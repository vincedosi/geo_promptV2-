-- sql/199 — Lecture de la courbe de couverture par rayon (2026-09-18)
--
-- Sert l'onglet « Rayon d'influence ». Lit UNIQUEMENT la table pré-calculée
-- `couverture_rayon_risque` (sql/198) : aucun croisement géométrique ici, donc
-- une réponse en millisecondes quels que soient les filtres.
--
-- ── CE QUE LA SÉRIE VEUT DIRE ─────────────────────────────────────────────
--
-- Un point (r, p) se lit « p habitants vivent à MOINS DE r mètres d'au moins un
-- site retenu ». La table stocke des INCRÉMENTS par palier de 100 m ; le cumul
-- se fait ici, par fonction de fenêtrage.
--
-- ⚠ Le décalage de 100 m est voulu. Le palier `b` de la table regroupe les
-- carreaux dont la distance tombe dans [b, b+100). La population « à moins de
-- 100 m » est donc l'incrément du palier 0, et le point est émis à r = 100.
-- Émettre à r = 0 ferait dire « 12 000 habitants à moins de 0 mètre ».
--
-- ── LA COURBE « TOUTES NATURES » N'EST PAS LA SOMME DES AUTRES ────────────
--
-- Un carreau proche de deux natures compte dans les deux courbes — c'est
-- correct, chaque courbe répond à sa propre question. Les additionner ne l'est
-- pas. La courbe totale vient donc des lignes `nature = '*'`, calculées à la
-- construction sur le MINIMUM par carreau.
--
-- Corollaire honnête : quand l'utilisateur ne retient QU'UNE PARTIE des
-- natures, le total de ce sous-ensemble n'est pas stocké. La fonction rend
-- alors `total_est_global = true` pour que l'écran dise que la courbe totale
-- porte sur TOUTES les natures, et pas seulement sur celles affichées.

