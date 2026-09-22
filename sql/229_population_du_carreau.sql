-- ============================================================================
-- sql/229 — la population du carreau à côté de sa distance
-- ============================================================================
--
-- CE QUE MESURE CETTE MIGRATION, ET POURQUOI ELLE EXISTE.
--
-- Lire les 882 404 lignes de `carreau_risque_distance` : **0,9 s**.
-- La même chose en joignant `carreaux_filosofi` pour en tirer la population :
-- **11,2 s**. La jointure EST le coût, à plus de 90 %.
--
-- Cette jointure est faite par le remplissage des codes postaux d'un jeu de
-- zones, à chaque construction. D'où un coût mesuré le 2026-09-22 entre
-- **12 s** (cache chaud) et **plus de 400 s** (cache froid) — sur le MÊME jeu,
-- à dix minutes d'intervalle. Kong coupant à 60 s, `POST /api/zones/jeux`
-- pouvait échouer sans que rien ne soit fautif.
--
-- La cause est physique : `carreaux_filosofi` pèse 4,6 Go et 811 octets de
-- jsonb par ligne (mesuré), contre 128 Mo de `shared_buffers` en local. On lit
-- 170 Mo de jsonb pour en extraire un nombre par carreau.
--
-- ── POURQUOI UN `real[]` ET NI 24 COLONNES NI DU JSONB ──────────────────────
--
-- Mesuré sur `carreaux_filosofi` : le `metadata` complet pèse **811 o**, un
-- jsonb réduit aux 24 cibles **596 o**, une cible seule en `real` **4 o**.
--
-- - **jsonb réduit** : 596 contre 811, on ne gagne rien. Écarté.
-- - **24 colonnes** : 96 o par ligne, excellent — mais la cible d'un jeu est
--   un paramètre (`zone_sets.cible`), donc la lire imposerait du SQL DYNAMIQUE
--   dans une fonction qui n'en contient pas une ligne, ou une cascade de 24
--   `case`. Écarté pour la lisibilité, pas pour la taille.
-- - **`real[]` de 24 valeurs** : ~116 o par ligne, ~100 Mo au total, et
--   l'accès reste `d.pops[rang]` — dynamique sans être dynamique.
--
-- ⚠ **LA POSITION DANS LE TABLEAU EST UNE DONNÉE, PAS UNE CONVENTION.**
-- `cibles_exposition.rang_pop` la porte, avec une contrainte d'unicité. Un
-- tableau positionnel dont l'ordre vit dans la tête de celui qui l'a écrit est
-- une bombe à retardement : il suffit qu'une cible soit ajoutée au milieu de
-- l'ordre alphabétique pour que tous les chiffres deviennent faux, en silence,
-- et qu'on lise des logements sociaux sous le nom d'une tranche d'âge. Ici une
-- cible nouvelle prend le rang suivant, et les rangs existants ne bougent pas.
--
-- ⚠ **Pas de repli sur `carreaux_filosofi` si le pré-calcul manque.** Deux
-- chemins pour la même donnée, c'est deux chemins qui divergent. La fonction
-- REFUSE avec `population_carreau_absente`, comme `couverture_carreau_risque`
-- refuse quand les distances manquent (sql/217), et `12-sante.sh` le vérifie.
-- ============================================================================

-- ── 1. Le rang de chaque cible dans le tableau ──────────────────────────────

alter table public.cibles_exposition
  add column if not exists rang_pop smallint;

update public.cibles_exposition c
   set rang_pop = r.rang
  from (select code, row_number() over (order by code)::smallint as rang
          from public.cibles_exposition) r
 where r.code = c.code and c.rang_pop is null;

create unique index if not exists idx_cibles_rang_pop
  on public.cibles_exposition (rang_pop);

comment on column public.cibles_exposition.rang_pop is
  'Position de cette cible dans carreau_risque_distance.pops (sql/229). '
  'IMMUABLE : une cible nouvelle prend le rang suivant, jamais une place au '
  'milieu — sinon tous les chiffres deja calcules designeraient une autre '
  'cible, en silence.';


-- ── 2. La population, à côté de la distance ─────────────────────────────────

alter table public.carreau_risque_distance
  add column if not exists pops real[];

