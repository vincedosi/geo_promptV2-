# CHANGELOG — grand nettoyage MAGELIAN

> Date : 2026-08-31 · Branche `chore/zero-tech-debt` · 9 commits
> Protocole : `.claude/skills/cleanup-geomatik`
> Point de depart : `main` @ `f028e77`

Objectif demande : « zero dette technique ». Il n'est **pas atteint**, et la
raison est documentee en fin de document — l'essentiel du reste n'est pas
bloque par la difficulte technique mais par le besoin d'une validation
manuelle en navigateur.

---

## Avant / apres

| Metrique | Avant | Apres | Delta |
|---|---|---|---|
| Fichiers `.ts` / `.tsx` | 653 | 640 | **-13** |
| Lignes (`app` + `components` + `lib` + `types`) | 94 566 | 93 487 | **-1 079** |
| Routes API | 215 | 206 | **-9** |
| Routes API accessibles sans authentification | 3 | **0** | -3 |
| `console.log` hors exclusions | 90 | **0** | -90 |
| `Promise.all` > 3 appels Supabase | 3 | **0** | -3 |
| Declarations inutilisees | 61 | 40 | -21 |
| Dependances de production | 36 | 32 | -4 |
| Variables couvertes par `.env.example` | 20 | **36** | +16 |
| Couverture doc `lib/` | 91 % | **99 %** | +8 pts |
| `any` explicites | 13 | 13 | 0 (aucun actionnable) |
| Erreurs `tsc` | 0 | **0** | — |
| Tests | 331 verts | **331 verts** | — |
| Erreurs ESLint | 0 | **0** | — |
| Warnings ESLint | 71 | 71 | 0 (tolerance assumee) |
| `npm run build` | exit 0 | **exit 0** | — |

---

## 1. Code mort supprime

**9 routes API sans appelant** (~601 lignes) : `/api/analysis` ·
`/api/carreaux` · `/api/map/tmja` · `/api/meteo-geo/centroids` ·
`/api/custom-geo/source-types` · `/api/admin/dsp-sources` ·
`/api/admin/refresh-ville-stats` · `/api/admin/campaigns/preview` ·
`/api/admin/campaigns/populate-postal`

**4 composants orphelins** (555 lignes) : `ChoroplethSplit.tsx` (340) ·
`AgentLogs.tsx` (146) · `PiloteWorkspace.tsx` (30) ·
`app/copilote/layout.tsx` (39)

`AgentLogs.tsx` est tombe **par cascade** : sa seule reference etait un
import inutilise. `app/copilote/layout.tsx` etait un layout sans page
depuis le commit `825af5a` — il n'enveloppait plus rien.

**4 dependances jamais importees** : `@react-pdf/renderer` · `shpjs` ·
`hyparquet` · `fzstd`

**21 declarations inutilisees** : imports entiers, specifiers de liste,
consts et fonctions pures.

---

## 2. Securite

| Gravite | Constat | Statut |
|---|---|---|
| 🟡 | 3 routes API repondaient 200 sans authentification (`iris-tiles`, `tmja-tiles`, `ref/geo`) | **corrige** |
| 🟢 | Entrees de matcher creuses apres suppression de routes (401 au lieu de 404) | **corrige** |
| — | Identifiants en dur (`sk-`, `eyJ`, `AIza`) | **0 trouve** |
| — | `.env.local` ignore par git et non tracke | **verifie sain** |

La cause n'etait pas des gardes manquants dans les routes, mais une
**incoherence du matcher de `middleware.ts`** : `/api/tiles` y figurait,
ses deux jumelles non, alors que les trois servent la meme classe de
tuiles.

### Deux erreurs d'audit, corrigees en cours de route

Ces deux points valent d'etre consignes, car ils invalident des chiffres
qui circulaient dans la documentation du projet.

