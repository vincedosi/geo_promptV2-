-- 245 — Codes postaux d'une bbox : la liste entière, plus 1 000 (2026-10-10)
--
-- ── Le défaut ────────────────────────────────────────────────────────────────
--
-- `codes_postaux_dans_bbox` (sql/144) est `RETURNS TABLE` : PostgREST la
-- coupe sans erreur. Mesuré le 2026-10-10 en local (`max_rows` = 1 000) :
-- 1 000 codes postaux rendus sur 6 051 pour la bbox métropole (défaut B de
-- docs/SUITE_TRONCATURE_POSTGREST.md — 5 000 sur l'ancienne production).
--
-- Son dernier appelant, `/api/analyses/score`, résout ainsi la bbox d'une zone
-- enregistrée. Les plus grandes zones de la base en couvrent 6 165 (mesuré) :
-- le score était calculé sur les 1 000 premiers codes, sous un plafond de
-- route (`MAX_CP` = 7 000) qu'il ne pouvait donc jamais atteindre — un score
-- partiel, présenté comme complet.
--
-- ── Le correctif ─────────────────────────────────────────────────────────────
--
-- Jumelle `codes_postaux_dans_bbox_jsonb` (patron sql/154, 168-170) : même
-- corps, retour `jsonb` (tableau de codes triés), hors troncature. Bornée par
-- construction : le référentiel `ref_codes_postaux` (6 187 lignes).
-- `codes_postaux_dans_bbox` devient une ENVELOPPE MINCE de la jumelle : un seul
-- corps, deux formes de retour. Plus aucun code de l'application ne l'appelle.
--
-- Mêmes droits que l'originale : SECURITY DEFINER, exécution réservée à
-- service_role.
-- Rejouable. Verrouillé par tests/integration/codes-postaux-bbox-jsonb.test.ts.

begin;

create or replace function public.codes_postaux_dans_bbox_jsonb(
  p_ouest numeric, p_sud numeric, p_est numeric, p_nord numeric
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select coalesce(jsonb_agg(r.code_postal order by r.code_postal), '[]'::jsonb)
  from public.ref_codes_postaux r
  where r.centroid && st_makeenvelope(p_ouest, p_sud, p_est, p_nord, 4326);
$fn$;

revoke all on function public.codes_postaux_dans_bbox_jsonb(numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.codes_postaux_dans_bbox_jsonb(numeric, numeric, numeric, numeric) to service_role;

-- Enveloppe mince : même signature, même forme de retour qu'en sql/144.
create or replace function public.codes_postaux_dans_bbox(
  p_ouest numeric, p_sud numeric, p_est numeric, p_nord numeric
)
returns table(code_postal text)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select c #>> '{}'
  from jsonb_array_elements(public.codes_postaux_dans_bbox_jsonb(p_ouest, p_sud, p_est, p_nord)) c;
$fn$;

notify pgrst, 'reload schema';

commit;
