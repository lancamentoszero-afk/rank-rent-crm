import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { Layout } from '../ui'
import { audit, back, flash, form } from '../db'
import { syncSearchConsole } from '../gsc'
import { fmtDateTime } from '../lib'

export const settings = new Hono<AppEnv>()

settings.get('/', async (c) => {
  const db = c.env.DB
  const { results: users } = await db.prepare('SELECT * FROM users ORDER BY role, email').all<{ email: string; name: string | null; role: string }>()
  const { results: log } = await db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 60').all<{ at: string; user_email: string | null; action: string }>()
  const lastGsc = await db.prepare("SELECT at, action FROM audit_log WHERE entity = 'gsc' ORDER BY id DESC LIMIT 1").first<{ at: string; action: string }>()
  const gscResult = c.req.query('gsc')
  let sa: string | null = null
  try { sa = c.env.GSC_SERVICE_ACCOUNT ? (JSON.parse(c.env.GSC_SERVICE_ACCOUNT).client_email as string) : null } catch { sa = 'segredo inválido' }
  const me = c.get('user').email

  return c.html(
    <Layout title="Definições" active="/definicoes" user={c.get('user')} flash={flash(c)}>
      <div><h1>Definições</h1></div>

      <section class="card" aria-label="Utilizadores">
        <h2>Quem entra na app</h2>
        <div class="tbl"><table>
          <thead><tr><th>Email</th><th>Nome</th><th>Papel</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr><td>{u.email}</td><td>{u.name ?? '—'}</td><td>{u.role === 'admin' ? 'Administrador' : 'VA'}</td>
                <td>{u.email !== me ? <form method="post" action="/definicoes/utilizadores/remover" class="inline"><input type="hidden" name="email" value={u.email} /><button class="btn sm danger" type="submit">Remover</button></form> : null}</td></tr>
            ))}
          </tbody>
        </table></div>
        <form method="post" action="/definicoes/utilizadores" class="form" style="margin-top:12px">
          <label class="f">Email<input type="email" name="email" required /></label>
          <label class="f">Nome<input name="name" /></label>
          <label class="f">Papel<select name="role"><option value="va">VA</option><option value="admin">Administrador</option></select></label>
          <div class="full"><button class="btn" type="submit">+ Acrescentar</button></div>
        </form>
        <p class="note">A VA vê e trabalha sites, leads, prospeção e parceiros, mas não vê o Financeiro nem valores, e não muda acordos. Além de a acrescentar aqui, o email dela tem de ser autorizado no Cloudflare Access.</p>
      </section>

      <section class="card" aria-label="Search Console">
        <h2>Search Console</h2>
        <div class="kv"><span>Conta de serviço</span><span class="mono">{sa ?? 'Não configurada'}</span></div>
        <div class="kv"><span>Última atualização</span><span>{lastGsc ? `${fmtDateTime(lastGsc.at.replace(' ', 'T'))} (UTC) · ${lastGsc.action}` : 'Nunca'}</span></div>
        {gscResult ? <pre>{gscResult}</pre> : null}
        <form method="post" action="/definicoes/gsc" style="margin-top:12px"><button class="btn pri" type="submit">Atualizar agora (últimos 90 dias)</button></form>
        <p class="note">Atualiza sozinho todos os dias. Em cada site do Search Console, a conta de serviço tem de estar como utilizador com permissão "Restrita".</p>
      </section>

      <section class="card" aria-label="Registo de alterações">
        <h2>Registo de alterações</h2>
        <div class="tbl"><table>
          <thead><tr><th>Quando (UTC)</th><th>Quem</th><th>O quê</th></tr></thead>
          <tbody>{log.map((l) => <tr><td>{fmtDateTime(l.at.replace(' ', 'T'))}</td><td>{l.user_email ?? '—'}</td><td class="wrap">{l.action}</td></tr>)}</tbody>
        </table></div>
      </section>
    </Layout>
  )
})

settings.post('/utilizadores', async (c) => {
  const f = await form(c)
  if (!f.email) return back(c, '/definicoes')
  await c.env.DB.prepare('INSERT INTO users (email, name, role) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role')
    .bind(f.email.toLowerCase(), f.name, f.role === 'admin' ? 'admin' : 'va')
    .run()
  await audit(c, `Acrescentou o utilizador ${f.email}`, 'user')
  return back(c, '/definicoes', 'Utilizador guardado. Não esquecer de o autorizar no Cloudflare Access.')
})

settings.post('/utilizadores/remover', async (c) => {
  const f = await form(c)
  if (!f.email || f.email === c.get('user').email) return back(c, '/definicoes')
  await c.env.DB.prepare('DELETE FROM users WHERE email = ?').bind(f.email).run()
  await audit(c, `Removeu o utilizador ${f.email}`, 'user')
  return back(c, '/definicoes', 'Utilizador removido.')
})

settings.post('/gsc', async (c) => {
  let txt: string
  try {
    const r = await syncSearchConsole(c.env, 90)
    txt = r.map((x) => `${x.domain}: ${x.ok ? `${x.rows} dias` : x.error}`).join('\n')
  } catch (e) {
    txt = `Erro: ${(e as Error).message}`
  }
  return c.redirect(`/definicoes?gsc=${encodeURIComponent(txt)}`, 303)
})
