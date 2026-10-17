import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { Layout, Pill, Chip, ExtIcon, Bars, Line, statusChip } from '../ui'
import { audit, back, flash, form, toNum } from '../db'
import {
  todayISO, monthOf, monthStart, addDays, addMonths, weekStart, money, num, fmtDate, fmtDateTime, fmtDuration,
  STATUS_LABEL, MODEL_LABEL, TYPE_LABEL, randomKey, monthName, daysBetween, type Agreement
} from '../lib'

export const sites = new Hono<AppEnv>()

type SiteRow = {
  id: number; domain: string; niche: string | null; city: string | null; country: string; status: string
  partner_id: number | null; partner_name: string | null; partner_currency: string | null; created_on: string | null
  domain_renews_on: string | null; tracking_number: string | null; forward_to: string | null; whisper: string | null
  drive_url: string | null; gsc_property: string | null; form_key: string; notes: string | null
}

const SITE_SQL = `SELECT s.*, p.name partner_name, p.currency partner_currency FROM sites s LEFT JOIN partners p ON p.id = s.partner_id`

async function activeAgreement(db: D1Database, partnerId: number | null) {
  if (!partnerId) return null
  return db.prepare('SELECT * FROM agreements WHERE partner_id = ? AND end_on IS NULL ORDER BY start_on DESC LIMIT 1').bind(partnerId).first<Agreement>()
}
export function agreementText(a: Agreement | null, cur: string | null) {
  if (!a) return '—'
  const c = cur ?? 'EUR'
  if (a.model === 'per_lead') return `Fase ${a.phase} · ${a.amount === null ? 'preço por lead por definir' : `${money(a.amount, c)} por lead`}`
  if (a.model === 'monthly') return `Fase ${a.phase} · ${a.amount === null ? 'mensalidade por definir' : `${money(a.amount, c)}/mês`}`
  return `Fase ${a.phase} · ${a.commission_pct ?? '?'}% por trabalho`
}

async function seoSummary(db: D1Database, siteId: number, days = 28) {
  const from = addDays(todayISO(), -days)
  const r = await db
    .prepare(
      `SELECT SUM(clicks) clicks, SUM(impressions) imp, SUM(position * impressions) / NULLIF(SUM(impressions),0) pos
       FROM seo_daily WHERE site_id = ? AND source = 'gsc' AND date >= ?`
    )
    .bind(siteId, from)
    .first<{ clicks: number | null; imp: number | null; pos: number | null }>()
  if (r && r.imp) return { clicks: r.clicks ?? 0, imp: r.imp, pos: r.pos, ctr: r.imp ? (r.clicks ?? 0) / r.imp : null, src: 'gsc' as const }
  const m = await db
    .prepare(`SELECT position, date FROM seo_daily WHERE site_id = ? AND source = 'manual' ORDER BY date DESC LIMIT 1`)
    .bind(siteId)
    .first<{ position: number; date: string }>()
  return { clicks: null, imp: null, pos: m?.position ?? null, ctr: null, src: m ? ('manual' as const) : null, date: m?.date }
}

/** Estado acompanha o parceiro: atribuir parceiro → Alugado; tirar o parceiro de um site alugado → Pausado */
export function autoStatus(requested: string, oldPartner: number | null, newPartner: number | null): string {
  if (newPartner && !oldPartner) return 'alugado'
  if (!newPartner && oldPartner && requested === 'alugado') return 'pausado'
  if (!newPartner && requested === 'alugado') return 'pausado'
  return requested
}

