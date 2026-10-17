import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { Layout, Chip } from '../ui'
import { audit, back, flash, form, toNum } from '../db'
import { agreementText } from './sites'
import {
  todayISO, monthOf, money, addDays, fmtDate, monthName, MODEL_LABEL, computeBill, billStatus, partnerMonths, num,
  type Agreement, type Currency, type MonthBill, type BillStatus
} from '../lib'

export const finance = new Hono<AppEnv>()

type Partner = { id: number; name: string; currency: Currency; payment_method: string | null }

finance.get('/', async (c) => {
  const db = c.env.DB
  const today = todayISO()
  const curM = monthOf(today)
  const tab = c.req.query('t') ?? 'pagamentos'
  const pf = c.req.query('parceiro') ?? ''
  const { results: partners } = await db.prepare('SELECT id, name, currency, payment_method FROM partners ORDER BY name').all<Partner>()

  // Faturas (calculadas) + pagamentos
  const bills: { p: Partner; bill: MonthBill; st: BillStatus }[] = []
  for (const p of partners) {
    for (const m of await partnerMonths(db, p.id, today)) {
      const bill = await computeBill(db, p.id, p.currency, m, today)
      if (!bill) continue
      const paid = (await db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE partner_id = ? AND month = ?').bind(p.id, m).first<{ s: number }>())!.s
      bills.push({ p, bill, st: billStatus(bill, paid, today) })
    }
  }
  bills.sort((a, b) => (a.bill.month < b.bill.month ? 1 : a.bill.month > b.bill.month ? -1 : a.p.name.localeCompare(b.p.name)))

  const sumBy = (rows: { cur: Currency; v: number }[]) => {
    const m = new Map<Currency, number>()
    rows.forEach((r) => m.set(r.cur, (m.get(r.cur) ?? 0) + r.v))
    return m.size ? [...m.entries()].map(([k, v]) => money(v, k)).join(' + ') : '0 €'
  }
  const toBill = sumBy(bills.filter((b) => b.bill.month === curM && b.bill.total !== null).map((b) => ({ cur: b.p.currency, v: b.bill.total! })))
  const overdue = sumBy(bills.filter((b) => b.st.cls === 'c-warn').map((b) => ({ cur: b.p.currency, v: (b.bill.total ?? 0) - b.st.paid })))
  const { results: rec } = await db
    .prepare('SELECT p.currency cur, SUM(y.amount) v FROM payments y JOIN partners p ON p.id = y.partner_id WHERE substr(y.paid_on,1,7) = ? GROUP BY p.currency')
    .bind(curM)
    .all<{ cur: Currency; v: number }>()
  const { results: costs } = await db
    .prepare('SELECT c.*, s.domain FROM costs c LEFT JOIN sites s ON s.id = c.site_id ORDER BY s.domain IS NULL, s.domain, c.item')
    .all<{ id: number; site_id: number | null; domain: string | null; item: string; amount: number; currency: Currency; period: string; renews_on: string | null; provider: string | null }>()
  const yearly = sumBy(costs.map((x) => ({ cur: x.currency, v: x.period === 'mes' ? x.amount * 12 : x.amount })))

  const tabs = [
    ['pagamentos', 'Pagamentos'], ['acordos', 'Acordos'], ['trabalhos', 'Trabalhos à comissão'], ['custos', 'Custos e renovações']
  ]

  let body: any = null
  if (tab === 'pagamentos') {
    const rows = bills.filter((b) => !pf || String(b.p.id) === pf)
    body = (
      <section class="card flush" aria-label="Pagamentos">
        <div class="tbl"><table>
          <thead><tr><th>Mês</th><th>Parceiro</th><th>Modelo</th><th>Cálculo</th><th class="num">Total</th><th class="num">Pago</th><th>Vence</th><th>Estado</th><th>Registar pagamento</th></tr></thead>
          <tbody>
            {rows.map(({ p, bill, st }) => {
              const remaining = bill.total === null ? null : Math.max(0, bill.total - st.paid)
              const calc = bill.perSite.length > 1 ? `${bill.calc} (${bill.perSite.map((s) => `${s.domain.split('.')[0]} ${s.n}`).join(' · ')})` : bill.calc
              return (
                <tr>
                  <td>{monthName(bill.month)} {bill.month.slice(0, 4)}</td>
                  <td><a href={`/parceiros?sel=${p.id}`}>{p.name}</a></td>
                  <td>{bill.model}</td>
                  <td class="wrap" style="max-width:300px">{calc}</td>
                  <td class="num"><strong>{money(bill.total, p.currency)}</strong></td>
                  <td class="num">{st.paid ? money(st.paid, p.currency) : '—'}</td>
                  <td>{fmtDate(st.dueOn)}</td>
                  <td><Chip cls={st.cls}>{st.label}</Chip></td>
                  <td>
                    {bill.month < curM && remaining !== null && remaining > 0 ? (
                      <form method="post" action="/financeiro/pagamentos" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                        <input type="hidden" name="partner_id" value={String(p.id)} />
                        <input type="hidden" name="month" value={bill.month} />
                        <input name="amount" value={String(remaining)} inputmode="decimal" aria-label="Valor" style="width:90px" />
                        <input type="date" name="paid_on" value={today} aria-label="Data" style="width:150px" />
                        <input name="method" value={p.payment_method ?? ''} placeholder="Método" aria-label="Método" style="width:120px" />
                        <button class="btn sm pri" type="submit">Pago</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
        {!rows.length ? <p class="empty">Ainda não há meses faturados. Os meses aparecem quando um parceiro tem acordo.</p> : null}
        <p class="note">Uma linha por parceiro e por mês, calculada pelo modelo dele. Cobra-se até dia 5 do mês seguinte. Se pagar só parte, fica o valor em falta.</p>
      </section>
    )
  } else if (tab === 'acordos') {
    const { results: ags } = await db
      .prepare('SELECT a.*, p.name, p.currency FROM agreements a JOIN partners p ON p.id = a.partner_id ORDER BY a.end_on IS NOT NULL, p.name, a.start_on DESC')
      .all<Agreement & { name: string; currency: Currency }>()
    const { results: sl } = await db.prepare('SELECT domain, partner_id FROM sites WHERE partner_id IS NOT NULL').all<{ domain: string; partner_id: number }>()
    body = (
      <section class="card flush" aria-label="Acordos">
        <div class="tbl"><table>
          <thead><tr><th>Parceiro</th><th>Sites</th><th>Fase</th><th>Modelo</th><th>Valor</th><th>Cobrança</th><th>Desde</th><th>Até</th></tr></thead>
          <tbody>
            {ags.map((a) => (
              <tr style={a.end_on ? 'color:#56635C' : ''}>
                <td><a href={`/parceiros?sel=${a.partner_id}`}>{a.name}</a></td>
                <td class="wrap">{a.end_on ? '' : sl.filter((s) => s.partner_id === a.partner_id).map((s) => s.domain).join(', ') || '—'}</td>
                <td>{a.phase}</td><td>{MODEL_LABEL[a.model]}</td><td>{agreementText(a, a.currency).replace(/^Fase \d · /, '')}</td>
                <td>Mensal</td><td>{fmtDate(a.start_on)}</td><td>{a.end_on ? fmtDate(a.end_on) : 'Atual'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p class="note">Um acordo ativo por parceiro, que vale para todos os sites dele. Muda-se na ficha do parceiro.</p>
      </section>
    )
  } else if (tab === 'trabalhos') {
    const { results: jobs } = await db
      .prepare('SELECT j.*, p.name, p.currency, s.domain FROM jobs j JOIN partners p ON p.id = j.partner_id LEFT JOIN sites s ON s.id = j.site_id ORDER BY j.done_on DESC')
      .all<{ id: number; partner_id: number; name: string; currency: Currency; domain: string | null; done_on: string; client: string | null; description: string | null; value: number; pct: number }>()
    body = (
      <section class="card flush" aria-label="Trabalhos">
        <div class="tbl"><table>
          <thead><tr><th>Data</th><th>Parceiro</th><th>Site</th><th>Cliente</th><th>Trabalho</th><th class="num">Valor</th><th class="num">%</th><th class="num">Comissão</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr><td>{fmtDate(j.done_on)}</td><td><a href={`/parceiros?sel=${j.partner_id}`}>{j.name}</a></td><td>{j.domain ?? '—'}</td><td>{j.client ?? '—'}</td>
                <td class="wrap">{j.description ?? '—'}</td><td class="num">{money(j.value, j.currency)}</td><td class="num">{num(j.pct)}%</td><td class="num">{money((j.value * j.pct) / 100, j.currency)}</td></tr>
            ))}
          </tbody>
        </table></div>
        {!jobs.length ? <p class="empty">Ainda não há trabalhos registados. Registam-se na ficha do parceiro.</p> : null}
        <p class="note">Os trabalhos entram na faturação só nos parceiros com acordo de comissão por trabalho. Nos outros servem para calcular o fecho real.</p>
      </section>
    )
  } else {
    const { results: siteList } = await db.prepare('SELECT id, domain FROM sites ORDER BY domain').all<{ id: number; domain: string }>()
    const cf = c.req.query('site') ?? ''
    const shown = costs.filter((x) => (cf === '' ? true : cf === 'geral' ? x.site_id === null : String(x.site_id) === cf))
    const ed = costs.find((x) => String(x.id) === c.req.query('editar')) ?? null
    const shownYear = sumBy(shown.map((x) => ({ cur: x.currency, v: x.period === 'mes' ? x.amount * 12 : x.amount })))
    body = (
      <>
        <form method="get" action="/financeiro" class="filters">
          <input type="hidden" name="t" value="custos" />
          <label class="f">Mostrar
            <select name="site" onchange="this.form.submit()">
              <option value="" selected={cf === ''}>Todos</option>
              <option value="geral" selected={cf === 'geral'}>Geral / outros</option>
              {siteList.map((s) => <option value={s.id} selected={cf === String(s.id)}>{s.domain}</option>)}
            </select>
          </label>
          {cf ? <p class="sub" style="margin:0">Total por ano desta seleção: <strong>{shownYear}</strong></p> : null}
        </form>
        {ed ? (
          <section class="card" id="editar" aria-label="Editar custo" style="border-color:#1F5C4A">
            <h2>Editar custo</h2>
            <form method="post" action={`/financeiro/custos/${ed.id}`} class="form">
              <input type="hidden" name="filtro" value={cf} />
              <label class="f">Site<select name="site_id"><option value="">Geral (todos os sites)</option>{siteList.map((s) => <option value={s.id} selected={ed.site_id === s.id}>{s.domain}</option>)}</select></label>
              <label class="f">Item<input name="item" value={ed.item} required /></label>
              <label class="f">Valor<input name="amount" value={String(ed.amount)} required inputmode="decimal" /></label>
              <label class="f">Moeda<select name="currency"><option selected={ed.currency === 'EUR'}>EUR</option><option selected={ed.currency === 'USD'}>USD</option></select></label>
              <label class="f">Período<select name="period"><option value="ano" selected={ed.period === 'ano'}>Anual</option><option value="mes" selected={ed.period === 'mes'}>Mensal</option></select></label>
              <label class="f">Renova em<input type="date" name="renews_on" value={ed.renews_on ?? ''} /></label>
              <label class="f">Fornecedor<input name="provider" value={ed.provider ?? ''} /></label>
              <div class="full row-actions"><button class="btn pri" type="submit">Guardar alterações</button><a class="btn" href={`/financeiro?t=custos&site=${cf}`}>Cancelar</a></div>
            </form>
          </section>
        ) : null}
        <section class="card flush" aria-label="Custos">
          <div class="tbl"><table>
            <thead><tr><th>Site</th><th>Item</th><th class="num">Valor</th><th>Período</th><th class="num">Por ano</th><th>Renova</th><th>Fornecedor</th><th></th></tr></thead>
            <tbody>
              {shown.map((x) => (
                <tr><td>{x.domain ? <a href={`/financeiro?t=custos&site=${x.site_id}`}>{x.domain}</a> : 'Geral'}</td><td>{x.item}</td><td class="num">{money(x.amount, x.currency)}</td><td>{x.period === 'mes' ? 'Mensal' : 'Anual'}</td>
                  <td class="num">{money(x.period === 'mes' ? x.amount * 12 : x.amount, x.currency)}</td>
                  <td>{x.renews_on && x.renews_on <= addDays(today, 30) ? <Chip cls="c-warn">{fmtDate(x.renews_on)}</Chip> : fmtDate(x.renews_on)}</td><td>{x.provider ?? '—'}</td>
                  <td style="display:flex;gap:6px"><a class="btn sm" href={`/financeiro?t=custos&site=${cf}&editar=${x.id}#editar`}>Editar</a><form method="post" action={`/financeiro/custos/${x.id}/apagar`} class="inline" onsubmit="return confirm('Apagar este custo?')"><input type="hidden" name="site" value={cf} /><button class="btn sm danger" type="submit">Apagar</button></form></td></tr>
              ))}
            </tbody>
          </table></div>
          {!shown.length ? <p class="empty">Sem custos registados{cf ? ' nesta seleção' : ''}.</p> : null}
        </section>
        <details class="box" open={c.req.query('novo') === '1'}>
          <summary>+ Acrescentar custo</summary>
          <form method="post" action="/financeiro/custos" class="form">
            <label class="f">Site<select name="site_id"><option value="">Geral (todos os sites)</option>{siteList.map((s) => <option value={s.id} selected={cf === String(s.id)}>{s.domain}</option>)}</select></label>
            <label class="f">Item<input name="item" required placeholder="Alojamento, plataforma de call tracking…" /></label>
            <label class="f">Valor<input name="amount" required inputmode="decimal" /></label>
            <label class="f">Moeda<select name="currency"><option>EUR</option><option>USD</option></select></label>
            <label class="f">Período<select name="period"><option value="ano">Anual</option><option value="mes">Mensal</option></select></label>
            <label class="f">Renova em<input type="date" name="renews_on" /></label>
            <label class="f">Fornecedor<input name="provider" /></label>
            <div class="full"><button class="btn pri" type="submit">Acrescentar</button></div>
          </form>
        </details>
      </>
    )
  }

  return c.html(
    <Layout title="Financeiro" active="/financeiro" user={c.get('user')} flash={flash(c)}>
      <div><h1>Financeiro</h1><p class="sub">{monthName(curM)} de {curM.slice(0, 4)}</p></div>
      <section class="kpis" aria-label="Resumo">
        <div class="card"><div class="k">A faturar em {monthName(curM)}</div><div class="v" style="font-size:20px">{toBill}</div></div>
        <div class="card"><div class="k">Recebido em {monthName(curM)}</div><div class="v" style="font-size:20px">{sumBy(rec)}</div></div>
        <div class="card"><div class="k">Em atraso</div><div class="v" style="font-size:20px">{overdue}</div></div>
        <div class="card"><div class="k">Custos por ano (todos os sites)</div><div class="v" style="font-size:20px">{yearly}</div></div>
      </section>
      <nav class="tabs" aria-label="Separadores">
        {tabs.map(([k, v]) => <a class={`tab${tab === k ? ' on' : ''}`} href={`/financeiro?t=${k}`}>{v}</a>)}
      </nav>
      {tab === 'pagamentos' && pf ? <p class="sub">A mostrar só um parceiro. <a href="/financeiro?t=pagamentos">Ver todos</a></p> : null}
      {body}
    </Layout>
  )
})

finance.post('/pagamentos', async (c) => {
  const f = await form(c)
  const pid = toNum(f.partner_id)
  const amount = toNum(f.amount)
  if (!pid || amount === null || !f.month || !f.paid_on) return back(c, '/financeiro?t=pagamentos')
  await c.env.DB.prepare('INSERT INTO payments (partner_id, month, amount, paid_on, method, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(pid, f.month, amount, f.paid_on, f.method, c.get('user').email)
    .run()
  await audit(c, `Registou pagamento de ${f.month}`, 'partner', pid)
  return back(c, '/financeiro?t=pagamentos', 'Pagamento registado.')
})

finance.post('/custos', async (c) => {
  const f = await form(c)
  const amount = toNum(f.amount)
  if (!f.item || amount === null) return back(c, '/financeiro?t=custos')
  await c.env.DB.prepare('INSERT INTO costs (site_id, item, amount, currency, period, renews_on, provider) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(toNum(f.site_id), f.item, amount, f.currency ?? 'EUR', f.period ?? 'ano', f.renews_on, f.provider)
    .run()
  await audit(c, `Acrescentou custo "${f.item}"`, 'cost')
  return back(c, `/financeiro?t=custos${f.site_id ? `&site=${f.site_id}` : ''}`, 'Custo acrescentado.')
})

finance.post('/custos/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await form(c)
  const amount = toNum(f.amount)
  if (!f.item || amount === null) return back(c, '/financeiro?t=custos')
  await c.env.DB.prepare('UPDATE costs SET site_id=?, item=?, amount=?, currency=?, period=?, renews_on=?, provider=? WHERE id = ?')
    .bind(toNum(f.site_id), f.item, amount, f.currency ?? 'EUR', f.period ?? 'ano', f.renews_on, f.provider, id)
    .run()
  await audit(c, `Editou o custo "${f.item}"`, 'cost', id)
  return back(c, `/financeiro?t=custos${f.filtro && /^(\d+|geral)$/.test(f.filtro) ? `&site=${f.filtro}` : ''}`, 'Custo atualizado.')
})

finance.post('/custos/:id{[0-9]+}/apagar', async (c) => {
  const f = await form(c)
  await c.env.DB.prepare('DELETE FROM costs WHERE id = ?').bind(Number(c.req.param('id'))).run()
  await audit(c, 'Apagou um custo', 'cost')
  return back(c, `/financeiro?t=custos${f.site && /^(\d+|geral)$/.test(f.site) ? `&site=${f.site}` : ''}`, 'Custo apagado.')
})
