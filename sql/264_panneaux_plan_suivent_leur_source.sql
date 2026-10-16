-- 264 — Les panneaux d'un plan OOH partent avec leur source privée (2026-10-16)
--
-- Spec : docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md § 4.4 ; relecture de la tâche 8 (I1).
-- Les panneaux d'une campagne (`source like 'plan-ooh:%'`, écrits par scripts/ooh/importer-plan.ts) sont cachés aux
-- autres espaces par leur source PRIVÉE (`data_source_id`, `source_visible()`). Or `panneaux_affichage.data_source_id`
-- est `on delete set null` et `source_visible(null)` vaut VRAI : supprimer la source — ou l'espace, dont la
-- suppression emporte ses `data_sources` en cascade — rendait les noms de sites du client lisibles par TOUS les
-- espaces, et ces orphelins (`organization_id` nul aussi) bloquaient pour toujours l'import d'un autre espace sous la
-- même clé.
--
-- Mécanisme le plus étroit : un déclencheur BEFORE DELETE sur `data_sources` qui supprime, pour la source qui part,
-- d'abord ses liens de campagne (`campagne_ligne_panneaux`, `on delete restrict` côté panneau) puis ses panneaux
-- `plan-ooh:%`. Aucune autre famille de panneaux n'est touchée : leur `set null` reste tel quel. Supprimer les liens
-- AVANT les panneaux rend le résultat indépendant de l'ordre des cascades issues de `organizations` (campagnes et
-- data_sources partent dans des actions référentielles distinctes, dont l'ordre n'est pas garanti).
-- Supprimer la seule source privée d'une ligne retire donc aussi ses panneaux de la campagne : la ligne garde ses
-- montants, son `data_source_id` passe à null (« liste non fournie ») — un rejeu du script la reconstruit.
--
-- SECURITY DEFINER : un admin d'espace peut supprimer sa source par PostgREST (`ds_modify_delete`) sans aucun droit
-- d'écriture sur les panneaux ni sur les liens ; le déclencheur doit pouvoir nettoyer derrière lui. Il ne touche que
-- les lignes de la source en cours de suppression.
--
-- Coût : deux DELETE par `data_source_id` (index `idx_panneaux_source`) et par `panneau_id`
-- (`campagne_ligne_panneaux_panneau_id_idx`) ; ≈ 900 panneaux au plus par source de plan. Une source non `plan-ooh`
-- ne paie qu'un parcours d'index vide.
-- Droits : fonction de déclencheur, EXECUTE retiré à public/anon/authenticated. Rejouable (CREATE OR REPLACE, création
-- du déclencheur gardée par pg_trigger, aucun DROP).

begin;

create or replace function public.supprimer_panneaux_plan_de_source()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  delete from public.campagne_ligne_panneaux l
   using public.panneaux_affichage p
   where l.panneau_id = p.id
     and p.data_source_id = old.id
     and p.source like 'plan-ooh:%';
  delete from public.panneaux_affichage p
   where p.data_source_id = old.id
     and p.source like 'plan-ooh:%';
  return old;
end
$function$;

comment on function public.supprimer_panneaux_plan_de_source() is
  'Avant suppression d une data_source : retire ses panneaux plan-ooh:% et leurs liens de campagne, sinon set null les rendrait visibles de tous (sql/264).';

revoke all on function public.supprimer_panneaux_plan_de_source() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_data_sources_panneaux_plan' and tgrelid = 'public.data_sources'::regclass) then
    create trigger trg_data_sources_panneaux_plan before delete on public.data_sources
      for each row execute function public.supprimer_panneaux_plan_de_source();
  end if;
end
$$;

commit;
