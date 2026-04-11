#!/bin/bash
# =============================================================================
# Daily Drive Docker Entrypoint
# =============================================================================
# Runs scheduler that executes npm start at configured times
# =============================================================================

set -e

CONFIG_FILE="config.yaml"
DOCKER_ENV="1"
DATA_DIR="/app/data"
LAST_RUNS_FILE="$DATA_DIR/scheduler-last-runs.state"

mkdir -p "$DATA_DIR"
touch "$LAST_RUNS_FILE"

# =============================================================================
# Step 1: Handle CLI arguments (for npm run setup, npm test, etc.)
# =============================================================================

# If docker run is called with explicit command, execute it
if [ "$#" -gt 0 ]; then
  export DOCKER_ENV="1"
  exec "$@"
fi

# =============================================================================
# Step 2: Validate config exists
# =============================================================================

if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ config.yaml not found"
  echo "   Mount it: docker compose run -v ./config.yaml:/app/config.yaml"
  exit 1
fi

# =============================================================================
# Step 3: Validate token exists
# =============================================================================

TOKEN_FILE=".spotify-token.json"

if [ ! -f "$TOKEN_FILE" ]; then
  echo ""
  echo "❌ Authentication required!"
  echo ""
  echo "   Run setup first:"
  echo "   docker compose run --rm -p 8889:8889 dailydrive npm run setup"
  echo ""
  exit 1
fi

# =============================================================================
# Step 4: Parse schedule and run scheduler
# =============================================================================

# Extract schedule times from config.yaml (UTC only)
# Uses Node.js to parse YAML safely
TIMES=$(node -e "
const fs = require('fs');
const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync('config.yaml', 'utf8'));
const times = config.schedule?.times || ['05:00', '17:00'];
console.log(times.join(' '));
" 2>/dev/null || echo '05:00 17:00')

echo "⏰ Scheduled refresh times (UTC): $TIMES"
echo ""
echo "🚗 Daily Drive scheduler running..."
echo ""

# =============================================================================
# Step 5: Run scheduler loop
# =============================================================================

# Function to run the playlist refresh
get_last_run_epoch() {
  local slot_time="$1"
  awk -F'|' -v t="$slot_time" '$1==t{print $2}' "$LAST_RUNS_FILE" | tail -n 1
}

set_last_run_epoch() {
  local slot_time="$1"
  local epoch="$2"
  local tmp_file
  tmp_file=$(mktemp)
  awk -F'|' -v t="$slot_time" '$1!=t' "$LAST_RUNS_FILE" > "$tmp_file"
  echo "$slot_time|$epoch" >> "$tmp_file"
  mv "$tmp_file" "$LAST_RUNS_FILE"
}

run_playlist_refresh() {
  local slot_time="$1"
  local slot_epoch="$2"
  local reason="$3"

  echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting refresh for $slot_time ($reason)..."
  if npm start; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Refresh completed"
  else
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] ⚠️ Refresh failed (will continue scheduler loop)"
  fi

  # Mark this slot as handled to avoid repeated attempts in the same loop window.
  set_last_run_epoch "$slot_time" "$slot_epoch"
}

# Catch up missed slots from yesterday/today if container was offline/sleeping.
catch_up_missed_runs() {
  local now_epoch
  now_epoch=$(date -u +%s)

  for scheduled_time in $TIMES; do
    # Check yesterday and today slots for each configured time.
    for day_offset in -1 0; do
      local date_str slot_epoch last_run
      date_str=$(date -u -d "$day_offset day" +%Y-%m-%d)
      slot_epoch=$(date -u -d "$date_str $scheduled_time" +%s)

      if [ "$slot_epoch" -le "$now_epoch" ]; then
        last_run=$(get_last_run_epoch "$scheduled_time")
        [ -z "$last_run" ] && last_run=0
        if [ "$last_run" -lt "$slot_epoch" ]; then
          run_playlist_refresh "$scheduled_time" "$slot_epoch" "catch-up"
        fi
      fi
    done
  done
}

catch_up_missed_runs

# Main scheduler loop: check every 30s, trigger once per slot.
last_heartbeat_minute=""
while true; do
  current_time=$(date -u +%H:%M)
  now_epoch=$(date -u +%s)
  current_minute=$(date -u +%M)

  # Heartbeat every 10 minutes so logs prove scheduler is alive.
  if [ "$((10#$current_minute % 10))" -eq 0 ] && [ "$last_heartbeat_minute" != "$current_minute" ]; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Scheduler alive. Waiting for: $TIMES"
    last_heartbeat_minute="$current_minute"
  fi

  for scheduled_time in $TIMES; do
    if [ "$current_time" = "$scheduled_time" ]; then
      today_slot_epoch=$(date -u -d "$(date -u +%Y-%m-%d) $scheduled_time" +%s)
      last_run=$(get_last_run_epoch "$scheduled_time")
      [ -z "$last_run" ] && last_run=0

      if [ "$last_run" -lt "$today_slot_epoch" ] && [ "$today_slot_epoch" -le "$now_epoch" ]; then
        run_playlist_refresh "$scheduled_time" "$today_slot_epoch" "scheduled"
      fi
    fi
  done

  # Also attempt catch-up periodically in case container resumes after sleep/network interruptions.
  catch_up_missed_runs

  sleep 30
done
