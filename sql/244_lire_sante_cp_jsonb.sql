-- 244 — Santé environnementale au code postal : tout le jour, en un passage (2026-10-10)
--
-- ── Le défaut ────────────────────────────────────────────────────────────────
--
-- `/api/civic-indicators/health-map?scale=cp` faisait trois lectures, dont
-- deux plafonnées EN SILENCE par PostgREST (`max_rows` = 1 000 en local) :
--
--   1. la table du jour (`pollen_map_daily` / `atmo_map_daily`) avec
--      `.limit(10_000)` — que `db-max-rows` ramène à 1 000. 100 lignes
--      aujourd'hui (rien de perdu), ≈ 6 100 après une ingestion nationale :
--      la carte en aurait peint 1 000 ;
--   2. avec une `bbox`, `codes_postaux_dans_bbox` (`RETURNS TABLE`) — 1 000
--      codes postaux sur 6 051 pour la métropole, mesuré le 2026-10-10 (défaut B
--      de docs/SUITE_TRONCATURE_POSTGREST.md : 5 000 sur l'ancienne production).
--      Au-delà de 500 codes la route relisait la table nationale et filtrait
--      en mémoire PAR CES 1 000 CODES : tout code postal hors des 1 000
--      premiers disparaissait de la carte, même présent dans la table.
--
-- ── Le correctif ─────────────────────────────────────────────────────────────
--
-- `lire_sante_cp_jsonb` fait tout en base, en un passage : date la plus
-- récente (clé primaire `(date_ech, code_postal)`, lecture arrière), filtre
-- du niveau minimal sur la métrique demandée, bbox par une semi-jointure sur
-- `ref_codes_postaux.centroid` (index GIST) — même sémantique que
-- `codes_postaux_dans_bbox` (sql/144). Retour `jsonb`, hors troncature.
--
-- Borne : `p_limite` (route : 10 000). La clé primaire impose une ligne par
-- code postal et par jour, donc au plus un par CP du pays (6 187 au
-- référentiel). On lit `p_limite + 1` lignes et `tronque` le DIT.
--
-- Jeu et métrique sont vérifiés contre une liste fermée AVANT d'entrer dans le
-- SQL dynamique (`format(%I)`) : aucun nom venu de l'appelant n'y passe brut.
--
-- Réservée à service_role (la route passe par `createAdminClient`).
-- Rejouable. Verrouillé par tests/integration/sante-cp-jsonb.test.ts.

begin;

create or replace function public.lire_sante_cp_jsonb(
  p_jeu text,
  p_metrique text default 'global',
  p_niveau_min integer default 1,
  p_ouest double precision default null,
  p_sud double precision default null,
  p_est double precision default null,
  p_nord double precision default null,
  p_limite integer default 10000
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_catalog'
as $fn$
declare
  v_table text;
  v_colonnes text;
  v_metriques text[];
  v_colonne text;
  v_date date;
  resultat jsonb;
  avec_bbox boolean := p_ouest is not null and p_sud is not null
                       and p_est is not null and p_nord is not null;
begin
  if p_jeu = 'pollen' then
    v_table := 'pollen_map_daily';
    v_colonnes := 'code_postal, indice_global, ambroisie, armoise, aulne, bouleau, graminees, olivier, '
      || 'conc_ambroisie, conc_armoise, conc_aulne, conc_bouleau, conc_graminees, conc_olivier, alerte, nb_communes';
    v_metriques := array['global', 'ambroisie', 'armoise', 'aulne', 'bouleau', 'graminees', 'olivier'];
  elsif p_jeu = 'atmo' then
    v_table := 'atmo_map_daily';
    v_colonnes := 'code_postal, indice_global, no2, o3, pm10, pm25, so2, nb_communes';
    v_metriques := array['global', 'no2', 'o3', 'pm10', 'pm25', 'so2'];
  else
    raise exception 'Jeu inconnu : %. Attendu pollen ou atmo.', p_jeu;
  end if;
  if not (p_metrique = any(v_metriques)) then
    raise exception 'Métrique inconnue pour %: %.', p_jeu, p_metrique;
  end if;
  v_colonne := case when p_metrique = 'global' then 'indice_global' else p_metrique end;

  -- Date la plus récente : aujourd'hui, ou la veille si l'ingestion du matin
  -- n'a pas encore tourné. Lecture arrière de la clé primaire.
  execute format('select max(date_ech) from %I', v_table) into v_date;
  if v_date is null then
    return jsonb_build_object('date', null, 'rows', '[]'::jsonb, 'tronque', false);
  end if;

  -- EXECUTE … USING : plan sur mesure à chaque appel (bbox présente ou non).
  execute format($q$
    with lus as materialized (
      select %s
      from %I t
      where t.date_ech = $1
        and t.%I >= $2
        and (not $7 or exists (
          select 1 from ref_codes_postaux r
          where r.code_postal = t.code_postal
            and r.centroid && st_makeenvelope($3, $4, $5, $6, 4326)))
      order by t.code_postal
      limit $8 + 1
    )
    select jsonb_build_object(
      'rows', coalesce(
        (select jsonb_agg(to_jsonb(l) order by l.code_postal)
         from (select * from lus order by code_postal limit $8) l),
        '[]'::jsonb),
      'tronque', (select count(*) from lus) > $8
    )
  $q$, v_colonnes, v_table, v_colonne)
  into resultat
  using v_date, greatest(p_niveau_min, 1), p_ouest, p_sud, p_est, p_nord, avec_bbox, p_limite;

  return jsonb_build_object('date', v_date) || resultat;
end;
$fn$;

revoke all on function public.lire_sante_cp_jsonb(text, text, integer, double precision, double precision, double precision, double precision, integer) from public, anon, authenticated;
grant execute on function public.lire_sante_cp_jsonb(text, text, integer, double precision, double precision, double precision, double precision, integer) to service_role;

notify pgrst, 'reload schema';

commit;
