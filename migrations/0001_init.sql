-- Esquema inicial do CRM Rank & Rent

CREATE TABLE users (
  email TEXT PRIMARY KEY,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','va')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  country TEXT NOT NULL DEFAULT 'PT',
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR','USD')),
  payment_method TEXT,
  hours TEXT,
  whatsapp_optin_on TEXT,
  promised_close TEXT,           -- resposta a "se lhe mandar 10 leads, quantas fecha?"
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Um acordo ativo por parceiro (end_on NULL). Mudar de fase fecha o anterior.
CREATE TABLE agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  phase INTEGER NOT NULL DEFAULT 1,
  model TEXT NOT NULL CHECK (model IN ('per_lead','monthly','per_job')),
  amount REAL,                   -- preço por lead ou mensalidade
  commission_pct REAL,           -- só per_job
  start_on TEXT NOT NULL,
  end_on TEXT,
  notes TEXT
);

CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  niche TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'PT',
  status TEXT NOT NULL DEFAULT 'construcao' CHECK (status IN ('construcao','alugado','pausado')),
  partner_id INTEGER REFERENCES partners(id),
  created_on TEXT,
  domain_renews_on TEXT,
  tracking_number TEXT,
  forward_to TEXT,
  whisper TEXT,
  drive_url TEXT,
  gsc_property TEXT,             -- ex: sc-domain:detalheautomovelseixal.pt
  form_key TEXT NOT NULL,        -- chave secreta do webhook do formulário
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  partner_id INTEGER REFERENCES partners(id),   -- parceiro do site no momento da lead
  type TEXT NOT NULL CHECK (type IN ('chamada','formulario','whatsapp')),
  occurred_at TEXT NOT NULL,     -- ISO, hora de Lisboa
  contact TEXT,
  name TEXT,
  duration_s INTEGER,
  result TEXT,
  billable INTEGER NOT NULL DEFAULT 1,
  details TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX leads_site_time ON leads(site_id, occurred_at);
CREATE INDEX leads_partner_time ON leads(partner_id, occurred_at);

-- Números do Search Console (diários, source='gsc') e registos manuais antigos (source='manual')
CREATE TABLE seo_daily (
  site_id INTEGER NOT NULL REFERENCES sites(id),
  date TEXT NOT NULL,
  clicks INTEGER,
  impressions INTEGER,
  position REAL,
  source TEXT NOT NULL DEFAULT 'gsc',
  PRIMARY KEY (site_id, date, source)
);

CREATE TABLE prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  niche TEXT,
  site_id INTEGER REFERENCES sites(id),
  source TEXT,
  stage INTEGER NOT NULL DEFAULT 0,   -- 0 por contactar, 1 contactado, 2 leads grátis, 3 negociação, 4 fechado, 5 recusou
  promised_close TEXT,
  proposed_model TEXT,
  free_leads_sent INTEGER NOT NULL DEFAULT 0,
  next_step TEXT,
  next_step_on TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE prospect_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id),
  on_date TEXT NOT NULL,
  kind TEXT,
  text TEXT,
  created_by TEXT
);

-- Trabalhos fechados (acordos per_job)
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  site_id INTEGER REFERENCES sites(id),
  lead_id INTEGER REFERENCES leads(id),
  done_on TEXT NOT NULL,
  client TEXT,
  description TEXT,
  value REAL NOT NULL,
  pct REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pagamentos recebidos, por parceiro e mês faturado (YYYY-MM)
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  month TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_on TEXT NOT NULL,
  method TEXT,
  notes TEXT,
  created_by TEXT
);

CREATE TABLE costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES sites(id),  -- NULL = custo geral
  item TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  period TEXT NOT NULL DEFAULT 'ano' CHECK (period IN ('ano','mes')),
  renews_on TEXT,
  provider TEXT
);

-- Calculadora de valor da lead, gravada por site
CREATE TABLE calculations (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER
);