create or replace function public.lire_couverture_rayon(
  p_cible        text default 'ind',
  p_gravites     text[] default null,
  p_natures      text[] default null,
  p_perim_niveau text default null,
  p_perim_codes  text[] default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_gravite   text;
  v_depts     text[] := null;
  v_result    jsonb;
  v_total_global boolean;
begin
  -- La cible est validée contre le CATALOGUE, jamais interpolée : même barrière
  -- que `population_exposee_agregee` (sql/185).
  if not exists (select 1 from public.cibles_exposition where code = p_cible and actif) then
    return jsonb_build_object('error', 'cible_inconnue', 'calculable', false);
  end if;

  -- La gravité se résout en UNE valeur stockée. `'*'` n'est pas « aucun
  -- filtre » : c'est la ligne pré-calculée « toutes gravités confondues »,
  -- obtenue au minimum par carreau. Sélectionner les deux gravités revient
  -- donc à lire `'*'`, et surtout PAS à sommer les deux lignes.
  if p_gravites is null or array_length(p_gravites, 1) is null
     or array_length(p_gravites, 1) >= 2 then
    v_gravite := '*';
  else
    v_gravite := p_gravites[1];
  end if;

  if p_perim_niveau = 'departement' then
    v_depts := p_perim_codes;
  elsif p_perim_niveau = 'region' then
    select array_agg(d.code_dept) into v_depts
      from public.ref_departements d
     where d.code_region = any(p_perim_codes);
  end if;

  -- Le total porte-t-il sur plus de natures que celles affichées ?
  v_total_global := p_natures is not null and array_length(p_natures, 1) is not null;

  with
  base as (
    select r.nature, r.rayon_m, r.n_carreaux,
           coalesce((r.populations->>p_cible)::numeric, 0) as pop
      from public.couverture_rayon_risque r
     where r.gravite = v_gravite
       and (v_depts is null or r.code_departement = any(v_depts))
       -- La nature `'*'` est TOUJOURS retenue : c'est la courbe totale, elle ne
       -- dépend pas du filtre de natures.
       and (p_natures is null or array_length(p_natures, 1) is null
            or r.nature = '*' or r.nature = any(p_natures))
  ),
  -- Somme des départements du périmètre, palier par palier.
  par_palier as (
    select nature, rayon_m, sum(pop) as pop, sum(n_carreaux) as n_carreaux
      from base
     group by nature, rayon_m
  ),
  -- Le cumul. `rows between unbounded preceding and current row` est explicite
  -- à dessein : le défaut d'une fonction de fenêtrage ordonnée est `range`, qui
  -- regrouperait les ex æquo — sans effet ici, les paliers étant uniques par
  -- nature, mais un défaut implicite dans un calcul cumulé est exactement le
  -- genre de chose qui se met à mentir quand la clé change.
  cumul as (
    select nature,
           -- Décalage de 100 m : voir l'en-tête.
           rayon_m + 100 as rayon_m,
           pop,
           sum(pop) over (partition by nature order by rayon_m
                          rows between unbounded preceding and current row) as pop_cumulee,
           sum(n_carreaux) over (partition by nature order by rayon_m
                          rows between unbounded preceding and current row) as carreaux_cumules
      from par_palier
  ),
  -- ── LA GRILLE COMPLÈTE ──────────────────────────────────────────────
  --
  -- Une nature sans aucun carreau à un palier donné n'a pas de ligne : la
  -- courbe avait donc des trous — mesuré, 94 points sur 99 pour les
  -- « Inflammables (ancienne nomenclature) ». Une courbe à trous se dessine de
  -- travers (Recharts relie les points existants, ce qui invente une pente) et
  -- rendrait faux tout report de cumul côté client.
  --
  -- On produit donc la grille ENTIÈRE, 100 à 10 000 par pas de 100, et on
  -- REPORTE le dernier cumul connu sur les paliers vides. C'est exact : si
  -- aucun carreau nouveau n'entre entre 3 200 et 3 300 m, la population
  -- couverte n'a pas bougé.
  grille as (
    select c.nature, g.r
      from (select distinct nature from cumul) c
      cross join generate_series(100, 10000, 100) g(r)
  ),
  complet as (
    select g.nature, g.r as rayon_m,
           coalesce(c.pop, 0) as pop,
           -- Le report : dernier cumul connu, zéro avant le premier point.
           coalesce(
             max(c.pop_cumulee) over (partition by g.nature order by g.r
                                      rows between unbounded preceding and current row),
             0) as pop_cumulee,
           coalesce(
             max(c.carreaux_cumules) over (partition by g.nature order by g.r
                                           rows between unbounded preceding and current row),
             0) as carreaux_cumules,
           -- Le cumul du palier PRÉCÉDENT, pour en déduire l'incrément par
           -- différence. `1 preceding` et non `current row` : c'est toute la
           -- différence entre un télescopage exact et une accumulation
           -- d'arrondis.
           coalesce(
             max(c.pop_cumulee) over (partition by g.nature order by g.r
                                      rows between unbounded preceding and 1 preceding),
             0) as cumul_precedent
      from grille g
      left join cumul c on c.nature = g.nature and c.rayon_m = g.r
  ),
  courbes as (
    select nature,
           max(pop_cumulee) as total,
           max(carreaux_cumules) as carreaux,
           jsonb_agg(jsonb_build_object(
             'r', rayon_m,
             'p', round(pop_cumulee),
             -- ⚠ L'INCRÉMENT EST LA DIFFÉRENCE DE DEUX CUMULS ARRONDIS, jamais
             -- l'arrondi de l'incrément brut.
             --
             -- La spec exige que la somme des incréments égale le cumul final.
             -- Avec `round(pop)` par palier, 100 arrondis indépendants
             -- s'accumulent : mesuré 242 483 contre 242 457, soit 26 habitants
             -- d'écart sortis de nulle part. La différence de deux cumuls
             -- arrondis, elle, télescope — la somme retombe EXACTEMENT sur le
             -- dernier cumul, par construction.
             --
             -- Même correctif que `population_exposee_agregee` (sql/188), pour
             -- exactement la même raison.
             'i', round(pop_cumulee) - coalesce(round(cumul_precedent), 0)
           ) order by rayon_m) as points
      from complet
     group by nature
  )
  select jsonb_build_object(
    'calculable', true,
    'cible', p_cible,
    'gravite', v_gravite,
    'perim_niveau', p_perim_niveau,
    'perim_codes', to_jsonb(coalesce(p_perim_codes, array[]::text[])),
    'rayon_max_m', 10000,
    -- Le total affiché porte-t-il sur plus de natures que celles montrées ?
    'total_est_global', v_total_global,
    'n_departements', (select count(distinct code_departement) from public.couverture_rayon_risque
                        where gravite = v_gravite
                          and (v_depts is null or code_departement = any(v_depts))),
    'courbes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cle',      nature,
               'total',    round(total),
               'carreaux', carreaux,
               'points',   points
             ) order by (nature = '*') desc, total desc)
        from courbes
    ), '[]'::jsonb),
    -- ⚠ LA COUVERTURE DU PRÉ-CALCUL REMONTE À L'ÉCRAN.
    --
    -- La table peut être partielle : la construction se fait par bandes et peut
    -- être interrompue — elle l'a été le 2026-09-18 à 19 bandes sur 40, sur
    -- alerte de budget d'I/O Supabase. Une courbe bâtie sur une France
    -- incomplète SOUS-ESTIME, et rien dans les données ne le signale : elle a
    -- exactement la même forme qu'une courbe complète.
    'couverture_pct', (
       select round(100.0 * coalesce(sum(lon_max - lon_min), 0) / (9.8 - (-5.5)))
         from public.couverture_rayon_bandes),
    'n_bandes_construites', (select count(*) from public.couverture_rayon_bandes),
    'calcule_le', now()
  ) into v_result;

  return v_result;
