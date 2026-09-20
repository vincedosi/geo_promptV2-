-- sql/217 — « Pas construit » n'est pas « pas carroyé »
--           (2026-09-20)
--
-- ── LE DEFAUT ────────────────────────────────────────────────────────────
--
-- Selectionner la Guadeloupe dans l'onglet Rayons affichait :
--
--     « Les distances par carreau n'ont pas encore ete construites.
--       Construction : node scripts/construire_carreau_risque.mjs »
--
-- Le pre-calcul EST construit : 883 451 lignes, 98 departements. Ce que
-- l'ecran lisait comme une absence de calcul etait une absence de DONNEE
-- SOURCE — mesure le 2026-09-20 : `carreaux_filosofi` porte **0 carreau**
-- pour 971, 973 et 976, parce que le carroyage Filosofi 2021 a 200 m de
-- l'INSEE ne publie que la metropole, la Martinique et La Reunion.
--
-- Le message envoyait donc l'utilisateur lancer une construction qui ne
-- pouvait rien y changer, et il TAISAIT le seul fait qui compte : ces trois
-- departements comptent **603 sites a risque, dont 31 Seveso**, dont la
-- population exposee n'est pas mesurable.
--
-- Un ecran qui reclame une action impossible est pire qu'un ecran qui avoue
-- une limite : le premier fait perdre du temps et laisse croire que le
-- chiffre existera un jour.
--
-- ── CE QUE CETTE FONCTION REND ───────────────────────────────────────────
--
-- De quoi ecrire la bonne phrase, en UN aller-retour :
--   · le pre-calcul existe-t-il ;
--   · ce territoire y est-il couvert ;
--   · combien de sites a risque il porte malgre tout.
--
-- ⚠ **Aucun COUNT sur `carreau_risque_distance`, et c'est mesure.** La
-- premiere version rendait aussi `n_departements`, par un
-- `count(distinct code_departement)` : **295 ms**, soit 98 % du cout de
-- l'appel, pour un chiffre qu'aucun message n'utilise. Les sondes qui restent
-- sont des `exists` sur index — 0,35 ms. Ce diagnostic s'affiche chaque fois
-- qu'un ecran ne trouve rien : il doit etre moins cher que ce qui vient
-- d'echouer.

