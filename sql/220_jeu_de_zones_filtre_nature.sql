-- sql/220 — Le jeu de zones sait enfin filtrer par nature
--           (2026-09-20)
--
-- `construire_zone_set` REFUSAIT un jeu portant un filtre de nature
-- (`filtre_nature_non_supporte`, sql/211). Le refus était honnête : le
-- pré-calcul des distances portait un prédicat fixe, et un filtre affiché mais
-- non appliqué est pire qu'un filtre absent.
--
-- sql/218 a construit la dimension manquante — `carreau_risque_nature`,
-- 1 446 552 lignes, 13 natures, Martinique et La Réunion comprises. Le refus
-- peut donc être levé.
--
-- ── DEUX MOITIÉS, ET IL FAUT LES DEUX ────────────────────────────────────
--
-- Un jeu de zones porte une GÉOMÉTRIE (ce que la carte montre) et une LISTE DE
-- CODES POSTAUX (ce que le DSP achète). Ne filtrer que la seconde produirait
-- une carte qui contredit son propre plan : les zones de tous les sites, les
-- codes postaux d'une seule nature.
--
-- La clé du cache de géométrie est fournie par l'APPELANT, et
-- `zone_sets.profil_hash` — c'est-à-dire `codeJeu()` — couvre déjà profil,
-- filtres et seuil. Deux jeux qui ne diffèrent que par leur filtre de nature
-- ont donc des clés distinctes, sans rien changer à la table.

drop function if exists public.construire_zones_risque(jsonb, text);

