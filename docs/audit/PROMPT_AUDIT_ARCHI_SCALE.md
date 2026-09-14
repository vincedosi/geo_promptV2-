# AUDIT ARCHITECTURE + PASSAGE A L'ECHELLE (lecture seule)

Lis d'abord `CLAUDE.md`, `ARCHITECTURE.md` et `DESIGN_SYSTEM.md`.

## SKILLS OBLIGATOIRES

@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## MISSION

Produire un audit chiffré de l'architecture actuelle et déterminer **à partir de combien d'utilisateurs la plateforme sature**, ressource par ressource, avec la métrique qui le prouve et le coût de la levée du goulot.

Tu es en **mode audit** : aucune modification de code applicatif, aucune migration, aucun `apply_migration`. Seules écritures autorisées : les fichiers de rapport dans `docs/audit/`.

## REGLES DU JEU (non négociables)

1. **Chaque chiffre est étiqueté** : `[MESURE]` (issu d'une commande, d'un log ou d'un EXPLAIN), `[CALCULE]` (dérivé de mesures, formule affichée), `[HYPOTHESE]` (assumption, avec la valeur retenue et sa fourchette). Un chiffre sans étiquette est un défaut de l'audit.
2. **Zéro complaisance.** Si l'archi ne tient que 5 utilisateurs simultanés, écris 5. Si une donnée manque pour trancher, écris "non mesurable en l'état" et donne la commande ou l'instrumentation qui permettrait de la mesurer.
3. Contraintes Supabase pendant l'audit : compute **Nano** (250 IOPS, 5 MB/s, burst 30 min/jour), max 3 requêtes parallèles, jamais de full table scan sur `iris` (51k) ni `carreaux_filosofi` (2.3M), requêtes en lecture seule, `EXPLAIN` sans `ANALYZE` sur tout ce qui est lourd.
4. Fichiers protégés, lecture seule absolue : `/api/isochrone-battle/route.ts`, toutes les fonctions PostGIS `battle_*`, `get_isochrone_battle`, `clip_geojson_to_france`, `clip_rings_to_france`, `middleware.ts`.
5. Distingue toujours **utilisateurs inscrits**, **utilisateurs actifs simultanés** et **requêtes par seconde**. La saturation se raisonne en concurrence, pas en comptes.

## PHASE 1 : CARTOGRAPHIE DU REEL

Ne pars pas de la doc, pars du code et de la base.

- Inventaire de toutes les routes `app/api/**` : méthode, runtime (node/edge), durée max configurée, appels Supabase par requête, appels externes, payload de réponse typique.
- Inventaire des RPC PostGIS appelées, avec volatilité (`VOLATILE`/`STABLE`) et tables temporaires éventuelles.
- Tables : nombre de lignes, taille disque, index présents, index inutilisés (`pg_stat_user_indexes`), colonnes géométrie sans index GIST.
- Chemins critiques front : chargement carte (PMTiles + `/api/tiles/[z]/[x]/[y]`), import CSV/XLSX en SSE, clustering K-Means, scoring, battle, agent IA.
- Dépendances externes et quotas : PMTiles sur GitHub Releases, OpenRouteService, Gemini 2.5 Flash, Mistral, Modal, DV360 (1500 req/min projet, 700 writes/min, 300/min par annonceur), Adform (500 rapports/jour), Meta Marketing API.
- Etat du cache : LRU serveur tuiles, `isochrones_cache`, headers HTTP de cache réellement émis.

Livrable phase 1 : un tableau "surface d'exécution" (route, coût DB, coût CPU, coût réseau, dépendance externe).

## PHASE 2 : MESURE

- `pg_stat_statements` : top 20 requêtes par temps total, par temps moyen, par lignes lues. Ratio cache hit global et par table.
- `EXPLAIN (FORMAT JSON)` sur les 10 requêtes les plus coûteuses du chemin utilisateur. Repère les Seq Scan sur grosses tables, les tris disque, les estimations fausses.
- Volumétrie de réponse : poids réel des GeoJSON et MVT renvoyés (par zoom pour les tuiles), poids du bundle JS initial, nombre de requêtes réseau au premier chargement de `/map`.
- Concurrence DB : mode de pooling utilisé (Supavisor transaction ou session), nombre de connexions max disponible sur Nano, connexions ouvertes par invocation serverless, risque d'épuisement.
- Si des logs sont disponibles (`query_logs`, logs Vercel), extrais p50/p95/p99 par route et le taux d'erreur.

## PHASE 3 : MODELE DE CHARGE PAR UTILISATEUR

Construis un **profil planner** explicite et défendable, par exemple : N sessions par jour, M minutes par session, X déplacements de carte, Y analyses (scoring, clustering, battle), Z imports, W prompts agent IA. Chaque valeur est une `[HYPOTHESE]` assumée et modifiable.

Puis calcule le **coût unitaire d'un utilisateur actif** sur 6 axes :

1. requêtes SQL par heure et IOPS induites
2. Mo transférés (tuiles, GeoJSON, exports)
3. secondes d'exécution serverless
4. tokens LLM entrants/sortants
5. appels API externes (ORS, DSP)
6. euros par mois (référence actuelle : 235 à 255 €/mois HT)

## PHASE 4 : POINTS DE SATURATION

Pour chaque ressource, donne la formule, la capacité totale, la consommation par utilisateur, et le **seuil en utilisateurs actifs simultanés** :

- IOPS et débit disque Supabase Nano (y compris l'effet du burst 30 min/jour une fois épuisé)
- connexions Postgres et pooler
- CPU/mémoire du compute pendant clustering, scoring, battle et génération MVT
- timeouts et concurrence des fonctions Vercel
- bande passante PMTiles sur GitHub Releases (quota et risque de throttling)
- quotas ORS, Gemini, Mistral, Modal
- quotas DSP en écriture de bids
- croissance de stockage : Mo par campagne importée, projection à 10, 50, 200 annonceurs, sachant que la base fait déjà 6,75 Go dont 4,6 Go de `carreaux_filosofi`

Classe ensuite les goulots par ordre d'apparition : lequel casse en premier, en second, en troisième.

## PHASE 5 : SCENARIOS CHIFFRES

Tableau pour 4 paliers (5, 25, 100, 500 utilisateurs actifs simultanés, plus le nombre d'inscrits correspondant selon un taux de concurrence explicite) :

| Palier | Ce qui casse en premier | Symptôme observable | Métrique seuil | Correctif | Effort | Coût mensuel après correctif |

Précise pour chaque palier si le correctif est un **scale vertical** (compute Supabase supérieur), un **changement d'archi** (cache, CDN, pré-agrégation, read replica, materialized views, file d'attente) ou une **limitation produit** (quotas par compte).

## PHASE 6 : MULTI-TENANT ET ISOLATION

- Le modèle de données est-il réellement multi-tenant (colonne tenant/org, clés d'isolation) ou mono-espace partagé ?
- Impact des 35 tables sans RLS : risque de fuite inter-clients et, si RLS est activée demain, surcoût de performance attendu (notamment `auth.uid()` réévalué par ligne, à envelopper dans un `select`).
- Que se passe-t-il quand deux clients importent en même temps (batch insert par 50, SSE, verrous) ?
- Les invariants doivent tenir : données legacy Adform (4 campagnes, 294 135 lignes, 172 056 383 tracked_ads) intactes.

## PHASE 7 : VERDICT ET ROADMAP

- Verdict en 5 lignes maximum : plafond actuel réaliste en utilisateurs simultanés, et plafond atteignable en moins de 5 jours de travail.
- Top 10 des goulots, triés par (impact sur le plafond) / (effort).
- Quick wins de moins d'une journée, avec le gain chiffré attendu.
- Ce qu'il ne faut **pas** optimiser maintenant, et pourquoi (sur-ingénierie au regard du volume réel).
- Les 3 métriques à instrumenter en continu pour détecter la saturation avant les utilisateurs.

## LIVRABLES

1. `docs/audit/ARCHITECTURE_SCALE_AUDIT.md` : rapport complet, tableaux, formules visibles, étiquettes `[MESURE]`/`[CALCULE]`/`[HYPOTHESE]`.
2. `docs/audit/SCALE_MODEL.md` : le modèle de calcul isolé (paramètres d'entrée en tête de fichier), pour pouvoir rejouer les seuils en changeant une hypothèse.
3. `docs/audit/QUICK_WINS.md` : liste ordonnée et actionnable, un titre de tâche par ligne, prête à devenir un prompt.
4. Un seul commit : `docs(audit): architecture and scalability audit`. Aucun fichier applicatif modifié, build vert vérifié avant commit.

## FORMAT

Rapport en français, technique, sans remplissage, sans langage commercial. Tableaux plutôt que paragraphes dès qu'il y a plus de deux chiffres. Chaque affirmation de performance est adossée à une commande ou un log reproductible, cité dans le rapport.

## POST-LIVRAISON

Après le commit, vérifie qu'aucun fichier hors `docs/audit/` n'a été touché (`git diff --stat` dans le rapport final). Rapport rapide en fin de session : 3 chiffres clés, le premier goulot, et la question à laquelle tu n'as pas pu répondre faute de mesure.
