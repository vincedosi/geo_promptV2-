# Plan de refactor — 2026-09-11

> Phase 3 de `/audit-refactor`. Constats dans `docs/AUDIT.md`, cartographie dans
> `docs/CARTOGRAPHIE.md`.
>
> **Invariant** : comportement observable constant. Mêmes entrées, mêmes
> sorties, mêmes routes, mêmes signatures, même schéma, même UI, mêmes effets de
> bord. Ce qui exigerait un changement de comportement est en **hors périmètre**,
> à ton arbitrage.

## Ce que ce plan ne fait pas

L'audit conclut qu'**il n'y a pas de dette de forme** : typecheck et lint sont à
zéro, les couches sont respectées, la sécurité applicative tient. Ce plan ne
propose donc **ni redécoupage de fichiers, ni renommage, ni abstraction
nouvelle**. Découper `useMapLayers.ts` (1 118 lignes, `MAINT-003`) est le genre
de chantier qui produit un gros diff et zéro valeur ; il n'est pas retenu.

Tout ce qui suit corrige un comportement aux limites : rejeu, panne d'un tiers,
montée en volume, erreur silencieuse.

## Ordre d'exécution

| Lot | Objectif | Constats | Risque | Effort |
|---|---|---|---|---|
| 0 | ✅ Filet de sécurité — tests de caractérisation | — | nul | M |
| 1 | ✅ Délais d'expiration sur les appels externes (sans reprise, voir ci-dessous) | `ECH-002` | faible | S |
| 2 | ✅ Garde-fou anti-régression sur le middleware | `ARC-001` | nul | S |
| 3 | ✅ Respect de la limite de 50 sur les insertions | `PERF-003` | faible | S |
| 4 | ✅ Rendre les erreurs visibles (3 des 10 cas étaient légitimes) | `MAINT-001` | faible | M |
| 5 | ✅ Dégonfler `/api/admin/iris/stats` (+ 4 valeurs fausses corrigées) | `PERF-001` | moyen | M |
| 6 | Insertion groupée dans `inserter.ts` | `PERF-002` | moyen | M |
| 7 | Dédoublonner le filtre d'autorisation | `DUP-002` | faible | S |
| 8 | Nettoyages sans risque | `MAINT-002`, `MAINT-007`, `SEC-002` | nul | S |

Les lots 1 à 3 sont sûrs et rapides : ils sécurisent le terrain. Les lots 5 et 6
touchent des chemins chauds et viennent après le filet.

## Lot 0 — filet de sécurité

**Aucune ligne de code de production ne bouge avant que ce lot soit vert.**

Flux à couvrir par des tests de caractérisation — ils figent le comportement
**actuel**, bizarreries comprises :

- **Import de POI** : parse d'un CSV de référence → forme exacte des lignes
  produites par `lib/import/validator.ts`, y compris le fait qu'un `id` neuf est
  généré à chaque parse (`ECH-001` sera corrigé en lot séparé, hors périmètre —
  voir plus bas). Le test doit constater le comportement, pas le juger.
- **Découpage en lots de `inserter.ts`** : nombre d'appels émis pour 120 lignes,
  contenu des compteurs `inserted` / `ignored` / `errors`, et forme du rapport
  d'erreur ligne par ligne — c'est ce que le lot 6 doit préserver.
- **`/api/admin/iris/stats`** : forme exacte de la réponse JSON (clés, types,
  ordre des départements) — c'est ce que le lot 5 doit préserver.
- **Clients DSP** : forme des réponses de `lib/dsp/dv360/client.ts` et
  `lib/dsp/tiktok/client.ts` sur des réponses simulées, y compris les cas
  d'erreur — c'est ce que le lot 1 doit préserver.
- **`getOrgSourceIds`** : mêmes identifiants renvoyés par les trois
  implémentations pour un même jeu d'entrée — c'est le préalable du lot 7.

Baseline à capturer (déjà mesurée le 2026-09-11) :

| Mesure | Valeur initiale |
|---|---|
| `npx tsc --noEmit` | 0 erreur |
| `npm run lint` | 0 warning |
| Tests | 483 verts / 64 fichiers |
| `npm audit` | 2 critiques, 8 hautes, 7 moyennes, 6 basses |
| Fichier le plus long | `useMapLayers.ts`, 1 118 lignes |
| `any` explicites | 14 (dont 6 en fichier protégé) |
| `catch` avalés | 138 |

Commit : `test: tests de caractérisation avant refactor`

## Lot 1 — délais d'expiration et reprises sur les appels externes

- **Objectif** : aucun appel sortant ne peut bloquer une invocation serverless
  indéfiniment.
- **Constats** : `ECH-002`
- **Fichiers** : `lib/dsp/dv360/client.ts` (11 appels), `lib/dsp/tiktok/client.ts`
  (2), `lib/bidding-ml/client.ts` (1)