CREATE OR REPLACE FUNCTION public.construire_zones_risque(
  p_profil jsonb,
  p_code text,
  /**
   * Libellés de natures retenus. Vide ou NULL = toutes.
   *
   * ⚠ Le filtre doit aussi valoir pour la GÉOMÉTRIE, pas seulement pour
   * les codes postaux : un jeu bâti sur « Explosibles » dont la carte
   * montrerait les zones de tous les sites serait le même mensonge, en
   * plus visible.
   *
   * La clé de cache (`p_code`) est fournie par l'APPELANT et doit donc
   * inclure les natures. `zone_sets.profil_hash` le fait déjà —
   * `codeJeu()` couvre profil + filtres + seuil.
   */
  p_natures text[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Le périmètre publié du niveau, s'il est distingué.
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
      select ST_Union(
               ST_Transform(
                 ST_Buffer(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
                           v_anneaux[i])::geometry, 3857))
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
$function$;

comment on function public.construire_zones_risque is
  'Construit la geometrie des classes d''un profil. ST_Buffer sur GEOGRAPHY — le '
  'rayon est en metres, jamais en degres. La priorite est transcrite en geometrie : '
  'bande i = disque(r_i) moins disque(r_i-1), moins le PPRT du meme niveau ; puis '
  'toute classe du seuil bas moins l''EMPREINTE COMPLETE du seuil haut. Depuis '
  'sql/220 elle honore p_natures, sur la nature DOMINANTE — sans quoi un jeu bati '
  'sur une nature montrerait les zones de toutes.';

revoke all on function public.construire_zones_risque(jsonb, text, text[])
  from public, anon, authenticated;
grant execute on function public.construire_zones_risque(jsonb, text, text[]) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- LE CORPS DU JEU DE ZONES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.construire_zone_set_corps(p_zone_set_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_jeu      record;
  v_code     text;
  v_geoms    int;
  v_cp       int;
  v_retenus  int;
  v_exposee  numeric;
  v_utile    numeric;
  v_t0       timestamptz := clock_timestamp();
  v_ords     smallint[];
  v_filtre   boolean;
  v_inconnues text[];
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

    select array_agg(public.ordinal_nature(n)) into v_ords from unnest(v_jeu.natures) n;
  end if;
  v_filtre := v_ords is not null and array_length(v_ords, 1) is not null;

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

  -- ── 2. Les codes postaux ────────────────────────────────────────────────
  delete from public.zone_set_cp where zone_set_id = p_zone_set_id;

  insert into public.zone_set_cp
    (zone_set_id, code_postal, classe, pop_en_zone, pop_totale, part_en_zone, retenu)
  with par_classe as (
    select d.code_postal,
           public.classe_carreau_risque(
             -- SANS filtre, la table MERE : le chemin rapide, et le cas le
             -- plus frequent. AVEC filtre, la fille, restreinte aux natures
             -- retenues. Personne ne paie pour une dimension qu'il n'utilise
             -- pas.
             case when v_filtre then n.d_haut_m    else d.d_haut_m    end,
             case when v_filtre then n.d_bas_m     else d.d_bas_m     end,
             case when v_filtre then n.pprt_niveau else d.pprt_niveau end,
             (select coalesce(array_agg(x::int order by x::int), '{}')
                from jsonb_array_elements_text(coalesce(v_jeu.profil->'haut', '[]'::jsonb)) x),
             (select coalesce(array_agg(x::int order by x::int), '{}')
                from jsonb_array_elements_text(
                  case when coalesce((v_jeu.profil->>'lie')::boolean, false)
                       then coalesce(v_jeu.profil->'haut', '[]'::jsonb)
                       else coalesce(v_jeu.profil->'bas',  '[]'::jsonb) end) x),
             coalesce((v_jeu.profil->>'inclurePPRT')::boolean, true)
           ) as classe,
           sum(coalesce((c.metadata->>v_jeu.cible)::numeric, 0)) as pop
      from public.carreau_risque_distance d
      join public.carreaux_filosofi c on c.id = d.carreau_id
      -- ⚠ Jointure ORDINAIRE et non `lateral` : ce dernier s'evalue LIGNE A
      -- LIGNE, soit un sous-plan par carreau meme quand on ne filtre rien.
      -- Mesure : 0,5 s payes par des gens qui ne filtrent pas. Ici la
      -- sous-requete est agregee UNE fois, et ne rend aucune ligne sans filtre.
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
     group by d.code_postal, 2
  ),
  -- La classe DOMINANTE : celle qui porte le plus de population. Un code
  -- postal chevauche souvent plusieurs bandes ; en retenir une est ce qui fait
  -- tenir « un code postal, un poids ».
  dominante as (
    select distinct on (code_postal) code_postal, classe
      from par_classe
     where classe <> 'hors'
     order by code_postal, pop desc
  ),
  en_zone as (
    select code_postal, sum(pop) as pop_en_zone
      from par_classe where classe <> 'hors' group by code_postal
  )
  select p_zone_set_id,
         e.code_postal,
         d.classe,
         round(e.pop_en_zone),
         round(t.pop_totale),
         round(part.valeur, 2),
         part.valeur >= v_jeu.seuil_couverture_cp
    from en_zone e
    join dominante d on d.code_postal = e.code_postal
    -- ⚠ `cp_population_totale` (sql/207) et NON `carreaux_cp_population`, qui
    -- surcompte de 10,5 % en comptant un carreau dans chaque contour qui le
    -- recouvre. Le numérateur et le dénominateur doivent rattacher le carreau
    -- au MÊME code postal, sinon la part ne veut rien dire.
    join lateral (
      select coalesce((cpt.populations->>v_jeu.cible)::numeric, 0) as pop_totale
        from public.cp_population_totale cpt where cpt.code_postal = e.code_postal
    ) t on true
    join lateral (
      select least(100, e.pop_en_zone / nullif(t.pop_totale, 0) * 100) as valeur
    ) part on true
   where t.pop_totale > 0;
  get diagnostics v_cp = row_count;

  select count(*) filter (where retenu),
         sum(pop_en_zone) filter (where retenu),
         -- Le taux d'utile : population exposée rapportée à la population des
         -- codes postaux RETENUS. C'est ce qu'on achète contre ce qu'on vise.
         round(sum(pop_en_zone) filter (where retenu)
               / nullif(sum(pop_totale) filter (where retenu), 0) * 100, 1)
    into v_retenus, v_exposee, v_utile
    from public.zone_set_cp where zone_set_id = p_zone_set_id;

  update public.zone_sets
     set population_exposee = coalesce(v_exposee, 0),
         n_cp_retenus       = coalesce(v_retenus, 0),
         taux_utile         = v_utile,
         construit_le       = now()
   where id = p_zone_set_id;

  return jsonb_build_object(
    'ok', true,
    'jeu', p_zone_set_id,
    'classes', v_geoms,
    'codes_postaux', v_cp,
    'retenus', coalesce(v_retenus, 0),
    'population_exposee', coalesce(v_exposee, 0),
    'taux_utile', v_utile,
    'duree_ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end;
$function$;

comment on function public.construire_zone_set_corps is
  'Le calcul reel d''un jeu de zones. Appele UNIQUEMENT par construire_zone_set, '
  'qui pose devant lui les gardes « pre-calcul absent » et « territoire non '
  'carroye ». Depuis sql/220 il honore le filtre de nature, sur les DEUX moities '
  'du jeu — la geometrie et les codes postaux — faute de quoi la carte '
  'contredirait son propre plan.';

revoke all on function public.construire_zone_set_corps(uuid) from public, anon, authenticated;
grant execute on function public.construire_zone_set_corps(uuid) to service_role;
