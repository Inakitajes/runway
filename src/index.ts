#!/usr/bin/env bun
// `--line` prints a one-line summary for status bars; anything else opens the
// TUI. Dynamic imports keep the line mode from loading OpenTUI.
const mode = process.argv[2]
if (mode === "--line") (await import("./line")).printLine()
else if (mode === "--refresh-cache") await (await import("./line")).refreshCache()
else await import("./tui")

export {}
