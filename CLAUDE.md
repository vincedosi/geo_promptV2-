# CLAUDE.md — MAGELIAN

> Chaque ligne ici prévient une erreur réelle. Si tu l'ignores, l'app casse.

@ARCHITECTURE.md
@DESIGN_SYSTEM.md

## Projet

**MAGELIAN** — SaaS B2B géomarketing OOH/DOOH. Planification d'affichage extérieur sur données INSEE.
Stack : Next.js 15 App Router · TypeScript strict · Supabase Pro (PostgreSQL **17.6** + PostGIS, compute **Micro**) · MapLibre GL JS · Vercel AI SDK (Gemini 2.5 Flash / Mistral Small) · Tailwind CSS · Inngest · Zod · Vitest
### ⛔ BASE : LE LOCAL D'ABORD — la prod ne se touche pas sans accord explicite

**Depuis le 2026-09-17, un stack Supabase local existe** (`scripts/local/`,
§ « Environnement de développement local » d'`ARCHITECTURE.md`) : Postgres 17.6
+ PostGIS, 94 tables, 192 RPC, la copie des données de prod.

- **Tout travail de développement va en LOCAL.** Migrations, `EXPLAIN ANALYZE`,
  mesures, essais : `docker exec supabase_db_genesis_app psql -U postgres`.
  Le stack se remonte avec `scripts/local/00-docker-up.sh` puis `01-supabase-up.sh`.
- **Le projet hébergé `vkkdbygwbrxyogqosten` est en cours d'abandon
  (2026-09-19).** Tout ce qu'il portait d'irremplaçable a été rapatrié —
  569 698 liaisons radio et 1 100 comptages routiers mesurés — et le diff
  complet des 103 tables ne laisse plus que des caches régénérables et les
  406 930 lignes de proxy OSM, volontairement abandonnées.
  `npm run dev`, `npm test` ET `npm run build` tournent en local ;
  1 451 tests et le build le vérifient.
- **Le MCP Supabase parle à ce projet hébergé, et à rien d'autre.** Il n'a plus
  d'usage une fois le projet supprimé. Tant qu'il existe, ne pas l'appeler par
  réflexe : la voie normale est `psql` dans le conteneur.
- ⚠ **La clé `service_role` du projet hébergé reste à RÉVOQUER** : elle est
  dans l'historique git. Supprimer le projet la neutralise ; le mettre en pause,
  non.

> **Cette ligne disait « Utiliser MCP Supabase, JAMAIS de SQL manuel » jusqu'au
> 2026-09-18**, sans mentionner le local — elle avait été écrite quand la prod
> était le SEUL environnement. Le 2026-09-18, l'agent a appliqué sql/179
> directement en production en suivant cette règle à la lettre, alors que la
> base locale tournait déjà et que rien ne l'exigeait. Une règle qui survit à
> son contexte ne se contente pas d'être inutile : elle commande le mauvais geste.

En local, `psql` dans le conteneur est la voie normale. « JAMAIS de SQL
manuel » visait la prod, et ne vaut que pour elle.

**Quelle commande parle à quelle base — vérifié le 2026-09-19, pas supposé :**

| Commande | Fichier d'env lu | Base atteinte |
|---|---|---|
| `npm run dev` | `.env.development.local` | **locale** — Next le charge avant `.env.local`, en dev uniquement |
| `npm test` | `.env.development.local` | **locale** |
| `npm run build` | `.env.local` | **locale depuis le 2026-09-19** |

**Les trois pointent désormais sur le local.** `.env.local` portait les
identifiants du projet hébergé jusqu'au 2026-09-19 ; ses quatre variables
Supabase ont été basculées sur les conteneurs. L'ancienne version est dans
`.env.local.avant-coupure-supabase-2026-09-19`, non suivi par git.

⚠ **`.env.local` ne porte pas que Supabase.** Il contient aussi `ORS_API_KEY`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `DSP_ENC_KEY` et
`ADMIN_INIT_KEY`. Le supprimer casserait l'IA, les isochrones et le chiffrement
DSP, pas seulement la base.

- **`npm test` tapait en PRODUCTION jusqu'au 2026-09-18**, avec la clé
  `service_role` qui contourne toute RLS. Un seul fichier en était la cause —
  `tests/integration/supabase-rpc.test.ts` — qui appelait
  `dotenv.config({ path: '.env.local' })` **en dur**. Mesuré avant correctif :
  `injecting env (24) from .env.local`, appels de 542 ms (des allers-retours
  réseau, pas du local). Il charge désormais `.env.development.local` en
  priorité. `dotenv` n'écrase pas une variable déjà posée : **l'ordre de ces
  deux lignes EST le garde-fou**, l'inverser remet les tests sur la prod.
- **`npm run build` ne fait aucune requête Supabase** : vérifié, aucun
  composant serveur ni page `async` n'appelle `createAdminClient` hors
  `app/api/`, et les routes sont `force-dynamic`. En revanche il **inline les
  identifiants de `.env.local` dans le bundle client** : un build local suivi
  d'un `npm start` sert une application qui parle à la PROD. Pour un build de
  vérification contre la base locale, passer `NEXT_PUBLIC_SUPABASE_URL` et
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` explicitement.

## ⛔ RÈGLES CRITIQUES — NON NÉGOCIABLE

### Disk I/O — les règles tiennent, les chiffres sont à revérifier

**Budget I/O épuisé → Auth 504 → app down pendant des heures. Déjà arrivé 3 fois.**

> **Mesuré le 2026-09-13, et cela contredit l'en-tête historique.** Ce titre
> annonçait « Nano — 250 IOPS, 5 MB/s ». Or le compute est **Micro**
> (`shared_buffers` 256 Mo, `effective_cache_size` 768 Mo, ≈ 1 Go de RAM), et une
> lecture séquentielle de 348 Mo a été chronométrée à **≈ 195 Mo/s**, pas 5.
>
> **Cela ne relâche AUCUNE des interdictions ci-dessous.** Une mesure unique ne
> distingue pas un débit soutenu d'une rafale sur crédits de burst, les trois
> incidents ont bien eu lieu, et le plafond qui a lâché était peut-être le débit
> **aléatoire**, que cette mesure séquentielle ne dit pas. Tant que le palier et
> l'IOPS provisionnée ne sont pas relevés dans la console Supabase — point 0 de
> `docs/audit/QUICK_WINS.md`, non lisible en SQL — on continue de coder comme si
> la marge était étroite.
>
> Ce qui change : ne plus **citer** « 250 IOPS / 5 MB/s » comme un fait établi.

INTERDIT :
- Batch/parallèle > 1 colonne sur tables IRIS (51k) ou carreaux_filosofi (2.3M)
- Bbox France entière sans LIMIT — bbox métro max : `-5.5,41.2,9.8,51.2`
- Prefetch/preload massif au chargement de page
- `Promise.all()` > 3 appels Supabase simultanés
- Full table scan sur tables volumineuses
- Endpoints acceptant des listes illimitées de colonnes

OBLIGATOIRE :
- Lazy loading : 1 colonne à la fois, à la demande
- Bbox = viewport carte visible, jamais France entière au 1er chargement
- Cache client `useRef` — vérifier AVANT tout fetch
- `EXPLAIN ANALYZE` sur toute nouvelle requête PostGIS
- Index GIST sur toute colonne géométrie
- Quotas d'appels : passer par `lib/api/rate-limit.ts`, **jamais** par une `Map`
  locale. Un compteur en mémoire de processus ne limite RIEN sur Vercel — chaque
  invocation peut être une instance différente. Le compteur partagé vit en base
  (`consommer_quota`, sql/135), parce qu'Upstash n'est pas configuré en prod.

### Troncature PostgREST — 5 000 lignes, sans erreur, sans en-tête

**PostgREST coupe à 5 000 lignes TOUTE fonction `RETURNS TABLE` ou `SETOF`.**
Pas d'exception levée, pas d'avertissement, pas d'en-tête : l'appelant reçoit un
tableau parfaitement valide de 5 000 éléments et n'a aucun moyen de savoir qu'il
en manquait 1 187. Aucun `if (error)` ne peut voir ça passer. Cinq occurrences
recensées, dont trois corrigées et **trois encore ouvertes en production** —
`docs/SUITE_TRONCATURE_POSTGREST.md`.

RÈGLE :
- Une RPC dont le résultat **peut** dépasser 5 000 lignes est `RETURNS jsonb`.
  `RETURNS TABLE` est réservée aux résultats **bornés par construction** : un
  `LIMIT` dans le corps, un tableau d'ids fourni par l'appelant, une table de
  référence dont la taille est connue et petite.
- Changer le type de retour d'une fonction existante exige un `DROP`, **exclu en
  production** : on écrit une **jumelle** `_jsonb` qui porte le corps, et
  l'originale devient une **enveloppe mince** qui l'appelle. Un seul corps, deux
  formes de retour, dérive impossible. Patron littéral : sql/154, sql/168-169,
  sql/170.
- Un plafond côté route (« 1 500 CP maximum ») est une borne acceptable — mais
  c'est une constante, et le jour où quelqu'un la relève au-dessus de 5 000 la
  troncature revient **en silence**. L'écrire dans le commentaire de la constante.
- `tests/unit/db/troncature-postgrest.test.ts` verrouille la règle : toute RPC
  tabulaire appelée depuis `app/` ou `lib/` doit y avoir une borne écrite, ou
  être déclarée en dette ET nommée dans le document ci-dessus. Ne pas le
  désactiver, le compléter.

### Auth Middleware

```
Routes API (/api/*) → getSession()  — JWT local, ZÉRO appel réseau
Pages (/map, /dashboard…) → getUser() — un appel par navigation
```

IMPORTANT : `getUser()` sur routes API → 409 token refresh concurrent → déconnexion. Incident du 28/03.

### Secrets — jamais dans un fichier suivi par git

Le 2026-09-11, la clé `service_role` **active** a été trouvée en clair dans
**sept scripts Python versionnés**. Elle contourne toute RLS. L'audit de la
veille ne l'avait pas vue : il ne regardait que le TypeScript côté client.

- Un script qui écrit en base lit sa clé dans l'environnement, jamais en dur.
- `tests/unit/securite/aucun-secret-en-dur.test.ts` balaie TOUS les fichiers
  suivis, tous langages confondus. Il recolle les littéraux concaténés avant de
  chercher : c'est ainsi que la clé était écrite, et c'est ce qui rendait le
  premier scan aveugle.
- **Retirer un secret du code ne l'efface pas de l'historique git.** Une clé
  commitée, même une seule fois, doit être RÉVOQUÉE côté fournisseur.

### Fichiers protégés — NE PAS MODIFIER sauf demande explicite

`app/api/isochrone-battle/route.ts` · Fonctions PostGIS battle · `middleware.ts`

### Données clés

- Table `iris` — colonnes socio-démo **dynamiques**. JAMAIS hardcoder la liste de colonnes.
- `is_true_iris = true` → vrais IRIS (~16 400). Filtrer pour toute analyse statistique.
- `.trim()` obligatoire sur données CSV INSEE (espaces invisibles).
- POI importés : `id` **déterministe** (UUIDv5 du contenu de la ligne, `lib/import/identite-poi.ts`). JAMAIS de `randomUUID()` — c'est ce qui rendait `onConflict: 'id'` inopérant et dupliquait tout au rejeu d'un import (`ECH-001`).
- Gzip obligatoire sur réponses MVT. MapLibre 5.x plante silencieusement sans.
- `geom_3857` pré-calculé sur `carreaux_filosofi`. Ne pas recalculer à la volée.
- PMTiles IRIS → GitHub Releases (pas Supabase Storage). Proxy : `/api/iris-tiles-proxy`.

## Méthodologie

1. **Reconnaissance** — `grep -rn` sur les fichiers concernés AVANT de coder
2. **Impact I/O** — Le changement augmente la charge DB ? → alerter AVANT de coder
3. **Pas de modifs non demandées** — Ne pas refactorer/améliorer du code adjacent
4. **Code complet** — Copy-pasteable, jamais de `// ... rest of the code`
5. **Vérification** — Après modif, `grep` pour confirmer que rien d'autre n'est cassé
6. **Résumé structuré** — Fichiers modifiés, changements, ce qui n'a PAS changé

### Documentation — à jour DANS le commit, jamais après

`ARCHITECTURE.md` **à la racine** est la seule source de vérité. Un commit qui
ajoute ou retire une route, une table, une RPC, une variable d'environnement ou
une dépendance externe met le doc à jour **dans le même commit**. Pas de passe
de rangement plus tard : une doc périmée ne se contente pas d'être inutile, elle
ment avec autorité.

Constaté le 2026-09-11 : `docs/architecture.md` (30/04) affirmait
« 70 tables — RLS partout », ce qui se lit comme une garantie de sécurité alors
que les policies sont **dormantes**. Et il était le seul à documenter Modal, un
service Python tiers appelé par du code vivant. Un doc faux ET un doc à trou,
parce qu'on en maintenait deux.

- **Jamais deux documents d'architecture.** On n'en synchronise jamais deux.
- **Piège Windows** : `docs/architecture.md` et `docs/ARCHITECTURE.md` sont le
  MÊME fichier. Écrire l'un écrase l'autre en silence.
- `tests/unit/docs/derive-documentation.test.ts` garde les faits mesurables
  (variables d'env critiques, dépendances externes, dormance des RLS, unicité
  du doc). Il échoue si la doc dérive — ne pas le désactiver, le mettre à jour.

### Imports & batch DB — Progression OBLIGATOIRE

Tout import/traitement batch DOIT avoir : barre de progression UI (%, lignes traitées/total), logs temps réel (SSE/NDJSON), étapes nommées (parsing → insertion → post-traitement), compteurs finaux. JAMAIS de traitement DB silencieux.

## Conventions

- TypeScript strict, imports absolus `@/`, types dans `types/`
- Routes API : `export const dynamic = 'force-dynamic'`, validation Zod, `createAdminClient()` depuis `@/lib/auth`
- Corps de requête : passer par `lireCorps()` pour du JSON et
  `lireFormulaire()` pour un dépôt multipart (`lib/api/valider-corps.ts`). Ils ne
  lèvent jamais et rendent un message français — pas `await request.json()` nu,
  qui répond 500 sur un corps illisible. Les fichiers se récupèrent avec
  `fichierDeFormulaire()` / `fichiersDeFormulaire()` : **jamais**
  `formData.get('file') as File`, un cast qui ment sur une valeur texte.
  `tests/unit/api/validation-corps.test.ts` verrouille la règle — une seule
  route y échappe encore, le fichier protégé `isochrone-battle/route.ts`.
- Tout `upsert(..., { ignoreDuplicates: true })` suivi de `.select('id')` (voir
  plus bas) et tout corps validé qui repart TEL QUEL vers une RPC doit utiliser
  `.passthrough()` : Zod retire les clés inconnues par défaut, et les retirer
  changerait la charge utile reçue par la base.
- Rôles : `lib/auth/roles.ts` est la source unique (niveaux, libellés, schémas
  Zod). Ne jamais réécrire `['super_admin', 'admin', 'client']` à la main.
- Outils IA : 1 fichier = 1 outil dans `lib/chat/tools/`, retourne données structurées (jamais texte libre)
- Inserts DB : batch par 50 max — **une seule requête par lot**, avec repli
  ligne à ligne en cas d'échec pour désigner la ligne fautive
  (patron `lib/import/inserter.ts`). Jusqu'au 2026-09-11 ce fichier faisait
  un aller-retour PAR LIGNE : la règle le citait en exemple alors qu'il ne
  la respectait pas.
- **Jamais de `await supabase...delete()` sans lire son erreur.** supabase-js ne
  lève pas, il rend `{ error }` : une suppression qui échoue passe inaperçue. Or
  le patron d'idempotence du projet est **DELETE ciblé + INSERT** — un DELETE
  raté suivi de son INSERT transforme un remplacement en DOUBLEMENT.
  `tests/unit/db/suppressions-sans-garde.test.ts` le verrouille.
- `.delete()` et `.update()` ne renseignent `count` que si on passe
  `{ count: 'exact' }`. Sans l'option, `count` vaut `null` — et un rapport qui
  affiche `count || 0` annonce « 0 supprimé » après avoir effacé des milliers de
  lignes. Constaté sur `/api/admin/sources/[id]`.
- Tout `upsert(..., { ignoreDuplicates: true })` doit être suivi de
  `.select('id')`. `ON CONFLICT DO NOTHING` ne renvoie QUE les lignes
  réellement écrites : sans ce `select`, « inséré » et « déjà présent » sont
  indiscernables et le rapport d'import annonce des lignes qu'il n'a pas
  créées. Corollaire de l'identité déterministe des POI.
- Carto : MapLibre, fonds OpenFreeMap, MVT via `/api/tiles/[z]/[x]/[y]`
- Git : commits atomiques, format `type: description`
- Mise en forme des nombres : `lib/format/nombre.ts` est la source unique
  (`formaterNombre`, `formaterNombreArrondi`, `formaterNombreAbrege`). Ne pas
  réécrire un `fmtNum` local — il y en avait **quinze** avant le 2026-09-11.
- Design : dark minimal, Inter + JetBrains Mono, accent teal #4ecdc4, pas de violet, sentence case, flat total

## Fichiers de référence (lire AVANT de créer)

| Type | Exemple à lire |
|------|---------------|
| Route API | `app/api/iris/stats/route.ts` |
| Outil IA | `lib/chat/tools/*.ts` |
| Composant carte | `app/map/_components/FilterPanel.tsx` |
| Import données | `lib/import/inserter.ts` |
| Import DSP | `app/api/admin/campaigns/import/route.ts` |
| Column mappings | `lib/dsp-mapping/loader.ts` (mappings dynamiques en base `dsp_source_mappings`) |
| Migration SQL | `sql/SETUP.md` |

## Commandes

```bash
npm run dev              # Dev (localhost:3000)
npm run build            # Build prod
npx tsc --noEmit         # Type-check
npm test                 # Vitest — unitaires PUIS integration, en deux passes
npm run test:unit        # Unitaires seuls (rapide, aucune base)
npm run test:integration # Integration seule (tape la base locale)
npm run lint             # ESLint
```

### Tests — deux passes, et ce n'est pas un detail

`npm test` lance `--project unit` PUIS `--project integration`, jamais les deux
ensemble (`vitest.workspace.ts`, `package.json`). Les tests d'integration tapent
la base locale ; les laisser partager les 4 vCPU de la VM avec 150 fichiers
unitaires privait PostgREST de CPU, et Kong rendait « An invalid response was
received from the upstream server ».

Le symptome mentait deux fois : un test DIFFERENT echouait a chaque execution,
et le message ne nommait ni la concurrence ni la memoire. Mesure du
2026-09-19 : le fichier d'invariants de couverture passe **3 fois sur 3** lance
seul, et echouait **2 fois sur 3** dans la suite complete. Ne pas remettre les
deux projets en parallele pour gagner 10 secondes.

## Compaction

Quand tu fais `/compact`, préserve TOUJOURS :
- La liste exacte des fichiers modifiés dans cette session
- Le statut des tests (pass/fail + erreurs)
- Les contraintes I/O Supabase Nano (section ⛔ ci-dessus)
- Le contexte de la tâche en cours

## Incidents — NE PAS REPRODUIRE

| Date | Cause | Impact |
|------|-------|--------|
| 03-28 | Prefetch 24 colonnes IRIS × bbox France | I/O épuisé → 504 → down heures |
| 03-28 | `getUser()` sur routes API × 15 req parallèles | 409 refresh → déconnexion |
| 04-08 | 3 COUNT séquentiels × N campagnes (280k rows) | Timeout + boucle infinie client |
| 04-08 | `request.formData()` dans `ReadableStream.start()` | Import SSE cassé (body consumed) |
| 04-08 | Matching IRIS 266k lignes (DISTINCT ON + 3 JOINs) | I/O épuisé → DB down ~5 min |
