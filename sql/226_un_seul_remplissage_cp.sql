-- ============================================================================
-- sql/226 — un seul remplissage des codes postaux, et le filtre de nature
--           honoré jusqu'au bout
-- ============================================================================
--
-- DEUX DÉFAUTS, TOUS DEUX OUVERTS PAR sql/225, ET TOUS DEUX INVISIBLES.
--
-- ① `construire_zone_set_corps` portait ENCORE son propre remplissage de
--    `zone_set_cp`, écrit quand la table avait une ligne par code postal.
--    sql/225 en a fait une table PAR GRAPPE : `cluster_id` entre dans la clé
--    primaire, donc `not null`, sans valeur par défaut. Cet `insert` ne
--    pouvait plus qu'échouer en 23502 — et c'est le SEUL chemin
--    d'enregistrement d'un jeu de zones (`POST /api/zones/jeux`, et le seed de
--    démonstration). Les tests d'intégration ne le voyaient pas : ils
--    appellent déjà la chaîne en deux temps à la main.
--
--    ⚠ Le corriger sur place aurait donné DEUX implémentations du même
--    remplissage — celle-ci et `remplir_zone_set_cp` — qui auraient divergé au
--    premier correctif, l'une servant la carte et l'autre le plan. On appelle
--    donc celle qui est testée, et il n'en reste qu'une.
--
-- ② `remplir_zone_set_cp` IGNORAIT le filtre de nature. La géométrie
--    (`construire_zones_risque`, sql/220) et les grappes
--    (`construire_zone_set_clusters`, sql/224) l'appliquent toutes les deux ;
--    seul le remplissage des codes postaux lisait la table MÈRE sans
--    condition. Un jeu bâti sur « Explosibles » aurait donc acheté les codes
--    postaux de TOUTES les natures sous une carte qui n'en montre qu'une.
--    C'est mot pour mot ce que sql/220 a fermé — rouvert par une autre porte,
--    trois migrations plus tard, parce que le remplissage a changé de fonction
--    et que le filtre n'a pas suivi.
--
--    Mesure du 2026-09-20 qui donne l'ordre de grandeur de l'écart : sur le
--    département 13, un profil à deux anneaux rend 2 922 km2 et 5 codes
--    postaux filtré sur Explosibles, contre 13 224 km2 et 25 codes postaux
--    sans filtre.
-- ============================================================================

