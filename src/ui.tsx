import type { Child, FC } from 'hono/jsx'
import { raw } from 'hono/html'
import type { User } from './types'

const CSS = `
:root{--bg:#EEF0EC;--card:#fff;--ink:#18211D;--muted:#56635C;--line:#D9DDD7;--line2:#ECEEEA;--accent:#1F5C4A;--accent-dk:#123B2F;--side:#16201C}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px}
a{color:var(--accent)}a:hover{color:var(--accent-dk)}
.app{display:flex;flex-wrap:wrap;min-height:100vh}
.side{flex:1 1 200px;background:var(--side);padding:24px 14px;display:flex;flex-direction:column;gap:2px}
.brand{font-weight:600;font-size:16px;color:#fff;padding:4px 12px 20px}
.brand small{display:block;font-weight:400;font-size:12px;color:#9AA8A0;margin-top:2px}
.nav{display:flex;align-items:center;min-height:40px;padding:0 12px;border-radius:6px;color:#C9D2CC;text-decoration:none}
.nav:hover{background:#22302A;color:#fff}
.nav.on{background:#2C4A3E;color:#fff;font-weight:600}
.who{margin-top:auto;padding:16px 12px 0;font-size:12px;color:#9AA8A0}
@media(max-width:760px){.side{flex:1 1 100%;flex-direction:row;overflow-x:auto;padding:10px;gap:4px;align-items:center}.brand{padding:0 10px 0 4px;white-space:nowrap}.brand small,.who{display:none}.nav{white-space:nowrap;flex:0 0 auto}}
.main{flex:999 1 560px;min-width:0;padding:28px 32px 48px;display:flex;flex-direction:column;gap:20px}
@media(max-width:640px){.main{padding:20px 16px 40px}}
.top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:12px}
h1{margin:0;font-size:24px;font-weight:600}
h2{margin:0 0 12px;font-size:15px;font-weight:600}
.sub{color:var(--muted);font-size:13px;margin:4px 0 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:18px}
.card.flush{padding:6px 8px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.k{font-size:12px;color:var(--muted)}
.v{font-family:'IBM Plex Mono',monospace;font-size:24px;font-weight:500;margin-top:6px}
.d{font-size:12px;margin-top:4px;color:var(--muted)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px}
@media(max-width:640px){.grid2{grid-template-columns:1fr}}
.tbl{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-weight:500;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:10px;border-bottom:1px solid var(--line2);white-space:nowrap;vertical-align:top}
td.wrap{white-space:normal}
.num{font-family:'IBM Plex Mono',monospace;text-align:right}
.mono{font-family:'IBM Plex Mono',monospace}
.muted{color:var(--muted)}
.chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap}
.c-al{background:#DCEDE3;color:#1F5C3C}.c-co{background:#E4E7F2;color:#33406B}.c-pa{background:#ECE9E4;color:#5A5248}.c-warn{background:#F8E3D6;color:#8A3410}
.btn{display:inline-flex;align-items:center;gap:6px;padding:0 14px;border-radius:6px;border:1px solid #C9CEC7;background:#fff;color:var(--ink);font:inherit;font-size:13px;text-decoration:none;cursor:pointer;min-height:40px}
.btn:hover{border-color:var(--accent);color:var(--ink)}
.btn.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.btn.pri{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn.sm{min-height:32px;padding:0 10px;font-size:12px}
.btn.danger{color:#8A3410}
.row-actions{display:flex;flex-wrap:wrap;gap:8px}
.pills{display:flex;flex-wrap:wrap;gap:6px}
.filters{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between}
label.f{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:500;color:var(--muted)}
input,select,textarea{font:inherit;font-size:14px;padding:9px 10px;border:1px solid #C9CEC7;border-radius:6px;background:#fff;color:var(--ink);width:100%}
textarea{min-height:80px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.form .full{grid-column:1/-1}
details.box{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px 18px}
details.box summary{cursor:pointer;font-weight:600;min-height:24px}
details.box[open] summary{margin-bottom:12px}
.info{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px 20px}
.info div span{display:block;font-size:12px;color:var(--muted);margin-bottom:2px}
.alert{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line2);font-size:13px}
.alert:last-child{border:0}
.dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:0 0 8px}
.bar{height:8px;border-radius:4px;background:var(--line2);overflow:hidden;min-width:40px}
.bar span{display:block;height:100%;background:var(--accent)}
.flash{background:#E6F2EA;border:1px solid #B9D9C5;color:#1F5C3C;padding:10px 14px;border-radius:6px;font-size:13px}
.flash.err{background:#F8E3D6;border-color:#E9C2AB;color:#8A3410}
.empty{color:var(--muted);font-size:13px;padding:16px 4px}
.ext{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:6px;color:var(--accent)}
.ext:hover{background:var(--bg)}
.split{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.plist{flex:1 1 300px;min-width:0;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.pr{display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid var(--line2);padding:12px 14px;color:var(--ink);text-decoration:none;min-height:56px}
.pr:hover{background:#F5F6F3;color:var(--ink)}
.pr.sel{background:#E6F2EA;box-shadow:inset 3px 0 0 var(--accent)}
.pr strong{display:block;font-size:14px}
.pdetail{flex:999 1 560px;min-width:0}
.sec{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:18px 0 4px}
.kv{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line2);font-size:13px;flex-wrap:wrap}
.board{display:grid;grid-template-columns:repeat(6,minmax(210px,1fr));gap:12px;overflow-x:auto;padding-bottom:6px}
.col{background:#E3E7E1;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:200px}
.col h2{margin:2px 4px 4px;font-size:13px;display:flex;justify-content:space-between}
.pc{display:block;background:#fff;border:1px solid var(--line);border-radius:6px;padding:10px 12px;font-size:13px;color:var(--ink);text-decoration:none}
.pc:hover{border-color:var(--accent);color:var(--ink)}
.pc.sel{border:2px solid var(--accent);padding:9px 11px}
.pc strong{display:block;font-size:14px;margin-bottom:2px}
.pc .nx{display:block;margin-top:6px;font-size:12px;color:#8A3410}
.log{border-left:2px solid var(--line);padding:0 0 12px 14px;font-size:13px}
.log b{display:block;font-size:12px;color:var(--muted);font-weight:500}
.tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--line)}
.tab{font-size:14px;border-bottom:2px solid transparent;padding:12px 14px;color:var(--muted);text-decoration:none}
.tab.on{color:var(--ink);font-weight:600;border-bottom-color:var(--accent)}
.note{font-size:12px;color:var(--muted);margin:10px 4px 0;line-height:1.5}
code{font-family:'IBM Plex Mono',monospace;font-size:12px;background:#F5F6F3;padding:2px 5px;border-radius:4px;word-break:break-all}
pre{font-family:'IBM Plex Mono',monospace;font-size:12px;background:#F5F6F3;padding:12px;border-radius:6px;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
.inline{display:inline}
`

