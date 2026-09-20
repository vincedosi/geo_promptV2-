-- sql/218 — La NATURE du risque, dimension manquante du pré-calcul
--           (2026-09-20)
--
-- ── LE DÉFAUT, ET IL EST PIRE QUE CE QU'ON CROYAIT ───────────────────────
--
-- `construire_zone_set` REFUSE un jeu portant un filtre de nature
-- (`filtre_nature_non_supporte`, sql/211), parce que `carreau_risque_distance`
-- a été bâtie sur un prédicat FIXE : tous les sites Seveso, toutes natures
-- confondues. Chaque carreau n'y porte que `d_haut_m` / `d_bas_m`.
--
-- Ce refus était honnête. Mais en cherchant à le lever, on a trouvé le vrai
-- problème : **`population_par_classe` IGNORE le filtre en silence.** Sa
-- signature ne porte pas de natures du tout, et la route des bandes ne lui en
-- passe aucune.
--
-- Or le filtre est dans la barre COMMUNE aux trois onglets. Sur l'onglet
-- Rayons, décocher une nature change la courbe — `couverture_rayon_risque`
-- porte la dimension (sql/198) — et ne change pas le tableau juste au-dessus.
-- Deux chiffres sur le même écran, l'un filtré, l'autre non, et rien pour le
-- dire.
--
-- ── LA NATURE RETENUE EST LA DOMINANTE, UNE PAR SITE ─────────────────────
--
-- `metadata->>'libelle_nature'`, exactement comme `couverture_rayon_risque`
-- (sql/198). Un site porte en moyenne **4,49 natures** dans
-- `natures_risque[]` ; en retenir plusieurs ferait compter le même site dans
-- plusieurs familles et les totaux cesseraient d'être comparables entre les
-- deux écrans. Une seule convention, déjà posée, qu'on suit.
--
-- ── POURQUOI UNE TABLE FILLE, ET PAS DES COLONNES ────────────────────────
--
-- Mesure du 2026-09-20 sur le Rhône, 3 000 carreaux : un carreau est proche de
-- **3,81 natures en moyenne, 6 au maximum** — jamais 15. Quinze colonnes (ou
-- un tableau de quinze) gaspilleraient 60 % de leur place, et il en faudrait
-- deux jeux, un par niveau Seveso.
--
-- ⚠ **`carreau_risque_distance` n'est PAS remplacée.** Elle reste le chemin
-- rapide du cas par défaut — aucun filtre de nature — qui est aussi le plus
-- fréquent. Cette table fille n'est jointe QUE lorsqu'un filtre est actif :
-- personne ne paie pour une dimension qu'il n'utilise pas.
--
-- ── L'ORDINAL PLUTÔT QUE LE LIBELLÉ ──────────────────────────────────────
--
-- 883 451 carreaux × 3,81 natures ≈ **3,4 M de lignes**. Y stocker le libellé
-- (25 caractères en moyenne) coûterait ~85 Mo de chaînes répétées, contre
-- 7 Mo en `smallint`. Les RPC continuent de prendre des LIBELLÉS en argument,
-- comme leurs sœurs, et les résolvent une fois.
--
-- `rang_gravite` d'`icpe_rubrique_familles` est UNIQUE sur les 15 familles :
-- c'est un ordinal stable, déjà en base, qu'on n'a pas à inventer.

create table if not exists public.carreau_risque_nature (
  carreau_id  bigint   not null,
  /**
   * `icpe_rubrique_familles.rang_gravite`, ou 0 pour « Nature non précisée ».
   *
   * ⚠ Ce n'est PAS une échelle de danger — le commentaire d'origine de la
   * table le dit déjà : `rang_gravite` ne sert qu'à départager la nature
   * dominante d'un site qui en porte plusieurs. On s'en sert ici comme d'une
   * CLÉ, pas comme d'un ordre.
   */
  nature_ord  smallint not null,
  /** Distance au site SEVESO HAUT de cette nature le plus proche, en mètres. */
  d_haut_m    integer,
  /** Idem au seuil bas. */
  d_bas_m     integer,
  primary key (carreau_id, nature_ord)
);

