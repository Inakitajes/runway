import { expect, test } from "bun:test"

import type { Snapshot } from "../src/cache"
import { bar, formatLine } from "../src/line"

const now = 10_000_000_000

test("summarizes usage windows and credit balances, skipping empty panels", () => {
  const snap: Snapshot = {
    updatedAt: now,
    panels: {
      claude: {
        data: {
          title: "Claude Max",
          rows: [
            { label: "Session 5h", pct: 3.4 },
            { label: "Week", pct: 41.6 },
            { label: "Extra usage", pct: 10, detail: "$1.00 / $10.00" },
          ],
        },
        staleNote: null,
        fetchedAt: now,
      },
      codex: {
        data: { title: "Codex", rows: [{ label: "Window 3d", pct: 15 }, { label: "Resets", pct: null, detail: "2 available" }] },
        staleNote: null,
        fetchedAt: now,
      },
      openrouter: {
        data: { title: "OpenRouter", rows: [{ label: "Credits", pct: null, detail: "$197.20 left" }] },
        staleNote: null,
        fetchedAt: now,
      },
      vercel: { data: { title: "Vercel", rows: [], note: "No key" }, staleNote: null, fetchedAt: now },
    },
  }

  expect(formatLine(snap, now)).toBe("✳ ━━╸┈┈┈ 42% · ⬡ ━┈┈┈┈┈ 15% · ◆ $197")
})

test("hides numbers that haven't refreshed in a long time", () => {
  const snap: Snapshot = {
    updatedAt: now,
    panels: {
      claude: {
        data: { title: "Claude Max", rows: [{ label: "Week", pct: 40 }] },
        staleNote: "Token expired",
        fetchedAt: now - 20 * 60_000,
      },
    },
  }

  expect(formatLine(snap, now)).toBe("✳ ?")
})

test("bars fill a thin line in half cells over a dotted track", () => {
  expect([0, 1, 30, 50, 65, 100].map(bar)).toEqual(["┈┈┈┈┈┈", "╸┈┈┈┈┈", "━━┈┈┈┈", "━━━┈┈┈", "━━━━┈┈", "━━━━━━"])
})
