import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { Layout } from '../ui'
import { audit, back, flash, form, toNum } from '../db'
import { STAGES, fmtDate, todayISO } from '../lib'

export const prospects = new Hono<AppEnv>()

type P = {
  id: number; business: string; contact_name: string | null; phone: string | null; niche: string | null; site_id: number | null
  domain: string | null; source: string | null; stage: number; promised_close: string | null; proposed_model: string | null
  free_leads_sent: number; next_step: string | null; next_step_on: string | null; notes: string | null
}

prospects.get('/', async (c) => {
  const db = c.env.DB
  const { results } = await db
    .prepare('SELECT p.*, s.domain FROM prospects p LEFT JOIN sites s ON s.id = p.site_id ORDER BY p.next_step_on IS NULL, p.next_step_on, p.id DESC')
    .all<P>()
  const selId = Number(c.req.query('sel') ?? results[0]?.id ?? 0)
  const sel = results.find((r) => r.id === selId) ?? null
  const { results: logs } = sel
    ? await db.prepare('SELECT * FROM prospect_logs WHERE prospect_id = ? ORDER BY on_date DESC, id DESC').bind(sel.id).all<{ on_date: string; kind: string | null; text: string | null; created_by: string | null }>()
    : { results: [] as any[] }
  const { results: siteList } = await db.prepare('SELECT id, domain FROM sites ORDER BY domain').all<{ id: number; domain: string }>()
  const today = todayISO()

  return c.html(
    <Layout title="Prospeção" active="/prospecao" user={c.get('user')} flash={flash(c)}>
      <div class="top">
        <div><h1>Prospeção</h1><p class="sub">Donos de negócio a quem queres alugar sites</p></div>
        <a class="btn pri" href="#novo">+ Novo contacto</a>
      </div>

      <div class="board" aria-label="Etapas">
        {STAGES.map((name, i) => {
          const items = results.filter((r) => r.stage === i)
          return (
            <section class="col" aria-label={name}>
              <h2>{name} <span class="muted mono" style="font-weight:400">{items.length}</span></h2>
              {items.map((p) => (
                <a class={`pc${sel?.id === p.id ? ' sel' : ''}`} href={`/prospecao?sel=${p.id}`}>
                  <strong>{p.business}</strong>
                  <span class="muted" style="font-size:12px">{[p.niche, p.domain].filter(Boolean).join(' · ')}</span>
                  {p.next_step ? <span class="nx" style={p.next_step_on && p.next_step_on <= today ? '' : 'color:#56635C'}>{p.next_step}{p.next_step_on ? ` · ${fmtDate(p.next_step_on)}` : ''}</span> : null}
                </a>
              ))}
            </section>
          )
        })}
      </div>

      {sel ? (
        <section class="card" aria-label="Detalhe do contacto">
          <div class="filters" style="margin-bottom:14px">
            <div><h2 style="margin:0;font-size:18px">{sel.business}</h2><div class="sub">Etapa: {STAGES[sel.stage]}</div></div>
            <div class="row-actions">
              {sel.phone ? <a class="btn" href={`tel:${sel.phone.replace(/\s/g, '')}`}>Ligar</a> : null}
              {sel.stage > 0 ? <form method="post" action={`/prospecao/${sel.id}/etapa`} class="inline"><input type="hidden" name="d" value="-1" /><button class="btn" type="submit">← Recuar</button></form> : null}
              {sel.stage < 4 ? <form method="post" action={`/prospecao/${sel.id}/etapa`} class="inline"><input type="hidden" name="d" value="1" /><button class="btn pri" type="submit">Avançar etapa →</button></form> : null}
              {sel.stage < 4 ? <form method="post" action={`/prospecao/${sel.id}/etapa`} class="inline"><input type="hidden" name="to" value="5" /><button class="btn danger" type="submit">Recusou</button></form> : null}
              {sel.stage === 4 ? <form method="post" action={`/prospecao/${sel.id}/converter`} class="inline"><button class="btn pri" type="submit">Criar parceiro</button></form> : null}
            </div>
          </div>
          <form method="post" action={`/prospecao/${sel.id}`} class="form">
            <label class="f">Negócio<input name="business" value={sel.business} required /></label>
            <label class="f">Contacto<input name="contact_name" value={sel.contact_name ?? ''} /></label>
            <label class="f">Telefone<input name="phone" value={sel.phone ?? ''} /></label>
            <label class="f">Nicho<input name="niche" value={sel.niche ?? ''} /></label>
            <label class="f">Site a propor<select name="site_id"><option value="">—</option>{siteList.map((s) => <option value={s.id} selected={sel.site_id === s.id}>{s.domain}</option>)}</select></label>
            <label class="f">Origem<input name="source" value={sel.source ?? ''} placeholder="Google Maps, warm hand-off…" /></label>
            <label class="f">Fecha quantos em 10?<input name="promised_close" value={sel.promised_close ?? ''} placeholder="ex: 3 em 10" /></label>
            <label class="f">Modelo proposto<input name="proposed_model" value={sel.proposed_model ?? ''} /></label>
            <label class="f">Leads grátis enviadas<input name="free_leads_sent" value={String(sel.free_leads_sent)} inputmode="numeric" /></label>
            <label class="f">Próximo passo<input name="next_step" value={sel.next_step ?? ''} /></label>
            <label class="f">Data do próximo passo<input type="date" name="next_step_on" value={sel.next_step_on ?? ''} /></label>
            <label class="f full">Notas<textarea name="notes">{sel.notes ?? ''}</textarea></label>
            <div class="full"><button class="btn" type="submit">Guardar</button></div>
          </form>

          <h2 style="margin-top:20px">Histórico</h2>
          <form method="post" action={`/prospecao/${sel.id}/registo`} class="form" style="margin-bottom:14px">
            <label class="f">Data<input type="date" name="on_date" value={today} required /></label>
            <label class="f">Tipo<select name="kind"><option>Chamada</option><option>Mensagem</option><option>Visita</option><option>Warm hand-off</option><option>Leads grátis</option><option>Nota</option></select></label>
            <label class="f full">O que aconteceu<input name="text" required /></label>
            <div class="full"><button class="btn" type="submit">+ Registar contacto</button></div>
          </form>
          {logs.map((l) => <div class="log"><b>{fmtDate(l.on_date)} · {l.kind}</b>{l.text}</div>)}
          {!logs.length ? <p class="empty">Ainda sem registos.</p> : null}
        </section>
      ) : null}

      <details class="box" id="novo" open={!results.length}>
        <summary>+ Novo contacto</summary>
        <form method="post" action="/prospecao" class="form">
          <label class="f">Negócio<input name="business" required /></label>
          <label class="f">Contacto<input name="contact_name" /></label>
          <label class="f">Telefone<input name="phone" /></label>
          <label class="f">Nicho<input name="niche" /></label>
          <label class="f">Site a propor<select name="site_id"><option value="">—</option>{siteList.map((s) => <option value={s.id}>{s.domain}</option>)}</select></label>
          <label class="f">Origem<input name="source" /></label>
          <label class="f">Próximo passo<input name="next_step" /></label>
          <label class="f">Data do próximo passo<input type="date" name="next_step_on" /></label>
          <div class="full"><button class="btn pri" type="submit">Criar</button></div>
        </form>
      </details>
    </Layout>
  )
})

