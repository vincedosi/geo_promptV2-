-- ============================================================================
-- sql/322_poussee_branchee.sql — B16 (plan de corrections du découpage des zones, lot 2, 2026-11-02) : la POUSSÉE
-- BRANCHÉE d'une maille, au registre `plateformes_geo`.
--
-- LE CONSTAT. La maille par défaut (B9, ARB-7 = A) propose pour un rayon sur DV360 les « cercles », maille dont la
-- poussée par API n'existe pas dans le produit, alors que celle des codes postaux existe : rien ne le disait, ni dans
-- le choix ni à l'écran.
--
-- LE CORRECTIF.
--   1. Une colonne `poussee_branchee boolean not null default false` : le produit pousse-t-il le ciblage géo de cette
--      (plateforme, maille) par API ? Pour une maille qui porte des POIDS, la poussée dépend AUSSI du mécanisme :
--      `plateformes_poids.branche` (sql/305, amendement E2), lue à côté par la règle (`modePoussee`,
--      lib/zones/conversion-defaut.ts) — un ciblage poussé avec des poids non branchés est « ciblage par API, poids
--      en export manuel ».
--   2. La valeur du relevé, tirée du code de poussée PRÉSENT au 02/11 : DV360 au CP seulement —
--      `lib/dsp/dv360/pousser-ciblage.ts` (codes postaux → geo IDs Google, appelé par
--      `POST /api/campaigns/[campaignId]/activation/pousser`, seul canal câblé `CANAUX_CABLES = ['dv360']`, et par
--      `POST /api/admin/dsp/dv360/targeting/push`) et `POST /api/admin/dsp/dv360/zones/push` (location list de CP).
--      Aucun code ne pousse des cercles (DV360, Meta, TTD), un polygone (TTD), des communes ou départements (TikTok),
--      ni un ciblage pays : tout le reste vaut `false`, export manuel.
--
-- Rejouable : la colonne et la valeur du relevé sont posées ENSEMBLE, une seule fois (bloc `do` gardé par l'absence de
-- la colonne) — un rejeu ne remet donc pas au relevé une valeur corrigée par `update`, patron `on conflict do nothing`
-- de sql/305 et sql/315. Aucun DROP. Appliquer par `psql -1`.
-- ============================================================================

do $do$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'plateformes_geo' and column_name = 'poussee_branchee') then
    alter table public.plateformes_geo add column poussee_branchee boolean not null default false;
    update public.plateformes_geo set poussee_branchee = true where plateforme = 'dv360' and maille = 'cp';
  end if;
end
$do$;

comment on column public.plateformes_geo.poussee_branchee is
  'Le produit pousse-t-il le ciblage geo de cette maille par API ? Au 02/11 : DV360 au CP seulement '
  '(lib/dsp/dv360/pousser-ciblage.ts) ; tout le reste part en export manuel. Pour une maille qui porte des poids, '
  'la poussee des poids se lit dans plateformes_poids.branche (E2). Lu par la maille par defaut (B16, modePoussee). '
  'sql/322.';
