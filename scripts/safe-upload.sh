#!/bin/sh
# Upload a new version of Chaos Engine, refusing anything that could create a subreddit.
#
# `devvit upload` creates a new app AND a new playtest subreddit when it can't find the app
# under your account (that is what got the account suspended once). This script only uploads
# when the existing app is listed under the logged-in account and devvit.json still names the
# existing test subreddit. It never runs `devvit playtest`, never installs, never posts.
#
#   sh scripts/safe-upload.sh
set -e
cd "$(dirname "$0")/.."
APP=chaos-engine-game
SUB=chaos_engine_game_dev

if ! npx devvit whoami >/dev/null 2>&1; then
  echo "Not logged in. Run:  npx devvit login --copy-paste   then run this again."
  exit 1
fi
echo "Logged in as: $(npx devvit whoami 2>&1 | tail -1)"

if ! grep -q "\"subreddit\": \"$SUB\"" devvit.json; then
  echo "STOP: devvit.json no longer names r/$SUB as the test subreddit. Not uploading."
  exit 1
fi

APPS=$(npx devvit list apps 2>&1 || true)
if ! printf '%s' "$APPS" | grep -q "$APP"; then
  echo "STOP: the app '$APP' is not listed under this account."
  echo "Uploading now would create a NEW app and a NEW subreddit. Not uploading."
  printf '%s\n' "$APPS"
  exit 1
fi
echo "Found '$APP' under this account. Checking the code..."

npm run check
echo "Uploading a new private version (no subreddit is created, nothing is posted)..."
npx devvit upload
echo "Done. To update the test subreddit, install the new version from developers.reddit.com/apps/$APP"
