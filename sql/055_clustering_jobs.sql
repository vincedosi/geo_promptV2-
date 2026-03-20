-- 055_clustering_jobs.sql
-- Table de suivi des jobs de clustering déclenchés depuis l'UI wizard.
-- status: pending → running → done | failed

create table if not exists clustering_jobs (
  id           uuid        primary key default gen_random_uuid(),
  status       text        not null default 'pending'
                           check (status in ('pending', 'running', 'done', 'failed')),
  poi_types    text[]      not null,
  geo_filter   jsonb,      -- { metropolitaine, regions, depts }
  params       jsonb,      -- { duration, transport, force_k, dry_run }
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  log_tail     text,       -- dernières lignes de log (stdout tronqué à 8000 chars)
  error        text,
  result_meta  jsonb       -- { poi_count, n_cached, n_ok, n_fail, duration_ms }
);

-- Index pour le polling de statut
create index if not exists clustering_jobs_status_idx on clustering_jobs (status, started_at desc);

-- RLS : lecture admin uniquement (service role key bypass RLS de toute façon)
alter table clustering_jobs enable row level security;

create policy "Admin only" on clustering_jobs
  for all using (auth.role() = 'service_role');
