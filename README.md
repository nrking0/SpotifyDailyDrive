# Daily Drive (Personal Fork)

Recreates Spotify's retired **Daily Drive** experience by building a playlist that blends podcast episodes with music on an automatic schedule.

This repo is my personal fork/customization of the original project by **Patrick Deglon**.

## Credit

All core project credit goes to:

- **Patrick Deglon**
- Original project: `patdeg/dailydrive`

This fork keeps the same core idea and expands it for my own usage and deployment workflow.

## What This Project Does

- Authenticates with Spotify using OAuth (`setup.js`)
- Pulls latest episodes from configured podcasts
- Pulls music from one or more sources:
  - top tracks
  - source playlists
  - genre discovery search
- Mixes podcasts + music using a configurable pattern like `PMMMM`
- Updates a target Spotify playlist
- Caches run state to avoid unnecessary updates

## What I Changed in This Fork

Compared to the original baseline concept, this version includes practical enhancements for my daily use:

- Added **hourly podcast-only refresh mode** (`--podcast-only`) so short-lived episodes stay fresh without reshuffling music
- Added **daily + hourly automation scripts** in `scripts/` for cron-based scheduling
- Uses Spotify playlist **`/items` endpoint** for playlist reads to avoid the deprecated `/tracks` behavior
- Added **music filtering controls** (`exclude_keywords`, optional classical filtering) for cleaner mixes
- Added **state-aware behavior** to skip updates when podcast episodes have not changed
- Added **AI taste profile helpers**:
  - `taste-profile.js` (Demeterics)
  - `taste-profile-google.js` (Gemini)
- Added **Docker support** (`Dockerfile`, `docker-compose.yml`) for containerized deployment

## Requirements

- Node.js 18+
- Spotify Premium account (required for current Spotify dev restrictions)
- Spotify Developer app credentials

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create config from template:

```bash
cp config.example.yaml config.yaml
```

3. Fill in `config.yaml`:

- `spotify.client_id`
- `spotify.client_secret`
- `spotify.redirect_uri` (use `http://127.0.0.1:8888/callback`)
- `playlist_id`
- podcast show IDs and music preferences

4. Run first-time auth:

```bash
npm run setup
```

5. Dry run:

```bash
npm test
```

6. Update playlist:

```bash
npm start
```

## Commands

- `npm run setup` - run OAuth setup and save Spotify token
- `npm start` - full playlist refresh
- `npm test` - dry run (no playlist write)
- `npm run taste` - generate genre suggestions via Demeterics
- `npm run taste:google` - generate genre suggestions via Gemini

## Scheduling

For unattended updates, use the scripts in `scripts/` with cron:

- `scripts/daily-refresh.sh` - full refresh + housekeeping
- `scripts/hourly-refresh.sh` - podcast-only refresh

These are designed for Linux-style deployments (including mini PCs and SBCs).

### Run on GitHub Actions

`.github/workflows/daily-drive.yml` refreshes the playlist at 11:07 and 22:07 UTC (and on demand from the Actions tab).

Actions logs on a public repo are public, so the workflow runs through `scripts/ci-run.js`, which throws away all script output and prints only fixed lines like `refresh succeeded` or `refresh failed (exit code 1)`. No podcast names, songs, IDs, or error messages ever reach the log. To see why a run failed, run `npm test` locally.

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Required | Value |
| --- | --- | --- |
| `DD_CONFIG_YAML` | yes | Full contents of your `config.yaml` |
| `DD_TOKEN_JSON` | yes | Full contents of `.spotify-token.json` (run `npm run setup` locally first) |
| `DD_STATE_KEY` | no | Any long random string. Encrypts `state.json` between runs so unchanged episodes can be skipped. Without it, every run does a full rebuild. |
| `DD_GH_PAT` | no | Fine-grained token for this repo with **Secrets: read and write**. Lets the workflow save a new refresh token if Spotify rotates it. |

From a terminal with the GitHub CLI:

```bash
gh secret set DD_CONFIG_YAML < config.yaml
gh secret set DD_TOKEN_JSON < .spotify-token.json
openssl rand -base64 32 | gh secret set DD_STATE_KEY
```

Notes:
- GitHub disables scheduled workflows on public repos after 60 days with no commits. Re-enable it from the Actions tab if that happens.
- If you edit `config.yaml`, update the `DD_CONFIG_YAML` secret too.
- Turn off the Docker container once this is running, or the playlist refreshes twice.

## Configuration Highlights

Main file: `config.yaml`

- `podcasts[]` supports `episodes` and optional `position: first`
- `music.top_tracks` controls personal favorites source
- `music.genres` enables discovery tracks
- `music.playlists` imports tracks from existing playlists
- `music.total_songs` sets music count target
- `mix_pattern` controls interleave logic (P=podcast, M=music)

Example pattern:

- `PMMMM` = 1 podcast, then 4 songs, repeat

## Security Notes

This repo intentionally keeps secrets out of git. Do not commit:

- `config.yaml`
- `.env`
- `.spotify-token.json`
- `state.json`

## License

MIT (see `LICENSE`).

---

If you are here from the original project: thank you again to Patrick for creating and sharing the foundation this fork is built on.
