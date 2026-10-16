#!/bin/sh
# Launcher for the herdr popup. herdr's server can run with a minimal PATH
# (no ~/.bun/bin), so look for bun in its usual install spots too.
for bun in "$(command -v bun)" "${BUN_INSTALL:-$HOME/.bun}/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
  [ -x "$bun" ] && exec "$bun" src/index.ts
done
echo "runway: bun not found (https://bun.sh)" >&2
sleep 5
exit 1
