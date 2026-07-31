import { homedir } from "node:os"
import { join } from "node:path"
import type { PanelData, UsageRow } from "../types"

export const OPENROUTER_TITLE = "OpenRouter"

const CREDITS_URL = "https://openrouter.ai/api/v1/credits"
const KEY_URL = "https://openrouter.ai/api/v1/key"
const ANALYTICS_URL = "https://openrouter.ai/api/v1/analytics/query"
// Same keychain entry convoy uses (`convoy auth openrouter`): the management
// key that unlocks the exact /credits balance and the per-model analytics view.
const KEYCHAIN_SERVICE = "convoy"
const KEYCHAIN_ACCOUNT = "openrouter"

/** How many per-model rows the panel shows (sorted by spend). */
export const MAX_MODEL_ROWS = 6

const DAY_MS = 86_400_000

async function readKeychain(): Promise<string | null> {
  if (process.platform !== "darwin") return null
  try {
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { stderr: "ignore" },
    )
    const out = await new Response(proc.stdout).text()
    if ((await proc.exited) !== 0) return null
    return out.trim() || null
  } catch {
    return null
  }
}

function opencodeAuthPath(): string {
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "auth.json")
}

/** Keychain management key → OPENROUTER_API_KEY → the key opencode already stores. */
async function resolveKey(): Promise<string | null> {
  const fromKeychain = await readKeychain()
  if (fromKeychain) return fromKeychain
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  try {
    const entry = (await Bun.file(opencodeAuthPath()).json())?.openrouter
    if (entry?.type === "api" && typeof entry.key === "string" && entry.key.length > 0) return entry.key
  } catch {}
  return null
}

const money = (n: number) => `$${n.toFixed(n >= 1 ? 2 : 4)}`
const moneyPerMillion = (n: number) => `$${n.toFixed(2)}/M`

export interface ActivityItem {
  model: string
  /** UTC day, YYYY-MM-DD */
  date: string
  requests: number
  prompt_tokens: number
  completion_tokens: number
  usage: number
}

export interface ModelStats {
  model: string
  requests: number
  tokens: number
  cost: number
  /** Cost per million tokens; null when the model had no tokens. */
  costPerMillion: number | null
}

export interface SpendWindows {
  today: number
  week: number
  month: number
}

export interface KeyData {
  limit_remaining?: number | null
  usage_daily?: number
  usage_weekly?: number
  usage_monthly?: number
}

function trimTrailing(s: string): string {
  return s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")
}

/** 1950 → "2k", 3_120_000 → "3.12M", 0 → "0". */
export function compactCount(n: number): string {
  if (n < 1_000) return `${Math.round(n)}`
  // Round before formatting so 1.95 (stored as 1.9499…) becomes 2.0, not 1.9.
  const thousands = Math.round(n / 100) / 10
  if (thousands < 1_000) return `${trimTrailing(thousands.toFixed(1))}k`
  return `${trimTrailing((Math.round(n / 10_000) / 100).toFixed(2))}M`
}

/** "openai/gpt-4.1" → "gpt-4.1"; leaves a prefix-less slug alone. */
export function shortModelName(model: string): string {
  const slash = model.indexOf("/")
  return slash === -1 ? model : model.slice(slash + 1)
}

/** Sums activity rows (one per model per day) into per-model totals. */
export function aggregateActivity(items: ActivityItem[]): ModelStats[] {
  const byModel = new Map<string, ModelStats>()
  for (const item of items) {
    const entry = byModel.get(item.model) ?? {
      model: item.model,
      requests: 0,
      tokens: 0,
      cost: 0,
      costPerMillion: null,
    }
    entry.requests += item.requests
    entry.tokens += item.prompt_tokens + item.completion_tokens
    entry.cost += item.usage
    byModel.set(item.model, entry)
  }
  const stats = [...byModel.values()]
  for (const entry of stats) {
    entry.costPerMillion = entry.tokens > 0 ? (entry.cost / entry.tokens) * 1_000_000 : null
  }
  return stats.sort((a, b) => b.cost - a.cost)
}

function dateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7)
}

/** The UTC Monday that starts the week containing `ms`. */
function weekKey(ms: number): string {
  const dow = (new Date(ms).getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  return dateKey(ms - dow * DAY_MS)
}

/** Spend over the current UTC day, week (Monday-based), and calendar month. */
export function spendWindows(items: ActivityItem[], now: number): SpendWindows {
  const day = dateKey(now)
  const week = weekKey(now)
  const month = monthKey(now)
  let today = 0
  let weekSpend = 0
  let monthSpend = 0
  for (const item of items) {
    const at = Date.parse(`${item.date}T00:00:00Z`)
    if (Number.isNaN(at)) continue
    if (item.date === day) today += item.usage
    if (weekKey(at) === week) weekSpend += item.usage
    if (monthKey(at) === month) monthSpend += item.usage
  }
  return { today, week: weekSpend, month: monthSpend }
}

/** Today/Week/Month rows, dropping windows that saw no spend. */
const windowRows = (windows: SpendWindows): UsageRow[] => {
  const rows: UsageRow[] = []
  for (const [label, amount] of [
    ["Today", windows.today],
    ["Week", windows.week],
    ["Month", windows.month],
  ] as const) {
    if (amount > 0) rows.push({ label, pct: null, detail: `${money(amount)} spent` })
  }
  return rows
}

/** Credits, spend windows, then the top models — built from the account analytics. */
export function activityRows(items: ActivityItem[], balance: number | null, now: number): UsageRow[] {
  const rows: UsageRow[] = []
  if (balance !== null) rows.push({ label: "Credits", pct: null, detail: `${money(balance)} left` })
  rows.push(...windowRows(spendWindows(items, now)))
  for (const stats of aggregateActivity(items).slice(0, MAX_MODEL_ROWS)) {
    const perMillion = stats.costPerMillion === null ? "" : ` · ${moneyPerMillion(stats.costPerMillion)}`
    rows.push({
      label: shortModelName(stats.model),
      pct: null,
      detail: `${compactCount(stats.requests)} req · ${compactCount(stats.tokens)} tok · ${money(stats.cost)}${perMillion}`,
    })
  }
  return rows
}

/** Credits + spend windows from the key's own usage — the inference-key fallback. */
export function keyRows(data: KeyData, balance: number | null): UsageRow[] {
  const rows: UsageRow[] = []
  const creditAmount = balance ?? (typeof data.limit_remaining === "number" ? data.limit_remaining : null)
  if (creditAmount !== null) rows.push({ label: "Credits", pct: null, detail: `${money(creditAmount)} left` })
  rows.push(...windowRows({ today: data.usage_daily ?? 0, week: data.usage_weekly ?? 0, month: data.usage_monthly ?? 0 }))
  return rows
}

function metricNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** Strips the trailing date from a model permaslug ("z-ai/glm-5.2-20260616" → "z-ai/glm-5.2"). */
export function cleanModelSlug(slug: string): string {
  return slug.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "")
}

