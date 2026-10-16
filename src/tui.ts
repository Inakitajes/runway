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
import { CLAUDE_TITLE } from "./providers/claude"
import { CODEX_TITLE } from "./providers/codex"
import { OPENROUTER_TITLE } from "./providers/openrouter"
import { VERCEL_TITLE } from "./providers/vercel"
import { rowText, noteText } from "./ui"
import { activeTheme, setTheme } from "./theme"
import {
  PROVIDERS,
  isFresh,
  readSnapshot,
  refreshSnapshot,
  tryLock,
  unlock,
  type PanelState,
  type Snapshot,
} from "./cache"

// How often to look at the shared snapshot. A fetch only happens when it's
// older than REFRESH_MS, so `runway --line` and other TUIs share one budget.
const POLL_MS = 15_000
const MANUAL_THROTTLE_MS = 10_000

const loading = (title: string): PanelState => ({
  data: { title, rows: [], note: "Loading…" },
  staleNote: null,
  fetchedAt: 0,
})

const state = {
  claude: loading(CLAUDE_TITLE),
  codex: loading(CODEX_TITLE),
  openrouter: loading(OPENROUTER_TITLE),
  vercel: loading(VERCEL_TITLE),
  lastUpdated: null as number | null,
  fetching: false,
  lastManual: 0,
}

const CLAUDE_ACCENT = "#d97757"
const CODEX_ACCENT = "#74aa9c"
const OPENROUTER_ACCENT = "#8b5cf6"
const VERCEL_ACCENT = "#0070f3"

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
  color: [CLAUDE_ACCENT, CODEX_ACCENT, OPENROUTER_ACCENT, VERCEL_ACCENT],
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
const footer = new TextRenderable(renderer, { content: "" })
container.add(header)
container.add(claudeBox)
container.add(codexBox)
container.add(openRouterBox)
container.add(vercelBox)
container.add(footer)
renderer.root.add(container)

function panelLines(panel: PanelState, now: number, accent: string): StyledText[] {
  if (panel.data.rows.length > 0) return panel.data.rows.map((row) => rowText(row, now, accent))
  return [noteText(panel.data.note ?? "No data")]
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
  claudeBox.bottomTitle = state.claude.staleNote ? ` ⚠ ${state.claude.staleNote} `.slice(0, 58) : undefined
  codexBox.bottomTitle = state.codex.staleNote ? ` ⚠ ${state.codex.staleNote} `.slice(0, 58) : undefined
  openRouterBox.bottomTitle = state.openrouter.staleNote ? ` ⚠ ${state.openrouter.staleNote} `.slice(0, 58) : undefined
  vercelBox.bottomTitle = state.vercel.staleNote ? ` ⚠ ${state.vercel.staleNote} `.slice(0, 58) : undefined
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
  draw()
}
renderer.on("theme_mode", applyThemeMode)

function applySnapshot(snap: Snapshot) {
  for (const id of PROVIDERS) {
    const panel = snap.panels[id]
    if (panel) state[id] = panel
  }
  state.lastUpdated = snap.updatedAt
}

// Without `force`, a snapshot fresher than REFRESH_MS (ours or another
// process's) is adopted instead of fetching.
async function refresh(force = false) {
  if (state.fetching) return
  const snap = readSnapshot()
  if (!force && isFresh(snap)) {
    if (snap.updatedAt !== state.lastUpdated) {
      applySnapshot(snap)
      draw()
    }
    return
  }
  // another process is fetching: its snapshot gets picked up on the next poll
  if (!tryLock()) return
  state.fetching = true
  draw()
  try {
    applySnapshot(await refreshSnapshot())
  } finally {
    unlock()
    state.fetching = false
    draw()
  }
}

function quit() {
  renderer.destroy()
  process.exit(0)
}

renderer.keyInput.on("keypress", (key) => {
  // escape too, so it closes like any other popup (e.g. inside herdr)
  if (key.name === "q" || key.name === "escape") quit()
  if (key.name === "r" && Date.now() - state.lastManual > MANUAL_THROTTLE_MS) {
    state.lastManual = Date.now()
    void refresh(true)
  }
})

draw()
void refresh()
setInterval(() => void refresh(), POLL_MS)
setInterval(draw, 1000) // countdowns and clock, without refetching

// For non-interactive tests: USAGE_EXIT_AFTER=<seconds>
if (process.env.USAGE_EXIT_AFTER) {
  setTimeout(quit, Number(process.env.USAGE_EXIT_AFTER) * 1000)
}