1. **« 40 routes API sans auth »** (`docs/known_tech_debt.md` §4) etait un
   **faux positif de methode** : l'audit d'origine comptait les routes sans
   guard *dans le fichier de route*, sans tenir compte de `middleware.ts`
   qui protege en amont, ni du guard `requireDspAccess` (15 routes DSP). La
   mesure empirique — interroger chaque route sur le serveur — donne **3**.

2. **Un commit de « securisation » a ete annule** (`a6d7cec` → `48c523f`).
   Il ajoutait des gardes de route sur 8 chemins **deja proteges par le
   middleware**. Non seulement il ne fermait rien, mais il remplacait une
   validation JWT locale (`getSession()`, zero appel reseau) par
   `supabase.auth.getUser(token)`, soit un aller-retour reseau **par
   requete**, sur des routes appelees a chaque deplacement de carte.
   C'est exactement ce que `CLAUDE.md` interdit depuis l'incident du 28/03.

> **A retenir** : avant d'ajouter un guard a une route API, verifier si
> `middleware.ts` la couvre deja. Les guards de `lib/api/middleware.ts`
> lisent le header `Authorization` et n'ont **aucun fallback cookie** ; les
> doubler est redondant *et* couteux.

---

## 3. Conformite Supabase Nano

`app/api/admin/transport-stats/route.ts` lancait **trois `COUNT exact` en
parallele** sur `poi_france` (~285k arrets) et `comptages_routiers` (~408k
lignes, deux fois). C'est le motif exact de l'incident du 08/04 consigne
dans `CLAUDE.md` (3 COUNT sur 280k lignes → timeout + boucle client). Les
COUNT sont desormais **sequences**.

Deux autres routes depassaient la limite de 3 appels simultanes
(`bidding/strategies/[id]` : 5 → 3+2 ; `final-report` : 4 → 3+1). Memes
requetes, memes resultats — seule la concurrence change.

---

## 4. Logs

90 `console.log` migres vers `lib/logger`, avec une decision semantique par
call site :

- **`logger.info`** — ce qui doit survivre en production : progression
  d'import/batch (`inserter`, `geocode/batch`, `import-poi/execute`,
  `populateCarreauxColumns`), actions utilisateur, cout LLM. La progression
  tracee des traitements DB est une exigence du projet : ces logs ne
  pouvaient pas etre `debug`.
- **`logger.debug`** — diagnostic de developpement, silencieux en prod.

**5 `console.log` subsistent volontairement** : `lib/logger.ts` (c'est
l'implementation), `lib/crypto/secrets.ts` (le `console.log` est le
*contenu* d'un message d'erreur) et `app/api/isochrone-battle/**` (fichiers
proteges). Toute nouvelle occurrence ailleurs est une regression.

---

## 5. Documentation

- `.env.example` : **13 variables ajoutees**, dont **`DSP_ENC_KEY`** —
  pourtant obligatoire et totalement absente — ainsi que la serie OAuth
  DV360/TikTok, `GITHUB_ACTIONS_TOKEN`/`GITHUB_REPO`,
  `ATMO_WFS_URL`/`ATMO_API_URL`, `POSTGRES_URL`, `SUPABASE_ANON_KEY`.
  `NODE_ENV` volontairement exclue : Next.js la pose lui-meme.
- `ARCHITECTURE.md` : 6 lignes de routes retirees ; `get_carreaux`,
  `get_carreaux_by_zoom` et `refresh_ville_stats_chunk` marquees
  *orphelines* (RPC **conservees en base**, jamais supprimees ni renommees) ;
  description du dossier `copilote/` corrigee.
- `docs/known_tech_debt.md` : items 2, 4, 5 et « any » fermes, chiffres
  remesures, pieges consignes.
- 12 en-tetes de module ajoutes dans `lib/` (91 % → 99 %).

Le chiffre de « 57 % de JSDoc » releve en audit etait un **artefact de
mesure** : ce projet documente au niveau *module*, pas par fonction.

