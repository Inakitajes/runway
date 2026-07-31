import { afterEach, describe, expect, test } from "bun:test"
import {
  aggregateActivity,
  activityRows,
  cleanModelSlug,
  compactCount,
  fetchOpenRouterWithKey,
  keyRows,
  parseAnalytics,
  shortModelName,
  spendWindows,
  type ActivityItem,
} from "../../src/providers/openrouter"

// 2026-07-31T12:00:00Z — a Friday; its UTC week starts Monday 2026-07-27.
const NOW = Date.UTC(2026, 6, 31, 12)

const DAYS: ActivityItem[] = [
  { model: "openai/gpt-4.1", date: "2026-07-30", requests: 3, prompt_tokens: 100, completion_tokens: 50, usage: 0.01 },
  { model: "openai/gpt-4.1", date: "2026-07-31", requests: 2, prompt_tokens: 200, completion_tokens: 100, usage: 0.02 },
  { model: "anthropic/claude-sonnet-4.5", date: "2026-07-31", requests: 1, prompt_tokens: 1000, completion_tokens: 500, usage: 0.2 },
  { model: "deepseek/deepseek-chat", date: "2026-07-31", requests: 4, prompt_tokens: 400, completion_tokens: 100, usage: 0 },
  { model: "openai/gpt-4.1", date: "2026-06-15", requests: 10, prompt_tokens: 1000, completion_tokens: 500, usage: 0.5 },
]

test("compactCount renders compact magnitudes", () => {
  expect(compactCount(0)).toBe("0")
  expect(compactCount(999)).toBe("999")
  expect(compactCount(1_000)).toBe("1k")
  expect(compactCount(1_250)).toBe("1.3k")
  expect(compactCount(999_949)).toBe("999.9k")
  expect(compactCount(1_000_000)).toBe("1M")
  expect(compactCount(3_120_000)).toBe("3.12M")
})

test("shortModelName strips the provider prefix", () => {
  expect(shortModelName("openai/gpt-4.1")).toBe("gpt-4.1")
  expect(shortModelName("anthropic/claude-sonnet-4.5")).toBe("claude-sonnet-4.5")
  expect(shortModelName("gpt-4.1")).toBe("gpt-4.1")
})

test("cleanModelSlug strips the trailing date from permaslugs", () => {
  expect(cleanModelSlug("z-ai/glm-5.2-20260616")).toBe("z-ai/glm-5.2")
  expect(cleanModelSlug("openai/gpt-4.1-2025-04-14")).toBe("openai/gpt-4.1")
  expect(cleanModelSlug("anthropic/claude-sonnet-4.5")).toBe("anthropic/claude-sonnet-4.5")
})

test("parseAnalytics maps analytics rows to activity items", () => {
  const items = parseAnalytics({
    data: {
      data: [
        { date__day: "2026-07-31", model: "z-ai/glm-5.2-20260616", request_count: "98", total_usage: 1.736122, tokens_prompt: "3912131", tokens_completion: "37068" },
        { date__day: "2026-07-30", model: "openai/gpt-4.1-2025-04-14", request_count: "5", total_usage: 0.015, tokens_prompt: "100", tokens_completion: "50" },
      ],
    },
  })
  expect(items).toEqual([
    { model: "z-ai/glm-5.2", date: "2026-07-31", requests: 98, prompt_tokens: 3912131, completion_tokens: 37068, usage: 1.736122 },
    { model: "openai/gpt-4.1", date: "2026-07-30", requests: 5, prompt_tokens: 100, completion_tokens: 50, usage: 0.015 },
  ])
})

test("parseAnalytics rejects malformed responses", () => {
  expect(parseAnalytics({ data: {} })).toBeNull()
  expect(parseAnalytics({ data: { data: [{ model: 42 }] } })).toEqual([])
  expect(parseAnalytics(null)).toBeNull()
})

test("aggregateActivity sums per model and sorts by cost desc", () => {
  const stats = aggregateActivity(DAYS)
  expect(stats.map((s) => s.model)).toEqual([
    "openai/gpt-4.1",
    "anthropic/claude-sonnet-4.5",
    "deepseek/deepseek-chat",
  ])
  const gpt = stats[0]!
  expect(gpt.requests).toBe(15)
  expect(gpt.tokens).toBe(1950)
  expect(gpt.cost).toBeCloseTo(0.53, 10)
  expect(gpt.costPerMillion).toBeCloseTo((0.53 / 1950) * 1_000_000, 6)
  const claude = stats[1]!
  expect(claude.costPerMillion).toBeCloseTo((0.2 / 1500) * 1_000_000, 6)
  expect(stats[2]!.costPerMillion).toBe(0) // free model: $0.00/M
})

test("aggregateActivity leaves the cost per million null without tokens", () => {
  const stats = aggregateActivity([{ model: "openai/gpt-4.1", date: "2026-07-31", requests: 0, prompt_tokens: 0, completion_tokens: 0, usage: 0.5 }])
  expect(stats[0]!.costPerMillion).toBeNull()
})

test("spendWindows buckets usage by today, week, and month", () => {
  const windows = spendWindows(DAYS, NOW)
  expect(windows.today).toBeCloseTo(0.22, 10) // 07-31 items: gpt 0.02 + claude 0.2
  expect(windows.week).toBeCloseTo(0.23, 10) // adds the 07-30 gpt item
  expect(windows.month).toBeCloseTo(0.23, 10) // the June item stays out
})

