#!/usr/bin/env bun
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ASCIIFontRenderable,
  t,
  fg,
  bold,
  type StyledText,
  type ThemeMode,
} from "@opentui/core"
import { fetchClaude, CLAUDE_TITLE } from "./providers/claude"
import { fetchCodex, CODEX_TITLE } from "./providers/codex"
import { fetchOpenRouter, OPENROUTER_TITLE } from "./providers/openrouter"
import { fetchVercel, VERCEL_TITLE } from "./providers/vercel"
import { fetchAntigravity, ANTIGRAVITY_TITLE } from "./providers/antigravity"
import type { PanelData } from "./types"
import { rowText, noteText, hintText } from "./ui"
import { activeTheme, setTheme } from "./theme"

const REFRESH_MS = 180_000 // safe minimum for the Anthropic endpoint
const MANUAL_THROTTLE_MS = 10_000

interface PanelState {
  data: PanelData
  staleNote: string | null
}

const state = {
  claude: { data: { title: CLAUDE_TITLE, rows: [], note: "Loading…" }, staleNote: null } as PanelState,
  codex: { data: { title: CODEX_TITLE, rows: [], note: "Loading…" }, staleNote: null } as PanelState,
  openrouter: { data: { title: OPENROUTER_TITLE, rows: [], note: "Loading…" }, staleNote: null } as PanelState,
  vercel: { data: { title: VERCEL_TITLE, rows: [], note: "Loading…" }, staleNote: null } as PanelState,
  antigravity: { data: { title: ANTIGRAVITY_TITLE, rows: [], note: "Loading…" }, staleNote: null } as PanelState,
  lastUpdated: null as number | null,
  fetching: false,
  lastManual: 0,
}

const CLAUDE_ACCENT = "#d97757"
const CODEX_ACCENT = "#74aa9c"
const OPENROUTER_ACCENT = "#8b5cf6"
const VERCEL_ACCENT = "#0070f3"
const ANTIGRAVITY_ACCENT = "#4285f4"

const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 10 })

// Terminal theme (light/dark). On terminals set to "system auto" this follows
// the OS appearance. We briefly wait for detection so the first frame already
// uses the right theme; if the terminal doesn't answer, we stay on dark.
setTheme(renderer.themeMode ?? (await renderer.waitForThemeMode(200)))

const container = new BoxRenderable(renderer, {
  flexDirection: "column",
  padding: 1,
  gap: 1,
  width: 64,
})
const header = new ASCIIFontRenderable(renderer, {
  text: "Runway",
  font: "tiny",
  color: [CLAUDE_ACCENT, CODEX_ACCENT, OPENROUTER_ACCENT, VERCEL_ACCENT, ANTIGRAVITY_ACCENT],
})
const claudeBox = new BoxRenderable(renderer, {
  border: true,
  borderStyle: "rounded",
  borderColor: activeTheme().border,
  title: ` ✳ ${CLAUDE_TITLE} `,
  titleColor: CLAUDE_ACCENT,
  paddingX: 1,
  flexDirection: "column",
  width: "100%",
})
const codexBox = new BoxRenderable(renderer, {
  border: true,
  borderStyle: "rounded",
  borderColor: activeTheme().border,
  title: ` ⬡ ${CODEX_TITLE} `,
  titleColor: CODEX_ACCENT,
  paddingX: 1,
  flexDirection: "column",
  width: "100%",
})
const openRouterBox = new BoxRenderable(renderer, {
  border: true,
  borderStyle: "rounded",
  borderColor: activeTheme().border,
  title: ` ◆ ${OPENROUTER_TITLE} `,
  titleColor: OPENROUTER_ACCENT,
  paddingX: 1,
  flexDirection: "column",
  width: "100%",
})
const vercelBox = new BoxRenderable(renderer, {
  border: true,
  borderStyle: "rounded",
  borderColor: activeTheme().border,
  title: ` ▲ ${VERCEL_TITLE} `,
  titleColor: VERCEL_ACCENT,
  paddingX: 1,
  flexDirection: "column",
  width: "100%",
})
const antigravityBox = new BoxRenderable(renderer, {
  border: true,
  borderStyle: "rounded",
  borderColor: activeTheme().border,
  title: ` ◉ ${ANTIGRAVITY_TITLE} `,
  titleColor: ANTIGRAVITY_ACCENT,
  paddingX: 1,
  flexDirection: "column",
  width: "100%",
})
const footer = new TextRenderable(renderer, { content: "" })
container.add(header)
container.add(claudeBox)
container.add(codexBox)
container.add(openRouterBox)
container.add(vercelBox)
container.add(antigravityBox)
container.add(footer)
renderer.root.add(container)

function panelLines(panel: PanelState, now: number, accent: string): StyledText[] {
  const lines =
    panel.data.rows.length > 0
      ? panel.data.rows.map((row) => rowText(row, now, accent))
      : [noteText(panel.data.note ?? "No data")]
  if (panel.data.hint) lines.push(hintText(panel.data.hint))
  return lines
}

