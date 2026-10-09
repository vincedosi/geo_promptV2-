-- 239 — L'espace actif verrouille l'appartenance qu'il vérifie (2026-10-09)
--
-- ── LA COURSE ──────────────────────────────────────────────────────────────
--
-- `verifier_espace_actif` (sql/236) lisait l'appartenance par un simple
-- `exists`. Deux transactions concurrentes :
--   T1 : update profiles set organization_id = A   → le déclencheur voit le
--        membre (A), laisse passer ;
--   T2 : delete from organization_members (u, A)   → ne voit pas encore T1,
--        le report de l'espace actif ne trouve rien à reporter ;
-- les deux valident, et le client travaille dans un espace dont il n'est plus
-- membre — l'invariant de sql/236 violé sans erreur.
--
-- Le déclencheur prend désormais un verrou FOR KEY SHARE sur la ligne
-- d'appartenance : il n'empêche aucune lecture ni la mise à jour d'une colonne
-- non clé, mais un DELETE concurrent ATTEND la fin de T1, puis son déclencheur
-- de report voit le nouvel espace actif et le reporte.
--
-- Rejouable (create or replace). Verrouillé par
-- tests/integration/appartenance-espaces.test.ts (« course »).

begin;

create or replace function public.verifier_espace_actif()
returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.organization_id is null or new.role = 'super_admin' then
    return new;
  end if;
  perform 1 from organization_members m
    where m.user_id = new.id and m.organization_id = new.organization_id
    for key share;
  if found then
    return new;
  end if;
  raise exception 'Espace actif refusé : l''utilisateur % n''est pas membre de l''espace %.',
    new.id, new.organization_id
    using errcode = '23514';
end
$fn$;

revoke all on function public.verifier_espace_actif() from public, anon, authenticated;

commit;
