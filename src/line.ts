import { spawn } from "node:child_process"
import { isFresh, readSnapshot, refreshSnapshot, tryLock, unlock, type PanelState, type Snapshot } from "./cache"
import type { UsageRow } from "./types"

// `runway --line`: one-line summary for status bars (herdr's tab_bar_right,
// tmux…). Status bars poll often and kill slow commands, so this only reads
// the shared snapshot and, when it's stale, refreshes it in a detached
// process for the next tick.

/** Older than this, a panel's numbers are replaced by "?" (open the TUI for the reason). */
const OUTDATED_MS = 15 * 60_000

const GLYPHS = { claude: "✳", codex: "⬡", openrouter: "◆", vercel: "▲" } as const

function windowTag(label: string): string | null {
  if (label === "Session 5h") return "5h"
  if (label === "Week") return "7d"
  return label.match(/^Window (\d+[hd])$/)?.[1] ?? null
}

function rowSummary(row: UsageRow): string | null {
  if (row.pct !== null) {
    const tag = windowTag(row.label)
    return tag ? `${tag} ${Math.round(row.pct)}%` : null
  }
  return row.detail?.match(/^(\$[\d.,]+) left$/)?.[1] ?? null
}

function panelSummary(glyph: string, panel: PanelState | undefined, now: number): string | null {
  if (!panel || panel.data.rows.length === 0) return null
  if (now - panel.fetchedAt > OUTDATED_MS) return `${glyph} ?`
  const parts = panel.data.rows.map(rowSummary).filter((p) => p !== null)
  return parts.length > 0 ? `${glyph} ${parts.join(" ")}` : null
}

export function formatLine(snap: Snapshot, now = Date.now()): string {
  return Object.entries(GLYPHS)
    .map(([id, glyph]) => panelSummary(glyph, snap.panels[id as keyof typeof GLYPHS], now))
    .filter((s) => s !== null)
    .join("  ")
}

function spawnRefresh() {
  // Compiled binaries run their bundled entry from Bun's virtual fs; from
  // source, re-run the same entry script with bun.
  const compiled = Bun.main.startsWith("/$bunfs/") || Bun.main.includes("~BUN")
  const args = compiled ? ["--refresh-cache"] : [Bun.main, "--refresh-cache"]
  spawn(process.execPath, args, { detached: true, stdio: "ignore" }).unref()
}

export function printLine() {
  const snap = readSnapshot()
  if (!isFresh(snap) && tryLock()) spawnRefresh()
  if (snap) console.log(formatLine(snap))
}

/** Body of the detached refresher; `printLine` already took the lock. */
export async function refreshCache() {
  try {
    await refreshSnapshot()
  } finally {
    unlock()
  }
}
