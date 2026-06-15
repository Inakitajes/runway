export interface UsageRow {
  label: string
  /** 0-100; null = fila informativa sin barra (créditos, etc.) */
  pct: number | null
  /** Texto fijo a la derecha cuando no hay countdown */
  detail?: string
  /** Epoch ms; si está presente se pinta una cuenta atrás viva */
  resetsAt?: number
  /** Duración total de la ventana en ms; permite calcular el ritmo de gasto */
  windowMs?: number
}

export interface PanelData {
  title: string
  rows: UsageRow[]
  /** Mensaje (error o hint) que se muestra en lugar de las filas */
  note?: string
}
