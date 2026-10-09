-- 236 — Appartenance aux espaces de travail, tenue EN BASE (2026-10-09)
--
-- ── DEUX COLONNES, UNE RÈGLE ───────────────────────────────────────────────
--
--   organization_members (user_id, organization_id) — à quels espaces
--     l'utilisateur APPARTIENT : source de vérité de l'appartenance ;
--   profiles.organization_id — dans quel espace il TRAVAILLE en ce moment
--     (l'espace actif), lu par getOrgSourceIds et get_user_org().
--
-- Invariant : pour un non-super_admin, l'espace actif est un espace dont il
-- est membre, ou null (il ne voit alors que le socle).
--
-- ── LE CONSTAT DU 2026-10-08 ───────────────────────────────────────────────
--
-- Aucun code n'écrivait organization_members : « ajouter un membre » ne
-- posait que profiles.organization_id. Les deux comptes clients avaient donc
-- un espace actif sans en être membres ; basculés ailleurs, ils n'auraient
-- plus pu revenir (/api/user/switch-org exige l'appartenance).
--
-- La règle est en base et pas seulement dans les routes : c'est la leçon de
-- sql/234, où la base était la seule barrière face à un appel PostgREST
-- direct. Verrouillé par tests/integration/appartenance-espaces.test.ts.

begin;

-- ── 1. Rattrapage ──────────────────────────────────────────────────────────
insert into public.organization_members (user_id, organization_id)
select p.id, p.organization_id
  from public.profiles p
 where p.organization_id is not null
on conflict (user_id, organization_id) do nothing;

-- ── 2. L'espace actif d'un non-super_admin est un de ses espaces ───────────
create or replace function public.verifier_espace_actif()
returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.organization_id is null or new.role = 'super_admin' then
    return new;
  end if;
  if exists (select 1 from organization_members m
              where m.user_id = new.id and m.organization_id = new.organization_id) then
    return new;
  end if;
  raise exception 'Espace actif refusé : l''utilisateur % n''est pas membre de l''espace %.',
    new.id, new.organization_id
    using errcode = '23514';
end
$fn$;

drop trigger if exists profiles_espace_actif_membre on public.profiles;
create trigger profiles_espace_actif_membre
  before insert or update of organization_id, role on public.profiles
  for each row execute function public.verifier_espace_actif();

-- ── 3. Retirer quelqu'un de son espace actif le reporte ailleurs ───────────
-- Sur un autre de ses espaces (le plus ancien), ou null. Un super_admin n'est
-- pas lié à ses appartenances : son espace actif n'est pas touché.
create or replace function public.reporter_espace_actif()
returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  update profiles p
     set organization_id = (
       select m.organization_id from organization_members m
        where m.user_id = old.user_id
        order by m.joined_at asc nulls last, m.organization_id
        limit 1)
   where p.id = old.user_id
     and p.organization_id = old.organization_id
     and p.role <> 'super_admin';
  return old;
end
$fn$;

drop trigger if exists organization_members_report_espace_actif on public.organization_members;
create trigger organization_members_report_espace_actif
  after delete on public.organization_members
  for each row execute function public.reporter_espace_actif();

-- ── 4. Remplacer les espaces d'un utilisateur, atomiquement ────────────────
-- La fiche utilisateur coche plusieurs cases en une fois. Ordre voulu :
-- ajouter, placer l'espace actif, PUIS retirer — à aucun moment l'invariant
-- n'est violé, et le déclencheur de report n'a rien à reporter.
create or replace function public.remplacer_espaces_utilisateur(
  p_user uuid, p_espaces uuid[], p_actif uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_role text;
  v_espaces uuid[] := coalesce(p_espaces, '{}');
begin
  select role into v_role from profiles where id = p_user;
  if v_role is null then
    raise exception 'Utilisateur % introuvable.', p_user using errcode = 'P0002';
  end if;
  if p_actif is not null and v_role <> 'super_admin' and not (p_actif = any (v_espaces)) then
    raise exception 'L''espace actif doit faire partie des espaces de l''utilisateur.'
      using errcode = '22023';
  end if;

  insert into organization_members (user_id, organization_id)
  select p_user, e from unnest(v_espaces) as e
  on conflict (user_id, organization_id) do nothing;

  update profiles set organization_id = p_actif where id = p_user;

  delete from organization_members
   where user_id = p_user and not (organization_id = any (v_espaces));

  return jsonb_build_object(
    'espaces', (select coalesce(jsonb_agg(organization_id order by organization_id), '[]'::jsonb)
                  from organization_members where user_id = p_user),
    'espace_actif', (select organization_id from profiles where id = p_user));
end
$fn$;

revoke all on function public.remplacer_espaces_utilisateur(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.remplacer_espaces_utilisateur(uuid, uuid[], uuid) to service_role;
revoke all on function public.verifier_espace_actif() from public, anon, authenticated;
revoke all on function public.reporter_espace_actif() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