comment on table public.carreau_risque_nature is
  'Distance d''un carreau aux sites a risque PAR NATURE dominante. Table FILLE de '
  'carreau_risque_distance, jointe UNIQUEMENT quand un filtre de nature est actif : '
  'le cas par defaut (toutes natures) reste servi par la table mere, sans surcout. '
  'Mesure : un carreau est proche de 3,81 natures en moyenne, 6 au maximum.';

-- Un filtre porte sur quelques natures : l'index les trouve sans balayer.
create index if not exists idx_crn_nature on public.carreau_risque_nature (nature_ord);

alter table public.carreau_risque_nature enable row level security;

create table if not exists public.carreau_risque_nature_bandes (
  bande        int primary key,
  lon_min      numeric,
  lon_max      numeric,
  n_lignes     bigint,
  duree_ms     int,
  construit_le timestamptz not null default now()
);

alter table public.carreau_risque_nature_bandes enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- L'ORDINAL D'UNE NATURE
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.ordinal_nature(p_libelle text)
returns smallint
language sql stable security definer set search_path to 'public' as $fn$
  /*
   * `coalesce(..., 0)` : une nature absente du registre vaut « non précisée »
   * et garde donc une ligne. La faire disparaître ferait un carreau sans
   * aucune nature, indiscernable d'un carreau hors de portée.
   */
  select coalesce(
    (select f.rang_gravite::smallint
       from public.icpe_rubrique_familles f
      where f.libelle = p_libelle
      limit 1),
    0::smallint);
$fn$;

comment on function public.ordinal_nature is
  'Cle stable d''une nature de risque, depuis icpe_rubrique_familles.rang_gravite. '
  '0 = nature non precisee — une nature inconnue garde sa ligne, la faire '
  'disparaitre rendrait le carreau indiscernable d''un carreau hors de portee.';

