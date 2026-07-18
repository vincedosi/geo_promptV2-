-- ============================================================
-- 114 — Corrige idx_dsp_data_unique pour la dimension acteur
-- ============================================================
-- Contexte : sql/113 a ajouté la colonne `actor` à dsp_campaign_data (vue par
-- acteur) mais n'a pas étendu l'index d'unicité idempotent (CLAUDE.md :
-- idx_dsp_data_unique sur campaign_id + date + postal_code + city + media,
-- NULL=égal via COALESCE, utilisé pour DELETE-cible + insert idempotent).
-- Sans `actor` dans l'index, plusieurs lignes actor différentes pour le même
-- (campagne, date, CP, media) violent l'unicité — bloque tout import/seed qui
-- ventile la délivrance par acteur (ex. sql/112 task 6).
--
-- Découvert en appliquant sql/112 (attribution acteur du seed démo) : l'INSERT
-- CROSS JOIN sur 5 acteurs remonte 23505 duplicate key sur idx_dsp_data_unique.
--
-- REJOUABLE (DROP IF EXISTS + CREATE), NULL-safe (COALESCE(actor,'') comme les
-- 4 autres colonnes de l'index). Table dsp_campaign_data : ~233k lignes/238 MB
-- (07/2026) — DROP+CREATE UNIQUE INDEX en une passe, sous le budget I/O Nano.

DROP INDEX IF EXISTS public.idx_dsp_data_unique;

CREATE UNIQUE INDEX idx_dsp_data_unique ON public.dsp_campaign_data (
  campaign_id,
  COALESCE(date, '1970-01-01'::date),
  COALESCE(postal_code, ''::text),
  COALESCE(city, ''::text),
  COALESCE(media, ''::text),
  COALESCE(actor, ''::text)
);
