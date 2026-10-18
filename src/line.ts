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

/** Thin line bar (━━━╸┈┈): heavy line filled in half cells over a dotted track. */
const BAR_CELLS = 6

export function bar(pct: number): string {
  const total = BAR_CELLS * 2
  let halves = Math.min(total, Math.max(0, Math.round((pct / 100) * total)))
  if (halves === 0 && pct > 0) halves = 1
  const cells = "━".repeat(Math.floor(halves / 2)) + (halves % 2 ? "╸" : "")
  return cells + "┈".repeat(BAR_CELLS - cells.length)
}

function credits(row: UsageRow): string | null {
  const amount = row.detail?.match(/^\$([\d.,]+) left$/)?.[1]
  return amount ? `$${Math.round(Number(amount.replace(/,/g, "")))}` : null
}

function isWindow(label: string): boolean {
  return label === "Session 5h" || label === "Week" || /^Window \d+[hd]$/.test(label)
}

// Only the most used window is drawn (bar + percentage): it's the one that
// will cut you off first, whether it's the 5h session or the week.
function panelSummary(glyph: string, panel: PanelState | undefined, now: number): string | null {
  if (!panel || panel.data.rows.length === 0) return null
  if (now - panel.fetchedAt > OUTDATED_MS) return `${glyph} ?`
  const windows = panel.data.rows.filter((r) => r.pct !== null && isWindow(r.label)).map((r) => r.pct!)
  const parts: string[] = []
  if (windows.length > 0) {
    const worst = Math.max(...windows)
    parts.push(bar(worst), `${Math.round(worst)}%`)
  }
  parts.push(...panel.data.rows.map(credits).filter((c) => c !== null))
  return parts.length > 0 ? `${glyph} ${parts.join(" ")}` : null
}

export function formatLine(snap: Snapshot, now = Date.now()): string {
  return Object.entries(GLYPHS)
    .map(([id, glyph]) => panelSummary(glyph, snap.panels[id as keyof typeof GLYPHS], now))
    .filter((s) => s !== null)
    .join(" · ")
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