/** Maps an analytics/query response (grouped by model per day) to activity items. */
export function parseAnalytics(body: unknown): ActivityItem[] | null {
  const rows = (body as { data?: { data?: unknown } })?.data?.data
  if (!Array.isArray(rows)) return null
  const items: ActivityItem[] = []
  for (const raw of rows) {
    const entry = raw as Record<string, unknown> | null
    if (!entry || typeof entry.model !== "string") continue
    const date = (entry["date__day"] ?? entry["date"]) as unknown
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    items.push({
      model: cleanModelSlug(entry.model),
      date,
      requests: metricNumber(entry.request_count),
      prompt_tokens: metricNumber(entry.tokens_prompt),
      completion_tokens: metricNumber(entry.tokens_completion),
      usage: metricNumber(entry.total_usage),
    })
  }
  return items
}

const MANAGEMENT_KEY_HINT = "Per-model activity needs an OpenRouter management key"

export async function fetchOpenRouter(): Promise<PanelData> {
  const title = OPENROUTER_TITLE
  const key = await resolveKey()
  if (!key) return { title, rows: [], note: "No key: set OPENROUTER_API_KEY or add OpenRouter to opencode" }
  return fetchOpenRouterWithKey(key)
}

/** Fetches credits, per-model activity, and the key usage windows. */
export async function fetchOpenRouterWithKey(key: string): Promise<PanelData> {
  const title = OPENROUTER_TITLE
  const headers = { Authorization: `Bearer ${key}` }

  // 1. Account balance — /credits works for management and inference keys alike.
  let balance: number | null = null
  let res: Response
  try {
    res = await fetch(CREDITS_URL, { headers })
  } catch {
    return { title, rows: [], note: "No connection to openrouter.ai" }
  }
  if (res.status === 401) return { title, rows: [], note: "Invalid OpenRouter API key" }
  if (res.status !== 200 && res.status !== 403) {
    return { title, rows: [], note: `Error ${res.status} from the credits endpoint` }
  }
  if (res.ok) {
    const body = await res.json().catch(() => null)
    const total = body?.data?.total_credits
    const used = body?.data?.total_usage
    if (typeof total === "number" && typeof used === "number") balance = total - used
  }

  // 2. Per-model activity — the analytics API needs a management key; anything
  // else (403, malformed) falls back to the key's own windows via /key.
  const now = Date.now()
  const analyticsBody = {
    metrics: ["request_count", "total_usage", "tokens_prompt", "tokens_completion"],
    dimensions: ["model"],
    granularity: "day",
    time_range: { start: new Date(now - 29 * DAY_MS).toISOString(), end: new Date(now).toISOString() },
    order_by: { field: "total_usage", direction: "desc" },
  }
  let activity: ActivityItem[] | null = null
  let analyticsStatus = 0
  try {
    res = await fetch(ANALYTICS_URL, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(analyticsBody),
    })
    analyticsStatus = res.status
    if (res.ok) activity = parseAnalytics(await res.json().catch(() => null))
  } catch {
    analyticsStatus = 0
  }
  if (activity) return { title, rows: activityRows(activity, balance, now) }

  // 3. Inference-key fallback: the key's own spend windows.
  try {
    res = await fetch(KEY_URL, { headers })
  } catch {
    return { title, rows: [], note: "No connection to openrouter.ai" }
  }
  if (res.status === 401 || res.status === 403) return { title, rows: [], note: "Invalid OpenRouter API key" }
  if (!res.ok) return { title, rows: [], note: `Error ${res.status} from the key endpoint` }

  const data = (await res.json().catch(() => null))?.data as Partial<KeyData> | null | undefined
  const rows = keyRows(
    {
      limit_remaining: typeof data?.limit_remaining === "number" ? data.limit_remaining : null,
      usage_daily: typeof data?.usage_daily === "number" ? data.usage_daily : undefined,
      usage_weekly: typeof data?.usage_weekly === "number" ? data.usage_weekly : undefined,
      usage_monthly: typeof data?.usage_monthly === "number" ? data.usage_monthly : undefined,
    },
    balance,
  )
  if (rows.length === 0) return { title, rows: [], note: "Invalid response from the key endpoint" }
  return { title, rows, hint: analyticsStatus === 403 ? MANAGEMENT_KEY_HINT : undefined }
}
