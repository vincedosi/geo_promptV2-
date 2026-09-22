-- sql/225 — Un code postal, UNE LIGNE PAR GRAPPE (Phase 2 du chantier zones → CP).
--
-- ── LA DÉCISION, ET CE QU'ELLE COÛTE ────────────────────────────────────────
--
-- Arbitrage du 2026-09-22 : un code postal à cheval sur plusieurs grappes
-- porte **une ligne par grappe**. C'est le choix qui dit la vérité — un code
-- postal peut servir deux bassins industriels, et l'écraser en une ligne
-- perdrait l'information qu'on cherche précisément à montrer.
--
-- Trois conséquences en découlent. La troisième est un piège.
--
-- **a) La clé primaire s'élargit** : (zone_set_id, code_postal) devient
-- (zone_set_id, code_postal, cluster_id).
--
-- **b) Le PLAN doit agréger.** `bidding_zone_configs` a pour clé
-- (strategy_id, postal_code, country_code) : **un multiplicateur par code
-- postal**, pas un par grappe. Le DSP ne sait pas lire deux poids pour un même
-- code postal. `genererPlanCp` somme donc les lignes d'un même CP —
-- `Σ (population exposée dans la grappe × poids de sa classe)` — ce qui reste
-- fidèle au principe « le plan est une part de population EXPOSÉE » tout en
-- rendant un seul nombre.
--
-- **c) ⚠ LE SEUIL SE DÉCIDE SUR LE CODE POSTAL, JAMAIS SUR LA LIGNE.**
-- Un code postal exposé à 12 % par une grappe et à 15 % par une autre est
-- exposé à **27 %** : ligne par ligne, le seuil de 20 % l'écarterait DEUX FOIS
-- alors qu'il doit être retenu. `retenu` porte donc la même valeur sur toutes
-- les lignes d'un code postal, calculée sur leur somme.
--
-- ── ET UN QUATRIÈME PIÈGE, CELUI DE LA DÉMULTIPLICATION ─────────────────────
--
-- `pop_totale` est une propriété du CODE POSTAL, répétée sur chacune de ses
-- lignes. Toute somme qui la traverse doit d'abord DÉDUPLIQUER par code
-- postal, sinon un CP présent dans trois grappes pèse trois fois dans le taux
-- d'utile. C'est exactement le défaut que `campaign_cp_rollup` documente
-- (PK campagne × CP × acteur, un CP y apparaît jusqu'à cinq fois).


-- ── LES SITES D'UNE GRAPPE, ET POURQUOI CETTE TABLE EXISTE ──────────────────
--
-- ⚠ CORRECTION DE PERFORMANCE, mesurée le 2026-09-22. sql/224 rattachait
-- chaque carreau à sa grappe par `k.geom_3857 <-> centroïde` — un KNN sur les
-- POLYGONES des bassins. Une grappe est l'union de dizaines de disques et
-- porte des milliers de sommets : le calcul de distance y est coûteux.
--
--     mesure à chaud (juste après avoir chargé les mêmes carreaux)   9,8 s
--     mesure À FROID, la seule honnête                             508 s
--
-- La première a été documentée telle quelle dans ARCHITECTURE.md : c'est une
-- mesure de cache, pas une mesure de coût. Corrigé ici et là-bas.
--
-- Un carreau est désormais rattaché au bassin du SITE LE PLUS PROCHE. Un site
-- est un POINT : le KNN devient trivial. Et c'est sémantiquement plus juste —
-- un carreau appartient au bassin du site qui l'expose, pas à celui dont
-- l'enveloppe le contient (les deux diffèrent là où deux bassins se frôlent).
create table if not exists public.zone_set_cluster_sites (
  cluster_id uuid not null references public.zone_set_clusters(id) on delete cascade,
  site_id    uuid not null,
  geom_3857  geometry(Point, 3857) not null,
  primary key (cluster_id, site_id)
);

create index if not exists idx_zscs_geom on public.zone_set_cluster_sites using gist (geom_3857);

alter table public.zone_set_cluster_sites enable row level security;
revoke all on public.zone_set_cluster_sites from public, anon, authenticated;
grant select, insert, update, delete on public.zone_set_cluster_sites to service_role;

comment on table public.zone_set_cluster_sites is
  'Les sites de chaque grappe, en POINTS. Sert a rattacher un carreau a son '
  'bassin par KNN : sur les polygones des grappes, le meme rattachement coutait '
  '508 s a froid (sql/225).';

alter table public.zone_set_cp
  add column if not exists cluster_id uuid references public.zone_set_clusters(id) on delete cascade,
  add column if not exists poids numeric;

comment on column public.zone_set_cp.cluster_id is
  'La grappe (bassin) a laquelle cette ligne rapporte. Un code postal a cheval '
  'sur deux grappes porte deux lignes, au prorata de sa population exposee dans '
  'chacune. sql/225.';

comment on column public.zone_set_cp.poids is
  'population exposee de cette ligne x poids de sa classe. Le plan du DSP somme '
  'ces poids par CODE POSTAL : bidding_zone_configs ne sait porter qu''un seul '
  'multiplicateur par code postal.';

-- Les jeux construits AVANT cette migration n'ont pas de grappe. On ne les
-- convertit pas : un jeu se reconstruit (`POST /api/zones/jeux`), et inventer
-- un rattachement rétroactif donnerait des grappes que personne n'a calculées.
delete from public.zone_set_cp where cluster_id is null;

alter table public.zone_set_cp
  alter column cluster_id set not null;

alter table public.zone_set_cp drop constraint if exists zone_set_cp_pkey;
alter table public.zone_set_cp
  add constraint zone_set_cp_pkey primary key (zone_set_id, code_postal, cluster_id);

create index if not exists idx_zone_set_cp_cluster
  on public.zone_set_cp (cluster_id);


-- ── Le seuil, rejoué sur le CODE POSTAL ─────────────────────────────────────

create or replace function public.appliquer_seuil_zone_set(
  p_zone_set_id uuid,
  p_seuil       numeric
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_t0      timestamptz := clock_timestamp();
  v_pop_zone numeric;
  v_pop_cp   numeric;
  v_retenus  int;
begin
  if not exists (select 1 from public.zone_sets where id = p_zone_set_id) then
    return jsonb_build_object('error', 'jeu_introuvable', 'ok', false);
  end if;

  -- ⚠ Le seuil porte sur la SOMME des lignes du code postal, pas sur chacune.
  -- Un CP exposé à 12 % par une grappe et 15 % par une autre est exposé à 27 %.
  -- La version précédente testait `part_en_zone >= p_seuil` ligne à ligne :
  -- correcte tant qu'un CP n'avait qu'une ligne, fausse dès la Phase 2.
  update public.zone_set_cp z
     set retenu = t.part_cp >= p_seuil
    from (
      select code_postal, sum(part_en_zone) as part_cp
        from public.zone_set_cp
       where zone_set_id = p_zone_set_id
       group by code_postal
    ) t
   where z.zone_set_id = p_zone_set_id and z.code_postal = t.code_postal;

  -- ⚠ `pop_totale` est une propriété du CODE POSTAL, répétée sur ses lignes :
  -- on déduplique AVANT de sommer, sinon un CP dans trois grappes pèse trois
  -- fois ce qu'on « achète » et le taux d'utile s'effondre sans raison.
  select coalesce(sum(pop_en_zone) filter (where retenu), 0),
         coalesce((select sum(pop_totale) from (
            select distinct on (code_postal) code_postal, pop_totale
              from public.zone_set_cp
             where zone_set_id = p_zone_set_id and retenu
          ) u), 0),
         count(distinct code_postal) filter (where retenu)
    into v_pop_zone, v_pop_cp, v_retenus
    from public.zone_set_cp where zone_set_id = p_zone_set_id;

  update public.zone_sets
     set seuil_couverture_cp = p_seuil,
         n_cp_retenus        = v_retenus,
         population_exposee  = v_pop_zone,
         -- `nullif` et non `coalesce(…, 0)` : 0 % se lit « on achète tout pour
         -- ne viser personne », NULL se lit « aucun code postal retenu ».
         taux_utile          = round(v_pop_zone / nullif(v_pop_cp, 0) * 100, 1)
   where id = p_zone_set_id;

  return jsonb_build_object(
    'ok', true,
    'seuil', p_seuil,
    'n_cp_retenus', v_retenus,
    'population_exposee', v_pop_zone,
    'taux_utile', round(v_pop_zone / nullif(v_pop_cp, 0) * 100, 1),
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;
$fn$;

comment on function public.appliquer_seuil_zone_set is
  'Rejoue le seuil de couverture SANS reconstruire. ⚠ Le seuil porte sur la '
  'SOMME des lignes du code postal (sql/225) : ligne a ligne, un CP expose par '
  'deux grappes serait ecarte deux fois alors que son exposition cumulee le '
  'retient. Et `pop_totale` est dedupliquee avant toute somme — elle est '
  'repetee sur chaque ligne du meme CP.';

revoke all on function public.appliquer_seuil_zone_set(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.appliquer_seuil_zone_set(uuid, numeric) to service_role;


-- ── La construction des lignes, grappe par grappe ───────────────────────────

create or replace function public.remplir_zone_set_cp(
  p_zone_set_id uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_t0   timestamptz := clock_timestamp();
  v_jeu  record;
  v_haut int[];
  v_bas  int[];
  v_n    int;
begin
  set local statement_timeout = '10min';
  set local work_mem = '64MB';

  select zs.* into v_jeu from public.zone_sets zs where zs.id = p_zone_set_id;
  if not found then
    return jsonb_build_object('error', 'jeu_introuvable', 'ok', false);
  end if;

  if not exists (select 1 from public.zone_set_clusters where zone_set_id = p_zone_set_id) then
    -- Les grappes sont le PRÉALABLE : sans elles, aucune ligne ne peut dire de
    -- quel bassin elle parle.
    return jsonb_build_object('error', 'grappes_absentes', 'ok', false);
  end if;

  select coalesce(array_agg(x::int order by x::int), '{}')
    into v_haut from jsonb_array_elements_text(coalesce(v_jeu.profil->'haut','[]'::jsonb)) x;
  if coalesce((v_jeu.profil->>'lie')::boolean, false) then
    v_bas := v_haut;
  else
    select coalesce(array_agg(x::int order by x::int), '{}')
      into v_bas from jsonb_array_elements_text(coalesce(v_jeu.profil->'bas','[]'::jsonb)) x;
  end if;

  delete from public.zone_set_cp where zone_set_id = p_zone_set_id;

  -- ⚠ LE FILTRE AVANT LA JOINTURE, et ce n'est pas un détail de style.
  -- `carreaux_filosofi` pèse 4,6 Go et 806 octets de jsonb par ligne : joindre
  -- les 883 451 carreaux à portée pour n'en garder que 215 646 fait lire
  -- quatre fois trop de jsonb. `as materialized` force cet ordre — sans lui,
  -- le planificateur est libre de joindre d'abord.
  with retenus as materialized (
    -- La retenue vient de `classe_carreau_risque` (sql/204), la règle unique du
    -- module, et JAMAIS d'un test géométrique — voir sql/224 pour les trois
    -- mesures qui l'ont établi. Elle ne lit QUE la table des distances.
    select d.carreau_id, d.code_postal,
           public.classe_carreau_risque(
             d.d_haut_m, d.d_bas_m, d.pprt_niveau, v_haut, v_bas,
             coalesce((v_jeu.profil->>'inclurePPRT')::boolean, true)) as classe
      from public.carreau_risque_distance d
     where d.code_postal is not null and d.code_postal <> ''
       and (v_jeu.territoire is null or d.code_departement = v_jeu.territoire)
  ),
  rattaches as (
    -- Le bassin du SITE LE PLUS PROCHE. Un site est un point : le KNN est
    -- trivial, là où le même rattachement sur les polygones des grappes
    -- coûtait 508 s à froid.
    select r.code_postal, r.classe,
           coalesce((c.metadata->>v_jeu.cible)::numeric, 0) as pop,
           (select s.cluster_id from public.zone_set_cluster_sites s
              join public.zone_set_clusters k on k.id = s.cluster_id
             where k.zone_set_id = p_zone_set_id
             order by s.geom_3857 <-> ST_Centroid(c.geom_3857) limit 1) as cluster_id
      from retenus r
      join public.carreaux_filosofi c on c.id = r.carreau_id
     where r.classe <> 'hors'
  ),
  par_grappe_classe as (
    select code_postal, cluster_id, classe, sum(pop) as pop
      from rattaches where cluster_id is not null
     group by 1, 2, 3
  ),
  -- La classe DOMINANTE de la ligne : celle qui porte le plus de population
  -- DANS CETTE GRAPPE. Un code postal peut donc être « haut:1 » pour un bassin
  -- et « bas:2 » pour un autre — ce que la version à une ligne ne pouvait pas
  -- exprimer.
  dominante as (
    select distinct on (code_postal, cluster_id) code_postal, cluster_id, classe
      from par_grappe_classe
     order by code_postal, cluster_id, pop desc
  ),
  par_grappe as (
    select code_postal, cluster_id, sum(pop) as pop_en_zone
      from par_grappe_classe group by 1, 2
  ),
  -- Le total du CODE POSTAL, toutes grappes confondues : c'est lui qui décide
  -- de la rétention (voir l'en-tête, piège c).
  par_cp as (
    select code_postal, sum(pop_en_zone) as pop_cp from par_grappe group by 1
  )
  insert into public.zone_set_cp
    (zone_set_id, code_postal, cluster_id, classe,
     pop_en_zone, pop_totale, part_en_zone, retenu, poids)
  select p_zone_set_id,
         g.code_postal,
         g.cluster_id,
         d.classe,
         round(g.pop_en_zone),
         round(t.pop_totale),
         -- Part de CETTE grappe dans le code postal. La somme des lignes d'un
         -- CP redonne sa part totale : c'est ce qui rend le prorata lisible.
         round(least(100, g.pop_en_zone / nullif(t.pop_totale, 0) * 100), 2),
         least(100, c.pop_cp / nullif(t.pop_totale, 0) * 100) >= v_jeu.seuil_couverture_cp,
         -- Poids du plan : population exposée × poids de la classe. JAMAIS la
         -- population totale du code postal — c'est le principe du chantier.
         round(g.pop_en_zone * coalesce((v_jeu.poids->>d.classe)::numeric, 1), 2)
    from par_grappe g
    join dominante d on d.code_postal = g.code_postal and d.cluster_id = g.cluster_id
    join par_cp   c on c.code_postal = g.code_postal
    -- ⚠ `cp_population_totale` (sql/207) et NON `carreaux_cp_population`, qui
    -- surcompte de 10,5 %. Numérateur et dénominateur doivent rattacher le
    -- carreau au MÊME code postal.
    join lateral (
      select coalesce((cpt.populations->>v_jeu.cible)::numeric, 0) as pop_totale
        from public.cp_population_totale cpt where cpt.code_postal = g.code_postal
    ) t on true
   where t.pop_totale > 0;
  get diagnostics v_n = row_count;

  -- La population de chaque grappe se déduit des lignes qu'on vient d'écrire :
  -- une seule passe sur les carreaux, pas deux.
  update public.zone_set_clusters k
     set pop_exposee = s.pop
    from (select cluster_id, sum(pop_en_zone)::bigint as pop
            from public.zone_set_cp where zone_set_id = p_zone_set_id
           group by cluster_id) s
   where k.id = s.cluster_id;

  return jsonb_build_object('ok', true, 'n_lignes', v_n,
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000))
    || public.appliquer_seuil_zone_set(p_zone_set_id, v_jeu.seuil_couverture_cp);
end;
$fn$;

comment on function public.remplir_zone_set_cp is
  'Ecrit les lignes (code postal x grappe) d''un jeu de zones : UNE LIGNE PAR '
  'GRAPPE, au prorata de la population exposee dans chacune. Le seuil de '
  'retention est decide sur la SOMME du code postal, jamais ligne a ligne. '
  'sql/225.';

revoke all on function public.remplir_zone_set_cp(uuid) from public, anon, authenticated;
grant execute on function public.remplir_zone_set_cp(uuid) to service_role;


-- ── sql/224 corrigee : les sites en table, la population ailleurs ──────────

create or replace function public.construire_zone_set_clusters(
  p_zone_set_id uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_t0        timestamptz := clock_timestamp();
  v_profil    jsonb;
  v_natures   text[];
  v_gravites  text[];
  v_lie       boolean;
  v_haut      int[];
  v_bas       int[];
  v_ords      int[];
  v_filtre    boolean;
  v_noms      jsonb;
  v_n         int;
  v_pop       bigint;
begin
  -- Une construction, pas une lecture d'écran.
  set local statement_timeout = '10min';
  set local work_mem = '64MB';

  select zs.profil, zs.natures, zs.gravites
    into v_profil, v_natures, v_gravites
    from public.zone_sets zs where zs.id = p_zone_set_id;

  if v_profil is null then
    return jsonb_build_object('error', 'jeu_introuvable', 'ok', false);
  end if;

  -- Mêmes clés de profil que sql/220 : `haut`, `bas`, `lie`.
  v_lie := coalesce((v_profil->>'lie')::boolean, false);
  select coalesce(array_agg(x::int order by x::int), '{}')
    into v_haut from jsonb_array_elements_text(coalesce(v_profil->'haut','[]'::jsonb)) x;
  if v_lie then
    v_bas := v_haut;
  else
    select coalesce(array_agg(x::int order by x::int), '{}')
      into v_bas from jsonb_array_elements_text(coalesce(v_profil->'bas','[]'::jsonb)) x;
  end if;

  -- Filtre de nature : MÊME résolution que sql/218-220. Un libellé inconnu est
  -- REFUSÉ et jamais replié sur le seau « non précisée ».
  if v_natures is not null and array_length(v_natures, 1) is not null then
    if array_length(public.natures_inconnues(v_natures), 1) is not null then
      return jsonb_build_object(
        'error', 'natures_inconnues', 'ok', false,
        'natures', public.natures_inconnues(v_natures));
    end if;
    select array_agg(public.ordinal_nature(n)) into v_ords from unnest(v_natures) n;
  end if;
  v_filtre := v_ords is not null and array_length(v_ords, 1) is not null;

  -- On reconstruit : les grappes d'un jeu sont entièrement dérivées de son
  -- profil. Les noms saisis à la main sont récupérés juste après.
  select coalesce(jsonb_object_agg(rang::text, nom), '{}'::jsonb)
    into v_noms from public.zone_set_clusters
   where zone_set_id = p_zone_set_id and nom_auto = false;

  delete from public.zone_set_clusters where zone_set_id = p_zone_set_id;

  with sites as (
    -- Le prédicat de sql/220, à l'identique. Le rayon retenu est l'anneau
    -- EXTÉRIEUR du niveau : c'est lui qui décide si deux zones se touchent.
    select p.id, p.nom, p.ville, p.lng, p.lat,
           case when p.sous_categorie = 'seveso_haut' then 'haut' else 'bas' end as niveau,
           case when p.sous_categorie = 'seveso_haut'
                then v_haut[array_length(v_haut, 1)]
                else v_bas[array_length(v_bas, 1)] end as rayon_m
      from public.poi_france p
     where p.categorie = 'risque_industriel'
       and p.sous_categorie = any(
             coalesce(nullif(v_gravites, '{}'), array['seveso_haut','seveso_bas']))
       and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
       and p.lng is not null and p.lat is not null
       and (not v_filtre
            or public.ordinal_nature(
                 coalesce(nullif(p.metadata->>'libelle_nature',''), 'Nature non précisée')
               ) = any(v_ords))
  ),
  disques as (
    -- ⚠ `ST_Buffer` sur **geography** : le rayon est en mètres. En 4326,
    -- « 5 km » vaudrait 5 km en latitude et ~3,5 km en longitude à Marseille.
    -- Même raison que sql/155, sql/175 et sql/220.
    select s.*,
           ST_Transform(
             ST_Buffer(ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
                       s.rayon_m)::geometry, 3857) as g
      from sites s
     where s.rayon_m is not null and s.rayon_m > 0
  ),
  eclate as (
    -- `ST_ClusterIntersecting` est un AGRÉGAT : il rend un tableau de
    -- géométries, une par grappe. `unnest` les remet en lignes.
    --
    -- ⚠ Chaque élément est une `GeometryCollection` — la COLLECTION des disques
    -- membres, pas leur union. `ST_UnaryUnion` les fond en un seul polygone :
    -- sans lui, l'insertion échoue (« Geometry type GeometryCollection does not
    -- match column type MultiPolygon ») et, si la colonne l'acceptait, la carte
    -- afficherait quarante disques superposés au lieu d'un bassin.
    select ST_Multi(ST_UnaryUnion(brut)) as geom_3857,
           row_number() over (order by ST_Area(brut) desc) as rang
      from (select unnest(ST_ClusterIntersecting(g)) as brut from disques) u
  ),
  ins as (
  insert into public.zone_set_clusters
    (zone_set_id, rang, nom, nom_auto, niveau_dominant, n_sites, geom, geom_3857)
  select
    p_zone_set_id,
    e.rang,
    coalesce(
      v_noms->>e.rang::text,
      -- Nom automatique : la commune du site le plus « central » de la grappe,
      -- c'est-a-dire celle qui revient le plus souvent. Un bassin porte le nom
      -- de la commune qui en concentre les installations.
      (select d.ville from disques d
        where ST_Intersects(d.g, e.geom_3857)
        group by d.ville order by count(*) desc, d.ville limit 1),
      'Grappe ' || e.rang
    ),
    v_noms ? e.rang::text is not true,
    -- 'haut' dès qu'un site du seuil haut est dedans : même priorité que
    -- partout ailleurs dans ce module.
    case when exists (select 1 from disques d
                       where d.niveau = 'haut' and ST_Intersects(d.g, e.geom_3857))
         then 'haut' else 'bas' end,
    (select count(*) from disques d where ST_Intersects(d.g, e.geom_3857)),
    ST_Multi(ST_Transform(e.geom_3857, 4326)),
    e.geom_3857
  from eclate e
  returning id, geom_3857
  )
  -- ⚠ Les sites sont insérés DANS LA MÊME instruction, par une CTE
  -- modifiante : `disques` n'existe qu'ici, et le recalculer dans un second
  -- ordre donnerait deux versions du prédicat de sélection — exactement ce
  -- que ce fichier s'interdit trois paragraphes plus haut.
  insert into public.zone_set_cluster_sites (cluster_id, site_id, geom_3857)
  select i.id, d.id,
         ST_Transform(ST_SetSRID(ST_MakePoint(d.lng, d.lat), 4326), 3857)
    from ins i join disques d on ST_Intersects(d.g, i.geom_3857);

  select count(*) into v_n from public.zone_set_clusters where zone_set_id = p_zone_set_id;

  -- ⚠ LA POPULATION N'EST PLUS CALCULÉE ICI. sql/224 la calculait par un KNN
  -- sur les POLYGONES des grappes : 508 s à froid, contre 9,8 s à chaud — la
  -- mesure à chaud avait été documentée comme si elle était le coût. Elle est
  -- désormais remplie par `remplir_zone_set_cp` (sql/225), qui parcourt les
  -- carreaux UNE fois pour les codes postaux ET les grappes.
  return jsonb_build_object(
    'ok', true,
    'zone_set_id', p_zone_set_id,
    'n_clusters', v_n,
    'n_sites', (select count(*) from public.zone_set_cluster_sites s
                 join public.zone_set_clusters k on k.id = s.cluster_id
                where k.zone_set_id = p_zone_set_id),
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;
$fn$;

revoke all on function public.construire_zone_set_clusters(uuid)
  from public, anon, authenticated;
grant execute on function public.construire_zone_set_clusters(uuid) to service_role;