const NAV: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/sites', label: 'Sites' },
  { href: '/leads', label: 'Leads' },
  { href: '/prospecao', label: 'Prospeção' },
  { href: '/parceiros', label: 'Parceiros' },
  { href: '/financeiro', label: 'Financeiro', adminOnly: true },
  { href: '/calculadora', label: 'Calculadora de leads' },
  { href: '/definicoes', label: 'Definições', adminOnly: true }
]

export const Layout: FC<{ title: string; active: string; user: User; flash?: string | null; error?: string | null; children?: Child }> = (p) => (
  <html lang="pt-PT">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{p.title} · Rank &amp; Rent</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      <style>{raw(CSS)}</style>
    </head>
    <body>
      <div class="app">
        <nav class="side" aria-label="Menu">
          <div class="brand">Rank &amp; Rent<small>Gestão de sites e parceiros</small></div>
          {NAV.filter((n) => !n.adminOnly || p.user.role === 'admin').map((n) => (
            <a class={`nav${p.active === n.href ? ' on' : ''}`} href={n.href}>{n.label}</a>
          ))}
          <div class="who">{p.user.name || p.user.email}<br />{p.user.role === 'admin' ? 'Administrador' : 'VA'}</div>
        </nav>
        <main class="main">
          {p.flash ? <div class="flash" role="status">{p.flash}</div> : null}
          {p.error ? <div class="flash err" role="alert">{p.error}</div> : null}
          {p.children}
        </main>
      </div>
    </body>
  </html>
)