-- ⚠⚠ `sum(pops[n])` MENT, ET IL FAUT CASTER LIGNE À LIGNE.
--
-- `sum()` sur du `real` s'accumule EN FLOTTANT 32 BITS, dont la mantisse ne
-- porte que 7 chiffres significatifs. Mesuré sur les 883 451 carreaux :
-- `sum(pops[n])` rend **41 083 500** là où la source en compte
-- **41 083 683** — 183 habitants évaporés dans l'arrondi de l'accumulateur.
--
-- Le STOCKAGE, lui, est exact : comparaison ligne à ligne contre
-- `carreaux_filosofi`, **zéro écart sur 883 451 carreaux**, y compris les
-- 238 011 valeurs demi-entières (`85.5`), qu'un flottant binaire représente
-- exactement. Le défaut n'est pas dans la donnée, il est dans l'addition.
--
-- Écrire `sum(pops[n]::numeric)`. C'est ce que fait `remplir_zone_set_cp`, et
-- c'est pour cela que ses totaux retombent sur ceux de l'ancienne jointure.
comment on column public.carreau_risque_distance.pops is
  'Population du carreau pour les 24 cibles, indexee par '
  'cibles_exposition.rang_pop (sql/229). Evite de joindre carreaux_filosofi '
  '(4,6 Go, 811 o de jsonb par ligne) a chaque construction d''un jeu de '
  'zones : 11,2 s de jointure mesures contre 0,9 s de lecture seule.';


-- ── 3. Le centroïde, pour que la jointure disparaisse VRAIMENT ──────────────
--
-- ⚠ Sans lui, le travail est à moitié fait et ça ne se verrait qu'à la mesure.
-- Le remplissage d'un jeu de zones a besoin de DEUX choses du carreau : sa
-- population (résolue ci-dessus) et sa POSITION, pour le rattacher au bassin
-- du site le plus proche. Garder la seconde dans `carreaux_filosofi` laissait
-- la jointure en place — et avec elle la lecture des 811 octets de jsonb par
-- ligne, c'est-à-dire exactement le coût qu'on vient de retirer.
--
-- ⚠ En **3857** et non en 4326 : c'est la projection de `geom_3857` des sites
-- et de l'index GIST de `zone_set_cluster_sites`. Stocker en 4326 imposerait
-- un `ST_Transform` par carreau à chaque construction, ou pire, un opérateur
-- `<->` entre deux projections — qui ne lève pas, et rend des distances
-- fausses.
alter table public.carreau_risque_distance
  add column if not exists centroide_3857 geometry(Point, 3857);

comment on column public.carreau_risque_distance.centroide_3857 is
  'Centroide du carreau en 3857 (sql/229), la projection des sites et de '
  'l''index GIST de zone_set_cluster_sites. Evite de joindre carreaux_filosofi '
  'pour la seule position du carreau.';

-- ⚠ PAS d'index GIST dessus : ces points ne sont jamais CHERCHES par la
-- geometrie, ils sont LUS en bloc puis compares aux sites, qui eux sont
-- indexes. Un GIST sur 883 451 points coûterait ~60 Mo et du temps a chaque
-- reconstruction, pour zero requete.

