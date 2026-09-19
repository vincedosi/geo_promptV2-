-- sql/206 — Le code postal de chaque carreau du pré-calcul de risque
--           (2026-09-19)
--
-- Sert l'onglet « Diffusion » : les campagnes sont mesurées au CODE POSTAL
-- (`dsp_campaign_data.postal_code`, `campaign_cp_rollup`), le risque au
-- CARREAU. Sans ce pont, on ne peut pas confronter la pression publicitaire à
-- l'exposition.
--
-- ── POURQUOI UNE COLONNE ET PAS UNE JOINTURE À LA VOLÉE ──────────────────
--
-- Mesuré le 2026-09-19 : le point-dans-polygone de 20 000 carreaux contre les
-- 6 187 contours prend **895 ms**, soit ~40 s pour les 883 451. Une fois, à la
-- construction, c'est négligeable ; à chaque changement d'anneau, c'est
-- rédhibitoire.
--
-- ⚠ Et il faut transformer le POINT, jamais le polygone. La première version
-- écrivait `ST_Contains(ST_Transform(r.geom, 3857), centroide)` : la
-- transformation par ligne rend l'index GIST inutilisable, et la requête n'est
-- jamais revenue — **600 s sur 20 000 carreaux**, contre 895 ms en transformant
-- le point. Le symptôme désignait mal la cause : la requête semblait simplement
-- « lourde ».
--
-- ── LES CONTOURS DE CODES POSTAUX SE RECOUVRENT ──────────────────────────
--
-- Mesuré : **22 888 appariements pour 20 000 carreaux**, soit ~14 % de carreaux
-- couverts par DEUX codes postaux ou plus. `ref_codes_postaux.geom` est bâti
-- par union de communes, et une commune peut relever de plusieurs codes.
--
-- Les laisser tous casserait l'invariant qui fonde tout ce module : un carreau,
-- une unité. La somme des lignes cesserait d'égaler le total, exactement le
-- défaut qu'on vient de corriger ailleurs.
--
-- On retient donc le code postal dont le CENTROÏDE est le plus proche du
-- centroïde du carreau. Déterministe, géographiquement défendable, et sans
-- préférence arbitraire pour le plus petit code — un `min(code)` rangerait
-- systématiquement les zones de recouvrement du côté du numéro le plus bas.

alter table public.carreau_risque_distance
  add column if not exists code_postal text;

comment on column public.carreau_risque_distance.code_postal is
  'Code postal du carreau, retenu par PROXIMITE DE CENTROIDE quand plusieurs contours '
  'le couvrent (~14 % des carreaux). Un carreau, un code postal : sans cette regle, la '
  'somme des lignes cesserait d''egaler le total.';

create index if not exists idx_crd_code_postal
  on public.carreau_risque_distance (code_postal)
  where code_postal is not null;

create or replace function public.remplir_code_postal_carreau(
  p_lot int default 100000
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_t0      timestamptz := clock_timestamp();
  v_faits   int;
  v_restant bigint;
begin
  set local statement_timeout = '30min';
  set local work_mem = '64MB';

  -- Par LOTS, et reprenable : la colonne est nullable, donc « ce qui reste à
  -- faire » se lit directement en base. Pas besoin d'un journal de bandes comme
  -- pour la construction des distances — ici l'état EST la donnée.
  --
  -- ⚠ UNE SEULE instruction, et c'est un correctif. La première version
  -- appariait, puis marquait d'une seconde requête « tout ce qui reste NULL »
  -- comme sans code postal. Or ce qui reste NULL inclut les carreaux JAMAIS
  -- ESSAYÉS — ceux des lots suivants. Ils auraient été condamnés sans qu'aucun
  -- point-dans-polygone les ait seulement examinés, et le traitement aurait
  -- rendu « terminé » sur des carreaux qu'il n'a pas traités.
  --
  -- `a_faire` est référencée DEUX fois, donc matérialisée par PostgreSQL : le
  -- `limit` désigne le même lot dans les deux branches. Inlinée, il pourrait
  -- désigner deux lots différents.
  with a_faire as materialized (
    select d.carreau_id, ST_Transform(ST_Centroid(c.geom_3857), 4326) as p
      from public.carreau_risque_distance d
      join public.carreaux_filosofi c on c.id = d.carreau_id
     where d.code_postal is null
     limit greatest(coalesce(p_lot, 100000), 1)
  ),
  -- `distinct on` sur le carreau : un seul code postal par carreau, celui dont
  -- le centroïde est le plus proche. Les contours se recouvrent sur ~14 % des
  -- carreaux et en garder plusieurs casserait « un carreau, une unité ».
  choisis as (
    select distinct on (a.carreau_id) a.carreau_id, r.code_postal
      from a_faire a
      join public.ref_codes_postaux r
        on r.geom && a.p and ST_Contains(r.geom, a.p)
     order by a.carreau_id, ST_Distance(r.centroid, a.p)
  )
  update public.carreau_risque_distance d
     -- ⚠ La chaîne VIDE, et non `null`, pour un carreau qu'aucun contour ne
     -- couvre : les codes postaux ne pavent pas le territoire sans trou
     -- (littoral, zones non adressées). Laissé à `null`, un tel carreau
     -- reviendrait à chaque lot et le traitement ne finirait jamais. La chaîne
     -- vide dit « essayé, sans résultat », ce que `null` ne dit pas.
     set code_postal = coalesce(c.code_postal, '')
    from a_faire a
    left join choisis c on c.carreau_id = a.carreau_id
   where d.carreau_id = a.carreau_id;

  get diagnostics v_faits = row_count;

  select count(*) into v_restant
    from public.carreau_risque_distance where code_postal is null;

  return jsonb_build_object(
    'ok', true, 'apparies', v_faits, 'restant', v_restant,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.remplir_code_postal_carreau is
  'Remplit code_postal par lots, reprenable — la colonne nullable EST l''etat. '
  'Transforme le POINT et jamais le polygone : la transformation par ligne rend '
  'l''index GIST inutilisable (600 s sur 20 000 carreaux, contre 895 ms).';

revoke all on function public.remplir_code_postal_carreau(int) from public, anon, authenticated;
grant execute on function public.remplir_code_postal_carreau(int) to service_role;
