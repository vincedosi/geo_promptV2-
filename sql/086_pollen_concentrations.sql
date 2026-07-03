-- ============================================================
-- 086 — Concentrations pollen (grains/m³) + alerte sur pollen_map_daily
-- ============================================================
-- Appliquée le 2026-07-03 via MCP Supabase (migration `pollen_concentrations`).
--
-- Source : couche WFS publique ind_pol:ind_national_pol (champs conc_aul,
-- conc_boul, conc_oliv, conc_gram, conc_arm, conc_ambr en grains/m³ + alerte).
-- Agrégation CP = MAX des concentrations des communes du CP, alerte = OR.

ALTER TABLE public.pollen_map_daily
  ADD COLUMN IF NOT EXISTS conc_ambroisie real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conc_armoise   real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conc_aulne     real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conc_bouleau   real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conc_graminees real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conc_olivier   real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alerte         boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pollen_map_daily.alerte IS
  'true si au moins une commune du CP est en alerte pollen (source Atmo France)';