create or replace function public.construire_zone_set_corps(
  p_zone_set_id uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$

declare
  v_jeu      record;
  v_code     text;
  v_geoms    int;
  v_cp       int;
  v_retenus  int;
  v_exposee  numeric;
  v_utile    numeric;
  v_t0       timestamptz := clock_timestamp();
  v_inconnues text[];
  v_res       jsonb;
  v_lignes    int;
begin
  set local statement_timeout = '15min';
  set local work_mem = '64MB';

  select * into v_jeu from public.zone_sets where id = p_zone_set_id;
  if v_jeu is null then
    return jsonb_build_object('error', 'jeu_introuvable', 'ok', false);
  end if;

  /*
   * ── LE FILTRE DE NATURE EST HONORE DEPUIS sql/220 ──────────────────────
   *
   * Cette fonction le REFUSAIT (`filtre_nature_non_supporte`) : le pre-calcul
   * des distances portait un predicat fixe, et un filtre affiche mais non
   * applique est pire qu'un filtre absent. sql/218 a construit la dimension —
   * `carreau_risque_nature`, 1 446 552 lignes, 13 natures.
   *
   * Les LIBELLES sont resolus UNE fois en ordinaux, la meme cle que la table
   * fille : la geometrie et les codes postaux ne peuvent donc pas retenir deux
   * ensembles de sites differents.
   */
  if coalesce(array_length(v_jeu.natures, 1), 0) > 0 then
  /*
   * ⚠ On REFUSE un libellé qu'on ne sait pas résoudre, on ne le replie pas.
   * `ordinal_nature` rend 0 pour l'inconnu — correct à la construction, où un
   * site hors registre doit garder une ligne ; mensonger ici, où 0 est le seau
   * des natures non précisées. Mesuré : un accent manquant sur « GPL et
   * produits pétroliers » rendait 136 277 habitants au lieu de 7 753 811.
   */
  v_inconnues := public.natures_inconnues(v_jeu.natures);
  if array_length(v_inconnues, 1) is not null then
    return jsonb_build_object(
      'error', 'natures_inconnues',
      'calculable', false,
      'natures_inconnues', to_jsonb(v_inconnues));
  end if;

  end if;

  -- ⚠ La garde « pre-calcul absent » a REMONTE dans l'enveloppe
  -- `construire_zone_set` (sql/217), qui distingue desormais « pas construit »
  -- de « territoire non carroye par l'INSEE ». La laisser ici en double
  -- donnerait deux messages pour une meme situation, et l'un des deux
  -- finirait par mentir.

  v_code := v_jeu.profil_hash;

  -- ── 1. La géométrie, empruntée au cache de profil ───────────────────────
  -- ⚠ Les natures partent AUSSI a la geometrie. Ne filtrer que les codes
  -- postaux produirait une carte qui contredit son propre plan : les zones de
  -- tous les sites, les codes postaux d'une seule nature.
  perform public.construire_zones_risque(v_jeu.profil, v_code, v_jeu.natures);

  delete from public.zone_set_geoms where zone_set_id = p_zone_set_id;
  insert into public.zone_set_geoms
    (zone_set_id, classe, niveau, bande, geom, geom_3857, surface_km2)
  select p_zone_set_id, z.classe, z.niveau, z.bande, z.geom, z.geom_3857, z.surface_km2
    from public.zones_risque_cache z
   where z.profil_code = v_code;
  get diagnostics v_geoms = row_count;


  -- ── 2. Les grappes, puis les codes postaux ──────────────────────────────
  --
  -- ⚠ L'ORDRE n'est pas négociable, et il est vérifié en base :
  -- `remplir_zone_set_cp` refuse (`grappes_absentes`) tant qu'aucune grappe
  -- n'existe — chaque ligne doit pouvoir dire de quel bassin elle parle.
  v_res := public.construire_zone_set_clusters(p_zone_set_id);
  if coalesce((v_res->>'ok')::boolean, false) is not true then
    return v_res;
  end if;

  v_res := public.remplir_zone_set_cp(p_zone_set_id);
  if coalesce((v_res->>'ok')::boolean, false) is not true then
    return v_res;
  end if;

  -- ⚠ On NE RECALCULE PAS les totaux ici. `remplir_zone_set_cp` termine par
  -- `appliquer_seuil_zone_set`, qui pose déjà `n_cp_retenus`,
  -- `population_exposee` et `taux_utile` sur le jeu — et qui DÉDUPLIQUE
  -- `pop_totale` avant de la sommer, cette valeur étant une propriété du code
  -- postal répétée sur chacune de ses lignes. Les recalculer ici en donnerait
  -- une seconde définition, qui divergerait au premier correctif de l'autre.
  v_lignes  := coalesce((v_res->>'n_lignes')::int, 0);
  v_retenus := coalesce((v_res->>'n_cp_retenus')::int, 0);
  v_exposee := coalesce((v_res->>'population_exposee')::numeric, 0);
  v_utile   := (v_res->>'taux_utile')::numeric;

  -- ⚠ `codes_postaux` reste un compte de CODES POSTAUX et non de lignes : le
  -- client l'affiche tel quel (« 1 942 codes postaux »), et servir 2 255 sous
  -- ce nom ferait croire à 313 codes postaux apparus avec les grappes. Les
  -- lignes sont rendues à part, sous leur propre nom.
  select count(distinct code_postal) into v_cp
    from public.zone_set_cp where zone_set_id = p_zone_set_id;

  update public.zone_sets set construit_le = now() where id = p_zone_set_id;

  return jsonb_build_object(
    'ok', true,
    'jeu', p_zone_set_id,
    'classes', v_geoms,
    'codes_postaux', v_cp,
    'lignes_cp', v_lignes,
    'retenus', coalesce(v_retenus, 0),
    'population_exposee', coalesce(v_exposee, 0),
    'taux_utile', v_utile,
    -- ⚠ `extract(milliseconds from …)` sur un INTERVALLE ne rend que la
    -- composante secondes : elle REPART À ZÉRO à chaque minute. Écrite ainsi
    -- depuis sql/217, elle disait vrai tant que la construction tenait sous
    -- 60 s (21,2 s mesurées à chaud) — et aurait annoncé « 10 s » pour le
    -- premier passage à froid de ce jour, qui en a pris plus de six cents.
    -- Le compteur le plus dangereux n'est pas celui qui manque, c'est celui
    -- qui est juste tant qu'on ne regarde pas le cas qui compte.
    'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;
$fn$;

comment on function public.construire_zone_set_corps is
  'Calcul reel d''un jeu de zones : la geometrie, puis les grappes, puis les '
  'codes postaux. Ne remplit plus zone_set_cp lui-meme (sql/226) : un seul '
  'remplissage, celui de remplir_zone_set_cp. Appele UNIQUEMENT par '
  'construire_zone_set.';

revoke all on function public.construire_zone_set_corps(uuid) from public, anon, authenticated;
grant execute on function public.construire_zone_set_corps(uuid) to service_role;

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
    -- mesures qui l'ont établi. Elle ne lit QUE des tables de distances.
    --
    -- ⚠ SANS filtre, la table MÈRE : le chemin rapide, et le cas le plus
    -- fréquent. AVEC filtre, la fille `carreau_risque_nature`, restreinte aux
    -- natures retenues. Personne ne paie pour une dimension qu'il n'utilise
    -- pas. Même patron que `construire_zone_set_corps` (sql/220) et
    -- `population_par_classe` (sql/219) : trois lectures du même choix, une
    -- seule forme.
    select d.carreau_id, d.code_postal,
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
           'duree_seuil_ms', v_seuil->'duree_ms',
           'duree_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end;
$fn$;

comment on function public.remplir_zone_set_cp is
  'Ecrit les lignes (code postal x grappe) d''un jeu de zones : UNE LIGNE PAR '
  'GRAPPE, au prorata de la population exposee dans chacune. Le seuil de '
  'retention est decide sur la SOMME du code postal, jamais ligne a ligne. '
  'Honore le filtre de nature depuis sql/226 — il etait ignore ici alors que '
  'la geometrie et les grappes l''appliquaient. sql/225 + sql/226.';

revoke all on function public.remplir_zone_set_cp(uuid) from public, anon, authenticated;
grant execute on function public.remplir_zone_set_cp(uuid) to service_role;
