-- sql/342 — rôle Postgres `optimisation_service`, celui du service d'optimisation Python (services/optimisation/).
--
-- Plan : docs/superpowers/plans/2026-11-04-optimisation-python-architecture.md § 3.3 (T1, 04/11).
--
-- Pourquoi un rôle dédié et non la clé `service_role` : le service parle à Postgres par psycopg, en direct (pas de
-- PostgREST, donc pas de plafond `db-max-rows` de 1 000 lignes, et des transactions/verrous consultatifs). Il lui faut
-- donc un rôle de CONNEXION, borné à ce qu'il lit et écrit.
--
-- BYPASSRLS : nécessaire. `plateformes_poids`, `dsp_connections`, `campaign_dsp_report`, `bidding_zone_configs`,
-- `zone_set_extraction_cp_plateforme` (et toutes les tables ci-dessous) ont la RLS ACTIVE SANS POLICY : sans BYPASSRLS,
-- chaque lecture rendrait 0 ligne, sans erreur. Les droits de table restent la seule borne : pas de SUPERUSER, pas de
-- CREATEDB, pas de CREATEROLE, aucun droit sur `auth`, aucun DDL.
--
-- Droits limités à ce qui EXISTE au 04/11. Les tables `optimisation_cycles`, `optimisation_reglages`,
-- `cp_geoloc_defaut`, `optimisation_executions` (T8) recevront leurs droits dans leur propre migration.
--
-- MOT DE PASSE : jamais dans ce fichier, et jamais EN CLAIR vers Postgres. La variable psql `optimisation_mdp` porte un
-- VÉRIFICATEUR SCRAM-SHA-256 calculé côté client (`SCRAM-SHA-256$4096:<sel>$<StoredKey>:<ServerKey>`,
-- `services/optimisation/src/optimisation/outils/scram.py`), que Postgres stocke tel quel. Raison (relecture A, I1) : la
-- base journalise le DDL (`log_statement = ddl`) et `pg_stat_statements` garde le texte de l'`ALTER ROLE` — un mot de
-- passe en clair y restait lisible. Une valeur qui n'est pas un vérificateur est REFUSÉE (contrôle plus bas), et la
-- migration échoue sans la variable. `scripts/local/13-optimisation-up.sh` hache le mot de passe de
-- `services/optimisation/.env` (non suivi) et pose la variable par la première ligne de stdin (`\set`), jamais en
-- argument (visible dans `ps`). Chaque passage RÉALIGNE le mot de passe sur la valeur fournie.
--
-- EXECUTE par défaut (relecture A, M6) : comme tout rôle, `optimisation_service` hérite de l'EXECUTE accordé à PUBLIC —
-- dont 7 fonctions SECURITY DEFINER de `public` (`get_user_org`, `get_user_role`, `st_estimatedextent`…), exécutables
-- aussi par `anon`. Les deux `grant execute` de la fin ne sont donc pas la seule borne d'exécution. Aucun REVOKE ici :
-- base partagée, il toucherait tous les rôles.
--
-- Rejouable : création seulement si le rôle n'existe pas, puis ALTER/GRANT (idempotents). Aucun DROP, aucun REVOKE.

\set ON_ERROR_STOP on

\if :{?optimisation_mdp}
\else
  \echo 'sql/342 : variable psql optimisation_mdp absente — poser le verificateur SCRAM (voir l en-tete).'
  select 1 / 0 as optimisation_mdp_absente;
\endif

-- Jamais un mot de passe en clair : seul un vérificateur SCRAM-SHA-256 passe.
select :'optimisation_mdp' ~ '^SCRAM-SHA-256\$[0-9]+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'
  as optimisation_mdp_est_scram \gset
\if :optimisation_mdp_est_scram
\else
  \echo 'sql/342 : optimisation_mdp doit etre un verificateur SCRAM-SHA-256, jamais le mot de passe en clair.'
  select 1 / 0 as optimisation_mdp_en_clair;
\endif

select not exists (select 1 from pg_roles where rolname = 'optimisation_service') as optimisation_role_a_creer \gset

\if :optimisation_role_a_creer
  create role optimisation_service;
\endif

-- Attributs posés à CHAQUE passage : un rôle créé autrement (ou modifié à la main) revient à l'état voulu.
-- NOSUPERUSER et NOREPLICATION ne s'écrivent pas : en local `postgres` n'est pas superuser (Supabase), et seul un
-- superuser peut nommer ces deux attributs, même pour les retirer. Un rôle créé par `create role` ne les a pas ; le
-- contrôle d'après-migration (rapport T1) le vérifie dans pg_roles.
-- 5 connexions : pool de 3 (règles I/O de CLAUDE.md) + sonde /sante + une marge pour psql.
alter role optimisation_service with
  login
  bypassrls
  nocreatedb
  nocreaterole
  noinherit
  connection limit 5
  password :'optimisation_mdp';

-- Garde-fous de session : jamais une requête de plus de 30 s, jamais une transaction oubliée ouverte.
alter role optimisation_service set statement_timeout = '30s';
alter role optimisation_service set idle_in_transaction_session_timeout = '60s';
alter role optimisation_service set search_path = public, pg_catalog;

grant connect on database postgres to optimisation_service;
grant usage on schema public to optimisation_service;

-- ── Lecture : registre des plateformes ───────────────────────────────────────────────────────────────────────────────
grant select on table
  public.plateformes_poids,
  public.plateformes_geo,
  public.dsp_channel_registry
to optimisation_service;

-- ── Lecture : plan (jeux, extractions figées, stratégies) ────────────────────────────────────────────────────────────
grant select on table
  public.zone_sets,
  public.zone_set_cp,
  public.zone_set_plateformes,
  public.zone_set_extractions,
  public.zone_set_extraction_cp,
  public.zone_set_extraction_cp_plateforme,
  public.zone_set_extraction_unites,
  public.bidding_strategies,
  public.bidding_zone_configs
to optimisation_service;

-- ── Lecture : livraisons et campagnes ────────────────────────────────────────────────────────────────────────────────
grant select on table
  public.dsp_campaigns,
  public.campaign_dsp_report,
  public.campaign_cp_rollup,
  public.campaign_daily_rollup
to optimisation_service;

-- ── Lecture : référentiel des codes postaux (département d'un CP, groupes) ───────────────────────────────────────────
grant select on table
  public.ref_codes_postaux,
  public.cp_groupe
to optimisation_service;

-- ── Connexions DSP : jetons chiffrés lus, rafraîchis, statut mis à jour (T13-T14) ────────────────────────────────────
grant select, update on table public.dsp_connections to optimisation_service;

-- ── Écritures : rapports de livraison et journal des appels DSP (T15) ────────────────────────────────────────────────
grant insert on table public.campaign_dsp_report to optimisation_service;
grant insert on table public.dsp_api_logs to optimisation_service;

-- ── Fonctions : volume attendu et univers (D35, sql/337), ligne HORS_ZONE figée (sql/306). SECURITY DEFINER. ─────────
grant execute on function public.volumes_attendus_cp_univers(text[], text) to optimisation_service;
grant execute on function public.hors_zone_extraction(uuid) to optimisation_service;
