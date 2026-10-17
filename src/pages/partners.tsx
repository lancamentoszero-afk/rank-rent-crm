import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { Layout, Pill, Chip } from '../ui'
import { audit, back, flash, form, toNum } from '../db'
import { agreementText } from './sites'
import {
  todayISO, monthOf, addDays, money, fmtDate, MODEL_LABEL, computeBill, billStatus, partnerMonths, num,
  type Agreement, type Currency
} from '../lib'

export const partners = new Hono<AppEnv>()

type Partner = {
  id: number; name: string; contact_name: string | null; phone: string | null; email: string | null; country: string
  currency: Currency; payment_method: string | null; hours: string | null; whatsapp_optin_on: string | null
  promised_close: string | null; notes: string | null; active: number
}

async function overdueFor(db: D1Database, p: Partner, today: string): Promise<boolean> {
  for (const m of await partnerMonths(db, p.id, today)) {
    if (m >= monthOf(today)) continue
    const bill = await computeBill(db, p.id, p.currency, m, today)
    if (!bill) continue
    const paid = (await db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE partner_id = ? AND month = ?').bind(p.id, m).first<{ s: number }>())!.s
    if (billStatus(bill, paid, today).cls === 'c-warn') return true
  }
  return false
}

partners.get('/', async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const isAdmin = user.role === 'admin'
  const today = todayISO()
  const curM = monthOf(today)
  const qText = (c.req.query('q') ?? '').toLowerCase()
  const filt = c.req.query('f') ?? 'ativos'
  const { results: all } = await db.prepare('SELECT * FROM partners ORDER BY active DESC, name').all<Partner>()
  const { results: siteRows } = await db.prepare('SELECT id, domain, partner_id FROM sites WHERE partner_id IS NOT NULL').all<{ id: number; domain: string; partner_id: number }>()

  const enriched = await Promise.all(
    all.map(async (p) => {
      const bill = isAdmin ? await computeBill(db, p.id, p.currency, curM, today) : null
      const late = isAdmin ? await overdueFor(db, p, today) : false
      const sitesOf = siteRows.filter((s) => s.partner_id === p.id)
      return { ...p, bill, late, sitesOf }
    })
  )
  const list = enriched.filter((p) => {
    if (filt === 'ativos' && !p.active) return false
    if (filt === 'atraso' && !p.late) return false
    if (qText && !(p.name.toLowerCase().includes(qText) || p.sitesOf.some((s) => s.domain.includes(qText)))) return false
    return true
  })
  const selId = Number(c.req.query('sel') ?? list[0]?.id ?? 0)
  const sel = enriched.find((p) => p.id === selId) ?? null

  let detail: any = null
  if (sel) {
    const { results: ags } = await db.prepare('SELECT * FROM agreements WHERE partner_id = ? ORDER BY start_on DESC').bind(sel.id).all<Agreement>()
    const current = ags.find((a) => !a.end_on) ?? null
    const leadsMonth = (await db.prepare('SELECT COUNT(*) n FROM leads WHERE partner_id = ? AND substr(occurred_at,1,7) = ?').bind(sel.id, curM).first<{ n: number }>())!.n
    const leadsAll = (await db.prepare('SELECT COUNT(*) n FROM leads WHERE partner_id = ? AND billable = 1').bind(sel.id).first<{ n: number }>())!.n
    const { results: jobs } = await db
      .prepare('SELECT j.*, s.domain FROM jobs j LEFT JOIN sites s ON s.id = j.site_id WHERE j.partner_id = ? ORDER BY done_on DESC')
      .bind(sel.id)
      .all<{ id: number; done_on: string; client: string | null; description: string | null; value: number; pct: number; domain: string | null }>()
    detail = { ags, current, leadsMonth, leadsAll, jobs }
  }
  const q = (o: Record<string, string>) => '/parceiros?' + new URLSearchParams({ q: qText, f: filt, ...o }).toString()

  return c.html(
    <Layout title="Parceiros" active="/parceiros" user={user} flash={flash(c)}>
      <div class="top">
        <div><h1>Parceiros</h1><p class="sub">Negócios que pagam pelas leads</p></div>
        <div class="row-actions">
          <a class="btn" href="/prospecao">Ver prospeção</a>
          {isAdmin ? <a class="btn pri" href="#novo">+ Novo parceiro</a> : null}
        </div>
      </div>

      <div class="split">
        <section class="plist" aria-label="Lista de parceiros">
          <form method="get" action="/parceiros" style="padding:12px;border-bottom:1px solid #D9DDD7;display:flex;flex-direction:column;gap:8px">
            <input type="search" name="q" value={qText} placeholder="Procurar parceiro ou site" aria-label="Procurar parceiro" />
            <input type="hidden" name="f" value={filt} />
            <div class="pills">
              <Pill href={q({ f: 'ativos' })} on={filt === 'ativos'}>Ativos</Pill>
              {isAdmin ? <Pill href={q({ f: 'atraso' })} on={filt === 'atraso'}>Em atraso</Pill> : null}
              <Pill href={q({ f: 'todos' })} on={filt === 'todos'}>Todos</Pill>
            </div>
          </form>
          {list.map((p) => (
            <a class={`pr${sel?.id === p.id ? ' sel' : ''}`} href={q({ sel: String(p.id) })}>
              <span><strong>{p.name}</strong><span class="muted" style="font-size:12px">{p.sitesOf.length} site{p.sitesOf.length === 1 ? '' : 's'}{isAdmin && p.bill ? ` · ${p.bill.total === null ? 'preço por definir' : money(p.bill.total, p.currency)}` : ''}</span></span>
              {isAdmin ? <Chip cls={p.late ? 'c-warn' : p.active ? 'c-al' : 'c-pa'}>{p.late ? 'Em atraso' : p.active ? 'Em dia' : 'Inativo'}</Chip> : null}
            </a>
          ))}
          {!list.length ? <p class="empty" style="padding:16px">Nenhum parceiro.</p> : null}
        </section>

        {sel && detail ? (
          <section class="card pdetail" aria-label="Ficha do parceiro">
            <div class="filters">
              <div><h2 style="margin:0;font-size:20px">{sel.name}</h2><div class="sub">{sel.country === 'US' ? 'EUA' : 'Portugal'} · {sel.currency}{detail.current ? ` · desde ${fmtDate(detail.ags[detail.ags.length - 1].start_on)}` : ''}</div></div>
              {sel.phone ? <a class="btn" href={`tel:${sel.phone.replace(/\s/g, '')}`}>Ligar</a> : null}
            </div>
            <div class="kpis" style="margin:16px 0">
              {isAdmin ? <div class="card" style="background:#F5F6F3;border:0"><div class="k">A faturar este mês</div><div class="v" style="font-size:18px">{sel.bill ? (sel.bill.total === null ? 'Preço por definir' : money(sel.bill.total, sel.currency)) : '—'}</div></div> : null}
              <div class="card" style="background:#F5F6F3;border:0"><div class="k">Leads enviadas (mês)</div><div class="v" style="font-size:18px">{detail.leadsMonth}</div></div>
              <div class="card" style="background:#F5F6F3;border:0"><div class="k">Fecho prometido</div><div class="v" style="font-size:18px">{sel.promised_close ?? '—'}</div></div>
              <div class="card" style="background:#F5F6F3;border:0"><div class="k">Fecho real</div><div class="v" style="font-size:18px">{detail.leadsAll ? `${num((detail.jobs.length / detail.leadsAll) * 10)} em 10` : '—'}</div><div class="d">{detail.jobs.length} trabalhos reportados / {detail.leadsAll} leads</div></div>
            </div>

            <div class="sec">Acordo</div>
            <div class="kv"><span>Atual</span><strong>{detail.current ? `${MODEL_LABEL[detail.current.model]} · ${agreementText(detail.current, sel.currency)}` : 'Sem acordo ativo'}</strong></div>
            {detail.ags.filter((a: Agreement) => a.end_on).map((a: Agreement) => (
              <div class="kv"><span class="muted">{fmtDate(a.start_on)} – {fmtDate(a.end_on)}</span><span class="muted">{MODEL_LABEL[a.model]} · {agreementText(a, sel.currency)}</span></div>
            ))}
            {isAdmin ? (
              <details class="box" style="margin-top:10px">
                <summary>{detail.current ? 'Mudar de acordo ou de preço' : 'Definir acordo'}</summary>
                <form method="post" action={`/parceiros/${sel.id}/acordo`} class="form">
                  {detail.current ? (
                    <p class="note full" style="margin:0">Para corrigir o preço do acordo atual sem criar outro, use "Corrigir acordo atual". Para mudar de fase, cria-se um acordo novo e o atual fecha na véspera da data de início.</p>
                  ) : null}
                  <label class="f">Fase<select name="phase">{[1, 2, 3].map((n) => <option value={n} selected={(detail.current?.phase ?? 1) === n}>{n}</option>)}</select></label>
                  <label class="f">Modelo<select name="model">{Object.entries(MODEL_LABEL).map(([k, v]) => <option value={k} selected={detail.current?.model === k}>{v}</option>)}</select></label>
                  <label class="f">Valor ({sel.currency}) · por lead ou por mês<input name="amount" inputmode="decimal" value={detail.current?.amount ?? ''} /></label>
                  <label class="f">Comissão % (só por trabalho)<input name="commission_pct" inputmode="decimal" value={detail.current?.commission_pct ?? ''} /></label>
                  <label class="f">Início<input type="date" name="start_on" value={todayISO()} /></label>
                  <div class="full row-actions">
                    {detail.current ? <button class="btn" type="submit" name="mode" value="corrigir">Corrigir acordo atual</button> : null}
                    <button class="btn pri" type="submit" name="mode" value="novo">{detail.current ? 'Criar acordo novo' : 'Criar acordo'}</button>
                  </div>
                </form>
              </details>
            ) : null}

            <div class="sec">Sites</div>
            {sel.sitesOf.map((s) => (
              <div class="kv" style="align-items:center">
                <a href={`/sites/${s.id}`}>{s.domain}</a>
                {isAdmin ? (
                  <form method="post" action={`/parceiros/${sel.id}/sites/${s.id}/retirar`} class="inline" onsubmit={`return confirm('Retirar ${s.domain} deste parceiro? O site passa a Pausado e as leads novas deixam de lhe ser faturadas.')`}>
                    <button class="btn sm danger" type="submit">Retirar</button>
                  </form>
                ) : null}
              </div>
            ))}
            {!sel.sitesOf.length ? <p class="empty">Sem sites. Atribua o parceiro na ficha do site.</p> : null}

            <div class="sec">Trabalhos fechados reportados</div>
            <div class="tbl"><table>
              <thead><tr><th>Data</th><th>Site</th><th>Cliente</th><th>Trabalho</th>{isAdmin ? <><th class="num">Valor</th><th class="num">%</th><th class="num">Comissão</th><th></th></> : null}</tr></thead>
              <tbody>
                {detail.jobs.map((j: any) => (
                  <tr><td>{fmtDate(j.done_on)}</td><td>{j.domain ?? '—'}</td><td>{j.client ?? '—'}</td><td class="wrap">{j.description ?? '—'}</td>
                    {isAdmin ? <><td class="num">{money(j.value, sel.currency)}</td><td class="num">{num(j.pct)}%</td><td class="num">{money((j.value * j.pct) / 100, sel.currency)}</td>
                      <td><form method="post" action={`/parceiros/${sel.id}/trabalhos/${j.id}/apagar`} class="inline"><button class="btn sm danger" type="submit">Apagar</button></form></td></> : null}</tr>
                ))}
              </tbody>
            </table></div>
            {isAdmin ? (
              <details class="box" style="margin-top:10px">
                <summary>+ Registar trabalho fechado</summary>
                <form method="post" action={`/parceiros/${sel.id}/trabalhos`} class="form">
                  <label class="f">Data<input type="date" name="done_on" value={todayISO()} required /></label>
                  <label class="f">Site<select name="site_id"><option value="">—</option>{sel.sitesOf.map((s) => <option value={s.id}>{s.domain}</option>)}</select></label>
                  <label class="f">Cliente<input name="client" /></label>
                  <label class="f">Trabalho<input name="description" /></label>
                  <label class="f">Valor ({sel.currency})<input name="value" inputmode="decimal" required /></label>
                  <label class="f">Comissão %<input name="pct" inputmode="decimal" value={detail.current?.commission_pct ?? '0'} /></label>
                  <p class="note full" style="margin:0">Serve para o "fecho real". Só entra na faturação se o acordo for de comissão por trabalho.</p>
                  <div class="full"><button class="btn pri" type="submit">Registar</button></div>
                </form>
              </details>
            ) : null}

            <div class="sec">Dados</div>
            <form method="post" action={`/parceiros/${sel.id}`} class="form">
              <label class="f">Nome<input name="name" value={sel.name} required /></label>
              <label class="f">Pessoa de contacto<input name="contact_name" value={sel.contact_name ?? ''} /></label>
              <label class="f">Telefone<input name="phone" value={sel.phone ?? ''} /></label>
              <label class="f">Email<input name="email" value={sel.email ?? ''} /></label>
              <label class="f">País<select name="country"><option value="PT" selected={sel.country === 'PT'}>Portugal</option><option value="US" selected={sel.country === 'US'}>EUA</option></select></label>
              {isAdmin ? <label class="f">Moeda<select name="currency"><option selected={sel.currency === 'EUR'}>EUR</option><option selected={sel.currency === 'USD'}>USD</option></select></label> : null}
              {isAdmin ? <label class="f">Forma de pagamento<input name="payment_method" value={sel.payment_method ?? ''} placeholder="MB Way, transferência…" /></label> : null}
              <label class="f">Horário para leads<input name="hours" value={sel.hours ?? ''} /></label>
              <label class="f">Fecha quantos em 10 (prometido)<input name="promised_close" value={sel.promised_close ?? ''} /></label>
              <label class="f">Aceitou mensagens do nosso número em<input type="date" name="whatsapp_optin_on" value={sel.whatsapp_optin_on ?? ''} /></label>
              {isAdmin ? <label class="f">Estado<select name="active"><option value="1" selected={!!sel.active}>Ativo</option><option value="0" selected={!sel.active}>Inativo</option></select></label> : null}
              <label class="f full">Notas<textarea name="notes">{sel.notes ?? ''}</textarea></label>
              <div class="full row-actions">
                <button class="btn pri" type="submit">Guardar</button>
                {isAdmin ? <a class="btn" href={`/financeiro?t=pagamentos&parceiro=${sel.id}`}>Ver pagamentos</a> : null}
                <a class="btn" href={`/leads?p=tudo`}>Ver leads</a>
              </div>
            </form>
          </section>
        ) : <section class="card pdetail"><p class="empty">Selecione um parceiro.</p></section>}
      </div>

      {isAdmin ? (
        <details class="box" id="novo">
          <summary>+ Novo parceiro</summary>
          <form method="post" action="/parceiros" class="form">
            <label class="f">Nome<input name="name" required /></label>
            <label class="f">Telefone<input name="phone" /></label>
            <label class="f">País<select name="country"><option value="PT">Portugal</option><option value="US">EUA</option></select></label>
            <label class="f">Moeda<select name="currency"><option>EUR</option><option>USD</option></select></label>
            <div class="full"><button class="btn pri" type="submit">Criar</button></div>
          </form>
          <p class="note">Também pode criar a partir da Prospeção, quando um contacto chega a "Fechado".</p>
        </details>
      ) : null}
    </Layout>
  )
})