create or replace function public.couverture_carreau_risque(
  p_departement text default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_construit   boolean;
  v_couvert     boolean;
  v_n_sites     int;
  v_n_seveso    int;
begin
  -- `exists` et non `count` : on demande « y a-t-il quelque chose », pas
  -- « combien ». La difference est de trois ordres de grandeur.
  select exists (select 1 from public.carreau_risque_distance) into v_construit;

  if not v_construit then
    return jsonb_build_object(
      'construit', false, 'territoire_couvert', false,
      'n_sites', 0, 'n_seveso', 0);
  end if;

  if p_departement is null then
    return jsonb_build_object(
      'construit', true, 'territoire_couvert', true,
      'n_sites', 0, 'n_seveso', 0);
  end if;

  select exists (
    select 1 from public.carreau_risque_distance
     where code_departement = p_departement
  ) into v_couvert;

  /*
   * Les sites sont comptes MEME quand le territoire n'est pas carroye : c'est
   * precisement ce qu'il faut dire. « Aucune population calculable » se lit
   * « il n'y a rien la-bas » tant qu'on ne precise pas qu'il y a 603 sites et
   * qu'ils restent visibles sur la carte.
   */
  select count(*),
         count(*) filter (where sous_categorie in ('seveso_haut', 'seveso_bas'))
    into v_n_sites, v_n_seveso
    from public.poi_france
   where categorie = 'risque_industriel'
     and code_departement = p_departement;

  return jsonb_build_object(
    'construit', true,
    'territoire_couvert', v_couvert,
    'n_sites', v_n_sites,
    'n_seveso', v_n_seveso);
end;
$fn$;

comment on function public.couverture_carreau_risque is
  'Distingue « le pre-calcul n''est pas construit » de « ce territoire n''est pas '
  'carroye par l''INSEE ». Les deux rendaient le meme ecran, et le second envoyait '
  'lancer une construction qui ne pouvait rien y changer. Compte aussi les sites du '
  'territoire : « aucune population calculable » se lit « il n''y a rien la-bas » '
  'tant qu''on ne dit pas qu''il y a 603 sites dont 31 Seveso.';

revoke all on function public.couverture_carreau_risque(text)
  from public, anon, authenticated;
grant execute on function public.couverture_carreau_risque(text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- LE CORPS, RENOMME
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Inchange a la ligne pres, sauf la garde « pre-calcul absent » qui remonte
-- dans l'enveloppe. Le renommage n'est pas cosmetique : il rend la garde
-- INCONTOURNABLE. Une garde posee au debut du meme corps se contourne d'un
-- `return` mal place au prochain correctif ; une enveloppe, non.

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
begin
  set local statement_timeout = '15min';
  set local work_mem = '64MB';

  select * into v_jeu from public.zone_sets where id = p_zone_set_id;
  if v_jeu is null then
    return jsonb_build_object('error', 'jeu_introuvable', 'ok', false);
  end if;

  -- ⚠ Refus explicite plutôt qu'un filtre avalé en silence.
  if coalesce(array_length(v_jeu.natures, 1), 0) > 0 then
    return jsonb_build_object(
      'error', 'filtre_nature_non_supporte', 'ok', false,
      'detail', 'Le pre-calcul des distances porte toutes les natures de risque. '
                || 'Un filtre par nature ne peut pas etre honore sans le reconstruire.');
  end if;

  -- ⚠ La garde « pre-calcul absent » a REMONTE dans l'enveloppe
  -- `construire_zone_set` (sql/217), qui distingue desormais « pas construit »
  -- de « territoire non carroye par l'INSEE ». La laisser ici en double
  -- donnerait deux messages pour une meme situation, et l'un des deux
  -- finirait par mentir.

  v_code := v_jeu.profil_hash;

  -- ── 1. La géométrie, empruntée au cache de profil ───────────────────────
  perform public.construire_zones_risque(v_jeu.profil, v_code);

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
             d.d_haut_m, d.d_bas_m, d.pprt_niveau,
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
  'carroye » — une enveloppe plutot qu''un debut de corps, pour qu''elles ne '
  'puissent pas etre contournees par un return mal place.';

revoke all on function public.construire_zone_set_corps(uuid)
  from public, anon, authenticated;
grant execute on function public.construire_zone_set_corps(uuid) to service_role;



-- ═══════════════════════════════════════════════════════════════════════════
-- UN JEU DE ZONES NE SE CONSTRUIT PAS SUR UN TERRITOIRE SANS CARREAU
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Meme defaut, plus grave : `construire_zone_set` rendait `ok: true` avec zero
-- classe et zero code postal. L'atelier enregistrait donc un jeu VIDE, qu'une
-- campagne pouvait recevoir comme plan — un plan sans aucun code postal, qui
-- ne diffuse nulle part et ne le dit pas.
--
-- Il refuse desormais AVANT de construire.

create or replace function public.construire_zone_set(p_zone_set_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_jeu    public.zone_sets;
  v_couv   jsonb;
  v_res    jsonb;
begin
  select * into v_jeu from public.zone_sets where id = p_zone_set_id;
  if v_jeu is null then
    return jsonb_build_object('error', 'jeu_introuvable', 'ok', false);
  end if;

  v_couv := public.couverture_carreau_risque(v_jeu.territoire);

  if not (v_couv ->> 'construit')::boolean then
    return jsonb_build_object(
      'error', 'precalcul_absent', 'ok', false,
      'detail', 'node scripts/construire_carreau_risque.mjs');
  end if;

  if not (v_couv ->> 'territoire_couvert')::boolean then
    return jsonb_build_object(
      'error', 'territoire_non_carroye', 'ok', false,
      'territoire', v_jeu.territoire,
      'n_sites', (v_couv ->> 'n_sites')::int,
      'n_seveso', (v_couv ->> 'n_seveso')::int);
  end if;

  -- Le corps reel, inchange : cette fonction n'est qu'une GARDE posee devant.
  return public.construire_zone_set_corps(p_zone_set_id);
end;
$fn$;

comment on function public.construire_zone_set is
  'GARDE devant construire_zone_set_corps. Refuse un territoire que l''INSEE ne '
  'carroie pas (971, 973, 976) au lieu d''enregistrer un jeu VIDE : un jeu sans '
  'aucun code postal peut etre rattache a une campagne comme plan, et ne diffuse '
  'alors nulle part sans que rien le signale.';

revoke all on function public.construire_zone_set(uuid) from public, anon, authenticated;
grant execute on function public.construire_zone_set(uuid) to service_role;