create or replace function public.remplir_population_carreau(
  p_lot integer default 200000
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_t0      timestamptz := clock_timestamp();
  v_codes   text[];
  v_faits   int;
  v_restant bigint;
begin
  set local statement_timeout = '30min';
  set local work_mem = '64MB';

  -- ⚠ L'ORDRE VIENT DE `rang_pop`, jamais du code. C'est toute la raison
  -- d'être de cette colonne : le tableau doit se lire de la même façon dans
  -- dix migrations.
  select array_agg(code order by rang_pop) into v_codes
    from public.cibles_exposition where rang_pop is not null;

  if v_codes is null then
    return jsonb_build_object('error', 'rangs_absents', 'ok', false);
  end if;

  -- Par LOTS et reprenable, comme `remplir_code_postal_carreau` : l'état EST
  -- la donnée (`pops is null` = reste à faire), donc pas de journal de bandes
  -- à tenir — ni à désynchroniser, défaut déjà payé le 2026-09-22 sur
  -- `couverture_rayon_bandes`.
  with a_faire as materialized (
    select d.carreau_id, c.metadata, ST_Centroid(c.geom_3857) as centroide
      from public.carreau_risque_distance d
      join public.carreaux_filosofi c on c.id = d.carreau_id
     where d.pops is null or d.centroide_3857 is null
     limit greatest(coalesce(p_lot, 200000), 1)
  )
  update public.carreau_risque_distance d
     -- `coalesce(..., 0)` : une cible absente du jsonb vaut zéro habitant, et
     -- non « inconnu ». Laisser un NULL dans le tableau ferait revenir le
     -- carreau à chaque lot, et le traitement ne finirait jamais.
     set pops = (
           select array_agg(coalesce((a.metadata->>code)::real, 0::real)
                            order by ord)
             from unnest(v_codes) with ordinality as t(code, ord)),
         centroide_3857 = a.centroide
    from a_faire a
   where d.carreau_id = a.carreau_id;
  get diagnostics v_faits = row_count;

  select count(*) into v_restant
    from public.carreau_risque_distance
   where pops is null or centroide_3857 is null;

  return jsonb_build_object(
    'ok', true, 'remplis', v_faits, 'restant', v_restant,
    'n_cibles', array_length(v_codes, 1),
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;
$fn$;

comment on function public.remplir_population_carreau is
  'Copie la population des 24 cibles depuis carreaux_filosofi vers '
  'carreau_risque_distance.pops, par lots reprenables. A rejouer apres toute '
  'reconstruction des distances. sql/229.';

revoke all on function public.remplir_population_carreau(integer) from public, anon, authenticated;
grant execute on function public.remplir_population_carreau(integer) to service_role;


create or replace function public.vider_population_carreau()
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
begin
  update public.carreau_risque_distance
     set pops = null, centroide_3857 = null
   where pops is not null or centroide_3857 is not null;
  return jsonb_build_object('ok', true);
end;
$fn$;

comment on function public.vider_population_carreau is
  'Remet pops a null pour tout reconstruire. A rejouer apres un rechargement '
  'de carreaux_filosofi : ses id sont des bigint de sequence et ne survivent '
  'pas au rechargement depuis le CSV INSEE. sql/229.';

revoke all on function public.vider_population_carreau() from public, anon, authenticated;
grant execute on function public.vider_population_carreau() to service_role;


-- ── 4. Le remplissage d'un jeu de zones ne joint plus carreaux_filosofi ─────

create or replace function public.remplir_zone_set_cp(
  p_zone_set_id uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$

declare
  v_t0   timestamptz := clock_timestamp();
  v_jeu  record;
  v_haut int[];
  v_bas  int[];
  v_n     int;
  v_seuil jsonb;
  v_rang  smallint;
  v_cp_sans_denom  int;
  v_pop_sans_denom numeric;
  v_ords      smallint[];
  v_filtre    boolean;
  v_inconnues text[];
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

  -- ── Le filtre de nature, honoré ICI AUSSI (sql/226) ─────────────────────
  --
  -- ⚠ sql/225 l'avait oublié : cette fonction lisait la table MÈRE sans
  -- condition, quand la géométrie et les grappes appliquent toutes deux le
  -- filtre. Le jeu aurait alors acheté des codes postaux que sa propre carte
  -- ne montre pas.
  --
  -- On REFUSE un libellé qu'on ne sait pas résoudre, on ne le replie pas :
  -- `ordinal_nature` rend 0 pour l'inconnu, ce qui est le seau des natures non
  -- précisées — correct à la construction, mensonger au filtrage. Mesuré le
  -- 2026-09-20 : un accent manquant sur « GPL et produits pétroliers » rendait
  -- 136 277 habitants au lieu de 7 753 811.
  if coalesce(array_length(v_jeu.natures, 1), 0) > 0 then
    v_inconnues := public.natures_inconnues(v_jeu.natures);
    if array_length(v_inconnues, 1) is not null then
      return jsonb_build_object(
        'error', 'natures_inconnues', 'ok', false, 'calculable', false,
        'natures_inconnues', to_jsonb(v_inconnues));
    end if;
    select array_agg(public.ordinal_nature(n)) into v_ords from unnest(v_jeu.natures) n;
  end if;
  v_filtre := v_ords is not null and array_length(v_ords, 1) is not null;

  -- ⚠ LE RANG DE LA CIBLE DANS `pops`, lu EN BASE et jamais supposé. Un
  -- tableau positionnel dont l'ordre serait une convention rendrait des
  -- logements sociaux sous le nom d'une tranche d'âge, sans erreur.
  select rang_pop into v_rang
    from public.cibles_exposition where code = v_jeu.cible;
  if v_rang is null then
    return jsonb_build_object('error', 'cible_inconnue', 'ok', false,
                              'cible', v_jeu.cible);
  end if;

  -- ⚠ On REFUSE, on ne replie PAS sur `carreaux_filosofi`. Deux chemins pour
  -- la même donnée, c'est deux chemins qui divergent — et le second serait le
  -- lent, donc celui qui ne se verrait qu'en production. `12-sante.sh`
  -- surveille cette colonne, `11-reconstruire.sh` la remplit.
  if exists (select 1 from public.carreau_risque_distance
              where pops is null or centroide_3857 is null limit 1) then
    return jsonb_build_object('error', 'population_carreau_absente', 'ok', false,
      'message', 'Lancez scripts/local/11-reconstruire.sh (etape 4quater).');
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

  -- ⚠ UNE TABLE TEMPORAIRE, ET NON UNE CHAÎNE DE CTE, parce que DEUX écritures
  -- doivent lire le MÊME résultat sans le recalculer : les codes postaux, qui
  -- passent par le dénominateur, et la population des grappes, qui ne doit
  -- surtout pas y passer (voir plus bas). Une CTE n'est visible que de l'ordre
  -- qui la porte ; la refaire deux fois, ce serait deux passes sur les 215 646
  -- carreaux, soit le double d'un coût déjà mesuré entre 12 s et 400 s.
  drop table if exists _zs_grappes;
  create temporary table _zs_grappes on commit drop as

  -- ⚠ LE FILTRE AVANT LA JOINTURE, et ce n'est pas un détail de style.
  -- `carreaux_filosofi` pèse 4,6 Go et 806 octets de jsonb par ligne : joindre
  -- les 883 451 carreaux à portée pour n'en garder que 215 646 fait lire
  -- quatre fois trop de jsonb. `as materialized` force cet ordre — sans lui,
  -- le planificateur est libre de joindre d'abord.
  with retenus as materialized (
    -- La retenue vient de `classe_carreau_risque` (sql/204), la règle unique du
    -- module, et JAMAIS d'un test géométrique — voir sql/224 pour les trois
    -- mesures qui l'ont établi. Elle ne lit QUE des tables de distances.
    --
    -- ⚠ SANS filtre, la table MÈRE : le chemin rapide, et le cas le plus
    -- fréquent. AVEC filtre, la fille `carreau_risque_nature`, restreinte aux
    -- natures retenues. Personne ne paie pour une dimension qu'il n'utilise
    -- pas. Même patron que `construire_zone_set_corps` (sql/220) et
    -- `population_par_classe` (sql/219) : trois lectures du même choix, une
    -- seule forme.
    select d.carreau_id, d.code_postal,
           -- ⚠ La population et la position VIENNENT DE CETTE TABLE (sql/229).
           -- Elles étaient tirées de `carreaux_filosofi` par une jointure, et
           -- c'était tout le coût : 0,9 s pour lire les distances seules,
           -- 11,2 s avec la jointure — 811 octets de jsonb lus par ligne pour
           -- en extraire un nombre.
           coalesce(d.pops[v_rang], 0::real)::numeric as pop,
           d.centroide_3857,
           public.classe_carreau_risque(
             case when v_filtre then n.d_haut_m    else d.d_haut_m    end,
             case when v_filtre then n.d_bas_m     else d.d_bas_m     end,
             case when v_filtre then n.pprt_niveau else d.pprt_niveau end,
             v_haut, v_bas,
             coalesce((v_jeu.profil->>'inclurePPRT')::boolean, true)) as classe
      from public.carreau_risque_distance d
      -- ⚠ Jointure ORDINAIRE et surtout pas `lateral` : ce dernier s'évalue
      -- LIGNE À LIGNE, soit un sous-plan pour chacun des 883 451 carreaux même
      -- quand `v_filtre` est faux — mesuré à un demi-seconde payé par ceux qui
      -- ne filtrent rien (sql/219). Agrégée une fois, jointe par hachage, elle
      -- ne rend aucune ligne sans filtre.
      left join (
        select x.carreau_id,
               min(x.d_haut_m) as d_haut_m,
               min(x.d_bas_m)  as d_bas_m,
               case when bool_or(x.pprt_niveau = 'haut') then 'haut'
                    when bool_or(x.pprt_niveau = 'bas')  then 'bas'
                    else null end as pprt_niveau
          from public.carreau_risque_nature x
         where v_filtre
           and x.nature_ord = any(v_ords)
         group by x.carreau_id
      ) n on n.carreau_id = d.carreau_id
    -- ⚠ AUCUN FILTRE SUR LE CODE POSTAL ICI, et c'est le second volet du même
    -- correctif. Un carreau qu'aucun contour postal ne couvre porte la chaîne
    -- VIDE (`remplir_code_postal_carreau` : « essayé, sans résultat »). Les
    -- écarter dès la retenue les retirait AUSSI de la population des bassins —
    -- 1 047 carreaux et 36 140 habitants au national, 127 et 5 219 sur les
    -- seules Bouches-du-Rhône. Les contours postaux ne pavent pas le
    -- territoire : littoral, zones non adressées. Ces gens existent.
    --
    -- Le filtre revient à l'INSERT, là où il a un sens : sans code postal, il
    -- n'y a rien à acheter.
     where (v_jeu.territoire is null or d.code_departement = v_jeu.territoire)
  ),
  rattaches as (
    -- Le bassin du SITE LE PLUS PROCHE. Un site est un point : le KNN est
    -- trivial, là où le même rattachement sur les polygones des grappes
    -- coûtait 508 s à froid.
    --
    -- ⚠ PLUS AUCUNE JOINTURE VERS `carreaux_filosofi` (sql/229) : la position
    -- et la population du carreau sont portées par la table des distances.
    -- C'est le seul changement qui fasse tomber le coût de cette fonction sous
    -- les 60 s de Kong quel que soit l'état du cache.
    select r.code_postal, r.classe, r.pop,
           (select s.cluster_id from public.zone_set_cluster_sites s
              join public.zone_set_clusters k on k.id = s.cluster_id
             where k.zone_set_id = p_zone_set_id
             order by s.geom_3857 <-> r.centroide_3857 limit 1) as cluster_id
      from retenus r
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
  select g.code_postal, g.cluster_id, d.classe, g.pop_en_zone, c.pop_cp
    from par_grappe g
    join dominante d on d.code_postal = g.code_postal and d.cluster_id = g.cluster_id
    join par_cp   c on c.code_postal = g.code_postal;

  create index on _zs_grappes (code_postal);
  analyze _zs_grappes;

  insert into public.zone_set_cp
    (zone_set_id, code_postal, cluster_id, classe,
     pop_en_zone, pop_totale, part_en_zone, retenu, poids)
  select p_zone_set_id,
         g.code_postal,
         g.cluster_id,
         g.classe,
         round(g.pop_en_zone),
         round(t.pop_totale),
         -- Part de CETTE grappe dans le code postal. La somme des lignes d'un
         -- CP redonne sa part totale : c'est ce qui rend le prorata lisible.
         round(least(100, g.pop_en_zone / nullif(t.pop_totale, 0) * 100), 2),
         least(100, g.pop_cp / nullif(t.pop_totale, 0) * 100) >= v_jeu.seuil_couverture_cp,
         -- Poids du plan : population exposée × poids de la classe. JAMAIS la
         -- population totale du code postal — c'est le principe du chantier.
         round(g.pop_en_zone * coalesce((v_jeu.poids->>g.classe)::numeric, 1), 2)
    from _zs_grappes g
    -- ⚠ `cp_population_totale` (sql/207) et NON `carreaux_cp_population`, qui
    -- surcompte de 10,5 %. Numérateur et dénominateur doivent rattacher le
    -- carreau au MÊME code postal.
    join lateral (
      select coalesce((cpt.populations->>v_jeu.cible)::numeric, 0) as pop_totale
        from public.cp_population_totale cpt where cpt.code_postal = g.code_postal
    ) t on true
   -- Le filtre d'ACHETABILITÉ, et lui seul : un carreau sans code postal ou
   -- dont le code postal n'a pas de dénominateur ne donne aucune ligne de
   -- plan. Il compte quand même dans son bassin (voir plus haut).
   where g.code_postal <> '' and t.pop_totale > 0;
  get diagnostics v_n = row_count;

  -- ⚠ LA POPULATION DES GRAPPES NE PASSE PAS PAR LES CODES POSTAUX, et c'est
  -- un correctif de sql/225, pas un raffinement.
  --
  -- Elle était déduite des lignes qu'on vient d'écrire — `sum(pop_en_zone)`
  -- sur `zone_set_cp`. Or cette écriture porte `where t.pop_totale > 0` : elle
  -- ÉCARTE tout code postal absent de `cp_population_totale`. Mesuré le
  -- 2026-09-22 : **69 codes postaux** portent des carreaux à portée sans avoir
  -- de dénominateur — Nantes 44200, Strasbourg 67100, Limoges 87100,
  -- Saint-Denis 97417 — soit jusqu'à **427 006 habitants** qui disparaissaient
  -- de la population des bassins.
  --
  -- Un bassin est une réalité physique : les habitants autour de sites classés.
  -- Ce qu'on sait en faire côté achat média — a-t-il un code postal achetable,
  -- ce code postal a-t-il un dénominateur — ne change pas combien ils sont.
  -- Faire dépendre le premier du second, c'est laisser une lacune de
  -- référentiel effacer des gens.
  --
  -- Constaté par le test d'intégration, à l'échelle d'un département : somme
  -- des grappes 381 933 contre 388 272 au moteur de l'écran, soit 6 339
  -- habitants (1,6 %) perdus en silence.
  --
  -- ⚠ Le filtre des codes postaux, lui, RESTE : sans dénominateur il n'y a ni
  -- part d'exposition ni seuil de rétention, donc rien à acheter. C'est une
  -- lacune de `cp_population_totale` à traiter pour elle-même, et elle est
  -- signalée par `n_cp_sans_denominateur` plutôt que tue.
  update public.zone_set_clusters k
     set pop_exposee = s.pop
    from (select cluster_id, sum(pop_en_zone)::bigint as pop
            from _zs_grappes group by cluster_id) s
   where k.id = s.cluster_id;

  -- ⚠ CE QUE LE PLAN NE PEUT PAS PORTER, CHIFFRÉ ET RENDU À L'APPELANT.
  --
  -- Des habitants exposés comptent dans leur bassin sans donner la moindre
  -- ligne de plan : leur carreau n'a aucun code postal, ou son code postal n'a
  -- pas de dénominateur. C'est exactement l'écart entre « combien de gens sont
  -- exposés » et « combien on sait en acheter », et il doit se lire, sinon la
  -- somme des lignes du plan contredit la population des bassins sans un mot.
  --
  -- Le compte des codes postaux ignore la chaîne vide — ce n'est pas un code
  -- postal manquant au dénominateur, c'est l'absence de code postal.
  select count(distinct g.code_postal) filter (where g.code_postal <> ''),
         coalesce(sum(g.pop_en_zone), 0)
    into v_cp_sans_denom, v_pop_sans_denom
    from _zs_grappes g
    left join public.cp_population_totale cpt on cpt.code_postal = g.code_postal
   where g.code_postal = ''
      or cpt.code_postal is null
      or coalesce((cpt.populations->>v_jeu.cible)::numeric, 0) <= 0;

  -- ⚠ L'ORDRE DE LA CONCATÉNATION CHANGE LE CHIFFRE ANNONCÉ, et c'est ainsi
  -- qu'on a cru cette fonction cent fois plus rapide qu'elle ne l'est.
  --
  -- `a || b` sur du jsonb fait gagner la DROITE. Écrit
  -- `jsonb_build_object(…, 'duree_ms', …) || appliquer_seuil_zone_set(…)`, le
  -- `duree_ms` rendu était celui du SEUIL — 22 à 65 ms, une mise à jour de
  -- 1 942 lignes — et jamais celui du remplissage. Mesuré au chronomètre
  -- extérieur le 2026-09-22 : **15 s à chaud**, et plus de dix minutes au
  -- premier passage, `carreaux_filosofi` (4,6 Go) étant lu depuis le disque.
  -- La fonction annonçait « 48 ms ».
  --
  -- Les deux durées repartent donc SÉPARÉES, et celle du seuil sous son propre
  -- nom : un appelant qui dimensionne un écran sur `duree_ms` doit lire le
  -- coût de ce qu'il vient de déclencher, pas celui de la dernière ligne
  -- exécutée.
  v_seuil := public.appliquer_seuil_zone_set(p_zone_set_id, v_jeu.seuil_couverture_cp);
  return (v_seuil - 'duree_ms')
      || jsonb_build_object(
           'ok', true,
           'n_lignes', v_n,
           -- ⚠ Rendu MÊME à zéro : un champ qui n'apparaît que lorsqu'il y a
           -- un problème se lit « tout va bien » quand il manque pour une
           -- autre raison.
           'n_cp_sans_denominateur', coalesce(v_cp_sans_denom, 0),
           'pop_sans_denominateur', round(coalesce(v_pop_sans_denom, 0)),
           'duree_seuil_ms', v_seuil->'duree_ms',
           'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;

$fn$;
