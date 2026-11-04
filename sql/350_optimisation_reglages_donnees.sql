-- sql/350 — Optimisation en Python, correctifs de la phase 2 (relecture, point I3 et mineur M2) : les corrections de
-- données et les seuils deviennent RÉGLABLES par campagne, avec journal et bornes hautes.
--
-- LE DÉFAUT (I3). `optimisation_reglages.parametres` (sql/345) portait les bascules `tableaux_depuis_plan`,
-- `univers_methode_a` et les seuils d'alerte, mais AUCUN écrivain : `authenticated` n'a pas le droit d'écrire et seul
-- l'algorithme (`algo_id`, tâche 2.7) avait une route. Les corrections étaient livrées éteintes, sans interrupteur.
-- L'écrivain est la route `PUT /v1/campagnes/{id}/reglages` du service (relayée par
-- `PUT /api/campaigns/[campaignId]/optimisation/reglages`) ; cette migration lui donne son journal.
--
-- CE QUE POSE CETTE MIGRATION (aucun DROP) :
--   1. `optimisation_reglages_journal.nature` (`algo` | `reglages`, défaut `algo` : les lignes existantes restent des
--      changements d'algorithme), `reglages_avant` / `reglages_apres` (jsonb, le `parametres` d'avant et d'après).
--      Une ligne `reglages` garde l'algorithme courant dans `algo_avant` = `algo_apres` (et ses surcharges) : un
--      changement de seuil n'est pas un changement d'algorithme. CHECK de cohérence : `algo` sans `reglages_*`,
--      `reglages` avec les deux, chacun valide pour `optimisation_parametres_valides`.
--   2. Mineur M2 : bornes HAUTES dans `optimisation_parametres_valides` (CREATE OR REPLACE ; même forme que sql/345, une
--      seule condition ajoutée). Un pourcentage au-delà de 100 n'a pas de sens, et `cp_sous_plan_pct = 100000` ou
--      `fuite_pct = 1e400` passaient. Bornes : `*_pct` ≤ 100 ; rythmes et `cpm_depassement` ≤ 10 (un indice de rythme
--      de 10 = dix fois le budget du temps écoulé : au-delà, aucune alerte ne pourrait jamais partir). Mêmes bornes
--      côté Pydantic (`Seuils`, `le=`), comparées par test. 0 ligne en base : rien à revalider.
--
-- Rejouable : `add column if not exists`, contrainte sous garde, `create or replace`. Appliquer par
-- `psql -1 -v ON_ERROR_STOP=1`.

-- 2. Bornes hautes (M2). Corps de sql/345 recopié ; seule la ligne « sql/350 » change.
create or replace function public.optimisation_parametres_valides(p jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_typeof(p) = 'object', false)
     -- Clés connues seulement (comme `extra="forbid"` côté Python) : une faute de frappe est refusée, jamais ignorée.
     and case when jsonb_typeof(p) = 'object'
              then not exists (select 1 from jsonb_object_keys(p) k
                                where k not in ('seuils', 'tableaux_depuis_plan', 'univers_methode_a'))
              else false end
     and (not (p ? 'seuils') or (
           jsonb_typeof(p -> 'seuils') = 'object'
       and not exists (
             select 1 from jsonb_each(p -> 'seuils') e(cle, valeur)
              where e.cle not in ('rythme_retard', 'rythme_retard_grave', 'rythme_avance', 'rythme_avance_grave',
                                  'cpm_depassement', 'cp_sous_plan_pct', 'fuite_pct', 'ecart_signale_pct')
                 -- CASE et non OR : l'ordre d'évaluation d'un OR n'est pas garanti, le cast d'un texte lèverait.
                 or case when jsonb_typeof(e.valeur) = 'number'
                         then (e.valeur #>> '{}')::numeric <= 0
                              -- sql/350 (M2) : bornes hautes, comme `Seuils` (`le=`) côté Python.
                              or (e.valeur #>> '{}')::numeric > case when e.cle like '%\_pct' then 100 else 10 end
                         else true end)))
     and (not (p ? 'tableaux_depuis_plan') or jsonb_typeof(p -> 'tableaux_depuis_plan') = 'boolean')
     and (not (p ? 'univers_methode_a') or (p ->> 'univers_methode_a') in ('fige', 'referentiel'))
     -- Ordre des seuils de rythme, défauts compris (mêmes règles que `Seuils._ordonnes` côté Python).
     and public.optimisation_seuil(p, 'rythme_retard_grave', 0.70) <= public.optimisation_seuil(p, 'rythme_retard', 0.85)
     and public.optimisation_seuil(p, 'rythme_avance_grave', 1.30) >= public.optimisation_seuil(p, 'rythme_avance', 1.15)
     and public.optimisation_seuil(p, 'rythme_retard', 0.85) < public.optimisation_seuil(p, 'rythme_avance', 1.15)
$$;

-- 1. Le journal des réglages de données.
alter table public.optimisation_reglages_journal
  add column if not exists nature text not null default 'algo',
  add column if not exists reglages_avant jsonb,
  add column if not exists reglages_apres jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.optimisation_reglages_journal'::regclass
                  and conname = 'optimisation_reglages_journal_nature') then
    alter table public.optimisation_reglages_journal
      add constraint optimisation_reglages_journal_nature check (
        (nature = 'algo' and reglages_avant is null and reglages_apres is null)
        or (nature = 'reglages' and reglages_avant is not null and reglages_apres is not null
            and public.optimisation_parametres_valides(reglages_avant)
            and public.optimisation_parametres_valides(reglages_apres)));
  end if;
end $$;

comment on column public.optimisation_reglages_journal.nature is
  'sql/350 : algo = changement d''algorithme (tâche 2.7) ; reglages = changement de parametres (seuils, bascules des '
  'corrections de données), avant / après dans reglages_avant / reglages_apres.';

notify pgrst, 'reload schema';
