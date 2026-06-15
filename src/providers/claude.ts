import { homedir } from "node:os"
import { join } from "node:path"
import type { PanelData, UsageRow } from "../types"

export const CLAUDE_TITLE = "Claude Max"

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const KEYCHAIN_SERVICE = "Claude Code-credentials"

let cachedUserAgent: string | null = null

/** El endpoint exige un User-Agent claude-code/<v>; intenta usar la versión instalada. */
async function userAgent(): Promise<string> {
  if (cachedUserAgent) return cachedUserAgent
  let version = "2.0.0"
  try {
    const proc = Bun.spawn(["claude", "--version"], { stderr: "ignore" })
    const out = await new Response(proc.stdout).text()
    const match = out.match(/\d+\.\d+\.\d+/)
    if ((await proc.exited) === 0 && match) version = match[0]
  } catch {}
  cachedUserAgent = `claude-code/${version}`
  return cachedUserAgent
}

async function readKeychain(): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { stderr: "ignore" },
    )
    const out = await new Response(proc.stdout).text()
    if ((await proc.exited) !== 0) return null
    return out.trim() || null
  } catch {
    return null
  }
}

async function readCredentialsFile(): Promise<string | null> {
  try {
    const file = Bun.file(join(homedir(), ".claude", ".credentials.json"))
    return (await file.exists()) ? await file.text() : null
  } catch {
    return null
  }
}

async function getToken(): Promise<string | null> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN
  const raw = (await readKeychain()) ?? (await readCredentialsFile())
  if (!raw) return null
  try {
    return JSON.parse(raw)?.claudeAiOauth?.accessToken ?? null
  } catch {
    return null
  }
}

const centsToUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`

export async function fetchClaude(): Promise<PanelData> {
  const title = CLAUDE_TITLE
  const token = await getToken()
  if (!token) return { title, rows: [], note: "Sin credenciales: inicia sesión en Claude Code" }

  let res: Response
  try {
    res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": await userAgent(),
        "Content-Type": "application/json",
      },
    })
  } catch {
    return { title, rows: [], note: "Sin conexión con api.anthropic.com" }
  }
  if (res.status === 401) return { title, rows: [], note: "Token caducado: abre Claude Code para refrescarlo" }
  if (res.status === 429) return { title, rows: [], note: "Rate limit del endpoint, reintento en el próximo ciclo" }
  if (!res.ok) return { title, rows: [], note: `Error ${res.status} del endpoint de usage` }

  let data: any
  try {
    data = await res.json()
  } catch {
    return { title, rows: [], note: "Respuesta no válida del endpoint" }
  }

  const HOUR = 3_600_000
  const rows: UsageRow[] = []
  const window = (label: string, w: any, windowMs: number) => {
    if (!w || typeof w.utilization !== "number") return
    const resetsAt = typeof w.resets_at === "string" ? Date.parse(w.resets_at) : NaN
    rows.push({
      label,
      pct: w.utilization,
      resetsAt: Number.isNaN(resetsAt) ? undefined : resetsAt,
      windowMs,
    })
  }
  window("Sesión 5h", data.five_hour, 5 * HOUR)
  window("Semana", data.seven_day, 7 * 24 * HOUR)
  window("Semana Opus", data.seven_day_opus, 7 * 24 * HOUR)
  window("Semana Sonnet", data.seven_day_sonnet, 7 * 24 * HOUR)

  const extra = data.extra_usage
  if (extra?.is_enabled) {
    const used = typeof extra.used_credits === "number" ? extra.used_credits : null
    const limit = typeof extra.monthly_limit === "number" ? extra.monthly_limit : null
    rows.push({
      label: "Extra usage",
      pct: typeof extra.utilization === "number" ? extra.utilization : null,
      detail:
        used !== null && limit !== null
          ? `${centsToUsd(used)} / ${centsToUsd(limit)}`
          : used !== null
            ? `${centsToUsd(used)} usados`
            : "activado",
    })
  }

  if (rows.length === 0) return { title, rows, note: "El endpoint no devolvió ventanas de usage" }
  return { title, rows }
}
