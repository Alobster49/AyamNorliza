#!/bin/bash
# Double-click in Finder to stop everything START-PROJECT.command started.
# Closes the dev window and then this one automatically.

cd "$(dirname "$0")" || exit 1
PROJECT_DIR="$PWD"
STOP_FLAG="$PROJECT_DIR/.dev-stop-requested"
PORT=3000

printf '\033]0;AyamNorliza Stop\007'
export PATH="/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Tells the running START window this was a deliberate stop, so it self-closes.
touch "$STOP_FLAG"

echo "■  AyamNorliza — stopping dev environment"
echo

# 1. Next.js dev server on port 3000.
PIDS=$(lsof -ti "tcp:$PORT" 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "→  stopping Next.js on port $PORT…"
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null
  sleep 2
  STILL=$(lsof -ti "tcp:$PORT" 2>/dev/null)
  # shellcheck disable=SC2086
  [ -n "$STILL" ] && kill -9 $STILL 2>/dev/null
else
  echo "→  no dev server running on port $PORT"
fi

# 2. Any stray next process belonging to this project only.
pkill -f "$PROJECT_DIR/node_modules/.bin/next" 2>/dev/null
pkill -f "$PROJECT_DIR/node_modules/next/dist/bin/next" 2>/dev/null

# 3. Local Supabase stack — only if its containers are actually up.
if docker info >/dev/null 2>&1; then
  if [ -n "$(docker ps -q --filter 'name=supabase_db_ayam-norliza-ops' 2>/dev/null)" ]; then
    echo "→  stopping local Supabase stack…"
    npx --yes supabase stop
  fi
fi

echo
echo "✓  all stopped."
sleep 1
rm -f "$STOP_FLAG"

# Close the dev window, then this one (delayed so this shell has exited first).
osascript -e 'tell application "Terminal" to close (every window whose name contains "AyamNorliza Dev")' >/dev/null 2>&1
nohup osascript \
  -e 'delay 0.5' \
  -e 'tell application "Terminal" to close (every window whose name contains "AyamNorliza Stop")' \
  >/dev/null 2>&1 &
disown 2>/dev/null
exit 0
