-- CLOUDSUFI chatbot schema
-- Apply with: npm run db:migrate   (or: psql "$DATABASE_URL" -f db/schema.sql)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per visitor conversation.
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id    TEXT,                      -- opaque browser-side id, not PII
  referrer      TEXT,
  user_agent    TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS chat_sessions_started_at_idx ON chat_sessions (started_at DESC);

-- Full transcript. Assistant rows carry token usage for cost reporting.
CREATE TABLE IF NOT EXISTS messages (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content       TEXT NOT NULL,
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_session_id_idx ON messages (session_id, created_at);

-- At most one lead per session; refreshed as the conversation reveals more.
CREATE TABLE IF NOT EXISTS leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL UNIQUE REFERENCES chat_sessions (id) ON DELETE CASCADE,
  name            TEXT,
  email           TEXT,
  company         TEXT,
  industry        TEXT,
  interest        TEXT,          -- which CLOUDSUFI solution they asked about
  intent          TEXT NOT NULL DEFAULT 'browsing'
                    CHECK (intent IN ('browsing', 'researching', 'evaluating', 'ready_to_buy')),
  opportunity     TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (opportunity IN ('unknown', 'small', 'medium', 'enterprise')),
  status          TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'contacted', 'qualified', 'demo_booked', 'won', 'lost')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (email);

-- Lightweight product analytics.
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID REFERENCES chat_sessions (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,   -- widget_opened, message_sent, demo_cta_clicked, ...
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_name_created_at_idx ON events (name, created_at DESC);

-- Admin dashboard logins. Seed with: npm run db:seed-admin
CREATE TABLE IF NOT EXISTS admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Knowledge base. Article bodies are appended to the system prompt (cached),
-- so keep them short and factual.
CREATE TABLE IF NOT EXISTS kb_articles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  category    TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  published   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_articles_published_idx ON kb_articles (published, category);

-- Every admin mutation is recorded here.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    UUID REFERENCES admin_users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  changes     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);

-- ---------------------------------------------------------------------------
-- Agentic lead-magnet additions
-- ---------------------------------------------------------------------------

-- Structured discovery, written by the agent's record_discovery tool. Separate
-- from `leads` because it changes shape as the conversation progresses and we
-- want the sales rep to see the reasoning, not just the verdict.
CREATE TABLE IF NOT EXISTS discovery (
  session_id    UUID PRIMARY KEY REFERENCES chat_sessions (id) ON DELETE CASCADE,
  pain          TEXT,
  context       TEXT,
  stack         TEXT,
  urgency       TEXT,
  role          TEXT,
  recommended   TEXT[] NOT NULL DEFAULT '{}',  -- offering ids from lib/catalog.ts
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cached company research so we pay for the web search once per domain.
CREATE TABLE IF NOT EXISTS company_research (
  domain      TEXT PRIMARY KEY,
  summary     TEXT NOT NULL,
  raw         JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generated one-pagers. `token` is the unguessable public handle used in the
-- download URL; the row is what the PDF is rendered from on demand.
CREATE TABLE IF NOT EXISTS offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  company     TEXT,
  headline    TEXT NOT NULL,
  situation   TEXT NOT NULL,
  recommended TEXT[] NOT NULL DEFAULT '{}',
  outcomes    TEXT[] NOT NULL DEFAULT '{}',
  proof       TEXT[] NOT NULL DEFAULT '{}',
  next_step   TEXT,
  view_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offers_session_idx ON offers (session_id);

-- Admin-editable runtime config: calendar link, company name on the PDF, etc.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seeded once; edit in the admin Settings tab rather than here.
INSERT INTO settings (key, value) VALUES
  ('calendar_url', 'https://www.cloudsufi.com/request-demo/'),
  ('meeting_length', '15 minutes'),
  ('company_name', 'CLOUDSUFI')
ON CONFLICT (key) DO NOTHING;

-- Research + engagement columns on the lead itself.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS domain           TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS research_summary TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS offer_token      TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_offered  BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Admin-managed catalog (services) and proof (case studies)
-- ---------------------------------------------------------------------------

-- Services shown as the chat's service picker and injected into the agent's
-- catalog. Populated by hand OR by the website ingester (see lib/ingest.ts),
-- which fetches a URL, extracts the offerings, and writes rows here as drafts
-- for an admin to review and publish.
CREATE TABLE IF NOT EXISTS services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category    TEXT,
  -- Sub-items revealed when the visitor picks the service: [{name, description}]
  products    JSONB NOT NULL DEFAULT '[]',
  -- Free-text signals the agent matches discovery answers against.
  triggers    TEXT[] NOT NULL DEFAULT '{}',
  -- Directional business outcomes, drawn into the one-pager.
  outcomes    TEXT[] NOT NULL DEFAULT '{}',
  source_url  TEXT,                       -- where the ingester found it
  published   BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS services_published_idx ON services (published, sort_order);

-- Real customer wins. These are the heart of the pitch: the agent references
-- them in conversation ("we helped a company like yours...") and the one-pager
-- prints them. result_metric is the headline number and MUST be verified before
-- publishing — it ships to prospects.
CREATE TABLE IF NOT EXISTS case_studies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name   TEXT NOT NULL,
  industry      TEXT,
  headline      TEXT NOT NULL,          -- one-line summary
  challenge     TEXT NOT NULL DEFAULT '',
  solution      TEXT NOT NULL DEFAULT '',
  result_metric TEXT NOT NULL,          -- e.g. "2x online revenue in 9 months"
  -- Service slugs this case study proves, so the agent can pick a relevant one.
  service_slugs TEXT[] NOT NULL DEFAULT '{}',
  published     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_studies_published_idx ON case_studies (published, sort_order);

-- Record of website ingestion runs, so the admin can see what was fetched.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url           TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed
  services_found INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The offer records who it was for, and which case studies it printed.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS case_study_ids UUID[] NOT NULL DEFAULT '{}';
