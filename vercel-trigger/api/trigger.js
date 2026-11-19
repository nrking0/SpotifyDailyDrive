// =============================================================================
// Daily Drive — Vercel cron trigger
// =============================================================================
// GitHub's own schedule runs hours late, so Vercel cron calls this endpoint
// and it starts the GitHub Actions workflow through the API (the same as
// clicking "Run workflow").
//
// Vercel env vars:
//   CRON_SECRET             required  random string; Vercel sends it as
//                                     "Authorization: Bearer <CRON_SECRET>"
//   GITHUB_DISPATCH_TOKEN   required  fine-grained token, this repo only,
//                                     "Actions: Read and write"
//   GITHUB_REPO             optional  owner/name (default nrking0/SpotifyDailyDrive)
//
// It returns only status codes and fixed messages, never token values.
// =============================================================================

const crypto = require("crypto");

const WORKFLOW_FILE = "daily-drive.yml";

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.authorization || "", `Bearer ${secret}`)) {
    return res.status(401).json({ ok: false });
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return res.status(500).json({ ok: false, error: "missing GITHUB_DISPATCH_TOKEN" });
  }
  const repo = process.env.GITHUB_REPO || "nrking0/SpotifyDailyDrive";

  try {
    const gh = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "dailydrive-vercel-trigger",
          "Content-Type": "application/json",
        },
        // source=cron makes the workflow apply its 6 AM Chicago check
        body: JSON.stringify({ ref: "main", inputs: { source: "cron" } }),
      }
    );
    if (gh.status === 204 || gh.status === 200) {
      return res.status(200).json({ ok: true });
    }
    return res.status(502).json({ ok: false, github_status: gh.status });
  } catch {
    return res.status(502).json({ ok: false, error: "github request failed" });
  }
};