---

## 6. Ce qui n'a pas pu etre fait

### Partie 6 du protocole — bloquee

La verification des RPC contre `pg_proc` demande un acces base. Or il n'y
en a aucun dans cet environnement : pas de serveur MCP Supabase connecte,
`SUPABASE_DB_URL` vide (2 caracteres), pas de `psql`.

Un controle **statique** a ete fait a la place — croiser les
`supabase.rpc(...)` du code avec les `CREATE FUNCTION` des migrations. Il
revele un **ecart de tracabilite serieux** :

> **36 RPC appelees par le code n'ont aucune definition dans le depot.**
> Parmi elles `get_iris_tile`, `clip_geojson_to_france`,
> `get_codes_postaux_bbox`, `get_zone_centroids`, `get_voronoi_by_category`.
> Elles existent en base (l'app fonctionne), mais une base reconstruite
> depuis le depot en serait **depourvue** — alors que `sql/SETUP.md`
> presente son ordre d'execution comme un setup complet.

`types/database.types.ts` est par ailleurs **absent**, alors
qu'`ARCHITECTURE.md` documente la commande qui le genere.

### Dette restante planifiable

| Item | Effort | Risque | Bloqueur |
|---|---|---|---|
| Dumper les 36 RPC manquantes en migrations | 2-3 h | nul | acces base |
| `FilterPanel.tsx` split (3 651 l.) | 8-10 h | eleve | smoke E2E manuel |
| `admin/sources/page.tsx` split (2 544 l.) | 6-8 h | moyen | smoke E2E manuel |
| `map/page.tsx` split (1 879 l.) | 8-10 h | eleve | smoke E2E manuel |
| 18 fichiers de 500 a 1 500 lignes | 6-8 h | moyen | smoke E2E manuel |
| `xlsx` → `exceljs` (2 vulnerabilites HIGH) | 4-6 h | faible | test d'import |
| 40 declarations inutilisees restantes | 2 h | moyen | parametres, props et `await` → c'est du fond |
| 18 `react-hooks/exhaustive-deps` | 3-4 h | moyen | ajouter une dep peut declencher des re-runs |
| 5 endpoints `/api/demo/*` sans appelant | 15 min | faible | decision produit (leviers operateur ?) |

**Total : ~40-50 h**, dont la quasi-totalite attend une validation humaine
en navigateur, non un travail de code.

### Les 13 `any` ne sont pas de la dette

9 sont dans `app/api/isochrone-battle/**` (fichiers proteges par
`CLAUDE.md`), 3 dans `isochrone-battle-v2` (flux le plus critique du pitch,
gain nul pour un risque reel), 1 type un builder PostgREST dont le type
change a chaque filtre chaine. Les 2 `@ts-expect-error` portent deja un
commentaire `reason:`. **Ne pas relancer de chasse aux `any`.**

---

## 7. Fichiers proteges

`app/api/isochrone-battle/**`, les fonctions PostGIS `battle_*`, `CLAUDE.md`
et `DESIGN_SYSTEM.md` n'ont pas ete touches.

`middleware.ts` **a ete modifie**, sur accord explicite prealable — c'etait
la seule facon de fermer les 3 routes publiques. Verification en navigateur
authentifie apres modification : tuiles servies (200/204/200), `/api/ref/geo`
200, carte `/map` rendue, 0 erreur console ; les memes routes en anonyme
renvoient 401.

---

# Passe du 2026-09-22 — la documentation, et le disque

> Protocole : `.claude/skills/cleanup-geomatik` · point de depart `61fe6e1e`
> Declencheur : « dans C:\GENESIS c'est le bordel, plein de .md qui ne servent
> plus a rien ». Menee le jour ou ce poste a perdu Docker ET une sauvegarde,
> d'ou une regle appliquee tout du long : **rien n'est supprime sans que son
> contenu existe ailleurs** — git pour le depot, la base et deux sauvegardes
> verifiees pour les donnees.

## Avant / apres

| Metrique | Avant | Apres | Delta |
|---|---|---|---|
| Fichiers `.md` suivis (hors `.claude/`) | 138 | **65** | **-73** |
| `.md` a la racine du depot | 13 | **8** | -5 |
| `.md` cites nulle part | 66 | **10** | -56 |
| Entrees a la racine de `C:\GENESIS` | 13 | **9** | -4 |
| Espace disque libere | — | — | **~800 Mo** |
| Tests unitaires | 1 700 verts | **1 700 verts** | — |
| Liens morts introduits | — | **0** | — |

## Ce qui a ete retire, et pourquoi

**73 fichiers `.md`, 1 495 ko** — 24 plans et 23 specs `superpowers`, 12 docs,
7 `SPRINT_*` UX, 2 `cleanup/`, 5 a la racine. Tous anterieurs a aout, tous sans
aucun referent, tous dans git : `git show` les rend.

⚠ **La liste a ete calculee par POINT FIXE, pas a l'oeil.** Un fichier n'est
retire que si TOUS ceux qui le citent le sont aussi — sans quoi on fabrique le
defaut d'a cote : un document vivant qui renvoie a un fichier absent. C'est ce
qui a rattrape `CLEANUP_REPORT.md`, dont le seul referent etait
`FINISH_REPORT.md`, lui-meme supprime. Verifie apres coup : aucun lien mort.

**`DATABASE.md`** merite sa ligne. Genere le **2026-03-20**, il decrivait le
schema du projet heberge `vkkdbygwbrxyogqosten` — **supprime depuis**. 295
lignes de tables, six mois de retard, et deux fichiers vivants le citaient. Un
SECOND document de schema, qui decrit une base qui n'existe plus : exactement
ce que `CLAUDE.md` interdit depuis l'incident de `docs/architecture.md`
(« 70 tables — RLS partout », lu comme une garantie de securite alors que les
policies sont dormantes). Ses deux references sont REPORTEES, pas coupees —
`sql/091` ne le cite plus, `docs/AUDIT_IMPORTS.md` explique ce qu'il etait.

**Hors depot** : `_anciens_env/` (deux fichiers de secrets en clair —
`SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN`, `DSP_ENC_KEY`, cles IA), les deux
archives `.zip` de mars, et `_dump_prod/carreaux_filosofi.sql` (765 Mo),
strictement remplace par la source INSEE qui porte EN PLUS les DROM.

⚠ Avant de detruire `_anciens_env`, verifie et non suppose : la `DSP_ENC_KEY`
du fichier de septembre a la MEME empreinte que celle du `.env.local` actuel
(`730494…`), et une connexion DSP chiffree vit en base. Rien d'irremplacable
n'est parti. **Mais supprimer une cle du disque ne la revoque pas** — celle du
projet heberge reste a revoquer cote fournisseur, elle est aussi dans
l'historique git depuis le 11/09.

## Ce qui a ete GARDE, et c'est deliberе

- **10 fichiers sans aucun referent**, tous de septembre : les plans du
  chantier risque en cours. Les retirer parce qu'ils ne sont « cites nulle
  part » confondrait *pas encore reference* avec *perime*.
- **`_dump_prod/public.sql` (1,1 Go)** : derniere trace d'une production
  supprimee. 97 Go restent libres, donc elle ne coute rien de reel — et le jour
  ou ce poste a perdu Docker et une sauvegarde n'est pas le jour ou l'on detruit
  la seule copie de quoi que ce soit. A retrancher dans une semaine si rien ne
  la reclame.
- **`ETAT_DES_LIEUX_DSP_PILOT.md`, `INSPECTION_DSP_IMPORT.md`,
  `PROMPT_NAV_5_THEMES.md`** : anciens, mais cites par des fichiers vivants.
  Le point fixe les a epargnes, et c'est son role.
