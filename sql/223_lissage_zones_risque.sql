-- =============================================================================
-- sql/223 — Lissage des zones de risque (LOT 6), et quad_segs=16
--
-- ── CE QUE CETTE MIGRATION CHANGE, ET CE QU'ELLE NE CHANGE PAS ──────────────
--
-- Elle ne touche QUE la géométrie AFFICHÉE (`zones_risque_cache`, servie en MVT
-- par `zones_risque_tuile`). Aucun chiffre de population ne bouge : le comptage
-- passe par `carreau_risque_distance` + `classe_carreau_risque`, et AUCUNE de
-- ces deux chaînes ne lit `zones_risque_cache`. Vérifié avant d'écrire ceci —
-- les deux moteurs sont disjoints.
--
-- ── LE BRIEF DEMANDAIT EPSG:2154. ON GARDE `geography`. ─────────────────────
--
-- Lambert-93 ne couvre que la métropole. Mesuré le 2026-09-21 : **45 sites
-- Seveso** sont hors de son domaine de validité (Guadeloupe, Guyane, La
-- Réunion, Martinique, Mayotte). Le 2154 y produit des coordonnées valides au
-- sens du SGBD et FAUSSES au sens du terrain — une déformation muette, exactement
-- le piège déjà documenté pour `emetteurs_radio`. Du brief on ne retient donc
-- que `quad_segs=16`.
--
-- ── POURQUOI LA FERMETURE PORTE SUR LE DISQUE ET NON SUR LA BANDE ───────────
--
-- ⚠ C'est LE point de cette migration, et l'y prendre à l'envers casserait
-- l'invariant central du module.
--
-- Une fermeture morphologique (dilatation +d puis érosion −d) BOUCHE les creux
-- et les trous plus petits que `d`. Appliquée à une bande — qui est un ANNEAU —
-- elle refermerait son trou central dès que `d` approche la largeur de
-- l'anneau. Exemple réel et atteignable : un profil `haut [1000, 1100]` donne
-- un anneau de 100 m de large ; à 12 % de 1 100, `d` vaut 132 m, donc l'anneau
-- se refermerait en disque plein et RECOUVRIRAIT la bande intérieure. Les
-- classes cesseraient d'être exclusives, et c'est précisément ce que l'audit du
-- 2026-09-21 a mesuré à 0,00 m² sur 476 paires.
--
-- On lisse donc les DISQUES (`v_courant`) avant d'en faire la différence. La
-- fermeture est monotone — A ⊆ B implique fermeture(A) ⊆ fermeture(B), puisque
-- dilatation et érosion le sont toutes deux — donc l'emboîtement des disques
-- survit au lissage, et la différence reste un anneau propre.
--
-- ⚠ Corollaire : UN SEUL `d` par niveau. Avec un `d` proportionnel à chaque
-- rayon, on comparerait fermeture_d1(A) et fermeture_d2(B) — et la monotonie ne
-- vaut plus quand l'élément structurant change. L'emboîtement ne serait plus
-- garanti, donc l'exclusivité non plus.
--
-- ⚠ Et ce `d` unique se prend sur le PLUS PETIT anneau du niveau, jamais sur le
-- plus grand. L'invariant n'exige que l'unicité — les deux choix le respectent —
-- mais ils ne déforment pas la même chose. À 12 % de 5 000 m, `d` vaudrait
-- 600 m et refermerait les golfes entre sites distants de 1,2 km : appliqué à
-- l'union des disques de 1 000 m, ce lissage-là ne lisse plus, il fusionne des
-- sites que la bande intérieure sépare. À 12 % de 1 000 m, `d` vaut 120 m et ne
-- referme que ce qui se lit comme un défaut de tracé à l'échelle de la bande la
-- plus fine. On ne comble jamais un creux visible à l'échelle où il compte.
--
-- ── LE PÉRIMÈTRE PPRT N'EST PAS LISSÉ ───────────────────────────────────────
--
-- C'est une servitude d'utilité publique opposable en urbanisme. Son tracé a
-- été déposé par une DDT et fait foi en droit. Le lisser déplacerait une limite
-- juridique pour une raison esthétique — et de quelques dizaines de mètres, ce
-- qui suffit à faire entrer ou sortir des habitations. Seules les zones QUE
-- NOUS CALCULONS sont lissées ; la légende de la carte fait déjà cette
-- distinction (trait plein / tireté).
--
-- ── POURQUOI UN `drop function` ────────────────────────────────────────────
--
-- Le nouvel argument `p_lissage_pct` a une valeur par défaut. Ajouté par un
-- simple `create or replace`, il créerait une SECONDE fonction et rendrait tout
-- appel nommé ambigu — la leçon de sql/191, déjà payée une fois. DROP et CREATE
-- sont dans la MÊME migration, donc la même transaction : aucun instant sans
-- fonction.
-- =============================================================================

