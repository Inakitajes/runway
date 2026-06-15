import { homedir } from "node:os"
import { join } from "node:path"
import type { PanelData, UsageRow } from "../types"

export const CODEX_TITLE = "Codex (ChatGPT)"

const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), ".codex")
const AUTH_PATH = join(CODEX_HOME, "auth.json")
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const TOKEN_URL = "https://auth.openai.com/oauth/token"
// OAuth client id público del Codex CLI oficial
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const REFRESH_MARGIN_MS = 5 * 60_000

function jwtExpMs(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString())
    return typeof payload.exp === "number" ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/** Refresca el access token si caduca pronto y persiste la rotación en auth.json (igual que el CLI oficial). */
async function refreshIfNeeded(auth: any): Promise<{ token: string; authError?: string }> {
  let token: string = auth.tokens.access_token
  const refreshToken = auth.tokens?.refresh_token
  const expMs = jwtExpMs(token)
  if (!refreshToken || expMs === null || expMs > Date.now() + REFRESH_MARGIN_MS) return { token }

  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "openid profile email",
      }),
    })
  } catch {
    return { token } // sin red: intenta con el token actual y que falle el fetch de usage
  }
  if (res.status === 400 || res.status === 401) {
    return { token, authError: "Refresh rechazado: ejecuta `codex login` de nuevo" }
  }
  if (!res.ok) return { token }

  try {
    const fresh = await res.json()
    if (!fresh.access_token) return { token }
    token = fresh.access_token
    auth.tokens.access_token = fresh.access_token
    if (fresh.refresh_token) auth.tokens.refresh_token = fresh.refresh_token
    if (fresh.id_token) auth.tokens.id_token = fresh.id_token
    auth.last_refresh = new Date().toISOString()
    await Bun.write(AUTH_PATH, JSON.stringify(auth, null, 2))
  } catch {}
  return { token }
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

/** Actividad de hoy y racha desde wham/profiles/me; opcional, nunca rompe el panel */
async function fetchActivity(headers: Record<string, string>): Promise<UsageRow | null> {
  try {
    const res = await fetch("https://chatgpt.com/backend-api/wham/profiles/me", { headers })
    if (!res.ok) return null
    const stats = (await res.json())?.stats
    if (!stats) return null
    const today = new Date().toISOString().slice(0, 10)
    const bucket = (stats.daily_usage_buckets ?? []).find((b: any) => b?.start_date === today)
    const parts = [`${fmtTokens(bucket?.tokens ?? 0)} tokens`]
    if (typeof stats.current_streak_days === "number" && stats.current_streak_days > 0) {
      parts.push(`racha ${stats.current_streak_days}d`)
    }
    return { label: "Hoy", pct: null, detail: parts.join(" · ") }
  } catch {
    return null
  }
}

export async function fetchCodex(): Promise<PanelData> {
  const title = CODEX_TITLE
  const file = Bun.file(AUTH_PATH)
  if (!(await file.exists())) return { title, rows: [], note: "Ejecuta `codex login` para conectar tu cuenta" }

  let auth: any
  try {
    auth = await file.json()
  } catch {
    return { title, rows: [], note: "No pude leer ~/.codex/auth.json" }
  }
  if (!auth?.tokens?.access_token) return { title, rows: [], note: "Sin token: ejecuta `codex login`" }

  const { token, authError } = await refreshIfNeeded(auth)
  if (authError) return { title, rows: [], note: authError }
  const accountId = auth.tokens?.account_id

  const headers = {
    Authorization: `Bearer ${token}`,
    ...(accountId ? { "chatgpt-account-id": accountId } : {}),
  }
  let res: Response
  let activity: UsageRow | null
  try {
    ;[res, activity] = await Promise.all([fetch(USAGE_URL, { headers }), fetchActivity(headers)])
  } catch {
    return { title, rows: [], note: "Sin conexión con chatgpt.com" }
  }
  if (res.status === 401) return { title, rows: [], note: "Token caducado: ejecuta `codex login`" }
  if (!res.ok) return { title, rows: [], note: `Error ${res.status} del endpoint de usage` }

  let data: any
  try {
    data = await res.json()
  } catch {
    return { title, rows: [], note: "Respuesta no válida del endpoint" }
  }

  const rows: UsageRow[] = []
  const window = (label: string, w: any) => {
    if (!w || typeof w.used_percent !== "number") return
    let resetsAt: number | undefined
    if (typeof w.reset_at === "number" && w.reset_at > 0) {
      resetsAt = w.reset_at > 1e12 ? w.reset_at : w.reset_at * 1000
    }
    const windowMs =
      typeof w.limit_window_seconds === "number" && w.limit_window_seconds > 0
        ? w.limit_window_seconds * 1000
        : undefined
    rows.push({ label, pct: w.used_percent, resetsAt, windowMs })
  }
  window("Sesión 5h", data?.rate_limit?.primary_window)
  window("Semana", data?.rate_limit?.secondary_window)
  window("Code review", data?.code_review_rate_limit?.primary_window)
  for (const extra of data?.additional_rate_limits ?? []) {
    const name = extra?.name ?? extra?.display_name ?? "Extra"
    window(name, extra?.rate_limit?.primary_window ?? extra?.primary_window)
  }

  const credits = data?.credits
  if (credits && (credits.unlimited || credits.has_credits)) {
    // En planes Team/Business el saldo es un pool del workspace y la API no lo expone (balance: null)
    const balance = credits.balance != null && !Number.isNaN(Number(credits.balance)) ? String(credits.balance) : null
    rows.push({
      label: "Créditos",
      pct: null,
      detail: credits.unlimited
        ? "ilimitados"
        : credits.overage_limit_reached
          ? "límite de overage alcanzado"
          : balance !== null
            ? `${balance} restantes`
            : "pool del workspace · sin saldo vía API",
    })
  }

  const resets = data?.rate_limit_reset_credits?.available_count
  if (typeof resets === "number" && resets > 0) {
    rows.push({
      label: "Resets 5h",
      pct: null,
      detail: resets === 1 ? "1 disponible" : `${resets} disponibles`,
    })
  }

  const individualLimit = data?.spend_control?.individual_limit
  if (individualLimit != null) {
    rows.push({ label: "Límite mes", pct: null, detail: String(individualLimit) })
  }

  if (activity) rows.push(activity)

  if (rows.length === 0) return { title, rows, note: "El endpoint no devolvió ventanas de usage" }
  return { title, rows }
}
