import { Hono } from 'hono'
import { raw } from 'hono/html'
import type { AppEnv } from '../types'
import { Layout } from '../ui'
import { audit, back, flash, form, toNum } from '../db'
import { fmtDate, money } from '../lib'

export const calc = new Hono<AppEnv>()

type Svc = { name: string; value: number | null; share: number | null; margin: number | null; close: number | null }
type CalcData = { leads: number | null; comm: number | null; services: Svc[]; promisedClose: string | null; notes: string | null; result?: Result }
type Result = { revenue: number; profit: number; charge: number; perLead: number; profitPerLead: number }

function compute(d: CalcData): Result {
  const leads = d.leads ?? 0
  let revenue = 0, profit = 0
  for (const s of d.services) {
    if (!s.value || !s.share) continue
    const jobs = leads * (s.share / 100) * ((s.close ?? 0) / 100)
    const r = jobs * s.value
    revenue += r
    profit += r * ((s.margin ?? 0) / 100)
  }
  const charge = revenue * ((d.comm ?? 0) / 100)
  return { revenue, profit, charge, perLead: leads ? charge / leads : 0, profitPerLead: leads ? profit / leads : 0 }
}

const EMPTY: CalcData = { leads: 30, comm: 20, services: [0, 1, 2, 3].map(() => ({ name: '', value: null, share: null, margin: null, close: null })), promisedClose: null, notes: null }

const SCRIPT = `
(function(){
  var f = document.getElementById('calc'); if(!f) return;
  var cur = f.dataset.cur || 'EUR';
  var nf = new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2});
  var nf1 = new Intl.NumberFormat('pt-PT',{maximumFractionDigits:1});
  function m(v){ return nf.format(v) + (cur==='USD'?' $':' €'); }
  function n(name){ var e=f.elements[name]; var v=parseFloat(String(e&&e.value||'').replace(',','.')); return isNaN(v)?0:v; }
  function run(){
    var leads=n('leads'), comm=n('comm'), rev=0, prof=0, share=0, rows=[];
    for(var i=0;i<4;i++){
      var val=n('value'+i), sh=n('share'+i), mg=n('margin'+i), cl=n('close'+i);
      share+=sh;
      if(val>0&&sh>0){
        var sl=leads*sh/100, jobs=sl*cl/100, r=jobs*val, p=r*mg/100; rev+=r; prof+=p;
        rows.push('<tr><td>'+(f.elements['name'+i].value||('Serviço '+(i+1))).replace(/</g,'&lt;')+'</td><td class="num">'+nf1.format(sl)+'</td><td class="num">'+nf1.format(jobs)+'</td><td class="num">'+m(r)+'</td><td class="num">'+m(p)+'</td></tr>');
      }
    }
    var charge=rev*comm/100;
    document.getElementById('r-rev').textContent=m(rev);
    document.getElementById('r-prof').textContent=m(prof);
    document.getElementById('r-charge').textContent=m(charge);
    document.getElementById('r-per').textContent=m(leads?charge/leads:0);
    document.getElementById('r-ppl').textContent=m(leads?prof/leads:0);
    document.getElementById('r-rows').innerHTML=rows.join('');
    var w=document.getElementById('r-warn');
    w.style.display=(share>0&&Math.abs(share-100)>0.01)?'block':'none';
    w.textContent='As percentagens das leads somam '+nf1.format(share)+'%. Deviam somar 100%.';
  }
  f.addEventListener('input',run); run();
})();
`

