#!/bin/bash
# Double-click in Finder to start the AyamNorliza dev environment.
# Next.js serves the frontend AND the server/API routes in one process.
# Supabase is hosted, so there is no local backend to boot — unless
# NEXT_PUBLIC_SUPABASE_URL points at localhost, which this script detects.

cd "$(dirname "$0")" || exit 1
PROJECT_DIR="$PWD"
STOP_FLAG="$PROJECT_DIR/.dev-stop-requested"
PORT=3000

printf '\033]0;AyamNorliza Dev\007'
rm -f "$STOP_FLAG"

# Finder-launched scripts don't always inherit the interactive-shell PATH.
export PATH="/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

hold_open() {
  echo
  read -r -n 1 -p "Press any key to close this window..."
  osascript -e 'tell application "Terminal" to close (every window whose name contains "AyamNorliza Dev")' >/dev/null 2>&1 &
  exit "${1:-1}"
}

echo "▶  AyamNorliza — starting dev environment"
echo "   project : $PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "✗  npm not found. Install Node 20+ first:  brew install node@20"
  hold_open 1
fi
echo "   node    : $(node -v)"
echo

if [ ! -f .env.local ]; then
  echo "✗  .env.local is missing. Copy .env.local.example and fill it in first."
  hold_open 1
fi

if [ ! -d node_modules ]; then
  echo "→  installing dependencies (first run, this takes a minute)…"
  if ! npm install; then
    echo "✗  npm install failed."
    hold_open 1
  fi
  echo
fi

# Free the port if a previous run is still holding it.
EXISTING=$(lsof -ti "tcp:$PORT" 2>/dev/null)
if [ -n "$EXISTING" ]; then
  echo "→  port $PORT is busy — stopping the previous dev server…"
  # shellcheck disable=SC2086
  kill $EXISTING 2>/dev/null
  sleep 2
  STILL=$(lsof -ti "tcp:$PORT" 2>/dev/null)
  # shellcheck disable=SC2086
  [ -n "$STILL" ] && kill -9 $STILL 2>/dev/null
fi

# Local Supabase stack — only when .env.local actually points at localhost.
if grep -qE '^NEXT_PUBLIC_SUPABASE_URL=https?://(127\.0\.0\.1|localhost)' .env.local; then
  echo "→  local Supabase detected — starting the local stack (Docker)…"
  if ! docker info >/dev/null 2>&1; then
    echo "✗  Docker isn't running. Start Docker Desktop, then try again."
    hold_open 1
  fi
  if ! npx --yes supabase start; then
    echo "✗  supabase start failed."
    hold_open 1
  fi
  echo
else
  echo "→  backend: hosted Supabase (nothing local to start)"
fi

echo "→  starting Next.js (frontend + API routes) on http://localhost:$PORT"
echo "   stop it with Ctrl+C, or double-click STOP-PROJECT.command"
echo

# Open the browser once the server is actually answering.
(
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "http://localhost:$PORT"; then
      open "http://localhost:$PORT"
      break
    fi
    sleep 1
  done
) >/dev/null 2>&1 &

npm run dev
STATUS=$?

# Stopped via STOP-PROJECT.command → close this window silently.
if [ -f "$STOP_FLAG" ]; then
  rm -f "$STOP_FLAG"
  nohup osascript \
    -e 'delay 0.5' \
    -e 'tell application "Terminal" to close (every window whose name contains "AyamNorliza Dev")' \
    >/dev/null 2>&1 &
  exit 0
fi

echo
echo "Dev server exited (code $STATUS)."
hold_open "$STATUS"
