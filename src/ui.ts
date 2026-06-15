import {
  t,
  fg,
  bold,
  red,
  yellow,
  white,
  brightBlack,
  italic,
  dim,
  type StyledText,
} from "@opentui/core"
import type { UsageRow } from "./types"

const BAR_WIDTH = 18
const LABEL_WIDTH = 13
const TRACK_COLOR = "#3a3a3a"
const PACE_OK_COLOR = "#4a9b5e"

// Octavos de celda para el borde de la barra
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
  const text = `${String(Math.round(pct)).padStart(3)}%`
  if (pct >= 85) return bold(red(text))
  if (pct >= 60) return bold(yellow(text))
  return bold(white(text))
}

/** ▲ gastando más rápido que el tiempo de ventana, ▼ más despacio, · en ritmo */
function paceChunk(row: UsageRow, now: number) {
  if (row.pct === null || !row.resetsAt || !row.windowMs) return dim(" ")
  const elapsed = 1 - (row.resetsAt - now) / row.windowMs
  if (elapsed <= 0 || elapsed > 1) return dim(" ")
  const diff = row.pct / 100 - elapsed
  if (diff > 0.05) return red("▲")
  if (diff < -0.05) return fg(PACE_OK_COLOR)("▼")
  return dim("·")
}

export function rowText(row: UsageRow, now: number, accent: string): StyledText {
  const label = row.label.padEnd(LABEL_WIDTH).slice(0, LABEL_WIDTH)
  if (row.pct === null) {
    return t`${brightBlack(label)} ${white(row.detail ?? "")}`
  }
  const { fill, track } = bar(row.pct)
  const right = row.resetsAt
    ? `  ${fmtCountdown(row.resetsAt, now)}`
    : row.detail
      ? `  ${row.detail}`
      : ""
  return t`${brightBlack(label)} ${fg(accent)(fill)}${fg(TRACK_COLOR)(track)} ${pctChunk(row.pct)} ${paceChunk(row, now)}${brightBlack(right)}`
}

export function noteText(note: string): StyledText {
  return t`${italic(brightBlack(note))}`
}