prospects.post('/', async (c) => {
  const f = await form(c)
  if (!f.business) return back(c, '/prospecao')
  const r = await c.env.DB.prepare(
    'INSERT INTO prospects (business, contact_name, phone, niche, site_id, source, next_step, next_step_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(f.business, f.contact_name, f.phone, f.niche, toNum(f.site_id), f.source, f.next_step, f.next_step_on)
    .run()
  await audit(c, `Criou o contacto ${f.business}`, 'prospect', r.meta.last_row_id)
  return back(c, `/prospecao?sel=${r.meta.last_row_id}`, 'Contacto criado.')
})

prospects.post('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await form(c)
  await c.env.DB.prepare(
    `UPDATE prospects SET business=?, contact_name=?, phone=?, niche=?, site_id=?, source=?, promised_close=?, proposed_model=?,
     free_leads_sent=?, next_step=?, next_step_on=?, notes=? WHERE id = ?`
  )
    .bind(f.business, f.contact_name, f.phone, f.niche, toNum(f.site_id), f.source, f.promised_close, f.proposed_model,
      toNum(f.free_leads_sent) ?? 0, f.next_step, f.next_step_on, f.notes, id)
    .run()
  await audit(c, `Editou o contacto ${f.business}`, 'prospect', id)
  return back(c, `/prospecao?sel=${id}`, 'Guardado.')
})

prospects.post('/:id{[0-9]+}/etapa', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await form(c)
  const p = await c.env.DB.prepare('SELECT stage FROM prospects WHERE id = ?').bind(id).first<{ stage: number }>()
  if (!p) return back(c, '/prospecao')
  let to = f.to !== null && f.to !== undefined ? Number(f.to) : p.stage + Number(f.d ?? 1)
  to = Math.max(0, Math.min(5, to))
  await c.env.DB.prepare('UPDATE prospects SET stage = ? WHERE id = ?').bind(to, id).run()
  await c.env.DB.prepare('INSERT INTO prospect_logs (prospect_id, on_date, kind, text, created_by) VALUES (?, ?, ?, ?, ?)')
    .bind(id, todayISO(), 'Etapa', `Passou para "${STAGES[to]}"`, c.get('user').email)
    .run()
  await audit(c, `Mudou etapa para ${STAGES[to]}`, 'prospect', id)
  return back(c, `/prospecao?sel=${id}`)
})

prospects.post('/:id{[0-9]+}/registo', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await form(c)
  if (!f.text) return back(c, `/prospecao?sel=${id}`)
  await c.env.DB.prepare('INSERT INTO prospect_logs (prospect_id, on_date, kind, text, created_by) VALUES (?, ?, ?, ?, ?)')
    .bind(id, f.on_date ?? todayISO(), f.kind, f.text, c.get('user').email)
    .run()
  return back(c, `/prospecao?sel=${id}`, 'Registado.')
})

// Fechado → cria o parceiro com os dados do contacto e liga-o ao site proposto
prospects.post('/:id{[0-9]+}/converter', async (c) => {
  if (c.get('user').role !== 'admin') return c.text('Só o administrador cria parceiros.', 403)
  const id = Number(c.req.param('id'))
  const p = await c.env.DB.prepare('SELECT p.*, s.country FROM prospects p LEFT JOIN sites s ON s.id = p.site_id WHERE p.id = ?').bind(id).first<P & { country: string | null }>()
  if (!p) return back(c, '/prospecao')
  const country = p.country ?? 'PT'
  const r = await c.env.DB.prepare(
    'INSERT INTO partners (name, contact_name, phone, country, currency, promised_close, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(p.business, p.contact_name, p.phone, country, country === 'US' ? 'USD' : 'EUR', p.promised_close, p.notes)
    .run()
  const pid = r.meta.last_row_id
  if (p.site_id) await c.env.DB.prepare("UPDATE sites SET partner_id = ?, status = 'alugado' WHERE id = ?").bind(pid, p.site_id).run()
  await audit(c, `Converteu ${p.business} em parceiro`, 'partner', pid)
  return back(c, `/parceiros?sel=${pid}`, 'Parceiro criado. Falta definir o acordo (modelo e preço).')
})
