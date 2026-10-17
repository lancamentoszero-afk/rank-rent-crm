import { Hono } from 'hono'
import type { AppEnv, Env } from './types'
import { resolveUser } from './auth'
import { syncSearchConsole } from './gsc'
import { hooks } from './pages/hooks'
import { dashboard } from './pages/dashboard'
import { sites } from './pages/sites'
import { leads } from './pages/leads'
import { prospects } from './pages/prospects'
import { partners } from './pages/partners'
import { finance } from './pages/finance'
import { calc } from './pages/calc'
import { settings } from './pages/settings'

const app = new Hono<AppEnv>()

// Webhooks públicos (formulários dos sites). Não passam pelo login: são protegidos pela chave de cada site.
// No Cloudflare Access, o caminho /hooks/* tem de ficar com a política "Bypass".
app.route('/hooks', hooks)

// Tudo o resto exige utilizador autenticado
app.use('*', async (c, next) => {
  const user = await resolveUser(c.req.raw, c.env)
  if (!user) return c.text('Sem acesso. Entre com o email autorizado.', 403)
  c.set('user', user)
  await next()
})

// Áreas só para o administrador
app.use('/financeiro/*', async (c, next) => (c.get('user').role === 'admin' ? next() : c.text('Só o administrador tem acesso.', 403)))
app.use('/definicoes/*', async (c, next) => (c.get('user').role === 'admin' ? next() : c.text('Só o administrador tem acesso.', 403)))

app.route('/', dashboard)
app.route('/sites', sites)
app.route('/leads', leads)
app.route('/prospecao', prospects)
app.route('/parceiros', partners)
app.route('/financeiro', finance)
app.route('/calculadora', calc)
app.route('/definicoes', settings)

app.onError((err, c) => {
  console.error(err)
  return c.text(`Ocorreu um erro: ${err.message}`, 500)
})

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncSearchConsole(env, 10).then(() => undefined))
  }
}
