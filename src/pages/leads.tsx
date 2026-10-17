import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { Layout, Pill } from '../ui'
import { audit, back, flash, form, toNum } from '../db'
import { todayISO, monthOf, monthStart, weekStart, nowLocalISO, fmtDateTime, fmtDuration, TYPE_LABEL } from '../lib'

export const leads = new Hono<AppEnv>()

type LeadRow = {
  id: number; site_id: number; domain: string; type: string; occurred_at: string; contact: string | null; name: string | null
  duration_s: number | null; result: string | null; billable: number; details: string | null; partner_name: string | null
}

leads.get('/', async (c) => {
  const db = c.env.DB
  const today = todayISO()
  const site = c.req.query('site') ?? ''
  const p = c.req.query('p') ?? 'mes'
  const t = c.req.query('t') ?? 'tudo'
  const from = p === 'semana' ? weekStart(today) : p === 'mes' ? monthStart(monthOf(today)) : (c.req.query('de') || '2000-01-01')
  const to = p === 'intervalo' ? (c.req.query('ate') || today) : today
  const where = ['substr(l.occurred_at,1,10) BETWEEN ? AND ?']
  const binds: (string | number)[] = [from, to]
  if (site) { where.push('l.site_id = ?'); binds.push(Number(site)) }
  if (t !== 'tudo') { where.push('l.type = ?'); binds.push(t) }
  const { results } = await db
    .prepare(
      `SELECT l.*, s.domain, p.name partner_name FROM leads l JOIN sites s ON s.id = l.site_id LEFT JOIN partners p ON p.id = l.partner_id
       WHERE ${where.join(' AND ')} ORDER BY l.occurred_at DESC LIMIT 500`
    )
    .bind(...binds)
    .all<LeadRow>()
  const { results: siteList } = await db.prepare('SELECT id, domain FROM sites ORDER BY domain').all<{ id: number; domain: string }>()
  const q = (o: Record<string, string>) => '/leads?' + new URLSearchParams({ site, p, t, ...o }).toString()
  const billable = results.filter((r) => r.billable).length
  const isAdmin = c.get('user').role === 'admin'
  const backUrl = q({})

  return c.html(
    <Layout title="Leads" active="/leads" user={c.get('user')} flash={flash(c)}>
      <div class="top">
        <div><h1>Leads</h1><p class="sub">Chamadas, formulários e conversas de todos os sites</p></div>
        <a class="btn pri" href={q({ nova: '1' }) + '#nova'}>+ Registar lead</a>
      </div>

      <section class="kpis" aria-label="Resumo">
        <div class="card"><div class="k">Leads</div><div class="v">{results.length}</div></div>
        <div class="card"><div class="k">Faturáveis</div><div class="v">{billable}</div></div>
        <div class="card"><div class="k">Chamadas</div><div class="v">{results.filter((r) => r.type === 'chamada').length}</div></div>
        <div class="card"><div class="k">Formulários</div><div class="v">{results.filter((r) => r.type === 'formulario').length}</div></div>
      </section>

      <form method="get" action="/leads" class="filters">
        <label class="f">Site
          <select name="site" onchange="this.form.submit()">
            <option value="">Todos os sites</option>
            {siteList.map((s) => <option value={s.id} selected={String(s.id) === site}>{s.domain}</option>)}
          </select>
        </label>
        <input type="hidden" name="p" value={p} /><input type="hidden" name="t" value={t} />
        <div class="pills" role="group" aria-label="Período">
          <Pill href={q({ p: 'semana' })} on={p === 'semana'}>Esta semana</Pill>
          <Pill href={q({ p: 'mes' })} on={p === 'mes'}>Este mês</Pill>
          <Pill href={q({ p: 'tudo' })} on={p === 'tudo'}>Tudo</Pill>
        </div>
        <div class="pills" role="group" aria-label="Tipo">
          <Pill href={q({ t: 'tudo' })} on={t === 'tudo'}>Tudo</Pill>
          <Pill href={q({ t: 'chamada' })} on={t === 'chamada'}>Chamadas</Pill>
          <Pill href={q({ t: 'formulario' })} on={t === 'formulario'}>Formulários</Pill>
          <Pill href={q({ t: 'whatsapp' })} on={t === 'whatsapp'}>WhatsApp</Pill>
        </div>
      </form>

      <section class="card flush" aria-label="Lista de leads">
        <div class="tbl"><table>
          <thead><tr><th>Data</th><th>Site</th><th>Tipo</th><th>Contacto</th><th class="num">Duração</th><th>Resultado</th><th>Parceiro</th><th>Faturável</th><th>Detalhes</th><th></th></tr></thead>
          <tbody>
            {results.map((l) => (
              <tr>
                <td>{fmtDateTime(l.occurred_at)}</td>
                <td><a href={`/sites/${l.site_id}`}>{l.domain}</a></td>
                <td>{TYPE_LABEL[l.type]}</td>
                <td class="mono">{l.contact ?? '—'}{l.name ? <div class="muted" style="font-family:inherit">{l.name}</div> : null}</td>
                <td class="num">{fmtDuration(l.duration_s)}</td>
                <td>{l.result ?? '—'}</td>
                <td>{l.partner_name ?? <span class="muted">Sem parceiro</span>}</td>
                <td>
                  <form method="post" action={`/leads/${l.id}/faturavel`} class="inline">
                    <input type="hidden" name="back" value={backUrl} />
                    <button class="btn sm" type="submit" title="Alternar">{l.billable ? 'Sim' : 'Não'}</button>
                  </form>
                </td>
                <td class="wrap" style="max-width:320px;white-space:pre-line;font-size:12px">{l.details ?? ''}</td>
                <td>{isAdmin ? (
                  <form method="post" action={`/leads/${l.id}/apagar`} class="inline" onsubmit="return confirm('Apagar esta lead?')">
                    <input type="hidden" name="back" value={backUrl} />
                    <button class="btn sm danger" type="submit">Apagar</button>
                  </form>) : null}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!results.length ? <p class="empty">Nenhuma lead neste período.</p> : null}
        <p class="note">Cada chamada é uma lead faturável. Use "Não" só para spam, enganos ou testes.</p>
      </section>

      <details class="box" id="nova" open={c.req.query('nova') === '1'}>
        <summary>+ Registar lead à mão</summary>
        <p class="note" style="margin:0 0 10px">Enquanto o call tracking não está ligado, as chamadas registam-se aqui.</p>
        <form method="post" action="/leads" class="form">
          <label class="f">Site<select name="site_id" required>{siteList.map((s) => <option value={s.id} selected={String(s.id) === site}>{s.domain}</option>)}</select></label>
          <label class="f">Tipo<select name="type"><option value="chamada">Chamada</option><option value="formulario">Formulário</option><option value="whatsapp">WhatsApp</option></select></label>
          <label class="f">Data e hora<input type="datetime-local" name="occurred_at" value={nowLocalISO()} required /></label>
          <label class="f">Contacto<input name="contact" placeholder="+351 9xx xxx xxx" /></label>
          <label class="f">Nome<input name="name" /></label>
          <label class="f">Duração (minutos)<input name="duration_min" inputmode="decimal" /></label>
          <label class="f">Resultado<input name="result" placeholder="Atendida, não atendida…" /></label>
          <label class="f">Faturável<select name="billable"><option value="1">Sim</option><option value="0">Não</option></select></label>
          <label class="f full">Detalhes<textarea name="details"></textarea></label>
          <div class="full"><button class="btn pri" type="submit">Registar</button></div>
        </form>
      </details>
    </Layout>
  )
})

leads.post('/', async (c) => {
  const f = await form(c)
  const siteId = toNum(f.site_id)
  if (!siteId || !f.occurred_at) return back(c, '/leads')
  const site = await c.env.DB.prepare('SELECT partner_id, domain FROM sites WHERE id = ?').bind(siteId).first<{ partner_id: number | null; domain: string }>()
  if (!site) return back(c, '/leads')
  const min = toNum(f.duration_min)
  const r = await c.env.DB.prepare(
    `INSERT INTO leads (site_id, partner_id, type, occurred_at, contact, name, duration_s, result, billable, details, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(siteId, site.partner_id, f.type ?? 'chamada', f.occurred_at, f.contact, f.name, min === null ? null : Math.round(min * 60),
      f.result, f.billable === '0' ? 0 : 1, f.details, c.get('user').email)
    .run()
  await audit(c, `Registou uma lead em ${site.domain}`, 'lead', r.meta.last_row_id)
  return back(c, `/leads?site=${siteId}`, 'Lead registada.')
})

const safeBack = (v: string | null | undefined) => (v && v.startsWith('/leads') ? v : '/leads')

leads.post('/:id{[0-9]+}/faturavel', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await form(c)
  await c.env.DB.prepare('UPDATE leads SET billable = 1 - billable WHERE id = ?').bind(id).run()
  await audit(c, 'Alterou "faturável" de uma lead', 'lead', id)
  return back(c, safeBack(f.back), 'Lead atualizada.')
})

leads.post('/:id{[0-9]+}/apagar', async (c) => {
  if (c.get('user').role !== 'admin') return c.text('Só o administrador pode apagar leads.', 403)
  const id = Number(c.req.param('id'))
  const f = await form(c)
  await c.env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id).run()
  await audit(c, 'Apagou uma lead', 'lead', id)
  return back(c, safeBack(f.back), 'Lead apagada.')
})
