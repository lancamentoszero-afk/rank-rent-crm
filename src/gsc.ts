import type { Env } from './types'
import { addDays, todayISO } from './lib'

// Lê a API do Search Console com uma conta de serviço da Google (só leitura).
// Corre todos os dias pelo cron e também pelo botão "Atualizar agora" em Definições.

type ServiceAccount = { client_email: string; private_key: string }

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  )
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`))
  const jwt = `${header}.${claim}.${b64url(sig)}`
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  })
  if (!r.ok) throw new Error(`Google recusou a conta de serviço (${r.status}): ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

export type SyncResult = { domain: string; ok: boolean; rows?: number; error?: string }

export async function syncSearchConsole(env: Env, days = 30): Promise<SyncResult[]> {
  if (!env.GSC_SERVICE_ACCOUNT) return [{ domain: '—', ok: false, error: 'Falta o segredo GSC_SERVICE_ACCOUNT' }]
  const sa = JSON.parse(env.GSC_SERVICE_ACCOUNT) as ServiceAccount
  const token = await accessToken(sa)
  const { results: sites } = await env.DB.prepare('SELECT id, domain, gsc_property FROM sites WHERE gsc_property IS NOT NULL').all<{
    id: number; domain: string; gsc_property: string
  }>()
  const end = todayISO()
  const start = addDays(end, -days)
  const out: SyncResult[] = []
  for (const s of sites) {
    try {
      const r = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(s.gsc_property)}/searchAnalytics/query`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['date'], rowLimit: 1000, dataState: 'all' })
        }
      )
      if (!r.ok) {
        out.push({ domain: s.domain, ok: false, error: r.status === 403 ? 'Sem acesso (dar permissão à conta de serviço)' : `Erro ${r.status}` })
        continue
      }
      const j = (await r.json()) as { rows?: { keys: string[]; clicks: number; impressions: number; position: number }[] }
      const rows = j.rows ?? []
      if (rows.length) {
        await env.DB.batch(
          rows.map((x) =>
            env.DB.prepare(
              `INSERT INTO seo_daily (site_id, date, clicks, impressions, position, source) VALUES (?, ?, ?, ?, ?, 'gsc')
               ON CONFLICT(site_id, date, source) DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions, position = excluded.position`
            ).bind(s.id, x.keys[0], x.clicks, x.impressions, x.position)
          )
        )
      }
      out.push({ domain: s.domain, ok: true, rows: rows.length })
    } catch (e) {
      out.push({ domain: s.domain, ok: false, error: (e as Error).message })
    }
  }
  await env.DB.prepare("INSERT INTO audit_log (user_email, action, entity) VALUES ('sistema', ?, 'gsc')")
    .bind(`Search Console: ${out.filter((o) => o.ok).length}/${out.length} sites atualizados`)
    .run()
  return out
}
