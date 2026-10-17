// Datas (sempre em hora de Lisboa), dinheiro e cálculo de faturação

export const TZ = 'Europe/Lisbon'

export function todayISO(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function nowLocalISO(d = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`
}
export function monthOf(iso: string): string { return iso.slice(0, 7) }
export function monthStart(m: string): string { return `${m}-01` }
export function monthEnd(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return `${m}-${String(last).padStart(2, '0')}`
}
export function addMonths(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** Segunda-feira da semana de uma data */
export function weekStart(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z')
  const wd = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - wd)
  return d.toISOString().slice(0, 10)
}
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MESES_C = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export function monthName(m: string, short = false): string {
  const i = Number(m.slice(5, 7)) - 1
  return short ? MESES_C[i] : MESES[i]
}
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const [date, time] = iso.split('T')
  const [, m, d] = date.split('-')
  return `${d}/${m} ${time ? time.slice(0, 5) : ''}`.trim()
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000)
}

export type Currency = 'EUR' | 'USD'
export function money(v: number | null | undefined, cur: Currency | string = 'EUR', dec = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const n = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: Number.isInteger(v) ? 0 : dec, maximumFractionDigits: dec }).format(v)
  return cur === 'USD' ? `${n} $` : `${n} €`
}
export function num(v: number | null | undefined, dec = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: dec }).format(v)
}
export function fmtDuration(s?: number | null): string {
  if (s === null || s === undefined) return '—'
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const MODEL_LABEL: Record<string, string> = {
  per_lead: 'Pagamento por lead',
  monthly: 'Mensalidade fixa',
  per_job: 'Comissão por trabalho'
}
export const STATUS_LABEL: Record<string, string> = { construcao: 'Em construção', alugado: 'Alugado', pausado: 'Pausado' }
export const STAGES = ['Por contactar', 'Contactado', 'A receber leads grátis', 'Em negociação', 'Fechado', 'Recusou']
export const TYPE_LABEL: Record<string, string> = { chamada: 'Chamada', formulario: 'Formulário', whatsapp: 'WhatsApp' }

// ---------- Faturação ----------

export type Agreement = {
  id: number; partner_id: number; phase: number; model: 'per_lead' | 'monthly' | 'per_job'
  amount: number | null; commission_pct: number | null; start_on: string; end_on: string | null; notes: string | null
}

export type MonthBill = {
  partnerId: number
  month: string
  currency: Currency
  total: number | null         // null = há um acordo sem preço definido
  calc: string                 // texto do cálculo
  model: string
  perSite: { domain: string; n: number }[]
}

export async function computeBill(db: D1Database, partnerId: number, currency: Currency, month: string, today = todayISO()): Promise<MonthBill | null> {
  const ms = monthStart(month)
  const me = monthEnd(month)
  const { results: ags } = await db
    .prepare('SELECT * FROM agreements WHERE partner_id = ? AND start_on <= ? AND (end_on IS NULL OR end_on >= ?) ORDER BY start_on')
    .bind(partnerId, me, ms)
    .all<Agreement>()
  if (!ags.length) return null
  let total: number | null = 0
  const parts: string[] = []
  const models = new Set<string>()
  const perSite = new Map<string, number>()
  const lastDay = month === monthOf(today) ? today : me
  for (const a of ags) {
    models.add(a.model)
    const from = a.start_on > ms ? a.start_on : ms
    const to = a.end_on && a.end_on < me ? a.end_on : me
    if (a.model === 'per_lead') {
      const { results } = await db
        .prepare(
          `SELECT s.domain, COUNT(*) n FROM leads l JOIN sites s ON s.id = l.site_id
           WHERE l.partner_id = ? AND l.billable = 1 AND substr(l.occurred_at,1,10) BETWEEN ? AND ? GROUP BY s.domain ORDER BY n DESC`
        )
        .bind(partnerId, from, to)
        .all<{ domain: string; n: number }>()
      const n = results.reduce((s, r) => s + r.n, 0)
      results.forEach((r) => perSite.set(r.domain, (perSite.get(r.domain) ?? 0) + r.n))
      if (a.amount === null) {
        total = null
        parts.push(`${n} leads × preço por definir`)
      } else {
        if (total !== null) total += n * a.amount
        parts.push(`${n} leads × ${money(a.amount, currency)}`)
      }
    } else if (a.model === 'monthly') {
      // A mensalidade conta no mês em que o acordo está ativo no último dia (ou hoje, no mês corrente)
      const activeAtEnd = a.start_on <= lastDay && (!a.end_on || a.end_on >= lastDay)
      if (activeAtEnd) {
        if (a.amount === null) { total = null; parts.push('mensalidade por definir') }
        else { if (total !== null) total += a.amount; parts.push(`mensalidade ${money(a.amount, currency)}`) }
      }
    } else {
      const { results } = await db
        .prepare('SELECT value, pct FROM jobs WHERE partner_id = ? AND done_on BETWEEN ? AND ?')
        .bind(partnerId, from, to)
        .all<{ value: number; pct: number }>()
      const c = results.reduce((s, r) => s + (r.value * r.pct) / 100, 0)
      if (total !== null) total += c
      parts.push(`${results.length} trabalho${results.length === 1 ? '' : 's'} à comissão`)
    }
  }
  return {
    partnerId, month, currency, total: total === null ? null : Math.round(total * 100) / 100,
    calc: parts.join(' + '),
    model: [...models].map((m) => MODEL_LABEL[m]).join(' → '),
    perSite: [...perSite.entries()].map(([domain, n]) => ({ domain, n }))
  }
}

export type BillStatus = { label: string; cls: string; paid: number; due: number | null; dueOn: string }

export function billStatus(bill: MonthBill, paid: number, today = todayISO()): BillStatus {
  const dueOn = `${addMonths(bill.month, 1)}-05`
  const due = bill.total
  if (bill.month >= monthOf(today)) return { label: 'Mês a decorrer', cls: 'c-co', paid, due, dueOn }
  if (due === null) return { label: 'Preço por definir', cls: 'c-pa', paid, due, dueOn }
  if (due === 0) return { label: 'Nada a cobrar', cls: 'c-pa', paid, due, dueOn }
  if (paid >= due - 0.005) return { label: 'Pago', cls: 'c-al', paid, due, dueOn }
  if (today > dueOn) return { label: paid > 0 ? 'Pago em parte · em atraso' : 'Em atraso', cls: 'c-warn', paid, due, dueOn }
  return { label: paid > 0 ? 'Pago em parte' : 'Por pagar', cls: 'c-pa', paid, due, dueOn }
}

export async function partnerMonths(db: D1Database, partnerId: number, today = todayISO()): Promise<string[]> {
  const r = await db.prepare('SELECT MIN(start_on) s FROM agreements WHERE partner_id = ?').bind(partnerId).first<{ s: string | null }>()
  if (!r?.s) return []
  const out: string[] = []
  let m = monthOf(r.s)
  const cur = monthOf(today)
  while (m <= cur && out.length < 60) { out.push(m); m = addMonths(m, 1) }
  return out.reverse()
}

export function randomKey(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}
