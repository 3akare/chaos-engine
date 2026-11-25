#!/bin/sh
# Put Chaos Engine on Reddit in one go: log in, create the app the first time, upload, install.
#
#   sh scripts/safe-upload.sh r/YourCommunity
#
# Uses only Reddit's own devvit tool. It never posts as you. The first upload of a new app makes
# Reddit's tool create the app and a small playtest subreddit (that is how Devvit works); every
# later run just uploads a new version and updates the install.
set -e
cd "$(dirname "$0")/.."
SUB=$(printf '%s' "${1:-}" | sed 's#^/*r/##')
if [ -z "$SUB" ]; then
  echo "Which community should the game go on?  sh scripts/safe-upload.sh r/YourCommunity"
  exit 1
fi

if ! npx devvit whoami >/dev/null 2>&1; then
  echo "Step 1: log in. Open the link below, tap Allow, paste the code here."
  npx devvit login --copy-paste
fi
echo "Logged in as: $(npx devvit whoami 2>&1 | tail -1)"

APP=$(node -e "console.log(require('./devvit.json').name)")
if ! npx devvit list apps 2>&1 | grep -q "$APP"; then
  echo ""
  echo "First time: the app doesn't exist yet."
  echo "Open https://developers.reddit.com/new , name the app (e.g. $APP), copy the code it gives you,"
  echo "and paste it when asked below. Reddit's tool will also create a small playtest subreddit."
  printf "Press Enter to continue (Ctrl+C to stop) "
  read _
fi

npm run check
npx devvit upload
npx devvit install "$SUB"
echo "Done: the game is on r/$SUB. Its first post comes from the app's own account within a few minutes."
