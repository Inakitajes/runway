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

/** Partial cells, 1/8 to 8/8 filled from the left; ░ is the empty track. */
const EIGHTHS = "▏▎▍▌▋▊▉█"
const BAR_CELLS = 3

/** Horizontal bar of BAR_CELLS cells: ░░░ (unused) … ▉░░ … ███ (exhausted). */
export function bar(pct: number): string {
  const total = BAR_CELLS * 8
  let eighths = Math.min(total, Math.max(0, Math.round((pct / 100) * total)))
  if (eighths === 0 && pct > 0) eighths = 1
  const full = Math.floor(eighths / 8)
  const rest = eighths % 8
  const cells = "█".repeat(full) + (rest ? EIGHTHS[rest - 1] : "")
  return cells + "░".repeat(BAR_CELLS - [...cells].length)
}

function credits(row: UsageRow): string | null {
  const amount = row.detail?.match(/^\$([\d.,]+) left$/)?.[1]
  return amount ? `$${Math.round(Number(amount.replace(/,/g, "")))}` : null
}

function isWindow(label: string): boolean {
  return label === "Session 5h" || label === "Week" || /^Window \d+[hd]$/.test(label)
}

// Usage windows draw a bar each, in panel order (Claude: 5h then 7d),
// followed by the highest percentage: the window that will cut you off first.
function panelSummary(glyph: string, panel: PanelState | undefined, now: number): string | null {
  if (!panel || panel.data.rows.length === 0) return null
  if (now - panel.fetchedAt > OUTDATED_MS) return `${glyph} ?`
  const windows = panel.data.rows.filter((r) => r.pct !== null && isWindow(r.label)).map((r) => r.pct!)
  const parts = windows.map(bar)
  if (windows.length > 0) parts.push(`${Math.round(Math.max(...windows))}%`)
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
