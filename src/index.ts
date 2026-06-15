#!/usr/bin/env bun
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ASCIIFontRenderable,
  t,
  fg,
  bold,
  brightBlack,
  type StyledText,
} from "@opentui/core"
import { fetchClaude, CLAUDE_TITLE } from "./providers/claude"
import { fetchCodex, CODEX_TITLE } from "./providers/codex"
import type { PanelData } from "./types"
import { rowText, noteText } from "./ui"

const REFRESH_MS = 180_000 // mínimo seguro para el endpoint de Anthropic
const MANUAL_THROTTLE_MS = 10_000

interface PanelState {
  data: PanelData
  staleNote: string | null
}

const state = {
  claude: { data: { title: CLAUDE_TITLE, rows: [], note: "Cargando…" }, staleNote: null } as PanelState,
  codex: { data: { title: CODEX_TITLE, rows: [], note: "Cargando…" }, staleNote: null } as PanelState,
  lastUpdated: null as number | null,
  fetching: false,
  lastManual: 0,
}

const CLAUDE_ACCENT = "#d97757"
const CODEX_ACCENT = "#74aa9c"

const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 10 })

const container = new BoxRenderable(renderer, {
  flexDirection: "column",
  padding: 1,
  gap: 1,
  width: 64,
})
const header = new ASCIIFontRenderable(renderer, {
  text: "Runway",
  font: "tiny",
  color: [CLAUDE_ACCENT, CODEX_ACCENT],
})
const claudeBox = new BoxRenderable(renderer, {
  border: true,
  borderStyle: "rounded",
  borderColor: "#444444",
  title: ` ✳ ${CLAUDE_TITLE} `,
  titleColor: CLAUDE_ACCENT,
  paddingX: 1,
  flexDirection: "column",
  width: "100%",
})
const codexBox = new BoxRenderable(renderer, {
  border: true,
  borderStyle: "rounded",
  borderColor: "#444444",
  title: ` ⬡ ${CODEX_TITLE} `,
  titleColor: CODEX_ACCENT,
  paddingX: 1,
  flexDirection: "column",
  width: "100%",
})
const footer = new TextRenderable(renderer, { content: "" })
container.add(header)
container.add(claudeBox)
container.add(codexBox)
container.add(footer)
renderer.root.add(container)

function panelLines(panel: PanelState, now: number, accent: string): StyledText[] {
  if (panel.data.rows.length > 0) return panel.data.rows.map((row) => rowText(row, now, accent))
  return [noteText(panel.data.note ?? "Sin datos")]
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
  if (s < 5) return "ahora"
  if (s < 60) return `hace ${s}s`
  return `hace ${Math.floor(s / 60)}m`
}

function draw() {
  const now = Date.now()
  syncPanel(claudeBox, panelLines(state.claude, now, CLAUDE_ACCENT))
  syncPanel(codexBox, panelLines(state.codex, now, CODEX_ACCENT))
  claudeBox.bottomTitle = state.claude.staleNote ? ` ⚠ ${state.claude.staleNote} `.slice(0, 58) : undefined
  codexBox.bottomTitle = state.codex.staleNote ? ` ⚠ ${state.codex.staleNote} `.slice(0, 58) : undefined
  const updated = state.lastUpdated ? fmtAgo(state.lastUpdated, now) : "—"
  const status = state.fetching
    ? fg(CODEX_ACCENT)(` ${SPINNER[Math.floor(now / 250) % SPINNER.length]} actualizando`)
    : brightBlack(` · ${updated}`)
  footer.content = t` ${bold("r")} ${brightBlack("refrescar")} ${brightBlack("·")} ${bold("q")} ${brightBlack("salir")}${status}`
}

function applyResult(panel: PanelState, next: PanelData) {
  if (next.rows.length > 0 || panel.data.rows.length === 0) {
    // datos nuevos, o nunca hubo datos: muestra lo que haya venido (incluida la nota)
    panel.data = next
    panel.staleNote = null
  } else {
    // falló el refresco pero teníamos datos: consérvalos y marca el panel
    panel.staleNote = next.note ?? "sin refrescar"
  }
}

async function refresh() {
  if (state.fetching) return
  state.fetching = true
  draw()
  try {
    const [claude, codex] = await Promise.all([fetchClaude(), fetchCodex()])
    applyResult(state.claude, claude)
    applyResult(state.codex, codex)
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
setInterval(draw, 1000) // countdowns y reloj, sin refetch

// Para pruebas no interactivas: USAGE_EXIT_AFTER=<segundos>
if (process.env.USAGE_EXIT_AFTER) {
  setTimeout(quit, Number(process.env.USAGE_EXIT_AFTER) * 1000)
}