- **Méthode** : reprendre le patron **déjà présent dans le projet** —
  `lib/isochrones/fetcher.ts:127` (AbortController + reprise) et
  `lib/civic-health/` (`fetchWithTimeout`). Ne pas inventer un helper de plus :
  extraire celui qui existe si nécessaire.
- **Risque** : faible. Un appel qui réussissait continue de réussir ; seul le
  cas « le tiers ne répond pas » change, et il passe d'un blocage à une erreur.
- **Vérification** : tests de caractérisation du lot 0 sur les réponses
  simulées, inchangés. Plus un test nouveau : un tiers qui ne répond jamais
  produit une erreur bornée dans le temps au lieu de pendre.

## Lot 2 — garde-fou anti-régression sur le middleware

- **Objectif** : rendre impossible l'ajout d'une route protégée en apparence et
  publique en réalité.
- **Constats** : `ARC-001`
- **Fichiers** : `tests/unit/` uniquement. **`middleware.ts` n'est pas modifié**
  — fichier protégé par `CLAUDE.md`.
- **Méthode** : un test qui énumère les 170 `app/api/**/route.ts`, calcule pour
  chacune si elle est couverte par le `matcher` **et** par
  `PROTECTED_API_PREFIXES`, et compare le résultat à une liste explicite de
  routes autorisées à être publiques (aujourd'hui : `api/map/categories`,
  `api/auth/[...auth]`, `api/inngest`). Toute nouvelle route publique fait
  échouer la suite tant qu'elle n'est pas inscrite sciemment dans cette liste.
- **Risque** : nul. Aucun code de production touché.
- **Vérification** : le test doit être vu **rouge** avant d'être vu vert — en
  retirant temporairement une route de la liste autorisée.

## Lot 3 — respect de la limite de 50 sur les insertions

- **Objectif** : aligner les deux imports hors normes sur la règle de `CLAUDE.md`.
- **Constats** : `PERF-003`
- **Fichiers** : `app/api/admin/import-datagouv/route.ts:24` (500 → 50),
  `lib/radio/radio-matcher.ts:249-255, 304-310` (500 → 50)
- **Risque** : faible. Même données insérées, même ordre, plus de requêtes mais
  plus petites. À mesurer : la durée totale de l'import augmente probablement —
  c'est le prix de la règle, et la règle existe parce que l'application est
  tombée trois fois.
- **Vérification** : import d'un jeu de référence avant et après, comparaison du
  **contenu** inséré (pas du nombre de requêtes).

## Lot 4 — rendre les erreurs visibles

- **Objectif** : qu'un échec cesse de passer pour un succès.
- **Constats** : `MAINT-001`
- **Fichiers** : `app/api/admin/sources/[id]/route.ts:148-152`,
  `app/admin/organizations/[id]/page.tsx:236, 267, 282, 311, 326`,
  `lib/auth/getSessionOrg.ts:58, 72`, `lib/dsp/logger.ts:36-38`
- **Périmètre** : on ajoute un **log exploitable** et, côté interface, un retour
  à l'utilisateur via le mécanisme de toast déjà en place
  (`components/ui/geo-toast.tsx`). **On ne change pas le flux de contrôle** :
  une opération qui se poursuivait après une erreur continue de se poursuivre.
- **Attention** : le cas du `DROP TABLE` (`:148`) est à la frontière. Interrompre
  la suppression de la source serait un **changement de comportement** → hors
  périmètre. Ce lot se limite à rendre l'échec visible.
- **Risque** : faible.
- **Vérification** : aucun changement de réponse HTTP, aucun changement de
  données écrites. Seuls les logs et l'affichage changent.

## Lot 5 — dégonfler `/api/admin/iris/stats`

- **Objectif** : passer de 21 requêtes de comptage à une seule, sans changer la
  réponse.
