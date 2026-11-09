#!/usr/bin/env node
// =============================================================================
// Daily Drive — silent CI runner (for GitHub Actions on a public repo)
// =============================================================================
// Public repos have public Actions logs. This wrapper makes sure nothing about
// your account or listening (podcasts, songs, genres, IDs, error text) can
// ever reach them:
//
//   - index.js runs as a child process with ALL output discarded
//     (stdout + stderr), so even a crash or stack trace prints nothing.
//   - Secrets are written to a private temp folder, never the repo folder,
//     and deleted afterwards.
//   - state.json is stored AES-256-GCM encrypted, because Actions caches can
//     be read by pull-request workflows from forks.
//   - This script itself only ever prints fixed strings — never an error
//     object, message, or anything read from config/token/state.
//
// Environment variables (set from GitHub Secrets in the workflow):
//   DD_CONFIG_YAML   required  full contents of config.yaml
//   DD_TOKEN_JSON    required  full contents of .spotify-token.json
//   DD_STATE_KEY     optional  passphrase used to encrypt state.json between runs
//   DD_GH_PAT        optional  token allowed to update repo secrets, used to save
//                              a rotated Spotify refresh token
//   DD_STATE_DIR     optional  where the encrypted state lives (default: .dd-state)
//   DD_DRY_RUN       optional  "true" to run with --dry-run
// =============================================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const INDEX_JS = path.resolve(__dirname, "..", "index.js");
const STATE_DIR = path.resolve(process.env.DD_STATE_DIR || ".dd-state");
const STATE_ENC = path.join(STATE_DIR, "state.json.enc");

// Only ever print these fixed strings.
function say(msg) {
  process.stdout.write(`${msg}\n`);
}

// Last line of defence: any unexpected error prints a fixed message only.
let workDir = null;
function cleanup() {
  if (!workDir) return;
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  workDir = null;
}
function bail(msg, code = 1) {
  cleanup();
  say(msg);
  process.exit(code);
}
process.on("uncaughtException", () => bail("Daily Drive: internal error in CI runner"));
process.on("unhandledRejection", () => bail("Daily Drive: internal error in CI runner"));

// --- State encryption (AES-256-GCM, key derived from DD_STATE_KEY) ---
function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32);
}

function encrypt(plain, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), data]);
}

function decrypt(blob, passphrase) {
  const salt = blob.subarray(0, 16);
  const iv = blob.subarray(16, 28);
  const tag = blob.subarray(28, 44);
  const data = blob.subarray(44);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function readRefreshToken(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).refresh_token || null;
  } catch {
    return null;
  }
}

function main() {
  const configYaml = process.env.DD_CONFIG_YAML;
  const tokenJson = process.env.DD_TOKEN_JSON;
  const stateKey = process.env.DD_STATE_KEY || "";
  const ghPat = process.env.DD_GH_PAT || "";
  const dryRun = process.env.DD_DRY_RUN === "true";

  if (!configYaml || !tokenJson) {
    bail("Daily Drive: missing DD_CONFIG_YAML or DD_TOKEN_JSON secret");
  }

  // Private temp folder for secrets (0700), outside the repo checkout.
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dailydrive-"));
  fs.chmodSync(workDir, 0o700);
  const configFile = path.join(workDir, "config.yaml");
  const tokenFile = path.join(workDir, ".spotify-token.json");
  const stateFile = path.join(workDir, "state.json");
  fs.writeFileSync(configFile, configYaml, { mode: 0o600 });
  fs.writeFileSync(tokenFile, tokenJson, { mode: 0o600 });
  const refreshBefore = readRefreshToken(tokenFile);

  // Restore encrypted state, if we have one. Failure just means a full rebuild.
  let stateRestored = false;
  if (stateKey && fs.existsSync(STATE_ENC)) {
    try {
      fs.writeFileSync(stateFile, decrypt(fs.readFileSync(STATE_ENC), stateKey), { mode: 0o600 });
      stateRestored = true;
    } catch {
      // wrong key or corrupt file — ignore
    }
  }

  // Run index.js with every byte of output discarded.
  const args = [INDEX_JS];
  if (dryRun) args.push("--dry-run");
  const result = spawnSync(process.execPath, args, {
    cwd: workDir,
    stdio: "ignore",
    timeout: RUN_TIMEOUT_MS,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
    },
  });

  // Save state back, encrypted. Plain state.json never leaves the temp folder.
  let stateSaved = false;
  if (stateKey && fs.existsSync(stateFile)) {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(STATE_ENC, encrypt(fs.readFileSync(stateFile), stateKey));
      stateSaved = true;
    } catch {
      // ignore — next run just rebuilds
    }
  }

  // If Spotify issued a new refresh token, store it back into the repo secret.
  let tokenNote = null;
  const refreshAfter = readRefreshToken(tokenFile);
  if (refreshAfter && refreshAfter !== refreshBefore) {
    if (ghPat) {
      const gh = spawnSync("gh", ["secret", "set", "DD_TOKEN_JSON"], {
        input: fs.readFileSync(tokenFile),
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 60 * 1000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          GH_TOKEN: ghPat,
          GH_REPO: process.env.GITHUB_REPOSITORY || "",
        },
      });
      tokenNote =
        gh.status === 0
          ? "Daily Drive: refresh token rotated and saved"
          : "Daily Drive: refresh token rotated but could NOT be saved (check DD_GH_PAT)";
    } else {
      tokenNote = "Daily Drive: refresh token rotated but no DD_GH_PAT to save it";
    }
  }

  cleanup();

  say(`Daily Drive: state ${stateRestored ? "restored" : "not restored"}, ${stateSaved ? "saved" : "not saved"}`);
  if (tokenNote) say(tokenNote);

  if (result.error && result.error.code === "ETIMEDOUT") {
    bail("Daily Drive: refresh timed out");
  }
  if (result.status === 0) {
    say(`Daily Drive: ${dryRun ? "dry run" : "refresh"} succeeded`);
    process.exit(0);
  }
  // Exit code only — no message text, which could contain IDs or names.
  bail(`Daily Drive: refresh failed (exit code ${result.status === null ? "signal" : result.status}). Run locally with npm test to see details.`);
}

try {
  main();
} catch {
  bail("Daily Drive: internal error in CI runner");
}
