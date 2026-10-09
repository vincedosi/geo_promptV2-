-- 237 — Un compte neuf naît SANS espace actif (2026-10-09)
--
-- ── LE CONSTAT ─────────────────────────────────────────────────────────────
--
-- Créer un compte depuis l'administration rendait 500 « Utilisateur
-- introuvable » en local. Deux défauts empilés :
--
--   1. Le déclencheur `on_auth_user_created` (auth.users → handle_new_user)
--      n'existe pas dans la base locale : il avait été posé à la main sur le
--      projet hébergé, aucun fichier sql/ ne le crée, et le dump local est en
--      `--data-only` pour le schéma auth. Sans lui, aucun profil n'est créé, et
--      la route `POST /api/admin/users` met à jour un profil absent.
--
--   2. Remis tel quel, il casserait autrement : handle_new_user posait
--      l'espace GENESIS (Global) comme espace actif SANS appartenance. sql/236
--      refuse désormais un espace actif dont l'utilisateur n'est pas membre
--      (23514) : `createUser` échouerait en entier.
--
-- On n'ajoute PAS d'appartenance automatique à l'espace interne : chaque
-- client créé deviendrait membre de l'espace interne et en verrait les
-- données. Le compte naît avec `organization_id` null (il ne voit que le
-- socle) ; c'est la route d'administration qui pose l'appartenance puis
-- l'espace actif, dans cet ordre (lib/espaces/appartenance.ts).
--
-- `on conflict do nothing` : les tests d'intégration créent le compte puis
-- `upsert` leur profil ; ils restent valables avec ou sans déclencheur.
--
-- Verrouillé par tests/integration/creation-compte.test.ts.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  insert into public.profiles (id, email, full_name, organization_id)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', null)
  on conflict (id) do nothing;
  return new;
end;
$fn$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
