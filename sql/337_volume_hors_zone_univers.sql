-- sql/337 — D35 (plan de corrections du découpage des zones, lot 4, décision de Vincent du 03/11/2026) : le VOLUME de
-- la ligne HORS_ZONE.
--
-- DÉCISION.
--   Volume HORS_ZONE = somme des populations totales des CP PEUPLÉS du référentiel NON retenus, restreinte à l'UNIVERS
--   de la zone (métropole ou France entière). Mode strict : poids 0, part prévue 0, part observée = taux de fuite.
--   Mode national : poids plancher, part prévue calculée avec ce volume.
--
-- CONSTAT (code de cd11f6e3).
--   `volumes_attendus_cp` (sql/306, réécrite sur `cp_population_totale_e7` par sql/332) rendait le total du référentiel
--   ENTIER, quelle que soit la zone : une zone de métropole imputait à HORS_ZONE les 1 190 909,5 habitants des DROM
--   carroyés (972 : 306 745 ; 974 : 884 164,5). Les modes strict et national étaient déjà conformes (lib/zones/plan.ts).
--
-- CE QUE FAIT CETTE MIGRATION (rejouable, aucun DROP, même patron jumelle + enveloppe que sql/154).
--   1. `volumes_attendus_cp_univers(text[], text)` porte le corps : total des CP peuplés (`ind` > 0) de l'univers
--      demandé — `METRO` = hors départements 97x (`code_departement`, rattachement majoritaire de C25), `FR` = tous —,
--      et le volume de chaque code demandé (indépendant de l'univers). Univers inconnu : 22023, jamais un défaut.
--   2. `volumes_attendus_cp(text[])` devient une enveloppe mince de la jumelle en `FR` : son résultat ne change pas
--      (plus la clé `univers`), pour les appelants d'autres branches.
--   L'univers de la zone est choisi par l'extraction (`universDeZone`, lib/zones/part-prevue.ts) : une zone pays dit le
--   sien, toute autre zone est en France entière dès qu'une de ses unités CP est dans un DROM, en métropole sinon.
--
-- I/O : un passage séquentiel sur `cp_population_totale_e7` (6 010 lignes), comme avant. EXPLAIN ANALYZE du 03/11 :
--   voir le compte rendu de D35 (progress.md).

create or replace function public.volumes_attendus_cp_univers(p_codes text[], p_univers text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_univers is null or p_univers not in ('METRO', 'FR') then
    raise exception 'univers inconnu : % (METRO ou FR)', p_univers using errcode = '22023';
  end if;
  return (
    select jsonb_build_object(
             'volume', 'population_totale',
             'univers', p_univers,
             'total', coalesce(sum((cp.populations ->> 'ind')::numeric)
                                 filter (where (cp.populations ->> 'ind')::numeric > 0
                                           and (p_univers = 'FR' or coalesce(cp.code_departement, '') not like '97%')), 0),
             'codes', coalesce(jsonb_object_agg(cp.code_postal, (cp.populations ->> 'ind')::numeric)
                                 filter (where cp.code_postal = any (coalesce(p_codes, '{}'::text[]))
                                           and cp.populations ? 'ind'), '{}'::jsonb))
      from public.cp_population_totale_e7 cp);
end
$$;
comment on function public.volumes_attendus_cp_univers(text[], text) is
  'D35 : volume attendu V1 = population totale. {volume, univers, total (CP peuplés de l''univers : METRO hors 97x, '
  'FR tous), codes {code: volume}}. Le volume HORS_ZONE = total − unités retenues (lib/zones/plan-jeu-zone.ts).';
revoke all on function public.volumes_attendus_cp_univers(text[], text) from public, anon, authenticated;
grant execute on function public.volumes_attendus_cp_univers(text[], text) to service_role;

create or replace function public.volumes_attendus_cp(p_codes text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.volumes_attendus_cp_univers(p_codes, 'FR')
$$;
comment on function public.volumes_attendus_cp(text[]) is
  'A8 (E5, Q9 = A) : enveloppe de volumes_attendus_cp_univers(p_codes, ''FR'') depuis D35 (sql/337) — France entière.';
revoke all on function public.volumes_attendus_cp(text[]) from public, anon, authenticated;
grant execute on function public.volumes_attendus_cp(text[]) to service_role;

comment on column public.zone_set_extractions.resume_plan is
  'A8 : bilan du plan CP figé — {multiplicateur: séquence E4 + ligne hors_zone {code, mode, multiplicateur, part, '
  'classe, volume, univers (D35, METRO ou FR ; absent avant sql/337 = FR), part_prevue}, part_prevue: {volume_attendu, '
  'unite_de_somme, repartition_groupe, hors_zone, unites_sans_part}}. Lire la ligne HORS_ZONE par '
  'hors_zone_extraction(id), jamais en direct.';

notify pgrst, 'reload schema';
