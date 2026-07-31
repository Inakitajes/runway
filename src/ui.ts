import { t, fg, bold, italic, type StyledText } from "@opentui/core"
import type { UsageRow } from "./types"
import { activeTheme } from "./theme"

const BAR_WIDTH = 18
const LABEL_WIDTH = 13

// Cell eighths for the bar's leading edge
const PARTIALS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]

export function fmtCountdown(resetsAt: number, now: number): string {
  const s = Math.max(0, Math.floor((resetsAt - now) / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, "0")}s`
  return `${s}s`
}

function bar(pct: number): { fill: string; track: string } {
  const cells = (Math.min(100, Math.max(0, pct)) / 100) * BAR_WIDTH
  let full = Math.floor(cells)
  let eighths = Math.round((cells - full) * 8)
  if (eighths === 8) {
    full += 1
    eighths = 0
  }
  const fill = "█".repeat(full) + (PARTIALS[eighths] ?? "")
  const track = "░".repeat(BAR_WIDTH - full - (eighths > 0 ? 1 : 0))
  return { fill, track }
}

function pctChunk(pct: number) {
  const theme = activeTheme()
  const text = `${String(Math.round(pct)).padStart(3)}%`
  if (pct >= 85) return bold(theme.danger(text))
  if (pct >= 60) return bold(theme.warn(text))
  return bold(theme.text(text))
}

/** ▲ spending faster than the window's elapsed time, ▼ slower, · on pace */
function paceChunk(row: UsageRow, now: number) {
  const theme = activeTheme()
  if (row.pct === null || !row.resetsAt || !row.windowMs) return theme.pace(" ")
  const elapsed = 1 - (row.resetsAt - now) / row.windowMs
  if (elapsed <= 0 || elapsed > 1) return theme.pace(" ")
  const diff = row.pct / 100 - elapsed
  if (diff > 0.05) return theme.danger("▲")
  if (diff < -0.05) return theme.paceOk("▼")
  return theme.pace("·")
}

export function rowText(row: UsageRow, now: number, accent: string): StyledText {
  const theme = activeTheme()
  const label = row.label.padEnd(LABEL_WIDTH).slice(0, LABEL_WIDTH)
  if (row.pct === null) {
    const expiration = row.expiresAt === undefined ? "" : ` · next expires in ${fmtCountdown(row.expiresAt, now)}`
    return t`${theme.label(label)} ${theme.text(`${row.detail ?? ""}${expiration}`)}`
  }
  const { fill, track } = bar(row.pct)
  const right = row.resetsAt
    ? `  ${fmtCountdown(row.resetsAt, now)}`
    : row.detail
      ? `  ${row.detail}`
      : ""
  return t`${theme.label(label)} ${fg(accent)(fill)}${theme.track(track)} ${pctChunk(row.pct)} ${paceChunk(row, now)}${theme.label(right)}`
}

export function noteText(note: string): StyledText {
  return t`${italic(activeTheme().label(note))}`
}

export function hintText(hint: string): StyledText {
  return t`${italic(activeTheme().label(hint))}`
}
