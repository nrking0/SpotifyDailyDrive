#!/usr/bin/env bash
# =============================================================================
# Deploy the Vercel cron function from a clean folder.
# =============================================================================
# Copies ONLY the files the function needs into a temp folder and deploys
# from there, so config.yaml, .spotify-token.json, .env and the Dockerfile
# can never be uploaded. (A local `vercel build` ignores .vercelignore and
# picks up the Dockerfile.)
#
# Usage:  scripts/deploy-vercel.sh        (run from the repo root, after `vercel link`)
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .vercel/project.json ]; then
  echo "Not linked yet. Run: vercel link --project dailydrive"
  exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/api" "$STAGE/public" "$STAGE/.vercel"
cp api/refresh.js "$STAGE/api/"
cp public/robots.txt "$STAGE/public/"
cp index.js package.json vercel.json "$STAGE/"
[ -f package-lock.json ] && cp package-lock.json "$STAGE/"
cp .vercel/project.json "$STAGE/.vercel/"

echo "Deploying these files:"
(cd "$STAGE" && find . -type f -not -path "./.vercel/*" | sort)

(cd "$STAGE" && vercel deploy --prod --yes)
