-- 104 — Identité campagne (annonceur/produit) + hiérarchie de liaison par canal.
-- Appliquée via MCP Supabase le 2026-07-16 (migration campaign_identity_and_link_levels).
--
-- advertiser/product : saisis à l'étape Cible du wizard (mode démo sans API).
-- link_levels : niveaux de liaison plateforme (ex. annonceur → campagne → insertion
-- order) portés par le registre — le wizard les rend en saisie manuelle quand la
-- connexion API du canal n'existe pas. Jamais de hiérarchie en dur côté code.

ALTER TABLE dsp_campaigns
  ADD COLUMN IF NOT EXISTS advertiser text,
  ADD COLUMN IF NOT EXISTS product text;

COMMENT ON COLUMN dsp_campaigns.advertiser IS 'Annonceur (marque) — identité déclarée au wizard, indépendante des connexions DSP';
COMMENT ON COLUMN dsp_campaigns.product IS 'Produit/offre mis en avant par la campagne';

ALTER TABLE dsp_channel_registry
  ADD COLUMN IF NOT EXISTS link_levels jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN dsp_channel_registry.link_levels IS 'Niveaux de liaison plateforme [{key,label}] du plus haut au plus bas — rendus en cascade API si connecté, en saisie manuelle sinon';

UPDATE dsp_channel_registry SET link_levels = '[
  {"key":"advertiser","label":"Annonceur"},
  {"key":"campaign","label":"Campagne DV360"},
  {"key":"insertion_order","label":"Insertion order"}
]'::jsonb WHERE code = 'dv360';

UPDATE dsp_channel_registry SET link_levels = '[
  {"key":"advertiser","label":"Annonceur"},
  {"key":"campaign","label":"Campagne"},
  {"key":"ad_group","label":"Ad group"}
]'::jsonb WHERE code = 'ttd';

UPDATE dsp_channel_registry SET link_levels = '[
  {"key":"ad_account","label":"Compte publicitaire"},
  {"key":"campaign","label":"Campagne"},
  {"key":"ad_set","label":"Ad set"}
]'::jsonb WHERE code = 'meta';

UPDATE dsp_channel_registry SET link_levels = '[
  {"key":"advertiser","label":"Annonceur"},
  {"key":"campaign","label":"Campagne"},
  {"key":"ad_group","label":"Ad group"}
]'::jsonb WHERE code = 'tiktok';

UPDATE dsp_channel_registry SET link_levels = '[
  {"key":"advertiser","label":"Annonceur"},
  {"key":"campaign","label":"Campagne"},
  {"key":"placement","label":"Placement"}
]'::jsonb WHERE code = 'cm360';

UPDATE dsp_channel_registry SET link_levels = '[
  {"key":"advertiser","label":"Annonceur"},
  {"key":"campaign","label":"Campagne"},
  {"key":"line_item","label":"Line item"}
]'::jsonb WHERE code = 'adform';
