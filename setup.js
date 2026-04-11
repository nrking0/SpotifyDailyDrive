#!/usr/bin/env node
// =============================================================================
// Daily Drive — First-Time Setup
// =============================================================================
// This script authenticates your Spotify account and saves a token file.
// You only need to run this ONCE (or again if your token expires after months).
//
// Usage:  npm run setup
// =============================================================================

const fs = require("fs");
const yaml = require("js-yaml");
const { SpotifyApi } = require("@spotify/web-api-ts-sdk");
const express = require("express");

const TOKEN_FILE = ".spotify-token.json";
const CONFIG_FILE = "config.yaml";

// --- Clear any existing token to force fresh auth ---
if (fs.existsSync(TOKEN_FILE)) {
  fs.unlinkSync(TOKEN_FILE);
  console.log("🗑️  Deleted old token — starting fresh auth");
}

// --- Load config ---
if (!fs.existsSync(CONFIG_FILE)) {
  console.error("\n❌ config.yaml not found!");
  console.error("   Run: cp config.example.yaml config.yaml");
  console.error("   Then fill in your Spotify credentials.\n");
  process.exit(1);
}

const config = yaml.load(fs.readFileSync(CONFIG_FILE, "utf8"));
const { client_id, client_secret, redirect_uri } = config.spotify;

if (
  !client_id ||
  !client_secret ||
  client_id === "your-client-id-here"
) {
  console.error("\n❌ Please fill in your Spotify credentials in config.yaml");
  console.error("   See README.md for how to get them.\n");
  process.exit(1);
}

// --- Set up Spotify client ---
const spotifyApi = SpotifyApi.withClientCredentials(client_id, client_secret);

const SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-read-private",
  "user-read-recently-played",
  "user-top-read",
];
const AUTH_STATE = "dailydrive";

function buildAuthorizeUrl() {
  const params = new URLSearchParams({
    client_id,
    response_type: "code",
    redirect_uri,
    state: AUTH_STATE,
    scope: SCOPES.join(" "),
    show_dialog: "true",
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

// --- Start a tiny web server to catch the callback ---
const app = express();
const port = new URL(redirect_uri).port || 8888;

app.get("/callback", async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    res.send(`<h1>Error: ${error}</h1><p>Please try again.</p>`);
    console.error(`\n❌ Authorization failed: ${error}\n`);
    process.exit(1);
  }

  if (state !== AUTH_STATE) {
    res.send("<h1>Error</h1><p>Invalid OAuth state. Please try setup again.</p>");
    console.error("\n❌ OAuth state mismatch\n");
    process.exit(1);
  }

  try {
    const authBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri,
      client_id,
      client_secret,
    });
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: authBody.toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    }
    const data = await tokenRes.json();
    const tokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };

    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));

    res.send(
      "<h1>✅ Success!</h1><p>You can close this window. Daily Drive is ready to go!</p>"
    );
    console.log("\n✅ Authentication successful!");
    console.log(`   Token saved to ${TOKEN_FILE}`);
    console.log("\n   You can now run: npm start\n");

    // Give the browser a moment to show the success page
    setTimeout(() => process.exit(0), 1000);
  } catch (err) {
    res.send(`<h1>Error</h1><p>${err.message}</p>`);
    console.error("\n❌ Token exchange failed:", err.message, "\n");
    process.exit(1);
  }
});

// Bind to all interfaces (0.0.0.0) for Docker compatibility, or 127.0.0.1 for local only
// In Docker, 127.0.0.1 only accepts local connections; port mapping requires 0.0.0.0
const bindAddress = process.env.DOCKER_ENV ? "0.0.0.0" : "127.0.0.1";
app.listen(port, bindAddress, () => {
  const authUrl = buildAuthorizeUrl();

  console.log("\n🎵 Daily Drive — Setup\n");
  console.log("Open this URL in your browser to authorize:\n");
  console.log(`  ${authUrl}\n`);

  // Try to open the browser automatically (works on desktop, not headless)
  import("open")
    .then((open) => open.default(authUrl))
    .catch(() => {
      // If running headless, user will need to copy/paste the URL
      console.log(
        "(If you're on a headless server, copy the URL above to a browser on another machine.)"
      );
      console.log(
        `Make sure your Spotify app's redirect URI is set to: ${redirect_uri}\n`
      );
    });
});
