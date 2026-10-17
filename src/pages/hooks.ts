import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from '../types'
import { nowLocalISO } from '../lib'

// Recebe os formulários dos sites (por agora, os dos EUA).
// POST /hooks/form/<chave-do-site>  com campos name, phone, email, message (+ quaisquer outros)

export const hooks = new Hono<AppEnv>()

hooks.use('/form/*', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'] }))

hooks.post('/form/:key', async (c) => {
  const key = c.req.param('key')
  const site = await c.env.DB.prepare('SELECT id, partner_id FROM sites WHERE form_key = ?').bind(key).first<{ id: number; partner_id: number | null }>()
  if (!site) return c.json({ ok: false, error: 'chave inválida' }, 404)

  let data: Record<string, unknown> = {}
  const ct = c.req.header('content-type') ?? ''
  if (ct.includes('application/json')) data = await c.req.json()
  else data = (await c.req.parseBody()) as Record<string, unknown>

  // Armadilha para bots: campo escondido que um humano deixa vazio
  if (data._gotcha) return c.json({ ok: true })

  const pick = (...names: string[]) => {
    for (const n of names) {
      const v = data[n]
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 300)
    }
    return null
  }
  const name = pick('name', 'nome', 'full_name')
  const phone = pick('phone', 'telefone', 'tel', 'telemovel')
  const email = pick('email')
  const redirect = pick('_redirect')
  const details = Object.entries(data)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim())
    .map(([k, v]) => `${k}: ${String(v).trim().slice(0, 2000)}`)
    .join('\n')

  await c.env.DB.prepare(
    `INSERT INTO leads (site_id, partner_id, type, occurred_at, contact, name, result, billable, details, created_by)
     VALUES (?, ?, 'formulario', ?, ?, ?, 'Enviado', 1, ?, 'formulário')`
  )
    .bind(site.id, site.partner_id, nowLocalISO(), phone ?? email, name, details)
    .run()

  if (redirect && /^https?:\/\//.test(redirect)) return c.redirect(redirect, 303)
  return c.json({ ok: true })
})
