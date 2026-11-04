-- sql/348 — Optimisation en Python, correctifs de la phase 2 (relecture, point I1) : les réglages SUIVENT la campagne.
--
-- LE DÉFAUT. `optimisation_reglages.workspace_id` (sql/345) et `optimisation_reglages_journal.workspace_id` (sql/347)
-- recopient `dsp_campaigns.organization_id` au moment de l'écriture, sans rien qui les tienne égaux ensuite. Or
-- `PATCH /api/admin/campaigns/[id]` change `organization_id`. Après un tel déplacement :
--   - le SQL (`get_campaign_suivi`, l'enveloppe `refresh_campaign_rollups`) lisait le réglage par `campagne_id` SEUL ;
--   - Python (`lire_reglages`) le joignait sur `workspace_id = organization_id`, donc retombait sur les défauts ;
--   - la policy de lecture (`workspace_id = get_user_org()`) laissait l'ANCIEN espace lire le réglage et son journal.
-- Mesuré par la relecture : cockpit SQL « 52 CP cibles sous 50 % », Python « 161 CP sous 70 % », sans erreur.
--
-- LA RÈGLE CHOISIE : le réglage SUIT LA CAMPAGNE. Un seul réglage par campagne (`campagne_id` est la clé primaire), lu
-- par `campagne_id` des deux côtés — SQL inchangé, Python aligné dans le même commit (`lecture/reglages.py`,
-- `ecriture/algo_campagne.py`). L'espace ne sert plus qu'au CLOISONNEMENT (qui a le droit de lire), et `workspace_id`
-- est tenu égal à l'espace propriétaire par le déclencheur ci-dessous.
--
-- POURQUOI LA CAMPAGNE ET NON L'ESPACE. Les réglages décrivent la campagne, pas l'espace : des seuils d'alerte ajustés
-- à SON plan, la façon de construire SES tableaux par code postal, l'algorithme qui corrige SES poids. Déplacer une
-- campagne change qui la possède, pas comment elle se pilote. « Suivre l'espace » (filtrer par `workspace_id` des deux
-- côtés) aurait rendu SQL et Python égaux, mais en remettant EN SILENCE tous les défauts au déplacement : alertes,
-- tableaux et algorithme changeraient sans que personne ne l'ait décidé, et un retour dans l'espace d'origine les
-- ferait réapparaître — un réglage fantôme. Et le journal d'une campagne doit rester lisible par son propriétaire.
--
-- CE QUE POSE CETTE MIGRATION.
--   1. `optimisation_reglages_suivre_campagne()` + déclencheur `AFTER UPDATE OF organization_id` sur `dsp_campaigns` :
--      recopie le nouvel espace dans le réglage ET dans son journal (le journal est l'historique de la campagne ; sa
--      policy de lecture doit suivre le propriétaire comme celle du réglage). SECURITY DEFINER : le déplacement passe
--      par le client admin (`service_role`), et le journal n'est modifiable par AUCUN rôle applicatif.
--      Pas de clé étrangère composite `ON UPDATE CASCADE` : `organization_id` est NULLABLE (le PATCH admin accepte
--      `null`), la cascade poserait `null` dans `workspace_id not null` et ferait ÉCHOUER le déplacement. Une campagne
--      passée à `null` n'a plus d'espace : Python la refuse à tout `X-Espace` (404), le SQL lit toujours son réglage par
--      `campagne_id`, et `workspace_id` garde le dernier propriétaire (seul cas où il diffère ; documenté, testé).
--   2. Rattrapage idempotent des lignes déjà divergentes (0 le 05/11).
--   3. Mineur M1 de la relecture : `authenticated` gardait MAINTAIN (PG17) sur les deux tables. Révoqué.
--
-- Rejouable (`create or replace`, `create or replace trigger`, update conditionnel), aucun DROP.
-- Appliquer par `psql -1 -v ON_ERROR_STOP=1`.

create or replace function public.optimisation_reglages_suivre_campagne()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.optimisation_reglages
     set workspace_id = new.organization_id
   where campagne_id = new.id and workspace_id is distinct from new.organization_id;
  update public.optimisation_reglages_journal
     set workspace_id = new.organization_id
   where campagne_id = new.id and workspace_id is distinct from new.organization_id;
  return null;
end;
$$;

revoke all on function public.optimisation_reglages_suivre_campagne() from public, anon, authenticated;

create or replace trigger dsp_campaigns_optimisation_reglages_suivent
  after update of organization_id on public.dsp_campaigns
  for each row
  when (new.organization_id is distinct from old.organization_id and new.organization_id is not null)
  execute function public.optimisation_reglages_suivre_campagne();

comment on function public.optimisation_reglages_suivre_campagne() is
  'sql/348 : un déplacement de campagne (dsp_campaigns.organization_id) emporte son réglage d''optimisation et son '
  'journal ; SQL et Python lisent le réglage par campagne_id (règle unique).';

-- 2. Rattrapage (idempotent).
update public.optimisation_reglages r
   set workspace_id = c.organization_id
  from public.dsp_campaigns c
 where c.id = r.campagne_id and c.organization_id is not null and r.workspace_id <> c.organization_id;
update public.optimisation_reglages_journal j
   set workspace_id = c.organization_id
  from public.dsp_campaigns c
 where c.id = j.campagne_id and c.organization_id is not null and j.workspace_id <> c.organization_id;

comment on table public.optimisation_reglages_journal is
  'Journal des changements de réglage d''optimisation par campagne (sql/347, sql/350) : qui, quand, avant, après. '
  'Écrit par le service Python seul (INSERT) ; seul workspace_id suit un déplacement de la campagne (sql/348).';

-- 3. M1 : MAINTAIN (PG17) n'était pas révoqué.
revoke maintain on table public.optimisation_reglages from authenticated, anon;
revoke maintain on table public.optimisation_reglages_journal from authenticated, anon;

notify pgrst, 'reload schema';
