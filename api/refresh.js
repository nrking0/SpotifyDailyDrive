// =============================================================================
// Daily Drive — Vercel cron endpoint
// =============================================================================
// Vercel cron calls this at 11:00 and 12:00 UTC (see vercel.json). Whichever
// call lands in the 6 AM hour in Chicago runs the refresh, so the time stays
// right across daylight saving. index.js runs unchanged as a child process,
// in a temp folder holding config.yaml and .spotify-token.json written from
// environment variables.
//
// Vercel env vars:
//   CRON_SECRET     required  Vercel sends it as "Authorization: Bearer <value>"
//   DD_CONFIG_YAML  required  full contents of config.yaml
//   DD_TOKEN_JSON   required  full contents of .spotify-token.json
//
// Manual test (same auth header):  /api/refresh?force=1&dry=1
//   force=1  skip the 6 AM check     dry=1  run with --dry-run
//
// Vercel logs are private to your account, so script output is logged there.
// =============================================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const INDEX_JS = path.join(__dirname, "..", "index.js");
const TARGET_HOUR = 6; // 6 AM America/Chicago

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function chicagoHour(date = new Date()) {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hourCycle: "h23",
  }).format(date);
  return Number(h);
}

function refreshToken(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).refresh_token || null;
  } catch {
    return null;
  }
}

module.exports = function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.authorization || "", `Bearer ${secret}`)) {
    return res.status(401).json({ ok: false });
  }

  const query = req.query || {};
  const force = query.force === "1";
  const dryRun = query.dry === "1";

  const hour = chicagoHour();
  if (!force && hour !== TARGET_HOUR) {
    console.log(`Skipping: it's ${hour}:xx in Chicago, not ${TARGET_HOUR}:xx.`);
    return res.status(200).json({ ok: true, skipped: true, chicago_hour: hour });
  }

  const configYaml = process.env.DD_CONFIG_YAML;
  const tokenJson = process.env.DD_TOKEN_JSON;
  if (!configYaml || !tokenJson) {
    console.error("Missing DD_CONFIG_YAML or DD_TOKEN_JSON env var.");
    return res.status(500).json({ ok: false, error: "missing env vars" });
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dailydrive-"));
  try {
    const tokenFile = path.join(workDir, ".spotify-token.json");
    fs.writeFileSync(path.join(workDir, "config.yaml"), configYaml, { mode: 0o600 });
    fs.writeFileSync(tokenFile, tokenJson, { mode: 0o600 });
    const before = refreshToken(tokenFile);

    const args = [INDEX_JS];
    if (dryRun) args.push("--dry-run");
    const run = spawnSync(process.execPath, args, {
      cwd: workDir,
      encoding: "utf8",
      timeout: 50 * 1000,
      env: { PATH: process.env.PATH, HOME: workDir, NODE_ENV: "production" },
    });

    if (run.stdout) console.log(run.stdout);
    if (run.stderr) console.error(run.stderr);

    const after = refreshToken(tokenFile);
    if (after && after !== before) {
      console.warn(
        "Spotify issued a new refresh token. It can't be saved from here: " +
          "if refreshes start failing, re-run `npm run setup` locally and update DD_TOKEN_JSON."
      );
    }

    if (run.error && run.error.code === "ETIMEDOUT") {
      return res.status(504).json({ ok: false, error: "timed out" });
    }
    if (run.status !== 0) {
      return res.status(500).json({ ok: false, exit_code: run.status });
    }
    return res.status(200).json({ ok: true, dry_run: dryRun });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};
