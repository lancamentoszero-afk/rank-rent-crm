import type { Context } from 'hono'
import type { AppEnv } from './types'

export type C = Context<AppEnv>

export async function audit(c: C, action: string, entity?: string, id?: number | null) {
  await c.env.DB.prepare('INSERT INTO audit_log (user_email, action, entity, entity_id) VALUES (?, ?, ?, ?)')
    .bind(c.get('user').email, action, entity ?? null, id ?? null)
    .run()
}

/** Lê o corpo de um formulário como objeto de strings (vazios → null) */
export async function form(c: C): Promise<Record<string, string | null>> {
  const body = await c.req.parseBody()
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(body)) {
    const s = typeof v === 'string' ? v.trim() : null
    out[k] = s === '' ? null : s
  }
  // Campos que não vieram no pedido valem null (o D1 não aceita undefined)
  return new Proxy(out, { get: (t, k: string) => (k in t ? t[k] : null) })
}

export function toNum(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function back(c: C, url: string, msg?: string) {
  const sep = url.includes('?') ? '&' : '?'
  return c.redirect(msg ? `${url}${sep}ok=${encodeURIComponent(msg)}` : url, 303)
}

export const flash = (c: C) => c.req.query('ok') ?? null
