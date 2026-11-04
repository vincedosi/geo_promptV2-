-- Fixture de parité de la tâche 2.3 : `get_campaign_suivi` de la démo « élections » sous plusieurs réglages de seuils.
-- Chaque réglage est posé DANS une transaction annulée (rien n'est écrit). Lancement, depuis services/optimisation :
--   docker exec -i supabase_db_genesis_app psql -U postgres -X -q -At < tests/parite/generer_suivi_reglages.sql \
--     > tests/parite/fixtures/suivi-reglages.json
begin;
create temp table cas_reglages (rang int, parametres jsonb, acteurs text[], sortie text) on commit drop;
do $$
declare
  v_cas record;
  v_rang int := 0;
begin
  for v_cas in
    select p::jsonb as parametres, a::text[] as acteurs from (values
      ('{}', null),
      ('{"seuils": {"cp_sous_plan_pct": 50, "rythme_retard": 0.5, "rythme_retard_grave": 0.4}}', null),
      ('{"seuils": {"rythme_retard": 0.9, "rythme_retard_grave": 0.85}}', null),
      ('{"seuils": {"cpm_depassement": 1.0}}', null),
      ('{"seuils": {"cp_sous_plan_pct": 95.5, "fuite_pct": 0.1}}', null),
      ('{"seuils": {"rythme_avance": 0.7, "rythme_avance_grave": 0.75, "rythme_retard": 0.6, "rythme_retard_grave": 0.5}}', null),
      ('{"seuils": {"cp_sous_plan_pct": 80, "cpm_depassement": 0.9}}', '{dv360}'),
      ('{"tableaux_depuis_plan": true, "univers_methode_a": "referentiel"}', null)
    ) v(p, a)
  loop
    insert into public.optimisation_reglages (campagne_id, workspace_id, parametres)
    values ('dccc0000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', v_cas.parametres)
    on conflict (campagne_id) do update set parametres = excluded.parametres;
    insert into cas_reglages values (v_rang, v_cas.parametres, v_cas.acteurs,
      public.get_campaign_suivi('dccc0000-0000-4000-8000-000000000002', v_cas.acteurs)::text);
    v_rang := v_rang + 1;
  end loop;
end $$;
select jsonb_pretty(jsonb_build_object('cas', jsonb_agg(jsonb_build_object(
  'parametres', parametres, 'acteurs', to_jsonb(acteurs), 'sortie', sortie) order by rang)))
  from cas_reglages;
rollback;