calc.get('/', async (c) => {
  const db = c.env.DB
  const siteId = Number(c.req.query('site') ?? 0) || null
  const { results: siteList } = await db.prepare('SELECT s.id, s.domain, s.country, p.currency FROM sites s LEFT JOIN partners p ON p.id = s.partner_id ORDER BY s.domain').all<{ id: number; domain: string; country: string; currency: string | null }>()
  const site = siteList.find((s) => s.id === siteId) ?? null
  const row = siteId ? await db.prepare('SELECT data, updated_at, updated_by FROM calculations WHERE site_id = ?').bind(siteId).first<{ data: string; updated_at: string; updated_by: string | null }>() : null
  const d: CalcData = row ? JSON.parse(row.data) : EMPTY
  while (d.services.length < 4) d.services.push({ name: '', value: null, share: null, margin: null, close: null })
  const cur = site ? site.currency ?? (site.country === 'US' ? 'USD' : 'EUR') : 'EUR'
  const v = (x: number | null | undefined) => (x === null || x === undefined ? '' : String(x))

  return c.html(
    <Layout title="Calculadora" active="/calculadora" user={c.get('user')} flash={flash(c)}>
      <div class="top">
        <div><h1>Calculadora de valor da lead</h1><p class="sub">Quanto vale cada lead para o dono do negócio, e quanto podes cobrar por ela</p></div>
        <form method="get" action="/calculadora">
          <label class="f">Site
            <select name="site" onchange="this.form.submit()">
              <option value="">— Sem site (não grava) —</option>
              {siteList.map((s) => <option value={s.id} selected={s.id === siteId}>{s.domain}</option>)}
            </select>
          </label>
        </form>
      </div>
      {row ? <p class="sub" style="margin:0">Gravado a {fmtDate(row.updated_at)}{row.updated_by ? ` por ${row.updated_by}` : ''}. <a href={`/sites/${siteId}`}>Ver site</a></p> : null}

      <form method="post" action="/calculadora" id="calc" data-cur={cur}>
        <input type="hidden" name="site_id" value={siteId ? String(siteId) : ''} />
        <section class="card" aria-label="Dados">
          <div class="form" style="margin-bottom:12px">
            <label class="f">Número de leads / mês<input name="leads" inputmode="decimal" value={v(d.leads)} /></label>
            <label class="f">Comissão que cobras (%)<input name="comm" inputmode="decimal" value={v(d.comm)} /></label>
            <label class="f">Fecho que o parceiro disse<input name="promisedClose" value={d.promisedClose ?? ''} placeholder="ex: 3 em 10" /></label>
          </div>
          <div class="tbl"><table>
            <thead><tr><th>Serviço</th><th>Valor médio do cliente</th><th>% das leads</th><th>Margem de lucro (%)</th><th>Taxa de fecho (%)</th></tr></thead>
            <tbody>
              {d.services.slice(0, 4).map((s, i) => (
                <tr>
                  <td><input name={`name${i}`} value={s.name} placeholder={`Serviço ${i + 1}`} aria-label={`Nome do serviço ${i + 1}`} style="min-width:160px" /></td>
                  <td><input name={`value${i}`} value={v(s.value)} inputmode="decimal" aria-label="Valor médio" style="width:120px" /></td>
                  <td><input name={`share${i}`} value={v(s.share)} inputmode="decimal" aria-label="Percentagem das leads" style="width:100px" /></td>
                  <td><input name={`margin${i}`} value={v(s.margin)} inputmode="decimal" aria-label="Margem" style="width:100px" /></td>
                  <td><input name={`close${i}`} value={v(s.close)} inputmode="decimal" aria-label="Taxa de fecho" style="width:100px" /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div class="flash err" id="r-warn" style="display:none;margin-top:12px"></div>
          <label class="f" style="margin-top:12px">Notas<textarea name="notes">{d.notes ?? ''}</textarea></label>
          <div style="margin-top:12px">
            {siteId ? <button class="btn pri" type="submit">Guardar no site</button> : <p class="note">Escolha um site em cima para poder gravar os valores.</p>}
          </div>
        </section>
      </form>

      <section class="card" aria-label="Resultado">
        <h2>Resultado</h2>
        <div class="kpis" style="margin-bottom:16px">
          <div class="card"><div class="k">Faturação do parceiro</div><div class="v" id="r-rev">—</div></div>
          <div class="card"><div class="k">Lucro total do parceiro</div><div class="v" id="r-prof">—</div></div>
          <div class="card"><div class="k">Valor da comissão</div><div class="v" id="r-charge">—</div></div>
          <div class="card" style="background:#E6F2EA;border-color:#B9D9C5"><div class="k">Valor por lead</div><div class="v" id="r-per" style="color:#1F5C3C">—</div></div>
        </div>
        <div class="tbl"><table>
          <thead><tr><th>Serviço</th><th class="num">Leads</th><th class="num">Trabalhos fechados</th><th class="num">Faturação</th><th class="num">Lucro</th></tr></thead>
          <tbody id="r-rows"></tbody>
        </table></div>
        <p class="note">Por serviço: leads × % das leads × taxa de fecho = trabalhos fechados; × valor médio = faturação; × margem = lucro. A comissão é uma percentagem da faturação, e o valor por lead é essa comissão a dividir pelo número de leads. Compara sempre o valor por lead com o lucro por lead do dono do negócio (<span id="r-ppl">—</span>). Se estiverem muito perto, estás a cobrar de mais.</p>
      </section>
      <script>{raw(SCRIPT)}</script>
    </Layout>
  )
})

calc.post('/', async (c) => {
  const f = await form(c)
  const siteId = toNum(f.site_id)
  if (!siteId) return back(c, '/calculadora')
  const d: CalcData = {
    leads: toNum(f.leads),
    comm: toNum(f.comm),
    promisedClose: f.promisedClose ?? null,
    notes: f.notes ?? null,
    services: [0, 1, 2, 3].map((i) => ({
      name: f[`name${i}`] ?? '', value: toNum(f[`value${i}`]), share: toNum(f[`share${i}`]), margin: toNum(f[`margin${i}`]), close: toNum(f[`close${i}`])
    }))
  }
  d.result = compute(d)
  await c.env.DB.prepare(
    `INSERT INTO calculations (site_id, data, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(site_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  )
    .bind(siteId, JSON.stringify(d), c.get('user').email)
    .run()
  await audit(c, `Gravou a calculadora (${money(d.result.perLead)} por lead)`, 'site', siteId)
  return back(c, `/calculadora?site=${siteId}`, 'Valores gravados no site.')
})