revoke all on function public.ordinal_nature(text) from public, anon, authenticated;
grant execute on function public.ordinal_nature(text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- LA CONSTRUCTION, PAR BANDE DE LONGITUDE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Le découpage est celui de `construire_carreau_risque_distance` (sql/203),
-- repris à l'identique — bornes paramétrables comprises. ⚠ Ce piège a déjà
-- coûté DEUX fois : la première construction n'a couvert que -5,5 à 9,8, et la
-- Martinique comme La Réunion manquaient, sans le moindre message. L'outre-mer
-- se construit par des appels SÉPARÉS, clés de journal >= 1000.

create or replace function public.construire_carreau_risque_nature(
  p_bande        integer,
  p_n_bandes     integer default 20,
  p_rayon_max_m  integer default 10000,
  p_lon_ouest    numeric default -5.5,
  p_lon_est      numeric default 9.8,
  p_bande_id     integer default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_lon_min numeric;
  v_lon_max numeric;
  v_t0      timestamptz := clock_timestamp();
  v_x_min   double precision;
  v_x_max   double precision;
  v_lignes  bigint;
  v_id      int;
begin
  -- Mêmes réglages que sql/203, et pour les mêmes raisons mesurées : le
  -- `group by` déborde sur disque sous le `work_mem` du palier, et le délai du
  -- rôle PostgREST ANNULERAIT les bandes denses.
  set local work_mem = '64MB';
  set local statement_timeout = '30min';

  if p_bande < 0 or p_bande >= p_n_bandes then
    return jsonb_build_object('error', 'bande_hors_bornes', 'ok', false);
  end if;

  v_lon_min := p_lon_ouest + (p_lon_est - p_lon_ouest) * p_bande     / p_n_bandes;
  v_lon_max := p_lon_ouest + (p_lon_est - p_lon_ouest) * (p_bande+1) / p_n_bandes;
  v_id      := coalesce(p_bande_id, p_bande);

  v_x_min := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_min, 0), 4326), 3857));
  v_x_max := ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(v_lon_max, 0), 4326), 3857));

  with
  sites as (
    select p.sous_categorie as gravite,
           public.ordinal_nature(
             coalesce(nullif(p.metadata->>'libelle_nature', ''), 'Nature non précisée')
           ) as nature_ord,
           ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography as g,
           ST_Transform(
             ST_Buffer(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                       p_rayon_max_m, 'quad_segs=4')::geometry, 3857) as z
      from public.poi_france p
     where p.categorie = 'risque_industriel'
       and p.sous_categorie in ('seveso_haut', 'seveso_bas')
       and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
       and p.lng is not null and p.lat is not null
       -- ⚠ LES SITES AUSSI sont filtrés par la bande : sans ce prédicat chaque
       -- bande parcourt les 1 259 sites de France pour n'en utiliser qu'une
       -- poignée. Marge de 0,15° ~ 11 km, donc plus que le rayon maximal.
       and p.lng >= v_lon_min - 0.15
       and p.lng <  v_lon_max + 0.15
  ),
  -- Le SEUL écart avec sql/203 : le `group by` porte aussi sur la nature.
  -- Toute la géométrie est identique, donc les deux tables ne peuvent pas
  -- diverger sur ce qui est à portée.
  distances as (
    select c.id as carreau,
           s.gravite,
           s.nature_ord,
           min(ST_Distance(ST_Transform(ST_Centroid(c.geom_3857), 4326)::geography, s.g)) as d
      from sites s
      join public.carreaux_filosofi c
        on c.geom_3857 && s.z
       and ST_Intersects(c.geom_3857, s.z)
     where ST_X(ST_Centroid(c.geom_3857)) >= v_x_min
       and ST_X(ST_Centroid(c.geom_3857)) <  v_x_max
     group by c.id, s.gravite, s.nature_ord
  ),
  jointes as (
    select carreau,
           nature_ord,
           min(d) filter (where gravite = 'seveso_haut') as d_haut,
           min(d) filter (where gravite = 'seveso_bas')  as d_bas
      from distances
     group by carreau, nature_ord
  ),
  -- Les carreaux couverts par un périmètre PPRT, PAR NATURE de générateur.
  -- Même règle que sql/203 — le seuil haut l'emporte quand deux périmètres se
  -- recouvrent — mais déclinée par nature : sans cela, filtrer « Explosibles »
  -- laisserait à l'écran les périmètres opposables d'un site chimique.
  couverts as (
    select c.id as carreau,
           pn.nature_ord,
           min(case when pn.niveau = 'haut' then 1 else 2 end) as rang
      from public.pprt_niveau_generateur pn
      join public.carreaux_filosofi c
        on c.geom_3857 && pn.geom_3857
       and ST_Intersects(c.geom_3857, pn.geom_3857)
     where pn.niveau is not null
       and pn.nature_ord is not null
       and ST_X(ST_Centroid(c.geom_3857)) >= v_x_min
       and ST_X(ST_Centroid(c.geom_3857)) <  v_x_max
     group by c.id, pn.nature_ord
  ),
  -- `full join` et non `left` : un carreau peut être DANS un périmètre tout en
  -- étant à plus de 10 km de son générateur — les plus grandes servitudes
  -- mesurées atteignent 12,3 km de rayon équivalent (sql/185). Le perdre
  -- effacerait une zone OPPOSABLE de la carte. Même raisonnement que sql/203.
  assemble as (
    select coalesce(j.carreau, cv.carreau)       as carreau,
           coalesce(j.nature_ord, cv.nature_ord) as nature_ord,
           j.d_haut, j.d_bas,
           case cv.rang when 1 then 'haut' when 2 then 'bas' else null end as pprt_niveau
      from jointes j
      full join couverts cv
        on cv.carreau = j.carreau and cv.nature_ord = j.nature_ord
  )
  insert into public.carreau_risque_nature
    (carreau_id, nature_ord, d_haut_m, d_bas_m, pprt_niveau)
  select a.carreau, a.nature_ord,
         round(a.d_haut)::int, round(a.d_bas)::int, a.pprt_niveau
    from assemble a
  on conflict (carreau_id, nature_ord) do update
     set d_haut_m    = excluded.d_haut_m,
         d_bas_m     = excluded.d_bas_m,
         pprt_niveau = excluded.pprt_niveau;

  get diagnostics v_lignes = row_count;

  insert into public.carreau_risque_nature_bandes
    (bande, lon_min, lon_max, n_lignes, duree_ms, construit_le)
  values (v_id, v_lon_min, v_lon_max, v_lignes,
          extract(milliseconds from clock_timestamp() - v_t0)::int, now())
  on conflict (bande) do update
     set lon_min = excluded.lon_min, lon_max = excluded.lon_max,
         n_lignes = excluded.n_lignes, duree_ms = excluded.duree_ms,
         construit_le = excluded.construit_le;

  return jsonb_build_object(
    'ok', true, 'bande', v_id, 'lignes', v_lignes,
    'lon_min', v_lon_min, 'lon_max', v_lon_max,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$fn$;

comment on function public.construire_carreau_risque_nature is
  'Construit UNE bande de longitude de carreau_risque_nature. Meme decoupage et '
  'meme geometrie que construire_carreau_risque_distance (sql/203) : le SEUL ecart '
  'est le group by, qui porte aussi sur la nature. Les deux tables ne peuvent donc '
  'pas diverger sur ce qui est a portee. ⚠ Bornes METROPOLE par defaut : l''outre-mer '
  'se construit par des appels SEPARES, cles de journal >= 1000.';

revoke all on function public.construire_carreau_risque_nature(int, int, int, numeric, numeric, int)
  from public, anon, authenticated;
grant execute on function public.construire_carreau_risque_nature(int, int, int, numeric, numeric, int)
  to service_role;

create or replace function public.vider_carreau_risque_nature()
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare v_n bigint;
begin
  select count(*) into v_n from public.carreau_risque_nature;
  truncate public.carreau_risque_nature;
  delete from public.carreau_risque_nature_bandes;
  return jsonb_build_object('ok', true, 'lignes_supprimees', v_n);
end;
$fn$;

comment on function public.vider_carreau_risque_nature is
  'Vidange complete. A rejouer apres un rechargement de carreaux_filosofi — les id '
  'sont des bigint de sequence et ne survivent pas au rechargement — ou apres un '
  'import de sites qui changerait les natures dominantes.';

revoke all on function public.vider_carreau_risque_nature() from public, anon, authenticated;
grant execute on function public.vider_carreau_risque_nature() to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- LE PPRT AUSSI SE FILTRE PAR NATURE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ Sans cela, filtrer « Explosibles » laisserait à l'écran les périmètres
-- opposables d'un site CHIMIQUE : une réponse fausse, présentée comme filtrée.
-- Et c'est la classe qui compte le plus — la seule publiée par l'État.
--
-- Le générateur d'un périmètre est déjà identifié par
-- `remplir_pprt_niveau_generateur` (sql/203) : le site Seveso le plus proche à
-- 500 m, le seuil haut l'emportant à distance égale. On lui prend sa nature
-- dominante par la MÊME règle, sans en inventer une seconde.

alter table public.pprt_niveau_generateur
  add column if not exists nature_ord smallint;

comment on column public.pprt_niveau_generateur.nature_ord is
  'Nature dominante du site GENERATEUR, par la meme regle que `niveau` : le site '
  'Seveso le plus proche a 500 m. NULL quand aucun site actif n''est assez proche '
  '— 132 perimetres sur 664, le generateur ayant pu cesser son activite.';

create or replace function public.remplir_pprt_nature_generateur()
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare v_n int; v_rattaches int;
begin
  set local statement_timeout = '10min';

  update public.pprt_niveau_generateur g
     set nature_ord = (
       select public.ordinal_nature(
                coalesce(nullif(p.metadata->>'libelle_nature', ''), 'Nature non précisée'))
         from public.poi_france p
         join public.pprt_perimetres pp on pp.id = g.pprt_id
        where p.categorie = 'risque_industriel'
          and p.sous_categorie in ('seveso_haut', 'seveso_bas')
          and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
          and p.lng is not null and p.lat is not null
          and ST_DWithin(
                ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                pp.geom::geography, 500)
        -- ⚠ MÊME ordre que `remplir_pprt_niveau_generateur` : le seuil haut
        -- d'abord, puis la distance. Un autre ordre rattacherait le niveau à un
        -- site et la nature à un autre, sur le même périmètre.
        order by (p.sous_categorie = 'seveso_bas'),
                 ST_Distance(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                             pp.geom::geography)
        limit 1);

  get diagnostics v_n = row_count;
  select count(*) into v_rattaches
    from public.pprt_niveau_generateur where nature_ord is not null;

  return jsonb_build_object('ok', true, 'lignes', v_n, 'rattaches', v_rattaches);
end;
$fn$;

comment on function public.remplir_pprt_nature_generateur is
  'Rattache a chaque perimetre PPRT la nature dominante de son site generateur, par '
  'la MEME regle que remplir_pprt_niveau_generateur. A rejouer apres tout import de '
  'sites ou de perimetres.';

revoke all on function public.remplir_pprt_nature_generateur() from public, anon, authenticated;
grant execute on function public.remplir_pprt_nature_generateur() to service_role;

-- Le PPRT rejoint la table fille : un carreau peut être couvert par un
-- périmètre dont le générateur est d'une nature, et hors des anneaux d'une
-- autre. Les deux informations doivent voyager ensemble.
alter table public.carreau_risque_nature
  add column if not exists pprt_niveau text;

comment on column public.carreau_risque_nature.pprt_niveau is
  'Niveau du perimetre PPRT couvrant ce carreau, POUR CETTE NATURE de generateur. '
  'Distinct de carreau_risque_distance.pprt_niveau, qui ignore la nature : sans lui, '
  'filtrer une nature laisserait a l''ecran les perimetres opposables des autres.';


-- ─────────────────────────────────────────────────────────────────────────
-- Le pendant de `ordinal_nature` pour le FILTRAGE
-- ─────────────────────────────────────────────────────────────────────────
--
-- ⚠ `ordinal_nature` replie sur 0 tout libellé absent du registre, et c'est
-- CORRECT à la construction : un site dont la nature n'est pas répertoriée
-- garde une ligne, sous « Nature non précisée ». Le faire disparaître rendrait
-- un carreau sans aucune nature, indiscernable d'un carreau hors de portée.
--
-- Au FILTRAGE, le même repli ment. Mesuré le 2026-09-20 : demander
-- « GPL et produits petroliers » (sans accent) rendait **136 277 habitants**
-- au lieu de 7 753 811 — le seau des natures non précisées, servi sous le nom
-- d'une autre. Un chiffre plausible, d'une question que personne n'a posée.
--
-- Les deux gestes ont donc deux fonctions. Celle-ci ne replie pas : elle NOMME
-- ce qu'elle n'a pas reconnu, et l'appelant refuse de calculer.
create or replace function public.natures_inconnues(p_libelles text[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array_agg(l)
    from unnest(coalesce(p_libelles, '{}'::text[])) l
   where l is not null
     -- `Nature non précisée` est une valeur LÉGITIME du filtre — c'est le
     -- libellé que la construction pose sur les sites hors registre — et la
     -- seule qui n'ait pas de ligne dans `icpe_rubrique_familles`.
     and l <> 'Nature non précisée'
     and not exists (
       select 1 from public.icpe_rubrique_familles f where f.libelle = l
     );
$$;

comment on function public.natures_inconnues is
  'Rend les libelles de nature qu''on ne sait PAS resoudre, ou NULL si tous le sont. '
  'Pendant de ordinal_nature pour le filtrage : celle-la replie sur 0 (correct a la '
  'CONSTRUCTION, un site hors registre gardant une ligne), ce qui au FILTRAGE sert le '
  'seau « non precisee » sous le nom d''une autre nature — mesure, 136 277 habitants '
  'au lieu de 7 753 811 sur un accent manquant.';

revoke all on function public.natures_inconnues(text[]) from public, anon, authenticated;
grant execute on function public.natures_inconnues(text[]) to service_role;
