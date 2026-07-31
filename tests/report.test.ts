import { expect, test } from "bun:test"
import { fmtDuration, fmtPanel, fmtRow } from "../scripts/format"
import type { PanelData, UsageRow } from "../src/types"

const NOW = 1_752_350_000_000

const HOUR = 3_600_000
const DAY = 24 * HOUR

test("fmtDuration renders human durations, dropping empty units", () => {
  expect(fmtDuration(30_000)).toBe("30s")
  expect(fmtDuration(90_000)).toBe("1m 30s")
  expect(fmtDuration(HOUR)).toBe("1h")
  expect(fmtDuration(HOUR + 15 * 60_000)).toBe("1h 15m")
  expect(fmtDuration(7 * DAY)).toBe("7d")
  expect(fmtDuration(7 * DAY + 4 * HOUR)).toBe("7d 4h")
  expect(fmtDuration(-5_000)).toBe("0s")
})

test("fmtRow composes pct, detail, and countdowns", () => {
  const week: UsageRow = { label: "Week", pct: 42, resetsAt: NOW + 3 * DAY }
  expect(fmtRow(week, NOW)).toBe("Week · 42% used · resets in 3d")

  const credit: UsageRow = { label: "Credits", pct: null, detail: "unlimited" }
  expect(fmtRow(credit, NOW)).toBe("Credits · unlimited")

  const extra: UsageRow = {
    label: "Extra usage",
    pct: 10.4,
    detail: "$5.00 / $50.00",
    expiresAt: NOW + 60_000,
  }
  expect(fmtRow(extra, NOW)).toBe("Extra usage · 10% used · $5.00 / $50.00 · expires in 1m")
})

test("fmtPanel renders rows or the note", () => {
  const panel: PanelData = {
    title: "Claude Max",
    rows: [{ label: "Week", pct: 42, resetsAt: NOW + 3 * DAY }],
  }
  expect(fmtPanel(panel, NOW)).toEqual(["Claude Max", "  Week · 42% used · resets in 3d"])

  const note: PanelData = { title: "OpenRouter", rows: [], note: "Invalid OpenRouter API key" }
  expect(fmtPanel(note, NOW)).toEqual(["OpenRouter", "  Invalid OpenRouter API key"])

  const empty: PanelData = { title: "Codex (ChatGPT)", rows: [] }
  expect(fmtPanel(empty, NOW)).toEqual(["Codex (ChatGPT)", "  (no data)"])
})

test("fmtPanel renders the hint under the rows", () => {
  const panel: PanelData = {
    title: "OpenRouter",
    rows: [{ label: "Credits", pct: null, detail: "$8.46 left" }],
    hint: "Per-model activity needs an OpenRouter management key",
  }
  expect(fmtPanel(panel, NOW)).toEqual([
    "OpenRouter",
    "  Credits · $8.46 left",
    "  Per-model activity needs an OpenRouter management key",
  ])
})