end;
$fn$;

comment on function public.lire_couverture_rayon(text, text[], text[], text, text[]) is
  'Courbe cumulee de population par rayon, lue dans la table pre-calculee. La courbe '
  'nature=''*'' n''est PAS la somme des autres : un carreau proche de deux natures compte '
  'dans les deux courbes, ce qui est correct pour chacune mais faux pour leur somme.';

revoke all on function public.lire_couverture_rayon(text, text[], text[], text, text[]) from public, anon, authenticated;
grant execute on function public.lire_couverture_rayon(text, text[], text[], text, text[]) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Le nombre de SITES concernés par les filtres — un KPI de l'onglet.
-- Il ne se déduit pas de la table de couverture, qui compte des carreaux.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.compter_sites_rayon(
  p_gravites     text[] default null,
  p_natures      text[] default null,
  p_perim_niveau text default null,
  p_perim_codes  text[] default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_depts text[] := null;
begin
  if p_perim_niveau = 'departement' then
    v_depts := p_perim_codes;
  elsif p_perim_niveau = 'region' then
    select array_agg(d.code_dept) into v_depts
      from public.ref_departements d
     where d.code_region = any(p_perim_codes);
  end if;

  return (
    select jsonb_build_object(
      -- `sum(n)` et NON `count(*)` : la sous-requête est déjà groupée par
      -- nature, donc `count(*)` aurait compté les NATURES — 8 au lieu de 1 258.
      'n_sites', coalesce(sum(n), 0),
      'par_nature', coalesce(jsonb_object_agg(nature, n) filter (where nature is not null), '{}'::jsonb))
    from (
      select coalesce(nullif(p.metadata->>'libelle_nature', ''), 'Nature non précisée') as nature,
             count(*) as n
        from public.poi_france p
       where p.categorie = 'risque_industriel'
         and p.sous_categorie in ('seveso_haut', 'seveso_bas')
         and coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation'
         and p.lng is not null and p.lat is not null
         and (p_gravites is null or array_length(p_gravites,1) is null
              or p.sous_categorie = any(p_gravites))
         and (p_natures is null or array_length(p_natures,1) is null
              or coalesce(nullif(p.metadata->>'libelle_nature', ''), 'Nature non précisée') = any(p_natures))
         and (v_depts is null or p.code_departement = any(v_depts))
       group by 1
    ) t
  );
end;
$fn$;

revoke all on function public.compter_sites_rayon(text[], text[], text, text[]) from public, anon, authenticated;
grant execute on function public.compter_sites_rayon(text[], text[], text, text[]) to service_role;