// ---------------- Lista ----------------
sites.get('/', async (c) => {
  const db = c.env.DB
  const st = c.req.query('estado') ?? 'todos'
  const ct = c.req.query('pais') ?? 'todos'
  const where: string[] = []
  const binds: string[] = []
  if (st !== 'todos') { where.push('s.status = ?'); binds.push(st) }
  if (ct !== 'todos') { where.push('s.country = ?'); binds.push(ct) }
  const { results } = await db.prepare(`${SITE_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.status, s.domain`).bind(...binds).all<SiteRow>()
  const curM = monthOf(todayISO())
  const rows = await Promise.all(
    results.map(async (s) => {
      const leads = (await db.prepare('SELECT COUNT(*) n FROM leads WHERE site_id = ? AND substr(occurred_at,1,7) = ?').bind(s.id, curM).first<{ n: number }>())!.n
      const seo = await seoSummary(db, s.id)
      const cost = await db.prepare(`SELECT currency, SUM(CASE period WHEN 'mes' THEN amount*12 ELSE amount END) t FROM costs WHERE site_id = ? GROUP BY currency`).bind(s.id).all<{ currency: string; t: number }>()
      const ag = await activeAgreement(db, s.partner_id)
      return { ...s, leads, seo, cost: cost.results, ag }
    })
  )
  const { results: counts } = await db.prepare('SELECT status, COUNT(*) n FROM sites GROUP BY status').all<{ status: string; n: number }>()
  const n = (x: string) => counts.find((k) => k.status === x)?.n ?? 0
  const q = (o: Record<string, string>) => '/sites?' + new URLSearchParams({ estado: st, pais: ct, ...o }).toString()
  const { results: partners } = await db.prepare('SELECT id, name FROM partners WHERE active = 1 ORDER BY name').all<{ id: number; name: string }>()

  return c.html(
    <Layout title="Sites" active="/sites" user={c.get('user')} flash={flash(c)}>
      <div class="top">
        <div><h1>Sites</h1><p class="sub">Todos os sites do portefólio</p></div>
      </div>
      <section class="kpis" aria-label="Resumo">
        <div class="card"><div class="k">Alugados</div><div class="v">{n('alugado')}</div></div>
        <div class="card"><div class="k">Em construção</div><div class="v">{n('construcao')}</div></div>
        <div class="card"><div class="k">Pausados (no ar, sem parceiro)</div><div class="v">{n('pausado')}</div></div>
      </section>
      <div class="filters">
        <div class="pills" role="group" aria-label="Estado">
          <Pill href={q({ estado: 'todos' })} on={st === 'todos'}>Todos</Pill>
          <Pill href={q({ estado: 'alugado' })} on={st === 'alugado'}>Alugado</Pill>
          <Pill href={q({ estado: 'construcao' })} on={st === 'construcao'}>Em construção</Pill>
          <Pill href={q({ estado: 'pausado' })} on={st === 'pausado'}>Pausado</Pill>
        </div>
        <div class="pills" role="group" aria-label="País">
          <Pill href={q({ pais: 'todos' })} on={ct === 'todos'}>Todos os países</Pill>
          <Pill href={q({ pais: 'PT' })} on={ct === 'PT'}>Portugal</Pill>
          <Pill href={q({ pais: 'US' })} on={ct === 'US'}>EUA</Pill>
        </div>
      </div>
      <section class="card flush" aria-label="Lista de sites">
        <div class="tbl"><table>
          <thead><tr><th>Site</th><th></th><th>País</th><th>Estado</th><th>Parceiro</th><th>Acordo</th><th class="num">Leads (mês)</th><th class="num">Posição média</th><th class="num">Custo/ano</th><th>Criado</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr>
                <td><a href={`/sites/${s.id}`} style="font-weight:500">{s.domain}</a><div class="muted" style="font-size:12px">{[s.niche, s.city].filter(Boolean).join(' · ')}</div></td>
                <td><ExtIcon href={`https://${s.domain}`} label={`Abrir ${s.domain} numa nova aba`} /></td>
                <td>{s.country === 'US' ? 'EUA' : 'Portugal'}</td>
                <td><Chip cls={statusChip(s.status)}>{STATUS_LABEL[s.status]}</Chip></td>
                <td>{s.partner_id ? <a href={`/parceiros?sel=${s.partner_id}`}>{s.partner_name}</a> : '—'}</td>
                <td>{c.get('user').role === 'admin' ? agreementText(s.ag, s.partner_currency) : s.ag ? MODEL_LABEL[s.ag.model] : '—'}</td>
                <td class="num">{s.leads}</td>
                <td class="num">{num(s.seo.pos)}{s.seo.src === 'manual' ? '*' : ''}</td>
                <td class="num">{s.cost.length ? s.cost.map((x) => money(x.t, x.currency)).join(' + ') : '—'}</td>
                <td class="muted">{fmtDate(s.created_on)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!rows.length ? <p class="empty">Nenhum site com estes filtros.</p> : null}
        <p class="note">Posição média dos últimos 28 dias no Search Console. * = último registo manual (antes da ligação ao Search Console).</p>
      </section>

      <details class="box">
        <summary>+ Novo site</summary>
        <form method="post" action="/sites" class="form">
          <label class="f">Domínio<input name="domain" required placeholder="ex: wallboxbarreiro.pt" /></label>
          <label class="f">Nicho<input name="niche" /></label>
          <label class="f">Cidade<input name="city" /></label>
          <label class="f">País<select name="country"><option value="PT">Portugal</option><option value="US">EUA</option></select></label>
          <label class="f">Estado<select name="status">{Object.entries(STATUS_LABEL).map(([k, v]) => <option value={k}>{v}</option>)}</select></label>
          <label class="f">Parceiro<select name="partner_id"><option value="">— Sem parceiro —</option>{partners.map((p) => <option value={p.id}>{p.name}</option>)}</select></label>
          <label class="f">Criado em<input type="date" name="created_on" /></label>
          <div class="full"><button class="btn pri" type="submit">Criar site</button></div>
        </form>
      </details>
    </Layout>
  )
})

