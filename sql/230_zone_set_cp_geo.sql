-- ============================================================================
-- sql/230 — la géométrie des codes postaux d'un jeu de zones
-- ============================================================================
--
-- CE QUE SERT CETTE FONCTION : la carte de DROITE de l'étape ④, celle qui
-- montre ce qu'on ACHÈTE, à côté de celle qui montre ce qu'on MESURE.
--
-- Le module entier existe parce que ces deux choses ne coïncident pas : le
-- risque se mesure au carreau de 200 m, le DSP achète au code postal. Jusqu'ici
-- l'écart se lisait en chiffres — « 1 102 codes postaux retenus, 73,1 %
-- d'utile ». Il se regarde désormais.
--
-- ── UNE LIGNE PAR CODE POSTAL, PAS PAR GRAPPE ───────────────────────────────
--
-- `zone_set_cp` porte une ligne par (code postal x grappe) depuis sql/225 : un
-- code postal à cheval sur deux bassins en a deux, jusqu'à six. Une carte a
-- besoin d'UN polygone par code postal, sinon elle en peint le même quatre
-- fois — et l'opacité cumulée ferait passer un code postal partagé pour un
-- code postal plus exposé.
--
-- Les règles de repli sont celles de `regrouperParCodePostal`
-- (`lib/zones/plan.ts`), et c'est délibéré : `pop_en_zone` se SOMME,
-- `pop_totale` NE se somme PAS (c'est une propriété du code postal, répétée
-- sur chacune de ses lignes), la classe affichée est la DOMINANTE.
--
-- ── CE QUE LA CARTE MONTRE DE PLUS QUE LE TABLEAU ───────────────────────────
--
-- `n_membres` : les codes postaux qu'un référentiel ne sait pas distinguer
-- (sql/228). Le polygone dessiné est celui de la commune entière, et
-- l'infobulle doit le DIRE — sans quoi on lirait « 44000 » sur un contour qui
-- vaut aussi pour 44100, 44200 et 44300, et on croirait cibler un quartier.
--
-- ⚠ `ST_SimplifyPreserveTopology` et JAMAIS `ST_Simplify` : ce dernier VIDE
-- les petits polygones au lieu de les simplifier. Mesuré sur les périmètres
-- PPRT (sql/178), il en vidait 602 sur 664. Un code postal urbain est un petit
-- polygone.
-- ============================================================================

