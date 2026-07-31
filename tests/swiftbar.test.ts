import { expect, test } from "bun:test"
import type { PanelData } from "../src/types"
import { menuBarText, render, type MenuService } from "../scripts/swiftbar/format"

const NOW = 1_752_350_000_000
const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

const claudePanel: PanelData = {
  title: "Claude Max",
  rows: [
    { label: "Session", pct: 13, resetsAt: NOW + 41 * MINUTE },
    { label: "Week", pct: 30, resetsAt: NOW + 3 * DAY + 20 * HOUR },
  ],
}

const codexPanel: PanelData = {
  title: "Codex (ChatGPT)",
  rows: [
    { label: "Week", pct: 100, resetsAt: NOW + 4 * DAY + 19 * HOUR },
    { label: "Today", pct: null, detail: "0 tokens · streak 4d" },
  ],
}

const antigravityPanel: PanelData = {
  title: "Google Antigravity",
  rows: [
    { label: "Claude", pct: 0, detail: "2 models", resetsAt: NOW + 5 * HOUR },
    { label: "Gemini Flash", pct: 29, detail: "13 models", resetsAt: NOW + 4 * HOUR + 41 * MINUTE },
    { label: "Gemini Pro", pct: 29, detail: "3 models", resetsAt: NOW + 4 * HOUR + 41 * MINUTE },
  ],
}

const openRouterPanel: PanelData = {
  title: "OpenRouter",
  rows: [{ label: "Credits", pct: null, detail: "$0.0000 left" }],
  hint: "Model activity needs a management key",
}

const vercelPanel: PanelData = {
  title: "Vercel AI Gateway",
  rows: [],
  note: "No key: set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN, or add Vercel to opencode",
}

const services: MenuService[] = [
  {
    short: "Claude",
    title: "Claude Max",
    accent: "#d97757",
    panel: claudePanel,
    headline: (rows) => rows[0] ?? null,
  },
  {
    short: "Codex",
    title: "Codex (ChatGPT)",
    accent: "#74aa9c",
    panel: codexPanel,
    headline: (rows) => rows[0] ?? null,
  },
  {
    short: "Antigravity",
    title: "Google Antigravity",
    accent: "#4285f4",
    panel: antigravityPanel,
    headline: (rows) => rows.find((r) => r.label === "Gemini Flash") ?? null,
  },
  {
    short: "OpenRouter",
    title: "OpenRouter",
    accent: "#8b5cf6",
    panel: openRouterPanel,
    headline: () => null,
  },
  {
    short: "Vercel",
    title: "Vercel AI Gateway",
    accent: "#0070f3",
    panel: vercelPanel,
    headline: () => null,
  },
]

test("menuBarText joins a segment per service with a headline pct, skipping the rest", () => {
  expect(menuBarText(services, NOW)).toBe("Claude 13% · Codex 100% · Antigravity 29%")
})

test("menuBarText with ansi=true colors each segment with its accent", () => {
  const light: MenuService[] = services.map((service) =>
    service.title === "Codex (ChatGPT)"
      ? { ...service, panel: { ...codexPanel, rows: [{ label: "Week", pct: 30, resetsAt: NOW + DAY }] } }
      : service,
  )
  expect(menuBarText(light, NOW, { ansi: true })).toBe(
    "\x1b[38;2;217;119;87mClaude 13%\x1b[0m · \x1b[38;2;116;170;156mCodex 30%\x1b[0m · \x1b[38;2;66;133;244mAntigravity 29%\x1b[0m",
  )
})

test("menuBarText colors exhausted services (pct >= 100) red", () => {
  const exhausted: MenuService[] = [
    {
      short: "Codex",
      title: "Codex (ChatGPT)",
      accent: "#74aa9c",
      panel: codexPanel,
      headline: (rows) => rows[0] ?? null,
    },
  ]
  expect(menuBarText(exhausted, NOW, { ansi: true })).toBe("\x1b[38;2;255;59;48mCodex 100%\x1b[0m")
})

test("render emits the header line with ansi/dropdown params and a full dropdown body", () => {
  const output = render(services, NOW, {
    ansi: true,
    openRunwayScript: "/Users/davidgonzalez/code/me/runway/scripts/swiftbar/open-runway.sh",
  })
  const lines = output.split("\n")

  expect(lines[0]).toBe(
    "\x1b[38;2;217;119;87mClaude 13%\x1b[0m · \x1b[38;2;255;59;48mCodex 100%\x1b[0m · \x1b[38;2;66;133;244mAntigravity 29%\x1b[0m | ansi=true dropdown=false length=64",
  )
  expect(lines).toContain("**Claude Max** | md=true color=#d97757")
  expect(lines).toContain("Session · 13% used · resets in 41m | color=#d97757")
  expect(lines).toContain("Week · 100% used · resets in 4d 19h | color=#74aa9c")
  expect(lines).toContain("Credits · $0.0000 left | color=#8b5cf6")
  expect(lines).toContain("Model activity needs a management key | color=#8e8e93 length=64")
  expect(lines).toContain("No key: set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN, or add Vercel to opencode | color=#8e8e93 length=64")
  expect(lines).toContain("Open runway | bash=/Users/davidgonzalez/code/me/runway/scripts/swiftbar/open-runway.sh")
  expect(lines).toContain("Refresh now | refresh=true")
  expect(lines).toContain("Updated · now | color=#8e8e93")
  expect(output.split("\n---\n").length).toBeGreaterThan(1)
})

test("render without ansi omits the ansi=true param", () => {
  const lines = render(services, NOW, {}).split("\n")
  expect(lines[0]).toBe("Claude 13% · Codex 100% · Antigravity 29% | dropdown=false length=64")
})

test("render formats the relative update line", () => {
  const lines = render(services, NOW, { updatedAt: NOW - 5 * MINUTE }).split("\n")
  expect(lines).toContain("Updated · 5m ago | color=#8e8e93")
})
