-- 102 — Catalogue des canaux de diffusion (DSP / réseaux sociaux / ad server).
-- Registre dynamique (jamais de liste en dur côté code). Le « connecté » se
-- calcule par jointure dsp_channel_registry.connection_provider = dsp_connections.provider.
-- Appliquée via MCP Supabase le 2026-07-08 (spec 2026-07-08-etape-canaux-design.md).
create table if not exists public.dsp_channel_registry (
  code text primary key,
  label text not null,
  category text not null check (category in ('dsp','social','adserver')),
  connection_provider text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.dsp_channel_registry enable row level security;
drop policy if exists "dsp_channel_registry_read_auth" on public.dsp_channel_registry;
create policy "dsp_channel_registry_read_auth" on public.dsp_channel_registry
  for select to authenticated using (true);

insert into public.dsp_channel_registry (code, label, category, connection_provider) values
  ('dv360',  'Google DV360',       'dsp',      'dv360'),
  ('ttd',    'The Trade Desk',     'dsp',      null),
  ('meta',   'Meta (Facebook/Instagram)', 'social', 'meta'),
  ('tiktok', 'TikTok',             'social',   'tiktok'),
  ('adform', 'Adform',             'adserver', null),
  ('cm360',  'Google Campaign Manager 360', 'adserver', null)
on conflict (code) do nothing;

-- Mode démo par utilisateur (case à cocher admin dans l'overlay MAGELIAN, §8 spec).
alter table public.profiles add column if not exists demo_mode boolean not null default false;