- **Constats** : `PERF-001`
- **Fichiers** : `app/api/admin/iris/stats/route.ts:41-49, 61-66`, plus une
  migration SQL nouvelle (une RPC d'agrégation unique).
- **Méthode** : remplacer les 21 `count(exact)` par une RPC qui fait un seul
  `GROUP BY code_dept`. Suivre la règle du projet : `EXPLAIN ANALYZE` obligatoire
  sur la nouvelle requête, migration via le MCP Supabase.
- **Risque** : moyen — c'est le lot qui touche le plus au comportement mesurable.
  Le test de caractérisation du lot 0 est ici indispensable : la réponse JSON
  doit être **identique au champ près**, y compris l'ordre des départements.
- **Vérification** : comparaison octet à octet de la réponse avant et après, sur
  la base réelle.

## Lot 6 — insertion groupée dans `inserter.ts`

- **Objectif** : un aller-retour par lot de 50 au lieu de 50.
- **Constats** : `PERF-002`
- **Fichiers** : `lib/import/inserter.ts:36-89`
- **La difficulté** : la boucle existe pour produire un rapport d'erreur **ligne
  par ligne**. Un insert groupé échoue en bloc et ne dit pas quelle ligne pose
  problème. La méthode retenue : **tenter le groupe, et ne retomber ligne à
  ligne qu'en cas d'échec** du groupe. Le cas nominal passe à une requête ; le
  cas dégradé conserve exactement le diagnostic actuel.
- **Risque** : moyen. Les compteurs et le rapport d'erreur doivent rester
  identiques — c'est précisément ce que fige le test du lot 0.
- **Vérification** : sur un lot sans erreur, mêmes compteurs et même nombre de
  lignes en base. Sur un lot contenant une ligne fautive, **même message
  d'erreur et même ligne désignée** qu'avant.
- **Documentation** : `CLAUDE.md` devra être corrigé dans le même commit — la
  règle « batch par 50 (patron `lib/import/inserter.ts`) » ne décrit aujourd'hui
  pas ce que le fichier fait.

## Lot 7 — dédoublonner le filtre d'autorisation

- **Objectif** : une seule implémentation de la règle « sources visibles par une
  organisation ».
- **Constats** : `DUP-002`
- **Fichiers** : `app/api/map/pois/route.ts:27-41` et
  `app/api/map/categories/route.ts:54-58` importent désormais
  `lib/auth/getOrgSourceIds.ts`.
- **Risque** : faible — les trois implémentations sont aujourd'hui identiques,
  vérifié. Mais c'est une règle d'**autorisation** : le test du lot 0 doit
  prouver l'équivalence sur un jeu d'entrées avant la fusion.
- **Vérification** : mêmes identifiants renvoyés, mêmes POI et mêmes catégories
  visibles pour un même utilisateur.

## Lot 8 — nettoyages sans risque

- **Objectif** : fermer trois constats de faible gravité.
- **Constats** : `MAINT-002` (clé primaire sur `campaign_dsp_report`),
  `MAINT-007` (`GRANT` contradictoire sur `carreaux_1km`), `SEC-002`
  (filtre PostgREST paramétré plutôt qu'interpolé)
- **Risque** : nul pour les deux derniers. Pour `MAINT-002`, **ajouter une clé
  primaire sur une table existante peut échouer s'il y a déjà des doublons** :
  compter d'abord, et si des doublons existent, leur suppression est un
  changement de données → hors périmètre.

---

## Hors périmètre — à arbitrer

| Point | Pourquoi c'est un changement de comportement | Gravité | Recommandation |
|---|---|---|---|
| **`ECH-001`** — rejeu d'un import de POI dupliquant tout (`validator.ts:196` + `inserter.ts:65`) | Corriger impose une clé de déduplication **métier** (source + référence externe, comme `panneaux_affichage` fait avec `onConflict source,source_ref`). Choisir cette clé change ce qui est considéré comme « la même ligne » : des données aujourd'hui dupliquées deviendraient fusionnées | **critique** | À traiter en priorité, en chantier dédié. C'est une corruption silencieuse de données, pas de la dette de forme |
| **`DUP-001`** — `fmtNum` divergent, « 1.2M » vs « 1,2M » | Unifier change l'affichage sur au moins un des deux écrans | haute | Trancher : la virgule est la convention française et `lib/campaigns/suivi-metrics.ts` l'utilise déjà. Mais c'est visible par l'utilisateur |
| **`ECH-003`** — rejeu d'un import de campagne créant un doublon | Même nature : il faut une clé d'identification de campagne | haute | À traiter avec `ECH-001`, même chantier |
| **`SEC-001`** — 38 routes sans validation Zod | Ajouter un schéma **rejette** des entrées aujourd'hui acceptées. Un client qui envoie un champ en trop ou mal typé et que la route tolérait recevrait un 400 | haute | Y aller route par route, en commençant par les plus exposées (`admin/users`, `admin/organizations`), et en mode permissif d'abord |
| **`ARC-003`** — `init-admin` inatteignable | Le rendre atteignable **ouvre une route** aujourd'hui fermée | moyenne | Vérifier d'abord si le besoin existe encore. Si non, supprimer la route est plus sûr que de la réparer |
| **`ECH-004`** — limiteur de débit en mémoire d'instance | Le passer sur Upstash change le comportement effectif : des requêtes aujourd'hui acceptées seraient refusées | moyenne | Mesurer d'abord le nombre réel d'instances en production |
| **`MAINT-001`**, cas du `DROP TABLE` | Interrompre la suppression de la source quand le `DROP` échoue change le flux | haute | Le lot 4 se limite à rendre l'échec visible. Décider ensuite s'il doit bloquer |
| **`maplibre-gl` — faille XSS `DOM.sanitize`** | Montée en v6 **tentée et abandonnée** le 2026-09-11 : la bibliothèque ne rend plus rien. Piste consignée dans `docs/known_tech_debt.md` | haute, **risque abaissé** | Le chemin d'exploitation est coupé depuis `d058719` (échappement des popups à la source). La dépendance reste vulnérable au catalogue |
| **`compute_panneau_scores`** | Les 1 434 panneaux ont un score de `0.000` et n'ont jamais été scorés | — | Décision produit en attente : retirer les 14 colonnes mortes, ou écrire le scoring |
