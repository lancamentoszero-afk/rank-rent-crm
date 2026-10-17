export type Env = {
  DB: D1Database
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  ADMIN_EMAIL: string
  GSC_SERVICE_ACCOUNT?: string
  DEV_USER?: string // só em desenvolvimento local (.dev.vars)
}

export type User = { email: string; name: string | null; role: 'admin' | 'va' }

export type AppEnv = { Bindings: Env; Variables: { user: User } }
