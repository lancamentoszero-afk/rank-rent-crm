import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { Layout, Pill, Bars, Chip, statusChip } from '../ui'
import { flash } from '../db'
import {
  todayISO, monthOf, addMonths, addDays, weekStart, monthStart, money, computeBill, billStatus, partnerMonths,
  monthName, STATUS_LABEL, fmtDate, daysBetween, type Currency, type MonthBill
} from '../lib'

export const dashboard = new Hono<AppEnv>()

type Partner = { id: number; name: string; currency: Currency }

dashboard.get('/', async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const today = todayISO()
  const curM = monthOf(today)
  const period = c.req.query('p') === 'semana' ? 'semana' : 'mes'
  const from = period === 'semana' ? weekStart(today) : monthStart(curM)
  const prevFrom = period === 'semana' ? addDays(from, -7) : monthStart(addMonths(curM, -1))
  const prevTo = addDays(from, -1)
  const label = period === 'semana' ? 'esta semana' : 'este mês'

  // ---------- Leads ----------
  const cnt = async (a: string, b: string) =>
    (await db
      .prepare(`SELECT COUNT(*) n, SUM(billable) b FROM leads WHERE substr(occurred_at,1,10) BETWEEN ? AND ?`)
      .bind(a, b)
      .first<{ n: number; b: number | null }>())!
  const cur = await cnt(from, today)
  const prev = await cnt(prevFrom, prevTo)
  const delta = cur.n - prev.n
  const { results: perSite } = await db
    .prepare(
      `SELECT s.id, s.domain, s.status, COUNT(l.id) n FROM sites s
       LEFT JOIN leads l ON l.site_id = s.id AND substr(l.occurred_at,1,10) BETWEEN ? AND ?
       GROUP BY s.id ORDER BY n DESC, s.domain`
    )
    .bind(from, today)
    .all<{ id: number; domain: string; status: string; n: number }>()
  const maxN = Math.max(1, ...perSite.map((s) => s.n))
  const { results: statusCounts } = await db.prepare('SELECT status, COUNT(*) n FROM sites GROUP BY status').all<{ status: string; n: number }>()
  const sc = (s: string) => statusCounts.find((x) => x.status === s)?.n ?? 0

  // ---------- Dinheiro (só para admin) ----------
  let money_: null | {
    byModel: Map<string, Map<Currency, number>>
    toBill: Map<Currency, number>
    undefinedPrice: string[]
    received: Map<Currency, number>
    overdue: Map<Currency, number>
    overdueList: string[]
    history: Map<Currency, { label: string; value: number }[]>
  } = null
  if (user.role === 'admin') {
    const { results: partners } = await db.prepare('SELECT id, name, currency FROM partners WHERE active = 1').all<Partner>()
    const byModel = new Map<string, Map<Currency, number>>()
    const toBill = new Map<Currency, number>()
    const overdue = new Map<Currency, number>()
    const overdueList: string[] = []
    const undefinedPrice: string[] = []
    const history = new Map<Currency, Map<string, number>>()
    const add = (m: Map<Currency, number>, cur: Currency, v: number) => m.set(cur, (m.get(cur) ?? 0) + v)
    for (const p of partners) {
      const months = await partnerMonths(db, p.id, today)
      for (const m of months) {
        const bill = (await computeBill(db, p.id, p.currency, m, today)) as MonthBill | null
        if (!bill) continue
        if (m >= addMonths(curM, -5)) {
          if (!history.has(p.currency)) history.set(p.currency, new Map())
          const h = history.get(p.currency)!
          h.set(m, (h.get(m) ?? 0) + (bill.total ?? 0))
        }
        if (m === curM) {
          if (bill.total === null) undefinedPrice.push(p.name)
          else {
            add(toBill, p.currency, bill.total)
            if (!byModel.has(bill.model)) byModel.set(bill.model, new Map())
            add(byModel.get(bill.model)!, p.currency, bill.total)
          }
        } else {
          const paid = (await db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE partner_id = ? AND month = ?').bind(p.id, m).first<{ s: number }>())!.s
          const st = billStatus(bill, paid, today)
          if (st.cls === 'c-warn' && bill.total !== null) {
            add(overdue, p.currency, bill.total - paid)
            overdueList.push(`${p.name}: ${monthName(m)} (${money(bill.total - paid, p.currency)})`)
          }
        }
      }
    }
    const { results: rec } = await db
      .prepare(`SELECT p.currency, SUM(y.amount) s FROM payments y JOIN partners p ON p.id = y.partner_id WHERE substr(y.paid_on,1,7) = ? GROUP BY p.currency`)
      .bind(curM)
      .all<{ currency: Currency; s: number }>()
    const received = new Map<Currency, number>(rec.map((r) => [r.currency, r.s]))
    const hist = new Map<Currency, { label: string; value: number }[]>()
    for (const [cur, h] of history) {
      const arr: { label: string; value: number }[] = []
      for (let i = 5; i >= 0; i--) {
        const m = addMonths(curM, -i)
        arr.push({ label: monthName(m, true), value: Math.round((h.get(m) ?? 0) * 100) / 100 })
      }
      hist.set(cur, arr)
    }
    money_ = { byModel, toBill, undefinedPrice, received, overdue, overdueList, history: hist }
  }

  // ---------- Alertas ----------
  const alerts: { color: string; html: any }[] = []
  if (money_) {
    for (const o of money_.overdueList) alerts.push({ color: '#C2571A', html: <span><strong>Pagamento em atraso</strong>: {o}. <a href="/financeiro?t=pagamentos">Ver pagamentos</a></span> })
    for (const n of money_.undefinedPrice) alerts.push({ color: '#B08A1E', html: <span><strong>{n}</strong>: o acordo não tem preço definido. <a href="/parceiros">Definir</a></span> })
  }
  const { results: quiet } = await db
    .prepare(
      `SELECT s.id, s.domain, MAX(l.occurred_at) last FROM sites s LEFT JOIN leads l ON l.site_id = s.id
       WHERE s.status = 'alugado' GROUP BY s.id HAVING last IS NULL OR substr(last,1,10) < ?`
    )
    .bind(addDays(today, -7))
    .all<{ id: number; domain: string; last: string | null }>()
  for (const q of quiet)
    alerts.push({
      color: '#C2571A',
      html: <span><strong>{q.domain}</strong>: alugado e sem leads {q.last ? `há ${daysBetween(q.last, today)} dias` : 'desde sempre'}. <a href={`/sites/${q.id}`}>Ver site</a></span>
    })
  const { results: renew } = await db
    .prepare(
      `SELECT 'Domínio' item, domain AS what, domain_renews_on AS on_date FROM sites WHERE domain_renews_on BETWEEN ? AND ?
       UNION ALL SELECT c.item, COALESCE(s.domain,'geral'), c.renews_on FROM costs c LEFT JOIN sites s ON s.id = c.site_id
       WHERE c.period = 'ano' AND c.renews_on BETWEEN ? AND ? ORDER BY on_date`
    )
    .bind(today, addDays(today, 30), today, addDays(today, 30))
    .all<{ item: string; what: string; on_date: string }>()
  for (const r of renew) alerts.push({ color: '#B08A1E', html: <span><strong>A renovar</strong>: {r.item} de {r.what} a {fmtDate(r.on_date)}.</span> })
  const { results: todo } = await db
    .prepare(`SELECT id, business, next_step FROM prospects WHERE stage < 4 AND next_step_on IS NOT NULL AND next_step_on <= ? ORDER BY next_step_on`)
    .bind(today)
    .all<{ id: number; business: string; next_step: string | null }>()
  for (const t of todo)
    alerts.push({ color: '#1F5C4A', html: <span><strong>Prospeção</strong>: {t.business}{t.next_step ? ` — ${t.next_step}` : ''}. <a href={`/prospecao?sel=${t.id}`}>Abrir</a></span> })

  const moneyLine = (m: Map<Currency, number> | undefined) => {
    if (!m || !m.size) return '0 €'
    return [...m.entries()].map(([cur, v]) => money(v, cur)).join(' + ')
  }

  return c.html(
    <Layout title="Dashboard" active="/" user={user} flash={flash(c)}>
      <div class="top">
        <div><h1>Dashboard</h1><p class="sub">{monthName(curM)} de {curM.slice(0, 4)}</p></div>
        <div class="pills" role="group" aria-label="Período">
          <Pill href="/?p=semana" on={period === 'semana'}>Esta semana</Pill>
          <Pill href="/?p=mes" on={period === 'mes'}>Este mês</Pill>
        </div>
      </div>

      {money_ ? (
        <>
          <p class="sub" style="margin:0">Só valores já ganhos: mensalidades do mês, leads faturáveis já registadas e trabalhos já reportados.</p>
          <section class="kpis" aria-label="Receita">
            <div class="card"><div class="k">Mensalidades ({monthName(curM)})</div><div class="v">{moneyLine(money_.byModel.get('Mensalidade fixa'))}</div></div>
            <div class="card"><div class="k">Pagamento por lead (até hoje)</div><div class="v">{moneyLine(money_.byModel.get('Pagamento por lead'))}</div></div>
            <div class="card"><div class="k">Comissão por trabalho (até hoje)</div><div class="v">{moneyLine(money_.byModel.get('Comissão por trabalho'))}</div></div>
            <div class="card"><div class="k">A faturar em {monthName(curM)}</div><div class="v">{moneyLine(money_.toBill)}</div><div class="d">Cobrança até dia 5 do mês seguinte</div></div>
            <div class="card"><div class="k">Recebido em {monthName(curM)}</div><div class="v">{moneyLine(money_.received)}</div><div class="d"><a href="/financeiro?t=pagamentos">Ver pagamentos</a></div></div>
            <div class="card"><div class="k">Em atraso</div><div class="v">{moneyLine(money_.overdue)}</div></div>
          </section>
        </>
      ) : null}

      <section class="kpis" aria-label="Leads e sites">
        <div class="card"><div class="k">Leads ({label})</div><div class="v">{cur.n}</div><div class="d">{delta >= 0 ? '+' : ''}{delta} face ao período anterior</div></div>
        <div class="card"><div class="k">Faturáveis ({label})</div><div class="v">{cur.b ?? 0}</div><div class="d">Cada chamada, formulário ou conversa qualificada conta</div></div>
        <div class="card"><div class="k">Sites</div><div class="v">{sc('alugado') + sc('construcao') + sc('pausado')}</div>
          <div class="d"><Chip cls="c-al">{sc('alugado')} alugados</Chip> <Chip cls="c-co">{sc('construcao')} em construção</Chip> <Chip cls="c-pa">{sc('pausado')} pausados</Chip></div></div>
      </section>

      <div class="grid2">
        <section class="card" aria-label="Leads por site">
          <h2>Leads por site ({label})</h2>
          <div class="tbl"><table>
            <thead><tr><th>Site</th><th>Estado</th><th class="num">Leads</th><th style="width:35%">Peso</th></tr></thead>
            <tbody>
              {perSite.map((s) => (
                <tr>
                  <td><a href={`/sites/${s.id}`}>{s.domain}</a></td>
                  <td><Chip cls={statusChip(s.status)}>{STATUS_LABEL[s.status]}</Chip></td>
                  <td class="num">{s.n}</td>
                  <td><div class="bar"><span style={`width:${Math.round((s.n / maxN) * 100)}%`}></span></div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
        <section class="card" aria-label="Alertas">
          <h2>Alertas</h2>
          {alerts.length ? alerts.map((a) => (
            <div class="alert"><span class="dot" style={`background:${a.color}`}></span><div>{a.html}</div></div>
          )) : <p class="empty">Nada pendente.</p>}
        </section>
      </div>

      {money_ && [...money_.history.values()].some((d) => d.some((x) => x.value > 0)) ? (
        <div class="grid2">
          {[...money_.history.entries()].map(([cur, data]) => (
            <section class="card" aria-label={`Faturação por mês em ${cur}`}>
              <h2>Faturação por mês ({cur === 'EUR' ? 'euros' : 'dólares'})</h2>
              <Bars data={data} label={`Faturação dos últimos 6 meses: ${data.map((d) => `${d.label} ${money(d.value, cur)}`).join(', ')}`} fmt={(v) => money(v, cur, 0)} />
            </section>
          ))}
        </div>
      ) : null}
    </Layout>
  )
})
