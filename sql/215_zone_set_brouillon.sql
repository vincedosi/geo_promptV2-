-- sql/215 — Le brouillon de jeu de zones, et le seuil rejouable
--           (2026-09-20)
--
-- ── LE PROBLÈME : LE SEUIL DOIT ÊTRE RÉGLABLE, ET LE CALCUL DURE 21 S ────
--
-- Le brief appelle la dilution au code postal « le point dur » du produit, et
-- il a raison : le DSP achète au CODE POSTAL, le risque se mesure au carreau
-- de 200 m. Un cercle d'un kilomètre est bien plus petit qu'un code postal, et
-- le seuil de couverture décide seul de ce qu'on achète pour rien.
--
-- Un curseur ne vaut que s'il répond tout de suite. Or `construire_zone_set`
-- prend **21,3 s** — mesuré sur 7 classes et 1 942 codes postaux.
--
-- ── CE QUI EST FAIT, ET POURQUOI C'EST BON MARCHÉ ────────────────────────
--
-- Le calcul coûteux — quel carreau appartient à quelle classe, quelle part de
-- chaque code postal cela couvre — NE DÉPEND PAS du seuil. Le seuil ne décide
-- que d'une chose : à partir de quelle part un code postal est `retenu`.
--
-- On construit donc UNE fois, on garde `part_en_zone` pour TOUS les codes
-- postaux touchés, et le seuil se rejoue par un simple `update` sur 1 942
-- lignes. Mesuré : **10 ms**.
--
-- ── LE BROUILLON ─────────────────────────────────────────────────────────
--
-- L'atelier a besoin de ce calcul AVANT qu'un nom soit donné : on règle, on
-- compare, on décide, puis on enregistre. Un jeu `brouillon` porte donc le
-- résultat sans apparaître dans la liste des jeux. L'enregistrer, c'est lui
-- donner un nom et lever le drapeau — jamais recalculer.

alter table public.zone_sets
  add column if not exists brouillon boolean not null default false;

comment on column public.zone_sets.brouillon is
  'Jeu construit par l''atelier mais pas encore enregistre. Exclu de la liste, '
  'et purge par purger_brouillons_zone_set(). Enregistrer = nommer et lever ce '
  'drapeau, jamais reconstruire.';

-- Un seul brouillon par (organisation, profil) : re-régler le même profil
-- réutilise le calcul au lieu d'en empiler un par clic.
create unique index if not exists idx_zone_sets_brouillon_unique
  on public.zone_sets (org_id, profil_hash)
  where brouillon;

-- ═══════════════════════════════════════════════════════════════════════════
-- REJOUER LE SEUIL
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.appliquer_seuil_zone_set(
  p_zone_set_id uuid,
  p_seuil numeric
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_retenus int;
  v_pop_zone numeric;
  v_pop_cp numeric;
begin
  if p_seuil is null or p_seuil < 0 or p_seuil > 100 then
    return jsonb_build_object('error', 'seuil_hors_bornes', 'calculable', false);
  end if;

  if not exists (select 1 from public.zone_sets where id = p_zone_set_id) then
    return jsonb_build_object('error', 'jeu_introuvable', 'calculable', false);
  end if;

  update public.zone_set_cp
     set retenu = (part_en_zone >= p_seuil)
   where zone_set_id = p_zone_set_id;

  /*
   * Les deux populations du taux d'utile, et elles ne se confondent pas :
   *   · `pop_en_zone` = ce qu'on VISE — les habitants réellement dans la zone ;
   *   · `pop_totale` des codes postaux retenus = ce qu'on ACHÈTE.
   * Leur rapport est le taux d'utile. C'est le seul chiffre qui dise ce que le
   * seuil coûte, et il doit voyager avec le jeu.
   */
  select coalesce(sum(pop_en_zone), 0),
         coalesce(sum(pop_totale) filter (where retenu), 0),
         count(*) filter (where retenu)
    into v_pop_zone, v_pop_cp, v_retenus
    from public.zone_set_cp where zone_set_id = p_zone_set_id;

  update public.zone_sets
     set seuil_couverture_cp = p_seuil,
         n_cp_retenus = v_retenus,
         -- `nullif` et non `coalesce(…, 0)` : un taux d'utile de 0 % se lit
         -- « on achète tout pour ne viser personne », un taux NUL se lit
         -- « aucun code postal retenu, la question ne se pose pas ». Les
         -- confondre ferait afficher un chiffre alarmant là où il n'y a rien.
         taux_utile = round(100 * v_pop_zone / nullif(v_pop_cp, 0), 1)
   where id = p_zone_set_id;

  return jsonb_build_object(
    'ok', true, 'seuil', p_seuil, 'n_cp_retenus', v_retenus,
    'population_visee', round(v_pop_zone),
    'population_achetee', round(v_pop_cp),
    'taux_utile', round(100 * v_pop_zone / nullif(v_pop_cp, 0), 1));
end;
$fn$;

comment on function public.appliquer_seuil_zone_set is
  'Rejoue le seuil de couverture d''un jeu SANS reconstruire : le calcul couteux '
  '(carreau -> classe -> part de code postal) ne depend pas du seuil. Mesure : '
  '10 ms contre 21,3 s pour une construction.';

revoke all on function public.appliquer_seuil_zone_set(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.appliquer_seuil_zone_set(uuid, numeric) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- PURGE DES BROUILLONS
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.purger_brouillons_zone_set(p_age_heures int default 24)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare v_n int;
begin
  -- `on delete cascade` emporte geometries et codes postaux.
  delete from public.zone_sets
   where brouillon and created_at < now() - make_interval(hours => p_age_heures);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'brouillons_supprimes', v_n);
end;
$fn$;

comment on function public.purger_brouillons_zone_set is
  'Retire les brouillons d''atelier plus vieux que N heures. Un brouillon porte '
  'des geometries et jusqu''a 2 000 lignes de codes postaux : les laisser '
  's''accumuler ferait grossir la base sans que personne les voie.';

revoke all on function public.purger_brouillons_zone_set(int)
  from public, anon, authenticated;
grant execute on function public.purger_brouillons_zone_set(int) to service_role;
