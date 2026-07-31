import type { PanelData, UsageRow } from "../src/types"

/** Renders a millisecond duration as a compact human string, dropping empty units. */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const d = Math.floor(total / 86_400)
  const h = Math.floor((total % 86_400) / 3_600)
  const m = Math.floor((total % 3_600) / 60)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  const s = total % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function countdown(row: UsageRow, now: number, field: "resetsAt" | "expiresAt", verb: string): string | null {
  const at = row[field]
  if (typeof at !== "number") return null
  return `${verb} in ${fmtDuration(at - now)}`
}

/** Renders one usage row as "Label · pct · detail · countdown". */
export function fmtRow(row: UsageRow, now: number): string {
  const parts: string[] = []
  if (typeof row.pct === "number") parts.push(`${Math.round(row.pct)}% used`)
  if (row.detail) parts.push(row.detail)
  const resetsIn = countdown(row, now, "resetsAt", "resets")
  if (resetsIn) parts.push(resetsIn)
  const expiresIn = countdown(row, now, "expiresAt", "expires")
  if (expiresIn) parts.push(expiresIn)
  return [row.label, ...parts].join(" · ")
}

/** Renders a panel as its title line plus indented rows or note. */
export function fmtPanel(panel: PanelData, now: number): string[] {
  const lines = [panel.title]
  if (panel.rows.length > 0) {
    for (const row of panel.rows) lines.push(`  ${fmtRow(row, now)}`)
  } else if (panel.note) {
    lines.push(`  ${panel.note}`)
  } else {
    lines.push("  (no data)")
  }
  if (panel.hint) lines.push(`  ${panel.hint}`)
  return lines
}