begin;

drop function if exists public.construire_zones_risque(jsonb, text, text[]);

create or replace function public.construire_zones_risque(
  p_profil  jsonb,
  p_code    text,
  p_natures text[] default null,
  -- 0 désactive entièrement le lissage : une sortie de secours qui ne demande
  -- pas de migration le jour où une forme lissée surprendrait.
  p_lissage_pct numeric default 0.12
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_haut     int[];
  v_bas      int[];
  v_lie      boolean;
  v_pprt     boolean;
  v_t0       timestamptz := clock_timestamp();
  v_n        int := 0;
  v_niveau   text;
  v_anneaux  int[];
  v_gravite  text;
  v_precedent geometry;   -- disque du rayon précédent, pour l'exclusivité
  v_courant  geometry;
  v_bande    geometry;
  v_pprt_niv geometry;
  v_ords     smallint[];
  v_filtre   boolean;
  v_inconnues text[];
  v_haut_total geometry;  -- empreinte complète du seuil haut, pour la priorité
  v_d        numeric;     -- rayon de fermeture, UN par niveau (voir l'en-tête)
  i          int;
begin
  /*
   * Les LIBELLÉS arrivent en argument, comme dans les fonctions sœurs, et sont
   * résolus UNE fois en ordinaux — la même clé que `carreau_risque_nature`
   * (sql/218), pour que la géométrie et les codes postaux ne puissent pas
   * retenir deux ensembles de sites différents.
   */
  if p_natures is not null and array_length(p_natures, 1) is not null then
    -- ⚠ Cette fonction ne rend pas de jsonb : elle LÈVE. Son seul appelant est
    -- `construire_zone_set_corps`, qui a déjà refusé plus haut — c'est donc une
    -- ceinture, pour qu'un appel direct ne construise pas une géométrie muette
    -- sur le seau « non précisée ».
    if array_length(public.natures_inconnues(p_natures), 1) is not null then
      raise exception 'natures inconnues: %',
        array_to_string(public.natures_inconnues(p_natures), ', ');
    end if;
    select array_agg(public.ordinal_nature(n)) into v_ords from unnest(p_natures) n;
  end if;
  v_filtre := v_ords is not null and array_length(v_ords, 1) is not null;

  set local statement_timeout = '10min';
  -- L'union de milliers de sommets déborde vite le `work_mem` de ce palier.
  set local work_mem = '64MB';

  v_lie  := coalesce((p_profil->>'lie')::boolean, false);
  v_pprt := coalesce((p_profil->>'inclurePPRT')::boolean, true);

  select coalesce(array_agg(x::int order by x::int), '{}')
    into v_haut from jsonb_array_elements_text(coalesce(p_profil->'haut', '[]'::jsonb)) x;
  if v_lie then
    v_bas := v_haut;
  else
    select coalesce(array_agg(x::int order by x::int), '{}')
      into v_bas from jsonb_array_elements_text(coalesce(p_profil->'bas', '[]'::jsonb)) x;
  end if;

  delete from public.zones_risque_cache where profil_code = p_code;

  for v_niveau in select unnest(array['haut', 'bas']) loop
    v_anneaux := case v_niveau when 'haut' then v_haut else v_bas end;
    v_gravite := case v_niveau when 'haut' then 'seveso_haut' else 'seveso_bas' end;

    -- Un niveau sans anneau ne retient rien, pas même par son PPRT. MÊME ordre
    -- que `classerCarreau` : cette condition passe AVANT le périmètre publié.
    continue when coalesce(cardinality(v_anneaux), 0) = 0;

    -- UN SEUL rayon de fermeture par niveau, pris sur l'anneau le PLUS PETIT.
    -- L'unicité garde la fermeture monotone, donc les disques emboîtés, donc les
    -- bandes exclusives ; le choix du plus petit garde le lissage à l'échelle de
    -- la bande la plus fine (voir l'en-tête). `v_anneaux` est trié croissant par
    -- l'`order by` de son agrégation, donc l'indice 1 EST le plus petit.
    v_d := round(coalesce(p_lissage_pct, 0) * v_anneaux[1]);

    -- Le périmètre publié du niveau, s'il est distingué. JAMAIS lissé.
    v_pprt_niv := null;
    if v_pprt then
      select ST_Union(pn.geom_3857) into v_pprt_niv
        from public.pprt_niveau_generateur pn
       where pn.niveau = v_niveau;
    end if;

    v_precedent := null;

    for i in 1 .. cardinality(v_anneaux) loop
      -- ⚠ `ST_Buffer` sur **geography** : le rayon est en mètres. En 4326,
      -- « 5 km » vaudrait 5 km en latitude et ~3,5 km en longitude à Marseille —
      -- une ellipse présentée comme un cercle. Même raison que `zone_rayon`
      -- (sql/155) et `risques_industriels_carte` (sql/175).
      --
      -- `quad_segs=16` (lot 6) : 64 segments par cercle au lieu de 32. Le coût
      -- est payé UNE fois à la construction et rien ne le porte ensuite — les
      -- tuiles simplifient déjà selon la taille du pixel (`zones_risque_tuile`).
      select ST_Union(
               ST_Transform(
                 ST_Buffer(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                           v_anneaux[i], 'quad_segs=16')::geometry, 3857))
        into v_courant
        from public.poi_france p
       where p.categorie = 'risque_industriel'
         and p.sous_categorie = v_gravite
         and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
         and p.lng is not null and p.lat is not null
         -- La nature DOMINANTE, comme partout dans ce module (sql/198, sql/218).
         and (not v_filtre
              or public.ordinal_nature(
                   coalesce(nullif(p.metadata->>'libelle_nature', ''), 'Nature non précisée')
                 ) = any(v_ords));

      continue when v_courant is null;

      /*
       * ── FERMETURE MORPHOLOGIQUE, SUR LE DISQUE ────────────────────────────
       *
       * Dilatation +d puis érosion −d : les golfes étroits entre deux cercles
       * voisins se referment, et la grappe se lit comme une forme au lieu d'un
       * chapelet. Sur le DISQUE et jamais sur la bande — voir l'en-tête.
       *
       * ⚠ `::geography` s'applique à du 4326 et à rien d'autre. `v_courant` est
       * en 3857 : le caster directement interpréterait des mètres Mercator comme
       * des degrés, soit une erreur de quatre ordres de grandeur, sans la
       * moindre exception. D'où l'aller-retour explicite.
       *
       * `ST_MakeValid` après coup : une érosion peut produire un anneau
       * auto-sécant sur une forme très découpée, que `ST_Difference` refuserait
       * ensuite.
       *
       * Mesuré le 2026-09-21 sur la bande la plus lourde du profil par défaut
       * (51 647 sommets, 25 464 km²) : 760 ms pour l'aller-retour.
       */
      if v_d > 0 then
        v_courant := ST_Transform(
          ST_MakeValid(
            ST_Buffer(
              ST_Buffer(ST_Transform(v_courant, 4326)::geography, v_d)::geography,
              -v_d
            )::geometry
          ), 3857);
        -- Une érosion peut tout emporter sur une grappe minuscule. On retombe
        -- alors sur le disque non lissé plutôt que de perdre la bande : une
        -- forme un peu anguleuse vaut mieux qu'une zone absente.
        if v_courant is null or ST_IsEmpty(v_courant) then
          select ST_Union(
                   ST_Transform(
                     ST_Buffer(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                               v_anneaux[i], 'quad_segs=16')::geometry, 3857))
            into v_courant
            from public.poi_france p
           where p.categorie = 'risque_industriel'
             and p.sous_categorie = v_gravite
             and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
             and p.lng is not null and p.lat is not null
             and (not v_filtre
                  or public.ordinal_nature(
                       coalesce(nullif(p.metadata->>'libelle_nature', ''), 'Nature non précisée')
                     ) = any(v_ords));
        end if;
      end if;

      -- Exclusivité : la bande est l'anneau, jamais le disque.
      v_bande := case when v_precedent is null then v_courant
                      else ST_Difference(v_courant, v_precedent) end;
      v_precedent := v_courant;

      -- Le périmètre publié prime sur la bande calculée du même niveau.
      if v_pprt_niv is not null then
        v_bande := ST_Difference(v_bande, v_pprt_niv);
      end if;

      -- Priorité de NIVEAU : le seuil haut l'emporte en entier.
      if v_niveau = 'bas' and v_haut_total is not null then
        v_bande := ST_Difference(v_bande, v_haut_total);
      end if;

      if v_bande is not null and not ST_IsEmpty(v_bande) then
        insert into public.zones_risque_cache
          (profil_code, classe, niveau, bande, geom, geom_3857, surface_km2)
        values (
          p_code, v_niveau || ':' || i, v_niveau, i,
          ST_Multi(ST_Transform(v_bande, 4326)),
          ST_Multi(v_bande),
          round((ST_Area(ST_Transform(v_bande, 4326)::geography) / 1e6)::numeric, 2))
        on conflict (profil_code, classe) do update
          set geom = excluded.geom, geom_3857 = excluded.geom_3857,
              surface_km2 = excluded.surface_km2, construit_le = now();
        v_n := v_n + 1;
      end if;
    end loop;

    -- Le périmètre publié, après les bandes : il doit lui aussi céder au seuil
    -- haut quand on traite le seuil bas.
    if v_pprt_niv is not null then
      v_bande := v_pprt_niv;
      if v_niveau = 'bas' and v_haut_total is not null then
        v_bande := ST_Difference(v_bande, v_haut_total);
      end if;
      if v_bande is not null and not ST_IsEmpty(v_bande) then
        insert into public.zones_risque_cache
          (profil_code, classe, niveau, bande, geom, geom_3857, surface_km2)
        values (
          p_code, v_niveau || ':pprt', v_niveau, null,
          ST_Multi(ST_Transform(v_bande, 4326)),
          ST_Multi(v_bande),
          round((ST_Area(ST_Transform(v_bande, 4326)::geography) / 1e6)::numeric, 2))
        on conflict (profil_code, classe) do update
          set geom = excluded.geom, geom_3857 = excluded.geom_3857,
              surface_km2 = excluded.surface_km2, construit_le = now();
        v_n := v_n + 1;
      end if;
    end if;

    -- L'empreinte COMPLÈTE du seuil haut : son dernier disque plus son
    -- périmètre publié. C'est elle que le seuil bas doit céder — pas seulement
    -- les bandes, car un carreau « retenu » par le seuil haut peut l'être par
    -- sa servitude au-delà du dernier anneau.
    if v_niveau = 'haut' then
      v_haut_total := coalesce(
        case when v_precedent is not null and v_pprt_niv is not null
               then ST_Union(v_precedent, v_pprt_niv)
             else coalesce(v_precedent, v_pprt_niv) end,
        null);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true, 'profil', p_code, 'classes', v_n,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$$;

revoke all on function public.construire_zones_risque(jsonb, text, text[], numeric) from anon, authenticated;

-- ── INVALIDATION DU CACHE ───────────────────────────────────────────────────
--
-- La clé de `zones_risque_cache` est le CODE DU PROFIL, qui ne dit rien du
-- lissage ni de `quad_segs` : sans cette purge, les 30 profils déjà construits
-- continueraient d'être servis avec l'ancienne géométrie, et le lot serait
-- invisible pour quiconque revient sur un profil déjà vu. Même raisonnement que
-- `vider_zones_risque()`, qu'on appelle plutôt que de réécrire un DELETE.
select public.vider_zones_risque();

commit;
