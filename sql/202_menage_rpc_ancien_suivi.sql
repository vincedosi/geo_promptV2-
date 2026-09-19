-- sql/202 — Ménage des RPC de l'ancien écran de suivi
-- ============================================================================
--
-- Quatre fonctions sont devenues orphelines quand la Tâche 16 (2026-09-15) a
-- supprimé l'ancien écran de suivi et remplacé `SuiviV2` :
--
--     get_campaign_derive_map        sql/117
--     get_campaign_derive_ranked     sql/118
--     get_campaign_derive_headline   sql/118
--     get_campaign_suivi_cps         sql/109, puis sql/113 (signature à 3 args)
--
-- ── POURQUOI ELLES ONT SURVÉCU QUATRE JOURS ─────────────────────────────────
--
-- `ARCHITECTURE.md` interdisait explicitement de les supprimer :
--
--   « La base de données Supabase est UNIQUE et partagée entre branches — les
--     supprimer maintenant casserait l'écran de suivi en production, en
--     direct, pendant que cette branche n'est pas mergée. »
--
-- La raison était juste, et elle a cessé de valoir le 2026-09-19 : le projet
-- Supabase hébergé a été abandonné. Il n'existe plus de base partagée, plus de
-- production en ligne, et plus d'écran de suivi déployé à casser. La seule base
-- est locale, et elle sert la branche qui est sortie.
--
-- ── LES QUATRE CONDITIONS DU PROJET, VÉRIFIÉES UNE À UNE ────────────────────
--
-- `ARCHITECTURE.md` (§ ménage du 2026-09-11) fixe le critère de suppression
-- d'un objet en base. Mesures du 2026-09-19 :
--
--  1. **Aucune référence dans le code de cette branche** — 0 fichier pour les
--     quatre, sur `app/`, `lib/`, `components/` et `scripts/`.
--  2. **Aucune mention dans une fonction, vue ou vue matérialisée de `public`**
--     — 0 appelant en base, vérifié sur `pg_proc.prosrc` et sur
--     `information_schema.views`.
--  3. **Aucune clé étrangère, aucune vue dépendante** — sans objet, ce sont des
--     fonctions.
--  4. **Une définition présente dans une migration versionnée**, pour que
--     restaurer soit une opération git et non une restauration de sauvegarde :
--     sql/117, sql/118, sql/113. C'est cette condition qui rend la suppression
--     réversible, et c'est pour elle qu'on l'a vérifiée avant d'écrire ce
--     fichier.
--
-- ── CE QUI RESTE VRAI, ET QU'IL FAUT SAVOIR ─────────────────────────────────
--
-- ⚠ **`origin/main` appelle encore ces quatre RPC** — 6 fichiers au total. Tant
-- que la PR n'est pas mergée, sortir `main` en local et ouvrir l'écran de suivi
-- rendra une erreur. Ce n'est plus un incident de production (il n'y en a plus),
-- c'est une gêne de poste de travail, et elle disparaît au merge.
--
-- Les routes qui les appelaient — `digital/[id]/derive/map`, `derive/ranked`,
-- `suivi/cps` — sont supprimées par cette branche, avec `SuiviTable.tsx`,
-- `SuiviDeriveMap.tsx` et `DeriveTable.tsx` qui en étaient les seuls
-- consommateurs.
--
-- `DROP ... IF EXISTS` et non `DROP` : la migration doit pouvoir être rejouée
-- sur une base où elle est déjà passée, sans lever.

begin;

-- La carte de dérive par maille (sql/117).
drop function if exists public.get_campaign_derive_map(
  uuid, text, text, text[], double precision, double precision, double precision, double precision
);

-- Le classement des unités les plus dérivées (sql/118).
drop function if exists public.get_campaign_derive_ranked(uuid, text, text, text[], integer);

-- Le chiffre d'en-tête de la dérive (sql/118).
drop function if exists public.get_campaign_derive_headline(uuid, text, text[]);

-- Le drill-down par code postal d'un département (sql/109, élargi sql/113).
drop function if exists public.get_campaign_suivi_cps(uuid, text, text[]);
-- L'ancienne signature à deux arguments : sql/113 la supprimait déjà, mais une
-- base qui n'aurait pas reçu cette migration la porterait encore.
drop function if exists public.get_campaign_suivi_cps(uuid, text);

commit;