sites.post('/', async (c) => {
  const f = await form(c)
  if (!f.domain) return back(c, '/sites')
  const domain = f.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
  const r = await c.env.DB.prepare(
    `INSERT INTO sites (domain, niche, city, country, status, partner_id, created_on, gsc_property, form_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(domain, f.niche, f.city, f.country ?? 'PT', autoStatus(f.status ?? 'construcao', null, toNum(f.partner_id)), toNum(f.partner_id), f.created_on, `sc-domain:${domain}`, randomKey())
    .run()
  await audit(c, `Criou o site ${domain}`, 'site', r.meta.last_row_id)
  return back(c, `/sites/${r.meta.last_row_id}`, 'Site criado.')
})

// ---------------- Ficha ----------------
sites.get('/:id{[0-9]+}', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const s = await db.prepare(`${SITE_SQL} WHERE s.id = ?`).bind(id).first<SiteRow>()
  if (!s) return c.notFound()
  const today = todayISO()
  const g = c.req.query('g') === 'mes' ? 'mes' : 'semana'
  const lf = c.req.query('f') ?? 'todas'
  const seo = await seoSummary(db, id)
  const ag = await activeAgreement(db, s.partner_id)
  const { results: agHist } = s.partner_id
    ? await db.prepare('SELECT * FROM agreements WHERE partner_id = ? ORDER BY start_on DESC').bind(s.partner_id).all<Agreement>()
    : { results: [] as Agreement[] }

  // Impressões por semana (últimas 12) e posição (diária GSC + registos manuais)
  const { results: daily } = await db
    .prepare(`SELECT date, impressions, position, source FROM seo_daily WHERE site_id = ? AND date >= ? ORDER BY date`)
    .bind(id, addDays(today, -120))
    .all<{ date: string; impressions: number | null; position: number | null; source: string }>()
  const wk = new Map<string, number>()
  for (const d of daily) if (d.source === 'gsc') wk.set(weekStart(d.date), (wk.get(weekStart(d.date)) ?? 0) + (d.impressions ?? 0))
  const impData = [...wk.entries()].slice(-12).map(([w, v]) => ({ label: fmtDate(w).slice(0, 5), value: v }))
  const posData = daily.filter((d) => d.position !== null).map((d) => ({ label: fmtDate(d.date).slice(0, 5), value: d.position }))

  // Leads por semana / mês
  let leadBars: { label: string; value: number }[] = []
  if (g === 'semana') {
    const start = addDays(weekStart(today), -7 * 7)
    const { results } = await db
      .prepare(`SELECT occurred_at FROM leads WHERE site_id = ? AND substr(occurred_at,1,10) >= ?`)
      .bind(id, start)
      .all<{ occurred_at: string }>()
    for (let i = 0; i < 8; i++) {
      const w = addDays(start, i * 7)
      const e = addDays(w, 6)
      leadBars.push({ label: fmtDate(w).slice(0, 5), value: results.filter((r) => r.occurred_at.slice(0, 10) >= w && r.occurred_at.slice(0, 10) <= e).length })
    }
  } else {
    const curM = monthOf(today)
    const { results } = await db
      .prepare(`SELECT substr(occurred_at,1,7) m, COUNT(*) n FROM leads WHERE site_id = ? AND substr(occurred_at,1,7) >= ? GROUP BY m`)
      .bind(id, addMonths(curM, -5))
      .all<{ m: string; n: number }>()
    for (let i = 5; i >= 0; i--) {
      const m = addMonths(curM, -i)
      leadBars.push({ label: monthName(m, true), value: results.find((r) => r.m === m)?.n ?? 0 })
    }
  }
  const leadWhere = lf === 'faturaveis' ? 'AND billable = 1' : lf === 'nao' ? 'AND billable = 0' : ''
  const { results: leads } = await db
    .prepare(`SELECT * FROM leads WHERE site_id = ? ${leadWhere} ORDER BY occurred_at DESC LIMIT 100`)
    .bind(id)
    .all<{ id: number; type: string; occurred_at: string; contact: string | null; name: string | null; duration_s: number | null; result: string | null; billable: number; details: string | null }>()
  const first = await db.prepare('SELECT MIN(occurred_at) f FROM leads WHERE site_id = ?').bind(id).first<{ f: string | null }>()
  const { results: costs } = await db.prepare('SELECT * FROM costs WHERE site_id = ? ORDER BY item').bind(id).all<{ id: number; item: string; amount: number; currency: string; period: string; renews_on: string | null; provider: string | null }>()
  const yearly = costs.reduce((m, x) => m.set(x.currency, (m.get(x.currency) ?? 0) + (x.period === 'mes' ? x.amount * 12 : x.amount)), new Map<string, number>())
  const calcRow = await db.prepare('SELECT data, updated_at FROM calculations WHERE site_id = ?').bind(id).first<{ data: string; updated_at: string }>()
  const calcData = calcRow ? (JSON.parse(calcRow.data) as { result?: { perLead?: number }; promisedClose?: string; comm?: number }) : null
  const { results: partners } = await db.prepare('SELECT id, name FROM partners WHERE active = 1 ORDER BY name').all<{ id: number; name: string }>()
  const origin = new URL(c.req.url).origin
  const hookUrl = `${origin}/hooks/form/${s.form_key}`
  const q = (o: Record<string, string>) => `/sites/${id}?` + new URLSearchParams({ g, f: lf, ...o }).toString()

  return c.html(
    <Layout title={s.domain} active="/sites" user={c.get('user')} flash={flash(c)}>
      <div><a href="/sites" style="font-size:13px">← Sites</a></div>
      <div class="top">
        <div>
          <h1>{s.domain}</h1>
          <p class="sub">{[s.niche, s.city].filter(Boolean).join(' · ')}{s.niche || s.city ? ' · ' : ''}<Chip cls={statusChip(s.status)}>{STATUS_LABEL[s.status]}</Chip></p>
        </div>
        <div class="row-actions">
          <a class="btn" href={`https://${s.domain}`} target="_blank" rel="noopener">Abrir site</a>
          <a class="btn" href={`/calculadora?site=${id}`}>Calculadora</a>
          <a class="btn" href={`/leads?site=${id}&nova=1`}>+ Registar lead</a>
        </div>
      </div>

      <section class="card" aria-label="Informação">
        <h2>Informação</h2>
        <div class="info">
          <div><span>Criado</span>{fmtDate(s.created_on)}</div>
          <div><span>Primeira lead</span>{first?.f ? `${fmtDate(first.f)}${s.created_on ? ` (${daysBetween(s.created_on, first.f)} dias)` : ''}` : '—'}</div>
          <div><span>País</span>{s.country === 'US' ? 'EUA' : 'Portugal'}</div>
          <div><span>Parceiro</span>{s.partner_id ? <a href={`/parceiros?sel=${s.partner_id}`}>{s.partner_name}</a> : 'Sem parceiro'}</div>
          <div><span>Número de tracking</span>{s.tracking_number ?? '—'}</div>
          <div><span>Encaminha para</span>{s.forward_to ?? '—'}</div>
          {c.get('user').role === 'admin' ? <div><span>Custo por ano</span>{yearly.size ? [...yearly.entries()].map(([k, v]) => money(v, k)).join(' + ') : '—'} · <a href={`/financeiro?t=custos&site=${id}`}>{yearly.size ? 'ver custos' : 'acrescentar'}</a></div> : null}
          <div><span>Domínio renova</span>{fmtDate(s.domain_renews_on)}</div>
          <div><span>Pasta na Drive</span>{s.drive_url ? <a href={s.drive_url} target="_blank" rel="noopener">Abrir</a> : '—'}</div>
        </div>
        {s.notes ? <p class="note" style="white-space:pre-line">{s.notes}</p> : null}
      </section>

      <section class="kpis" aria-label="Search Console">
        <div class="card"><div class="k">Posição média (28 dias)</div><div class="v">{num(seo.pos)}</div>{seo.src === 'manual' ? <div class="d">Registo manual de {fmtDate((seo as any).date)}</div> : null}</div>
        <div class="card"><div class="k">Impressões (28 dias)</div><div class="v">{seo.imp === null ? '—' : num(seo.imp, 0)}</div></div>
        <div class="card"><div class="k">Cliques (28 dias)</div><div class="v">{seo.clicks === null ? '—' : num(seo.clicks, 0)}</div></div>
        <div class="card"><div class="k">CTR</div><div class="v">{seo.ctr === null ? '—' : `${num(seo.ctr * 100)}%`}</div></div>
      </section>

      <div class="grid2">
        <section class="card" aria-label="Impressões"><h2>Impressões por semana</h2>
          {impData.length ? <Bars data={impData} label="Impressões por semana no Search Console" fmt={(v) => num(v, 0)} /> : <p class="empty">Sem dados do Search Console ainda.</p>}
        </section>
        <section class="card" aria-label="Posição"><h2>Posição média ao longo do tempo</h2>
          <Line data={posData} label="Posição média no Google (mais abaixo é pior)" invert />
        </section>
      </div>

      <section class="card" aria-label="Leads do site">
        <div class="filters" style="margin-bottom:8px">
          <h2 style="margin:0">Leads</h2>
          <div class="pills"><Pill href={q({ g: 'semana' })} on={g === 'semana'}>Por semana</Pill><Pill href={q({ g: 'mes' })} on={g === 'mes'}>Por mês</Pill></div>
        </div>
        <Bars data={leadBars} label={`Leads ${g === 'semana' ? 'por semana' : 'por mês'}: ${leadBars.map((b) => `${b.label} ${b.value}`).join(', ')}`} />
      </section>

      <section class="card" aria-label="Histórico de leads">
        <div class="filters" style="margin-bottom:8px">
          <h2 style="margin:0">Histórico de leads</h2>
          <div class="pills">
            <Pill href={q({ f: 'todas' })} on={lf === 'todas'}>Todas</Pill>
            <Pill href={q({ f: 'faturaveis' })} on={lf === 'faturaveis'}>Faturáveis</Pill>
            <Pill href={q({ f: 'nao' })} on={lf === 'nao'}>Não faturáveis</Pill>
          </div>
        </div>
        <div class="tbl"><table>
          <thead><tr><th>Data</th><th>Tipo</th><th>Contacto</th><th class="num">Duração</th><th>Resultado</th><th>Faturável</th><th>Detalhes</th></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr>
                <td>{fmtDateTime(l.occurred_at)}</td><td>{TYPE_LABEL[l.type]}</td>
                <td class="mono">{l.contact ?? '—'}{l.name ? <div class="muted" style="font-family:inherit">{l.name}</div> : null}</td>
                <td class="num">{fmtDuration(l.duration_s)}</td><td>{l.result ?? '—'}</td>
                <td>{l.billable ? 'Sim' : 'Não'}</td>
                <td class="wrap" style="max-width:360px;white-space:pre-line">{l.details ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!leads.length ? <p class="empty">Ainda não há leads.</p> : null}
      </section>

      <div class="grid2">
        <section class="card" aria-label="Acordo">
          <h2>Acordo</h2>
          {s.partner_id ? (
            <>
              <div class="kv"><span>Atual</span><strong>{ag ? (c.get('user').role === 'admin' ? `${MODEL_LABEL[ag.model]} · ${agreementText(ag, s.partner_currency)}` : MODEL_LABEL[ag.model]) : 'Sem acordo ativo'}</strong></div>
              {agHist.filter((a) => a.end_on && c.get('user').role === 'admin').map((a) => (
                <div class="kv"><span class="muted">{fmtDate(a.start_on)} – {fmtDate(a.end_on)}</span><span class="muted">{MODEL_LABEL[a.model]} · {agreementText(a, s.partner_currency)}</span></div>
              ))}
              <p class="note">O acordo é do parceiro e vale para todos os sites dele. Muda-se na ficha do parceiro.</p>
              <a class="btn" href={`/parceiros?sel=${s.partner_id}`}>Ver parceiro</a>
            </>
          ) : <p class="empty">Sem parceiro. As leads ficam só registadas aqui.</p>}
        </section>
        <section class="card" aria-label="Calculadora">
          <h2>Calculadora deste site</h2>
          {calcData ? (
            <>
              <div class="kv"><span>Valor por lead calculado</span><strong>{money(calcData.result?.perLead ?? null, s.partner_currency ?? (s.country === 'US' ? 'USD' : 'EUR'))}</strong></div>
              <div class="kv"><span>Fecho que o parceiro disse</span><span>{calcData.promisedClose ?? '—'}</span></div>
              <div class="kv"><span>Atualizado</span><span>{fmtDate(calcRow!.updated_at)}</span></div>
            </>
          ) : <p class="empty">Ainda não há cálculo gravado para este site.</p>}
          <a class="btn" href={`/calculadora?site=${id}`} style="margin-top:10px">Abrir calculadora</a>
        </section>
      </div>
      <details class="box">
        <summary>Editar dados do site</summary>
        <form method="post" action={`/sites/${id}`} class="form">
          <label class="f">Domínio<input name="domain" value={s.domain} required /></label>
          <label class="f">Nicho<input name="niche" value={s.niche ?? ''} /></label>
          <label class="f">Cidade<input name="city" value={s.city ?? ''} /></label>
          <label class="f">País<select name="country"><option value="PT" selected={s.country === 'PT'}>Portugal</option><option value="US" selected={s.country === 'US'}>EUA</option></select></label>
          <label class="f">Estado<select name="status">{Object.entries(STATUS_LABEL).map(([k, v]) => <option value={k} selected={s.status === k}>{v}</option>)}</select></label>
          <label class="f">Parceiro<select name="partner_id"><option value="">— Sem parceiro —</option>{partners.map((p) => <option value={p.id} selected={s.partner_id === p.id}>{p.name}</option>)}</select></label>
          <label class="f">Criado em<input type="date" name="created_on" value={s.created_on ?? ''} /></label>
          <label class="f">Domínio renova em<input type="date" name="domain_renews_on" value={s.domain_renews_on ?? ''} /></label>
          <label class="f">Número de tracking<input name="tracking_number" value={s.tracking_number ?? ''} /></label>
          <label class="f">Encaminha para<input name="forward_to" value={s.forward_to ?? ''} /></label>
          <label class="f">Propriedade no Search Console<input name="gsc_property" value={s.gsc_property ?? ''} placeholder="sc-domain:exemplo.pt" /></label>
          <label class="f">Pasta na Drive (link)<input name="drive_url" value={s.drive_url ?? ''} /></label>
          <label class="f full">Mensagem de whisper<input name="whisper" value={s.whisper ?? ''} /></label>
          <label class="f full">Notas<textarea name="notes">{s.notes ?? ''}</textarea></label>
          <div class="full"><button class="btn pri" type="submit">Guardar</button></div>
        </form>
      </details>

      <details class="box">
        <summary>Ligar o formulário do site à app</summary>
        <p class="note" style="margin:0 0 10px">O formulário do site envia também para este endereço (além do email). Cada pedido entra como lead deste site. Não partilhe o endereço: a chave no fim é o que o protege.</p>
        <pre>{hookUrl}</pre>
        <p class="note">Código para pôr no fim da página, a seguir ao formulário (o formulário tem de ter id="lead-form"):</p>
        <pre>{`<script>
document.getElementById('lead-form').addEventListener('submit', function () {
  fetch('${hookUrl}', { method: 'POST', body: new FormData(this), keepalive: true });
});
</script>`}</pre>
        <p class="note">Campos lidos: name, phone, email, message (e qualquer outro, que fica nos detalhes). Um campo escondido chamado _gotcha serve de armadilha para bots.</p>
      </details>
    </Layout>
  )
})

sites.post('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'))
  const f = await form(c)
  const old = await c.env.DB.prepare('SELECT partner_id, status FROM sites WHERE id = ?').bind(id).first<{ partner_id: number | null; status: string }>()
  const newPartner = toNum(f.partner_id)
  const status = autoStatus(f.status ?? old?.status ?? 'construcao', old?.partner_id ?? null, newPartner)
  await c.env.DB.prepare(
    `UPDATE sites SET domain=?, niche=?, city=?, country=?, status=?, partner_id=?, created_on=?, domain_renews_on=?, tracking_number=?,
     forward_to=?, gsc_property=?, drive_url=?, whisper=?, notes=? WHERE id = ?`
  )
    .bind(f.domain, f.niche, f.city, f.country ?? 'PT', status, newPartner, f.created_on, f.domain_renews_on,
      f.tracking_number, f.forward_to, f.gsc_property, f.drive_url, f.whisper, f.notes, id)
    .run()
  await audit(c, `Editou o site ${f.domain}`, 'site', id)
  return back(c, `/sites/${id}`, 'Alterações guardadas.')
})

export { activeAgreement, seoSummary }