function syncPanel(box: BoxRenderable, lines: StyledText[]) {
  const children = box.getChildren() as TextRenderable[]
  if (children.length !== lines.length) {
    for (const child of children) {
      box.remove(child.id)
      child.destroyRecursively()
    }
    for (const line of lines) {
      box.add(new TextRenderable(renderer, { content: line }))
    }
  } else {
    children.forEach((child, i) => {
      child.content = lines[i]!
    })
  }
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function fmtAgo(since: number, now: number): string {
  const s = Math.floor((now - since) / 1000)
  if (s < 5) return "now"
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

function draw() {
  const now = Date.now()
  // `text` carries an explicit fg: keybind letters use `bold` alone, and
  // OpenTUI's default foreground is white — invisible on a light terminal.
  const { label, text } = activeTheme()
  syncPanel(claudeBox, panelLines(state.claude, now, CLAUDE_ACCENT))
  syncPanel(codexBox, panelLines(state.codex, now, CODEX_ACCENT))
  syncPanel(openRouterBox, panelLines(state.openrouter, now, OPENROUTER_ACCENT))
  syncPanel(vercelBox, panelLines(state.vercel, now, VERCEL_ACCENT))
  syncPanel(antigravityBox, panelLines(state.antigravity, now, ANTIGRAVITY_ACCENT))
  claudeBox.bottomTitle = state.claude.staleNote ? ` ⚠ ${state.claude.staleNote} `.slice(0, 58) : undefined
  codexBox.bottomTitle = state.codex.staleNote ? ` ⚠ ${state.codex.staleNote} `.slice(0, 58) : undefined
  openRouterBox.bottomTitle = state.openrouter.staleNote ? ` ⚠ ${state.openrouter.staleNote} `.slice(0, 58) : undefined
  vercelBox.bottomTitle = state.vercel.staleNote ? ` ⚠ ${state.vercel.staleNote} `.slice(0, 58) : undefined
  antigravityBox.bottomTitle = state.antigravity.staleNote ? ` ⚠ ${state.antigravity.staleNote} `.slice(0, 58) : undefined
  const updated = state.lastUpdated ? fmtAgo(state.lastUpdated, now) : "—"
  const status = state.fetching
    ? fg(CODEX_ACCENT)(` ${SPINNER[Math.floor(now / 250) % SPINNER.length]} updating`)
    : label(` · ${updated}`)
  footer.content = t` ${bold(text("r"))} ${label("refresh")} ${label("·")} ${bold(text("q"))} ${label("quit")}${status}`
}

// Repaint when the terminal theme changes (e.g. the OS switches to light while
// in "system auto" mode). Text colors resolve on every draw(); the panel border
// has to be updated by hand.
function applyThemeMode(mode: ThemeMode) {
  if (!setTheme(mode)) return
  const { border } = activeTheme()
  claudeBox.borderColor = border
  codexBox.borderColor = border
  openRouterBox.borderColor = border
  vercelBox.borderColor = border
  antigravityBox.borderColor = border
  draw()
}
renderer.on("theme_mode", applyThemeMode)

function applyResult(panel: PanelState, next: PanelData) {
  if (next.rows.length > 0 || panel.data.rows.length === 0) {
    // fresh data, or we never had any: show whatever came back (note included)
    panel.data = next
    panel.staleNote = null
  } else {
    // refresh failed but we had data: keep it and flag the panel
    panel.staleNote = next.note ?? "not refreshed"
  }
}

async function refresh() {
  if (state.fetching) return
  state.fetching = true
  draw()
  try {
    const [claude, codex, openrouter, vercel, antigravity] = await Promise.all([
      fetchClaude(),
      fetchCodex(),
      fetchOpenRouter(),
      fetchVercel(),
      fetchAntigravity(),
    ])
    applyResult(state.claude, claude)
    applyResult(state.codex, codex)
    applyResult(state.openrouter, openrouter)
    applyResult(state.vercel, vercel)
    applyResult(state.antigravity, antigravity)
    state.lastUpdated = Date.now()
  } finally {
    state.fetching = false
    draw()
  }
}

function quit() {
  renderer.destroy()
  process.exit(0)
}

renderer.keyInput.on("keypress", (key) => {
  if (key.name === "q") quit()
  if (key.name === "r" && Date.now() - state.lastManual > MANUAL_THROTTLE_MS) {
    state.lastManual = Date.now()
    void refresh()
  }
})

draw()
void refresh()
setInterval(() => void refresh(), REFRESH_MS)
setInterval(draw, 1000) // countdowns and clock, without refetching

// For non-interactive tests: USAGE_EXIT_AFTER=<seconds>
if (process.env.USAGE_EXIT_AFTER) {
  setTimeout(quit, Number(process.env.USAGE_EXIT_AFTER) * 1000)
}