create or replace function public.zone_set_cp_geo(
  p_zone_set_id uuid,
  p_bbox numeric[] default null,
  p_limite integer default 4000
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_t0    timestamptz := clock_timestamp();
  v_env   geometry;
  v_tol   double precision;
  v_res   jsonb;
  v_total int;
begin
  if not exists (select 1 from public.zone_sets where id = p_zone_set_id) then
    return jsonb_build_object('error', 'jeu_introuvable', 'ok', false);
  end if;

  -- ⚠ La tolérance est DÉRIVÉE de l'étendue demandée, jamais une constante —
  -- même arbitrage que `alignement_par_maille_geo` (ruling T13A-1) : une
  -- tolérance fixe fait disparaître des sous-polygones entiers à grande
  -- échelle, et ne simplifie rien à petite.
  if p_bbox is not null and array_length(p_bbox, 1) = 4 then
    v_env := ST_MakeEnvelope(p_bbox[1], p_bbox[2], p_bbox[3], p_bbox[4], 4326);
    v_tol := greatest((p_bbox[3] - p_bbox[1])::double precision / 1000, 0.0001);
  else
    v_tol := 0.001;
  end if;

  with par_cp as (
    select z.code_postal,
           sum(z.pop_en_zone)::numeric      as pop_en_zone,
           max(z.pop_totale)::numeric       as pop_totale,
           bool_or(z.retenu)                as retenu,
           count(*)::int                    as n_grappes,
           -- La classe DOMINANTE : celle qui porte le plus de monde. Un code
           -- postal chevauche souvent plusieurs bandes, et en retenir une est
           -- ce qui fait tenir « un code postal, une couleur ».
           (array_agg(z.classe order by z.pop_en_zone desc))[1] as classe,
           (array_agg(z.cluster_id order by z.pop_en_zone desc))[1] as cluster_id
      from public.zone_set_cp z
     where z.zone_set_id = p_zone_set_id
     group by z.code_postal
  ),
  avec_geo as (
    select c.*,
           coalesce(g.n_membres, 1) as n_membres,
           r.geom
      from par_cp c
      join public.ref_codes_postaux r on r.code_postal = c.code_postal
      left join public.cp_groupe g on g.code_postal = c.code_postal
     where v_env is null or r.geom && v_env
  ),
  bornee as (
    select * from avec_geo
     -- ⚠ La limite coupe les MOINS exposés d'abord : une liste tronquée ne
     -- perd jamais le bassin qu'on regarde.
     order by pop_en_zone desc
     limit greatest(coalesce(p_limite, 4000), 1)
  )
  select jsonb_build_object(
           'type', 'FeatureCollection',
           'features', coalesce(jsonb_agg(jsonb_build_object(
             'type', 'Feature',
             'id', b.code_postal,
             'geometry', ST_AsGeoJSON(
               ST_SimplifyPreserveTopology(b.geom, v_tol))::jsonb,
             'properties', jsonb_build_object(
               'code_postal', b.code_postal,
               'classe', b.classe,
               'cluster_id', b.cluster_id,
               'n_grappes', b.n_grappes,
               'n_membres', b.n_membres,
               'retenu', b.retenu,
               'pop_en_zone', round(b.pop_en_zone),
               'pop_totale', round(b.pop_totale),
               -- Le taux d'exposition DU CODE POSTAL : quelle part de ses
               -- habitants est réellement en zone. C'est lui qui dit la
               -- dilution, code postal par code postal.
               'taux_exposition', case when b.pop_totale > 0
                 then round(least(100, b.pop_en_zone / b.pop_totale * 100), 1)
                 else null end)
           )), '[]'::jsonb))
    into v_res
    from bornee b;

  select count(*) into v_total
    from (select distinct code_postal from public.zone_set_cp
           where zone_set_id = p_zone_set_id) x;

  return v_res || jsonb_build_object(
    'ok', true,
    -- `n_total` compté AVANT la limite : un rendu tronqué doit être honnête.
    'n_total', v_total,
    'tolerance', v_tol,
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;
$fn$;

comment on function public.zone_set_cp_geo is
  'Geometrie des codes postaux d''un jeu de zones, UNE ligne par code postal '
  '(zone_set_cp en porte une par grappe). Sert la carte « codes postaux » de '
  'l''etape 4. ST_SimplifyPreserveTopology, tolerance derivee de la bbox. '
  'sql/230.';

revoke all on function public.zone_set_cp_geo(uuid, numeric[], integer) from public, anon, authenticated;
grant execute on function public.zone_set_cp_geo(uuid, numeric[], integer) to service_role;


-- ── Les grappes d'un jeu, pour le tableau sous les cartes ───────────────────
--
-- ⚠ Leur ENVELOPPE et non leur géométrie complète : le tableau ne dessine
-- rien, il a besoin de savoir où recadrer les deux cartes au clic. Une
-- enveloppe fait 5 nombres, une grappe de Fos-sur-Mer en fait des milliers.
create or replace function public.zone_set_grappes(
  p_zone_set_id uuid,
  p_limite integer default 600
) returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
  select coalesce(jsonb_agg(x order by x->>'rang'), '[]'::jsonb) from (
    select jsonb_build_object(
             'id', k.id,
             'rang', k.rang,
             'nom', k.nom,
             'nom_auto', k.nom_auto,
             'niveau_dominant', k.niveau_dominant,
             'n_sites', k.n_sites,
             'pop_exposee', k.pop_exposee,
             -- Les codes postaux de CETTE grappe, et ceux qu'elle fait acheter.
             'n_cp', (select count(*) from public.zone_set_cp z
                       where z.zone_set_id = p_zone_set_id and z.cluster_id = k.id),
             'n_cp_retenus', (select count(*) from public.zone_set_cp z
                               where z.zone_set_id = p_zone_set_id
                                 and z.cluster_id = k.id and z.retenu),
             -- ⚠ Les codes postaux VOYAGENT AVEC le bassin, et ce n'est pas du
             -- confort. Le tableau les surligne sur la carte AU SURVOL : les
             -- chercher a la demande ferait une requete par ligne survolee, et
             -- le survol est le geste le plus repete d'un tableau. Mesure du
             -- volume : 580 bassins pour 2 255 lignes de codes postaux, soit
             -- quelques dizaines de ko — moins qu'une seule tuile.
             'codes_postaux', (select coalesce(jsonb_agg(z.code_postal order by z.code_postal), '[]'::jsonb)
                                 from public.zone_set_cp z
                                where z.zone_set_id = p_zone_set_id
                                  and z.cluster_id = k.id),
             'bbox', case when k.geom is null then null else
               jsonb_build_array(ST_XMin(k.geom), ST_YMin(k.geom),
                                 ST_XMax(k.geom), ST_YMax(k.geom)) end
           ) as x
      from public.zone_set_clusters k
     where k.zone_set_id = p_zone_set_id
     order by k.pop_exposee desc nulls last
     limit greatest(coalesce(p_limite, 600), 1)
  ) t
$fn$;

comment on function public.zone_set_grappes is
  'Les grappes d''un jeu avec leur ENVELOPPE (pas leur geometrie) : le tableau '
  'sous les cartes n''en a besoin que pour recadrer. sql/230.';

revoke all on function public.zone_set_grappes(uuid, integer) from public, anon, authenticated;
grant execute on function public.zone_set_grappes(uuid, integer) to service_role;
