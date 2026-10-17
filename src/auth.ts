import type { Env, User } from './types'

// Verifica o token que o Cloudflare Access põe em cada pedido.
// Sem isto, quem chegasse ao endereço da app por outro caminho podia fingir ser outra pessoa.

type Jwk = JsonWebKey & { kid: string }
let certCache: { at: number; keys: Jwk[] } | null = null

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function getKeys(team: string): Promise<Jwk[]> {
  if (certCache && Date.now() - certCache.at < 3600_000) return certCache.keys
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`)
  if (!r.ok) throw new Error('Não foi possível obter as chaves do Cloudflare Access')
  const j = (await r.json()) as { keys: Jwk[] }
  certCache = { at: Date.now(), keys: j.keys }
  return j.keys
}

export async function verifyAccessJwt(token: string, env: Env): Promise<string | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])))
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])))
  const keys = await getKeys(env.ACCESS_TEAM_DOMAIN)
  const jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) return null
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  )
  if (!ok) return null
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < now) return null
  // O AUD é opcional: sem ele, aceita tokens de qualquer aplicação da tua própria equipa do Access
  if (env.ACCESS_AUD) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!aud.includes(env.ACCESS_AUD)) return null
  }
  if (payload.iss && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null
  return typeof payload.email === 'string' ? payload.email.toLowerCase() : null
}

export async function resolveUser(req: Request, env: Env): Promise<User | null> {
  let email: string | null = null
  if (env.DEV_USER) {
    email = env.DEV_USER.toLowerCase()
  } else {
    if (!env.ACCESS_TEAM_DOMAIN) return null
    const token = req.headers.get('cf-access-jwt-assertion')
    if (!token) return null
    try {
      email = await verifyAccessJwt(token, env)
    } catch {
      return null
    }
  }
  if (!email) return null
  const row = await env.DB.prepare('SELECT email, name, role FROM users WHERE lower(email) = ?').bind(email).first<User>()
  if (row) return row
  if (email === env.ADMIN_EMAIL.toLowerCase()) return { email, name: null, role: 'admin' }
  return null
}
