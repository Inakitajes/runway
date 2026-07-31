export interface UsageRow {
  label: string
  /** 0-100; null = info row without a bar (credits, etc.) */
  pct: number | null
  /** Fixed text on the right when there's no countdown */
  detail?: string
  /** Epoch ms for an informational item's next expiration */
  expiresAt?: number
  /** Epoch ms; when present a live countdown is drawn */
  resetsAt?: number
  /** Total window duration in ms; lets us compute the spend pace */
  windowMs?: number
}

export interface PanelData {
  title: string
  rows: UsageRow[]
  /** Message (error or hint) shown in place of the rows */
  note?: string
  /** Secondary message rendered under the rows (e.g. how to unlock more data) */
  hint?: string
}
