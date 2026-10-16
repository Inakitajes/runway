import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fetchClaude } from "./providers/claude"
import { fetchCodex } from "./providers/codex"
import { fetchOpenRouter } from "./providers/openrouter"
import { fetchVercel } from "./providers/vercel"
import type { PanelData } from "./types"

// Snapshot shared by every runway process (the TUI and `runway --line` run by
// status bars), so they all draw from one fetch budget instead of each
// hitting the Anthropic endpoint, which 429s below a 180 s cadence.

export const REFRESH_MS = 180_000 // safe minimum for the Anthropic endpoint
const LOCK_STALE_MS = 60_000 // a fetch never takes this long; a lock this old is from a dead process

const DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "runway")
const FILE = join(DIR, "snapshot.json")
const LOCK = join(DIR, "refresh.lock")

export const PROVIDERS = ["claude", "codex", "openrouter", "vercel"] as const
export type ProviderId = (typeof PROVIDERS)[number]

export interface PanelState {
  data: PanelData
  /** Set when the last refresh failed and `data` is from an earlier one */
  staleNote: string | null
  /** Epoch ms when `data` was fetched */
  fetchedAt: number
}

export interface Snapshot {
  /** Epoch ms of the last refresh attempt */
  updatedAt: number
  panels: Partial<Record<ProviderId, PanelState>>
}

export function readSnapshot(): Snapshot | null {
  try {
    const snap = JSON.parse(readFileSync(FILE, "utf8"))
    return typeof snap?.updatedAt === "number" && snap.panels ? snap : null
  } catch {
    return null
  }
}

export function isFresh(snap: Snapshot | null, now = Date.now()): snap is Snapshot {
  return snap !== null && now - snap.updatedAt < REFRESH_MS
}

/** Exclusive refresh lock across processes; false if another one is fetching. */
export function tryLock(): boolean {
  mkdirSync(DIR, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      closeSync(openSync(LOCK, "wx"))
      return true
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs < LOCK_STALE_MS) return false
        unlinkSync(LOCK)
      } catch {
        // the holder released it in between: retry
      }
    }
  }
  return false
}

export function unlock() {
  try {
    unlinkSync(LOCK)
  } catch {}
}

function merge(prev: PanelState | undefined, next: PanelData, now: number): PanelState {
  if (next.rows.length > 0 || !prev || prev.data.rows.length === 0) {
    // fresh data, or we never had any: keep whatever came back (note included)
    return { data: next, staleNote: null, fetchedAt: now }
  }
  // refresh failed but we had data: keep it and flag the panel
  return { ...prev, staleNote: next.note ?? "not refreshed" }
}

/** Fetches every provider, merges into the snapshot and saves it. Call with the lock held. */
export async function refreshSnapshot(): Promise<Snapshot> {
  const results = await Promise.all([fetchClaude(), fetchCodex(), fetchOpenRouter(), fetchVercel()])
  const prev = readSnapshot()
  const now = Date.now()
  const snap: Snapshot = { updatedAt: now, panels: {} }
  PROVIDERS.forEach((id, i) => {
    snap.panels[id] = merge(prev?.panels[id], results[i]!, now)
  })
  mkdirSync(DIR, { recursive: true })
  const tmp = `${FILE}.${process.pid}`
  writeFileSync(tmp, JSON.stringify(snap))
  renameSync(tmp, FILE)
  return snap
}