partners.post('/', async (c) => {
  if (c.get('user').role !== 'admin') return c.text('Só o administrador.', 403)
  const f = await form(c)
  if (!f.name) return back(c, '/parceiros')
  const r = await c.env.DB.prepare('INSERT INTO partners (name, phone, country, currency) VALUES (?, ?, ?, ?)')
    .bind(f.name, f.phone, f.country ?? 'PT', f.currency ?? 'EUR')
    .run()
  await audit(c, `Criou o parceiro ${f.name}`, 'partner', r.meta.last_row_id)
  return back(c, `/parceiros?sel=${r.meta.last_row_id}`, 'Parceiro criado. Defina o acordo.')
})

partners.post('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await form(c)
  const isAdmin = c.get('user').role === 'admin'
  const cur = await c.env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(id).first<Partner>()
  if (!cur) return back(c, '/parceiros')
  await c.env.DB.prepare(
    `UPDATE partners SET name=?, contact_name=?, phone=?, email=?, country=?, currency=?, payment_method=?, hours=?, promised_close=?,
     whatsapp_optin_on=?, active=?, notes=? WHERE id = ?`
  )
    .bind(f.name ?? cur.name, f.contact_name, f.phone, f.email, f.country ?? cur.country,
      isAdmin ? (f.currency ?? cur.currency) : cur.currency, isAdmin ? f.payment_method : cur.payment_method,
      f.hours, f.promised_close, f.whatsapp_optin_on, isAdmin ? Number(f.active ?? 1) : cur.active, f.notes, id)
    .run()
  await audit(c, `Editou o parceiro ${f.name}`, 'partner', id)
  return back(c, `/parceiros?sel=${id}`, 'Guardado.')
})

