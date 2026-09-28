# MISSION : audit d'architecture MAGELIAN, livrable pour revue par les devs internes dentsu

## Contexte
Ce projet va être présenté à l'équipe de développeurs internes de dentsu. Le critère principal de jugement sera la qualité de l'architecture. Tu produis un document d'audit honnête, factuel et prêt à l'emploi, que je remettrai tel quel aux devs. Ton rôle est celui d'un architecte senior externe : ni complaisant, ni destructeur.

## Règles absolues
- Mode LECTURE SEULE : tu ne modifies, ne crées ni ne supprimes aucun fichier de code. Le seul fichier que tu écris est `docs/AUDIT-ARCHITECTURE.md`.
- Tu ne touches jamais à `app/api/isochrone-battle/route.ts` ni aux fonctions PostGIS de battle.
- Aucun secret, clé, token, URL Supabase ou ID de projet dans le document. Si tu en croises un en dur dans le code, signale-le comme finding sans le recopier.
- Rédaction en français, ton professionnel, phrases courtes. N'utilise jamais le tiret cadratin "—" : utilise des virgules, des deux-points, des parenthèses ou des points.
- Chaque affirmation critique doit être sourcée par un chemin de fichier (et ligne si pertinent) ou par la sortie d'une commande que tu as réellement exécutée. Pas de finding sans preuve.

## Phase 1 : lire la référence déclarée
1. Lis intégralement `ARCHITECTURE.md` (cherche aussi `docs/ARCHITECTURE.md`, `architecture.md`). C'est l'architecture VOULUE. Ne la considère pas comme vraie tant que tu ne l'as pas vérifiée dans le code.
2. Note pour chaque section : ce qui est affirmé, et ce qu'il faudra vérifier.

## Phase 2 : auditer le code réel
Explore systématiquement, sans te fier à la doc :
- `package.json`, `tsconfig.json`, `next.config.*`, `.env.example`, `vitest.config.*`, `eslint`, `knip.json`
- `app/` (App Router) : pages, layouts, route handlers `app/api/**`. Liste toutes les routes API avec méthode, auth, validation Zod ou non, accès DB.
- `lib/`, `components/`, `hooks/`, `types/` : frontières entre couches, imports croisés, logique métier dans les composants.
- `supabase/migrations/**`, fonctions RPC PostGIS, policies RLS : tables sans policy, RLS activé sans policy (bloque silencieusement), fonctions SECURITY DEFINER.
- Accès données : où passe-t-on par supabase-js SSR, où par `postgres`/`pg` en direct, cohérence des clients (anon vs service role).
- Tuiles MVT `app/api/tiles/**` : cache, limites de zoom, protection.
- IA : Vercel AI SDK, providers Gemini / Mistral, orchestrateur multi-agents, agent superviseur (vérifie qu'il est bien en lecture seule).
- Jobs : Inngest sans ordonnanceur, quotas via `consommer_quota`, Upstash déclaré mais non configuré.
- Python hors Next.js : `modal/bidding_ml/`, `scripts/*.py`. Contrat d'interface avec l'app (schémas, auth, gestion d'erreur).
- Tests : couverture réelle (unit vs integration), ce qui n'est pas testé.

Exécute et cite les résultats de :
- `npx tsc --noEmit` (compte d'erreurs)
- `npm run lint`
- `npm run catalogue` (knip : exports et dépendances mortes)
- `npx vitest run --reporter=verbose` (ou la commande du projet, sans casser la base)
- `find app/api -name "route.ts" | wc -l` et un inventaire des routes
- `cloc` ou `wc -l` par dossier pour les ordres de grandeur

## Phase 3 : rédiger `docs/AUDIT-ARCHITECTURE.md`
Structure imposée :

1. **Synthèse exécutive** (10 lignes max) : verdict global, 3 forces, 3 risques majeurs, note de maturité sur 5 par axe (structure, données, sécurité, tests, exploitabilité).
2. **Cartographie du système** : diagramme Mermaid des composants (Next.js, Supabase/PostGIS, Modal, Inngest, APIs externes, providers IA) et diagramme du flux d'une campagne de bout en bout (import, matching IRIS, scoring, cycle de bid quotidien, reporting).
3. **Écarts entre ARCHITECTURE.md et le code** : tableau `Affirmé | Constaté | Fichier | Gravité`. C'est la section la plus importante : les devs vont vérifier eux-mêmes.
4. **Analyse par couche** : présentation, route handlers, domaine/métier, données, jobs, IA, Python. Pour chaque couche : responsabilités, ce qui est propre, ce qui fuit.
5. **Sécurité et données** : RLS, auth, validation des entrées, secrets, exposition des tuiles, surface d'attaque des routes API.
6. **Dette technique** : tableau `ID | Constat | Preuve | Impact | Effort (S/M/L) | Priorité (P0/P1/P2)`. Inclus explicitement : vestiges (pmtiles importé nulle part, Upstash non configuré, `postgres` utilisé seulement dans health), duplication, couplages, nommage GENESIS/GEOMATIK/MAGELIAN résiduel.
7. **Tests et qualité** : couverture réelle, trous critiques, résultats tsc/lint/knip/vitest.
8. **Plan de remédiation** : 3 chantiers ordonnés (quick wins semaine 1, structurel mois 1, cible 3 mois), chacun avec livrable vérifiable.
9. **Questions ouvertes pour l'équipe interne** : 5 à 10 décisions à trancher ensemble (hébergement post-Vercel, ordonnancement des jobs, stratégie multi-signaux au-delà du géo, renommage du produit).
10. **Annexes** : inventaire des routes API, inventaire des tables et RPC, dépendances et versions, commandes exécutées avec sorties résumées.

## Critères de qualité du livrable
- Un dev qui ne connaît pas le projet doit pouvoir, en 20 minutes, comprendre le système et ouvrir les fichiers cités pour vérifier chaque finding.
- Pas de généralités ("améliorer la qualité du code") : chaque recommandation nomme le fichier ou le module concerné et l'action concrète.
- Quand quelque chose est bien fait, dis-le, avec la preuve, au même niveau d'exigence que pour les problèmes.
- Termine par un bloc "Ce que je n'ai pas pu vérifier" (accès manquant, commande en échec, hypothèses).

Commence par la Phase 1. Ne rédige pas le document avant d'avoir terminé l'exploration et exécuté les commandes.