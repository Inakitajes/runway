import type { PanelData, UsageRow } from "../../src/types"
import { fmtRow } from "../format"

export interface MenuService {
  /** Short label shown in the menu bar, e.g. "Antigravity" */
  short: string
  /** Full panel title used as the dropdown section header */
  title: string
  /** Hex accent color for the section */
  accent: string
  panel: PanelData
  /** Picks the row that represents this service in the menu bar */
  headline: (rows: UsageRow[]) => UsageRow | null
}

export interface MenuOptions {
  /** Color each menu bar segment with ANSI truecolor (SwiftBar: ansi=true) */
  ansi?: boolean
  /** Absolute path to the script that opens the runway TUI */
  openRunwayScript?: string
  /** When the data was fetched; defaults to `now` */
  updatedAt?: number
}

const EXHAUSTED = "#ff3b30"
const MUTED = "#8e8e93"

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function ansiFg(hex: string): string {
  const [r, g, b] = hexToRgb(hex) ?? [0, 0, 0]
  return `\x1b[38;2;${r};${g};${b}m`
}

/** Compact relative age, e.g. "now", "2m ago", "3h ago". */
export function fmtAgo(since: number, now: number): string {
  const seconds = Math.floor((now - since) / 1000)
  if (seconds < 5) return "now"
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3_600)}h ago`
}

function segment(service: MenuService, now: number, ansi: boolean): string | null {
  const row = service.headline(service.panel.rows)
  if (!row || typeof row.pct !== "number") return null
  const text = `${service.short} ${Math.round(row.pct)}%`
  if (!ansi) return text
  const color = row.pct >= 100 ? EXHAUSTED : service.accent
  return `${ansiFg(color)}${text}\x1b[0m`
}

/** The menu bar title: one segment per service that has a headline pct. */
export function menuBarText(services: MenuService[], now: number, opts: { ansi?: boolean } = {}): string {
  const segments = services
    .map((service) => segment(service, now, opts.ansi === true))
    .filter((part): part is string => part !== null)
  return segments.join(" · ")
}

/** Full SwiftBar plugin output: menu bar line + dropdown menu. */
export function render(services: MenuService[], now: number, opts: MenuOptions = {}): string {
  const ansi = opts.ansi === true
  const header = menuBarText(services, now, { ansi })
  const lines: string[] = [`${header} | ${ansi ? "ansi=true " : ""}dropdown=false length=64`]
  for (const service of services) {
    lines.push("---")
    lines.push(`**${service.panel.title}** | md=true color=${service.accent}`)
    if (service.panel.rows.length > 0) {
      for (const row of service.panel.rows) {
        lines.push(`${fmtRow(row, now)} | color=${service.accent}`)
      }
    } else if (service.panel.note) {
      lines.push(`${service.panel.note} | color=${MUTED} length=64`)
    } else {
      lines.push(`(no data) | color=${MUTED}`)
    }
    if (service.panel.hint) lines.push(`${service.panel.hint} | color=${MUTED} length=64`)
  }
  lines.push("---")
  if (opts.openRunwayScript) lines.push(`Open runway | bash=${opts.openRunwayScript}`)
  lines.push("Refresh now | refresh=true")
  lines.push(`Updated · ${fmtAgo(opts.updatedAt ?? now, now)} | color=${MUTED}`)
  return lines.join("\n")
}