partners.post('/:id{[0-9]+}/acordo', async (c) => {
  if (c.get('user').role !== 'admin') return c.text('Só o administrador muda acordos.', 403)
  const id = Number(c.req.param('id'))
  const f = await form(c)
  const db = c.env.DB
  const current = await db.prepare('SELECT * FROM agreements WHERE partner_id = ? AND end_on IS NULL').bind(id).first<Agreement>()
  const model = f.model ?? 'per_lead'
  const amount = toNum(f.amount)
  const pct = toNum(f.commission_pct)
  const phase = toNum(f.phase) ?? 1
  if (f.mode === 'corrigir' && current) {
    await db.prepare('UPDATE agreements SET phase=?, model=?, amount=?, commission_pct=? WHERE id = ?').bind(phase, model, amount, pct, current.id).run()
    await audit(c, 'Corrigiu o acordo atual', 'partner', id)
    return back(c, `/parceiros?sel=${id}`, 'Acordo corrigido.')
  }
  const start = f.start_on ?? todayISO()
  if (current) {
    if (start <= current.start_on) return back(c, `/parceiros?sel=${id}`, 'A data de início tem de ser depois do início do acordo atual.')
    await db.prepare('UPDATE agreements SET end_on = ? WHERE id = ?').bind(addDays(start, -1), current.id).run()
  }
  await db.prepare('INSERT INTO agreements (partner_id, phase, model, amount, commission_pct, start_on) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, phase, model, amount, pct, start)
    .run()
  await audit(c, `Novo acordo: ${MODEL_LABEL[model]}`, 'partner', id)
  return back(c, `/parceiros?sel=${id}`, 'Acordo criado.')
})

partners.post('/:id{[0-9]+}/sites/:sid{[0-9]+}/retirar', async (c) => {
  if (c.get('user').role !== 'admin') return c.text('Só o administrador.', 403)
  const id = Number(c.req.param('id'))
  const sid = Number(c.req.param('sid'))
  const s = await c.env.DB.prepare('SELECT domain FROM sites WHERE id = ? AND partner_id = ?').bind(sid, id).first<{ domain: string }>()
  if (!s) return back(c, `/parceiros?sel=${id}`)
  await c.env.DB.prepare("UPDATE sites SET partner_id = NULL, status = CASE status WHEN 'alugado' THEN 'pausado' ELSE status END WHERE id = ?").bind(sid).run()
  await audit(c, `Retirou ${s.domain} do parceiro`, 'partner', id)
  return back(c, `/parceiros?sel=${id}`, `${s.domain} retirado. Passou a Pausado.`)
})

partners.post('/:id{[0-9]+}/trabalhos', async (c) => {
  if (c.get('user').role !== 'admin') return c.text('Só o administrador.', 403)
  const id = Number(c.req.param('id'))
  const f = await form(c)
  const value = toNum(f.value)
  if (value === null || !f.done_on) return back(c, `/parceiros?sel=${id}`)
  await c.env.DB.prepare('INSERT INTO jobs (partner_id, site_id, done_on, client, description, value, pct) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, toNum(f.site_id), f.done_on, f.client, f.description, value, toNum(f.pct) ?? 0)
    .run()
  await audit(c, 'Registou um trabalho fechado', 'partner', id)
  return back(c, `/parceiros?sel=${id}`, 'Trabalho registado.')
})

partners.post('/:id{[0-9]+}/trabalhos/:jid{[0-9]+}/apagar', async (c) => {
  if (c.get('user').role !== 'admin') return c.text('Só o administrador.', 403)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM jobs WHERE id = ? AND partner_id = ?').bind(Number(c.req.param('jid')), id).run()
  await audit(c, 'Apagou um trabalho', 'partner', id)
  return back(c, `/parceiros?sel=${id}`, 'Trabalho apagado.')
})