export const Chip: FC<{ cls: string; children?: Child }> = (p) => <span class={`chip ${p.cls}`}>{p.children}</span>

export const statusChip = (s: string) => (s === 'alugado' ? 'c-al' : s === 'construcao' ? 'c-co' : 'c-pa')

export const ExtIcon: FC<{ href: string; label: string }> = (p) => (
  <a class="ext" href={p.href} target="_blank" rel="noopener" aria-label={p.label}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>
    </svg>
  </a>
)

export const Pill: FC<{ href: string; on: boolean; children?: Child }> = (p) => (
  <a class={`btn${p.on ? ' on' : ''}`} href={p.href} aria-current={p.on ? 'true' : undefined}>{p.children}</a>
)

/** Gráfico de barras simples (SVG) */
export const Bars: FC<{ data: { label: string; value: number }[]; label: string; fmt?: (v: number) => string; height?: number }> = (p) => {
  const h = p.height ?? 180
  const W = 520, base = h - 30
  const max = Math.max(1, ...p.data.map((d) => d.value))
  const slot = 500 / Math.max(1, p.data.length)
  const bw = Math.min(46, slot * 0.6)
  const f = p.fmt ?? ((v: number) => String(v))
  return (
    <svg viewBox={`0 0 ${W} ${h}`} width="100%" height={h} role="img" aria-label={p.label}>
      <line x1="10" y1={base} x2="510" y2={base} stroke="#D9DDD7"></line>
      {p.data.map((d, i) => {
        const bh = Math.round((d.value / max) * (base - 30))
        const x = 10 + i * slot + (slot - bw) / 2
        return (
          <g>
            <rect x={x} y={base - bh} width={bw} height={bh} rx="3" fill="#1F5C4A"></rect>
            <text x={x + bw / 2} y={base - bh - 6} text-anchor="middle" font-size="12" fill="#18211D" font-family="IBM Plex Mono">{f(d.value)}</text>
            <text x={x + bw / 2} y={h - 10} text-anchor="middle" font-size="11" fill="#56635C">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Linha simples (SVG). invert = valores mais baixos em cima (posição no Google). */
export const Line: FC<{ data: { label: string; value: number | null }[]; label: string; invert?: boolean; color?: string }> = (p) => {
  const pts = p.data.filter((d) => d.value !== null) as { label: string; value: number }[]
  if (pts.length < 2) return <p class="empty">Ainda não há dados suficientes para o gráfico.</p>
  const W = 520, H = 200, top = 20, bottom = 170
  const vals = pts.map((d) => d.value)
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (lo === hi) { lo -= 1; hi += 1 }
  const y = (v: number) => {
    const t = (v - lo) / (hi - lo)
    return p.invert ? top + t * (bottom - top) : bottom - t * (bottom - top)
  }
  const step = 480 / (pts.length - 1)
  const poly = pts.map((d, i) => `${(30 + i * step).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ')
  const every = Math.ceil(pts.length / 6)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={p.label}>
      <line x1="30" y1={bottom} x2="510" y2={bottom} stroke="#D9DDD7"></line>
      <text x="26" y={(p.invert ? top : bottom) + 4} text-anchor="end" font-size="11" fill="#56635C">{fmtShort(p.invert ? lo : lo)}</text>
      <text x="26" y={(p.invert ? bottom : top) + 4} text-anchor="end" font-size="11" fill="#56635C">{fmtShort(hi)}</text>
      <polyline fill="none" stroke={p.color ?? '#3B3F8F'} stroke-width="2.5" stroke-linejoin="round" points={poly}></polyline>
      {pts.map((d, i) =>
        i % every === 0 || i === pts.length - 1 ? (
          <text x={30 + i * step} y={H - 10} text-anchor={i === pts.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'} font-size="11" fill="#56635C">{d.label}</text>
        ) : null
      )}
    </svg>
  )
}
function fmtShort(v: number) {
  return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 }).format(v)
}