test("activityRows builds credits, spend windows, then models", () => {
  const rows = activityRows(DAYS, 8.46, NOW)
  expect(rows).toEqual([
    { label: "Credits", pct: null, detail: "$8.46 left" },
    { label: "Today", pct: null, detail: "$0.2200 spent" },
    { label: "Week", pct: null, detail: "$0.2300 spent" },
    { label: "Month", pct: null, detail: "$0.2300 spent" },
    { label: "gpt-4.1", pct: null, detail: "15 req · 2k tok · $0.5300 · $271.79/M" },
    { label: "claude-sonnet-4.5", pct: null, detail: "1 req · 1.5k tok · $0.2000 · $133.33/M" },
    { label: "deepseek-chat", pct: null, detail: "4 req · 500 tok · $0.0000 · $0.00/M" },
  ])
})

test("activityRows skips zero spend windows and omits credits without a balance", () => {
  const rows = activityRows([DAYS[4]!], null, NOW)
  expect(rows).toEqual([
    { label: "gpt-4.1", pct: null, detail: "10 req · 1.5k tok · $0.5000 · $333.33/M" },
  ])
})

test("activityRows caps the model list", () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    model: `openai/model-${i}`,
    date: "2026-07-31",
    requests: 1,
    prompt_tokens: 10,
    completion_tokens: 10,
    usage: 0.01,
  }))
  const rows = activityRows(items, null, NOW)
  const modelRows = rows.filter((r) => r.label.startsWith("model-"))
  expect(modelRows).toHaveLength(6)
})

test("keyRows renders credits plus the spend windows", () => {
  const rows = keyRows({ usage_daily: 1.5, usage_weekly: 3, usage_monthly: 10 }, 8.46)
  expect(rows).toEqual([
    { label: "Credits", pct: null, detail: "$8.46 left" },
    { label: "Today", pct: null, detail: "$1.50 spent" },
    { label: "Week", pct: null, detail: "$3.00 spent" },
    { label: "Month", pct: null, detail: "$10.00 spent" },
  ])
})

test("keyRows falls back to the key limit and skips zero windows", () => {
  const rows = keyRows({ limit_remaining: 5, usage_daily: 0 }, null)
  expect(rows).toEqual([{ label: "Credits", pct: null, detail: "$5.00 left" }])
})

test("keyRows returns nothing when there is no usable data", () => {
  expect(keyRows({}, null)).toEqual([])
})

describe("fetchOpenRouterWithKey", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetch(routes: {
    credits?: { status?: number; body: unknown }
    analytics?: { status?: number; body: unknown }
    key?: { status?: number; body: unknown }
  }): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes("/api/v1/credits")) {
        return Response.json(routes.credits?.body ?? {}, { status: routes.credits?.status ?? 200 })
      }
      if (url.includes("/api/v1/analytics/query")) {
        return Response.json(routes.analytics?.body ?? {}, { status: routes.analytics?.status ?? 200 })
      }
      if (url.includes("/api/v1/key")) {
        return Response.json(routes.key?.body ?? {}, { status: routes.key?.status ?? 200 })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as typeof fetch
  }

  test("shows per-model activity with a management key", async () => {
    globalThis.fetch = mockFetch({
      credits: { body: { data: { total_credits: 10, total_usage: 1.54 } } },
      analytics: {
        body: {
          data: {
            data: [
              { date__day: "2026-07-30", model: "openai/gpt-4.1-2025-04-14", request_count: "5", total_usage: 0.015, tokens_prompt: "100", tokens_completion: "50" },
            ],
          },
        },
      },
    })

    const panel = await fetchOpenRouterWithKey("sk-or-v1-test")

    expect(panel.rows).toContainEqual({ label: "Credits", pct: null, detail: "$8.46 left" })
    expect(panel.rows).toContainEqual({
      label: "gpt-4.1",
      pct: null,
      detail: "5 req · 150 tok · $0.0150 · $100.00/M",
    })
    expect(panel.hint).toBeUndefined()
  })

  test("falls back to the key spend windows without a management key", async () => {
    globalThis.fetch = mockFetch({
      credits: { body: { data: { total_credits: 10, total_usage: 1.54 } } },
      analytics: { status: 403, body: { error: { message: "Only management keys can query analytics", code: 403 } } },
      key: { body: { data: { usage_daily: 0.5, usage_weekly: 1.54, usage_monthly: 1.54 } } },
    })

    const panel = await fetchOpenRouterWithKey("sk-or-v1-test")

    expect(panel.rows).toContainEqual({ label: "Credits", pct: null, detail: "$8.46 left" })
    expect(panel.rows).toContainEqual({ label: "Week", pct: null, detail: "$1.54 spent" })
    expect(panel.hint).toContain("management key")
  })

  test("reports an invalid key without extra requests", async () => {
    let hits = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      hits++
      const url = String(input)
      if (url.endsWith("/credits")) return Response.json({}, { status: 401 })
      throw new Error(`Unexpected request: ${url}`)
    }) as typeof fetch

    const panel = await fetchOpenRouterWithKey("bad-key")

    expect(panel.note).toBe("Invalid OpenRouter API key")
    expect(hits).toBe(1)
  })
})
