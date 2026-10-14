# La carte en parcours — lot 3 « ③ Zones à recette » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** à l'étape ③ de la carte Angular, TOUTE sélection devient une zone : un seul objet `custom_geo_zones`, nommé, enregistré, qui garde sa **recette** (rayon autour d'un point ou de tous les POI d'un type, seuil sur les carreaux Filosofi, seuil d'indicateur IRIS/CP, liste de CP, dessin, import GeoJSON/KML, isochrones, combinaisons) et qui se **recalcule** à partir d'elle, chaque calcul lourd étant borné par le périmètre de ①.

**Architecture:** une recette est un objet JSON versionné (`v: 1`) décrit par un module PUR copié serveur/Angular (`lib/zones/recette.ts`, parité verrouillée) et validé côté serveur par Zod (`lib/zones/recette-schema.ts`). Elle est stockée dans une colonne neuve `custom_geo_zones.recette` (sql). Un **exécuteur** serveur (`lib/zones/executer-recette.ts`) transforme une recette en géométrie en appelant UNE RPC `jsonb` par famille (trois neuves : `zone_rayon_poi`, `zone_seuil_carreaux`, `zone_seuil_territoire` ; les autres existent) ; trois routes (`POST /api/zones/apercu`, `POST /api/zones`, `POST /api/zones/[id]/recalculer`) l'emploient. Côté Angular, l'étape ③ est rangée par familles (Autour des POI · Par seuil · À la main · Capture), chaque formulaire produit une recette, `AtelierZoneService` (fourni par le panneau) demande l'aperçu, le dessine, puis enregistre.

**Tech Stack:** Angular 21.2 standalone zoneless signals, Tailwind 4, Vitest (`cd angular && npx ng test --watch=false`) ; Next.js 15 (routes API), supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`) ; PostgreSQL 17.6 + PostGIS local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec:** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — **§ 16 (décisions du 14/10) fait foi** ; §§ 15, 11 (risques I/O), 5 (état URL). Mémoires : `feedback_polygones_pas_que_cp`, `reference_dsp_maille_geo`.

## Base d'exécution — À LIRE AVANT LA TÂCHE 1

L'exécution part de `feat/carte-parcours` **après la fin du lot 2** (Tasks 11, 11b, 12, 13, 14 et la revue finale du lot 2 terminées, registre `.superpowers/sdd/2026-10-13-carte-en-parcours-lots-1-2/progress.md`). Créer la branche `feat/carte-zones-recette` depuis ce commit, dans un worktree dédié (`superpowers:using-git-worktrees`).

Contrôle d'entrée (tous doivent passer, sinon s'arrêter et le signaler) :

```bash
git log --oneline -1                                                   # le dernier commit du lot 2 (doc « Preuve du lot 2 ») ou un descendant
grep -c "'jeu'" angular/src/app/features/carte/logique/parcours.ts     # ≥ 1 (8 étapes, ⑤ = jeu)
ls angular/src/app/features/carte/panneaux/donnees/panneau-donnees.component.ts   # présent (T13 du lot 2)
ls sql | sort -V | tail -3                                             # noter le dernier numéro (251 au 2026-10-14)
docker exec supabase_db_genesis_app psql -U postgres -At -c "select count(*) from carreaux_filosofi where geom_centroid is not null"   # 0 au 2026-10-14 (spec § 16.6) — ce lot n'emploie PAS geom_centroid
```

Les numéros de migration de ce plan (252 à 256) sont ceux du 14/10 : prendre à chaque tâche le **premier numéro libre** (`ls sql | sort -V | tail -3`) et reporter le numéro réel dans les tests qui lisent le fichier (ils cherchent par suffixe, jamais par numéro).

## Global Constraints

- Les huit étapes et leurs valeurs d'URL sont celles du lot 1 (`perimetre` · `donnees` · `zones` · `analyse` · `jeu` · `plan` · `activation` · `live`) ; ce lot ne touche qu'à ③ `zones` et, pour retirer les isochrones, à ④ `analyse`. « Autres » (OOH, radio) reste hors fil (Task 11b du lot 2), non replanifié.
- **Un seul objet zone** : toute création de ③ écrit `custom_geo_zones` avec une `recette` (spec § 16.2-1). Aucune table de zone neuve.
- **La forme exacte est la vérité** : ③ ne convertit jamais en CP ; `resolve_custom_geo_zone_codes` reste appelé après écriture pour les compteurs de « Mes zones » (affichage historique, spec § 4 ④), il n'achète rien.
- **① borne tout calcul lourd** : `rayon_poi`, `seuil_carreaux`, `seuil_territoire` refusent le périmètre `france` et tout périmètre de plus de **100 000 km²** ; plafonds écrits : **5 000 POI**, **20 000 carreaux**, **5 000 territoires**, **20 000 sommets** à l'import (spec § 16.8 A-4). Un refus est une RÉPONSE (`{ refus }` → HTTP 422 en français), jamais une exception muette ni un résultat tronqué.
- PostgREST coupe à 1 000 lignes : toute RPC neuve rend `jsonb` (pas de `RETURNS TABLE`) ; aucune lecture de table neuve sans borne écrite.
- I/O (CLAUDE.md § Disk I/O) : `EXPLAIN (ANALYZE, BUFFERS)` en LOCAL sur chaque RPC neuve, chiffres reportés dans le rapport ; quotas par `lib/api/rate-limit.ts` (`createRateLimiter`, compteur en base) — jamais une `Map` ; ≤ 3 appels Supabase simultanés ; aucune lecture déclenchée par l'ouverture de ③ hors les catalogues déjà chargés (catégories POI, indicateurs).
- `carreaux_filosofi.geom_centroid` est NULL partout en local : le centroïde d'un carreau se calcule `ST_Centroid(geom_3857)` (index GIST `idx_carreaux_filosofi_geom_3857`). Ne pas remplir la colonne (question Q-E de Vincent).
- **Aucun `DROP`** de fonction ni de table (base locale partagée) ; `create or replace`, `add column if not exists`, migrations rejouables (appliquées DEUX fois).
- Huit RPC vivantes sans source sont rapatriées À L'IDENTIQUE (Task 1) avant toute autre tâche ; ce lot n'en modifie aucune.
- Routes API : `export const dynamic = 'force-dynamic'`, Zod, `lireCorps()` (jamais `request.json()` nu), `getSessionOrg` (jamais `getUser()`), espace = `session.orgId` (vue espace, spec droits), `createAdminClient()` depuis `@/lib/auth`, messages d'erreur en français, détail Postgres seulement dans `console.error`.
- Types : `types/database.types.ts` régénéré dans le commit de chaque migration (`npx supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > types/database.types.ts`) ; le diff n'ajoute QUE les objets de la migration.
- Angular / AIDA (skill `porting-react-to-angular`) : aucun `position: fixed`, aucun écouteur sur `window`/`document`, services d'état fournis par la page ou le panneau (jamais `providedIn: 'root'`), services d'API dans `FOURNISSEURS_DISTANTS` (`angular/src/app/app.routes.ts`), pas de `@angular/core/rxjs-interop`, couleurs par jetons — MapLibre reçoit des couleurs CALCULÉES (`CouleursService.palette`), jamais `var()` dans `paint`.
- Le panneau d'une étape reste MONTÉ quand on en change (lot 1, A1) : l'aperçu d'une zone survit à un aller-retour ③ → ① → ③.
- Aucun fichier `.ts` non-spec d'`angular/src` au-delà de 400 lignes (`tests/unit/angular/taille-fichiers.test.ts`).
- DESIGN_SYSTEM : sentence case, Inter + JetBrains Mono (chiffres), bordures 0,5 px, accent teal, en-têtes `mg-entete-section`, CTA teal pour « Aperçu » / « Enregistrer la zone », jamais de violet ni de hex en dur.
- React gelé (P5) : aucun fichier de `app/map/**`, `components/**`, `lib/navigation/**` modifié ; `/api/custom-geo/save` inchangé (React l'emploie). Fichiers protégés intouchés : `middleware.ts`, `app/api/isochrone-battle/route.ts`.
- `ARCHITECTURE.md` mis à jour DANS le commit de chaque tâche qui ajoute une route, une colonne, une RPC (Grep par nom : `## Fonctions RPC PostGIS`, `## Tables Supabase`, la ligne `custom_geo_zones`, `### Zones custom`) ; `angular/src/app/features/carte/README.md` aussi.
- Tests : codes de retour lus SANS pipe (`npx tsc --noEmit`, `cd angular && npx ng test --watch=false`, `cd angular && npm run build -- --output-path=/tmp/ng-lot3` (sortie séparée, règle du lot 1), `npm run test:unit`, `npm run test:integration`). Échec connu admissible : l'attente « habitants » de zone-risque (41 025 366 vs 42 409 940).
- Preuve navigateur : Angular `:4202`, Next `:3000` réutilisé s'il tourne (jamais arrêté), deux thèmes, captures dans `.superpowers/sdd/2026-10-14-carte-lot-3/` (non suivi).
- Git : commits atomiques `type: description`, pas de push, pas de PR, rien sur `main`.

## Review Focus

1. **Périmètre absent, national ou trop grand pour une recette lourde** (aucun filtre à ①, filtre « France », filtre « zone » d'un autre espace, région ARA à 10 %) : ③ dit en une ligne ce qu'il faut faire (« Choisissez un périmètre à l'étape ① » / « Resserrez le périmètre ou relevez le seuil — plus de 20 000 carreaux »), AUCUNE requête lourde ne part, rien n'est tronqué en silence. → tests T5 (`refus` SQL), T7 (exécuteur → 422), T9 (`perimetreDeFiltre`, garde côté écran).
2. **Recalculer une zone qu'un plan achète** (stratégie de bidding, jeu de zones, composite, combinaison qui la cite) : refus 409 « Cette zone est utilisée par … : dupliquez-la » — la forme ne change jamais sous une campagne. → tests T3 (`remplacer_geometrie_zone`) et T8 (route).
3. **Import d'un fichier hostile ou maladroit** (KML avec trous, GeoJSON `FeatureCollection` mêlant points et polygones, polygone auto-intersecté, 80 000 sommets, fichier vide, encodage latin-1, coordonnées inversées lat/lon hors France) : on garde les polygones, on dit combien d'éléments sont ignorés, on répare (`ST_MakeValid`), on refuse au-delà de 20 000 sommets, on refuse une forme entièrement hors du territoire — jamais une zone vide enregistrée. → tests T9 (`lireForme`) et T7 (exécuteur, `vide` → 409).
4. **Changer d'espace ou d'étape pendant un aperçu en vol** : la réponse de l'ancien espace n'est jamais dessinée ni enregistrée dans le nouveau ; un aperçu reste dessiné après ③ → ① → ③ ; « Enregistrer » ré-exécute la recette côté serveur (le client ne fournit une géométrie que pour une forme figée). → tests T9 (`AtelierZoneService` : jeton de requête, page recréée) et T8 (la route ignore une géométrie fournie pour une recette recalculable).
5. **Super admin dans un espace dont il n'est pas membre** (vue espace) : la zone s'écrit dans l'espace ACTIF, et si `resolve_custom_geo_zone_codes` refuse le compte appelant (« Access denied »), la réponse est 207 « zone créée, codes postaux non résolus » — la zone n'est jamais perdue ni écrite dans l'espace du compte. → test T8 (route `POST /api/zones`, résolution en échec).

## Arbitrages du chef de projet

Ceux de la spec § 16.8 (A-1 à A-6) s'appliquent. Ajoutés par ce plan :

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| L3-1 | Une zone « rayon autour des POI d'un type » sort-elle du périmètre ? | **Non** : elle est découpée par le périmètre (`part_retenue` rendue). Le périmètre BORNE, et une zone qui le déborde ne serait plus bornée au recalcul. | un paramètre « découper » à ajouter |
| L3-2 | Seuil sur carreaux : un carreau est-il retenu par son centroïde ou par intersection ? | **Centroïde dans le périmètre** (la règle de `cp_du_point`, sql/228) ; la zone est l'union des carreaux ENTIERS (débord ≤ 100 m au bord du périmètre). | un clip final : une ligne |
| L3-3 | Indicateurs de seuil carreaux | Une liste FERMÉE de 13 indicateurs (parts en % et densité d'habitants), écrite deux fois — `INDICATEURS_SEUIL_CARREAUX` (TS) et le `case` SQL — et verrouillée par un test qui lit la migration. | ajouter une ligne aux deux |
| L3-4 | Aperçu puis enregistrement : deux exécutions ? | **Oui** : `POST /api/zones` ré-exécute la recette (on ne fait pas confiance à une géométrie cliente pour une recette recalculable). Coût mesuré du cas le plus lourd : 2,6 s ; quotas 20 aperçus et 20 écritures par minute. | une signature de l'aperçu à ajouter |
| L3-5 | Où vivent les isochrones et la bataille ? | Le bloc « Analyse spatiale » du panneau ④ est EXTRAIT tel quel en `mg-section-isochrones` et monté dans ③ (famille « Autour des POI ») ; la capture de leur résultat écrit une recette `isochrone` (forme figée) par la route existante `/api/custom-geo/capture`, qui accepte un champ `recette` facultatif (React ne l'envoie pas). | remonter le bloc dans ④ |
| L3-6 | Les trois créateurs existants (CP, rayon, dessin) | Gardés, mais ils ENREGISTRENT par `POST /api/zones` avec leur recette (`codes_postaux`, `rayon_point`, `dessin`) ; leurs routes source restent l'aperçu. Les opérations (union/intersection/différence) de « Mes zones » enregistrent une recette `combinaison`. | — |

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sql/252_rapatriement_rpc_zones.sql` (créé) | Huit RPC vivantes sans source, À L'IDENTIQUE + leurs droits. |
| `sql/253_zones_a_recette.sql` (créé) | Colonne `recette` + CHECK, `geometrie_perimetre`, `refus_perimetre`, `creer_zone_recette`, `remplacer_geometrie_zone`. |
| `sql/254_zone_rayon_poi.sql`, `sql/255_zone_seuil_carreaux.sql`, `sql/256_zone_seuil_territoire.sql` (créés) | Les trois RPC de recette, `jsonb`, bornées. |
| `lib/zones/recette.ts` + `angular/src/app/features/carte/logique/zones/recette.ts` (créés, parité) | Types, constantes, plafonds, libellés, messages de refus. Pur. |
| `lib/zones/recette-schema.ts` (créé) | Schéma Zod de la recette (serveur seul). |
| `lib/zones/executer-recette.ts` (créé) | Recette → géométrie, par RPC. |
| `app/api/zones/route.ts`, `app/api/zones/apercu/route.ts`, `app/api/zones/[id]/recalculer/route.ts` (créés) | Écrire, aperçu, recalcul. |
| `app/api/custom-geo/list/route.ts`, `app/api/custom-geo/capture/route.ts` (modifiés) | `recette` lue ; `recette` facultative à la capture. |
| `angular/.../data/zones.api.ts`, `etat/atelier-zone.service.ts`, `couches/apercu-zone.ts`, `logique/zones/perimetre-recette.ts`, `logique/zones/import-forme.ts` (créés) | Angular : API, état d'atelier, aperçu carte, périmètre, lecture GeoJSON/KML. |
| `angular/.../panneaux/zones/recette-rayon-poi.component.ts`, `recette-seuil-carreaux.component.ts`, `recette-seuil-territoire.component.ts`, `recette-import.component.ts`, `pied-recette.component.ts`, `section-isochrones.component.ts` (créés) | Formulaires de recette, pied commun (aperçu, nom, enregistrer), isochrones déplacées. |
| `angular/.../panneaux/zones/panneau-zones.component.ts`, `etat/creation-zone.service.ts`, `panneaux/zones/operations-zones.component.ts`, `panneaux/zones/carte-zone.component.ts`, `panneaux/zones/mes-zones.component.ts`, `panneaux/analyse/panneau-analyse.component.ts`, `data/zones-custom.api.ts`, `app.routes.ts` (modifiés) | |
| Tests : `tests/unit/db/rpc-chemin-zones-sources.test.ts`, `tests/unit/zones/recette.test.ts`, `tests/unit/angular/recette-paritaire.test.ts`, `tests/integration/zones-recette.test.ts`, `tests/integration/zone-rayon-poi.test.ts`, `tests/integration/zone-seuil-carreaux.test.ts`, `tests/integration/zone-seuil-territoire.test.ts`, `tests/unit/zones/executer-recette.test.ts`, `tests/unit/api/zones-routes.test.ts` (créés) ; specs Angular à côté de chaque fichier | |

---

## LOT 3 — ③ Zones à recette (12 tâches)

### Task 1: Rapatrier à l'identique les huit RPC vivantes du chemin des zones

**Files:**
- Create: `sql/252_rapatriement_rpc_zones.sql`
- Test: `tests/unit/db/rpc-chemin-zones-sources.test.ts`
- Doc: `ARCHITECTURE.md` (section `## Fonctions RPC PostGIS` : une ligne « sources rapatriées sql/252 »)

**Interfaces:**
- Produces: aucune fonction neuve ; la source versionnée de `get_carreaux_capture_geometry`, `get_carreaux_by_zoom`, `get_admin_filter_geometry`, `get_iris_selection_geometry`, `resolve_custom_geo_zone_codes` (DEUX surcharges : `(uuid)` et `(uuid, uuid)`), `resolve_custom_geo_zone_codes_with_subzones`, `transform_geometries_for_save`, `compute_zone_audience_stats`.

Pourquoi : ces fonctions n'existent QUE dans la base locale et son dump (`local-2026-09-19.dump`) ; Docker a déjà été vidé une fois (22/09). Les tâches suivantes en appellent quatre. On fige l'existant, défauts compris (`get_carreaux_capture_geometry` : 48 s par appel), sans rien corriger.

- [ ] **Step 1: Test (échec)** — `tests/unit/db/rpc-chemin-zones-sources.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Les RPC du chemin des zones ont une SOURCE versionnée (spec carte-en-parcours § 16.6). Jusqu'au 2026-10-14, huit
 * n'existaient que dans la base locale et son dump : un `docker volume rm` les effaçait sans recours.
 */
const RAPATRIEES = [
  'get_carreaux_capture_geometry', 'get_carreaux_by_zoom', 'get_admin_filter_geometry', 'get_iris_selection_geometry',
  'resolve_custom_geo_zone_codes', 'resolve_custom_geo_zone_codes_with_subzones', 'transform_geometries_for_save',
  'compute_zone_audience_stats',
];

const sources = readdirSync('sql').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`sql/${f}`, 'utf8')).join('\n');

describe('RPC du chemin des zones : une source dans sql/', () => {
  it.each(RAPATRIEES)('%s', (nom) => {
    expect(sources).toMatch(new RegExp(`create or replace function public\\.${nom}\\s*\\(`, 'i'));
  });
  it('les deux surcharges de resolve_custom_geo_zone_codes', () => {
    const n = sources.match(/create or replace function public\.resolve_custom_geo_zone_codes\s*\(/gi)?.length ?? 0;
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run --project unit tests/unit/db/rpc-chemin-zones-sources.test.ts` → 9 échecs.

- [ ] **Step 3: Extraire les définitions de la base locale** (lecture seule) :

```bash
docker exec supabase_db_genesis_app psql -U postgres -At -c "
  select pg_get_functiondef(p.oid) || ';' || E'\n'
    || coalesce((select string_agg(format('grant execute on function public.%I(%s) to %I;', p.proname,
                    pg_get_function_identity_arguments(p.oid), r.rolname), E'\n')
               from aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
              where a.privilege_type = 'EXECUTE' and r.rolname <> 'postgres'), '') || E'\n'
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('get_carreaux_capture_geometry','get_carreaux_by_zoom','get_admin_filter_geometry',
                      'get_iris_selection_geometry','resolve_custom_geo_zone_codes',
                      'resolve_custom_geo_zone_codes_with_subzones','transform_geometries_for_save',
                      'compute_zone_audience_stats')
  order by p.proname, pg_get_function_identity_arguments(p.oid);" > /tmp/rpc-zones.sql
```

Composer `sql/252_rapatriement_rpc_zones.sql` : l'en-tête ci-dessous, `begin;`, pour chaque fonction un `revoke all on function public.<nom>(<args>) from public;` puis sa définition et ses `grant` tels qu'extraits, `commit;`. **Ne rien reformater dans les corps** (le diff doit rester une copie).

```sql
-- 252 — Rapatriement À L'IDENTIQUE de huit RPC vivantes sans source (2026-10-14)
--
-- Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md § 16.6.
-- Ces fonctions n'existaient que dans la base locale et son dump. Elles sont recopiées par pg_get_functiondef,
-- droits compris, SANS AUCUNE CORRECTION — y compris get_carreaux_capture_geometry (48 s par appel,
-- docs/audit/SCALE_MODEL.md:107), que le lot 3 remplace pour l'étape ③ par zone_seuil_carreaux (sql/255) sans la
-- toucher, React la gardant. Rejouable (create or replace).
--
-- Fonctions : get_carreaux_capture_geometry, get_carreaux_by_zoom, get_admin_filter_geometry,
-- get_iris_selection_geometry, resolve_custom_geo_zone_codes (uuid) et (uuid, uuid),
-- resolve_custom_geo_zone_codes_with_subzones, transform_geometries_for_save, compute_zone_audience_stats.
```

- [ ] **Step 4: Rejouer sans changer la base** — appliquer DEUX fois, puis vérifier que les définitions sont inchangées :

```bash
docker exec supabase_db_genesis_app psql -U postgres -At -c "select md5(string_agg(pg_get_functiondef(oid), '' order by oid)) from pg_proc where pronamespace='public'::regnamespace and proname in ('get_carreaux_capture_geometry','get_carreaux_by_zoom','get_admin_filter_geometry','get_iris_selection_geometry','resolve_custom_geo_zone_codes','resolve_custom_geo_zone_codes_with_subzones','transform_geometries_for_save','compute_zone_audience_stats')"   # noter AVANT
docker exec -i supabase_db_genesis_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < sql/252_rapatriement_rpc_zones.sql
docker exec -i supabase_db_genesis_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < sql/252_rapatriement_rpc_zones.sql
# relancer la requête md5 : MÊME empreinte qu'avant. Sinon s'arrêter : le fichier n'est pas une copie.
```

- [ ] **Step 5: PASS** — le test du Step 1 ; `npx vitest run --project unit tests/unit/db` (la troncature ne doit pas bouger : ces fonctions rendent `jsonb`).
- [ ] **Step 6: Doc + commit** — `ARCHITECTURE.md` (une ligne sous `## Fonctions RPC PostGIS`) ; `git add sql/252_rapatriement_rpc_zones.sql tests/unit/db/rpc-chemin-zones-sources.test.ts ARCHITECTURE.md` ; `chore(db): rapatrier à l'identique huit RPC du chemin des zones (sql/252)`.

---

### Task 2: La recette — un module pur, copié serveur / Angular, et son schéma Zod

**Files:**
- Create: `lib/zones/recette.ts`, `angular/src/app/features/carte/logique/zones/recette.ts` (copie VERBATIM hors en-tête), `lib/zones/recette-schema.ts`
- Test: `tests/unit/zones/recette.test.ts`, `tests/unit/angular/recette-paritaire.test.ts`

**Interfaces:**
- Produces (identiques dans les deux copies) :
  - `VERSION_RECETTE = 1` ; `TYPES_RECETTE` (10 valeurs, ci-dessous) ; `type TypeRecette` ; `TYPES_RECALCULABLES` ; `TYPES_BORNES_PAR_PERIMETRE`.
  - `TYPES_PERIMETRE = ['region','departement','commune','cp','zone','france']` ; `interface PerimetreRecette { type; code }`.
  - Plafonds : `RAYON_POI_MIN_M = 100`, `RAYON_POI_MAX_M = 50_000`, `MAX_POI_RAYON = 5_000`, `MAX_CARREAUX_SEUIL = 20_000`, `MAX_TERRITOIRES_SEUIL = 5_000`, `MAX_SOMMETS_FORME = 20_000`, `MAX_CODES_POSTAUX = 3_000`, `SURFACE_MAX_PERIMETRE_KM2 = 100_000`.
  - `INDICATEURS_SEUIL_CARREAUX: readonly { id; libelle; unite: '%' | 'hab./km²' }[]` (13 entrées).
  - `type Recette` (union discriminée par `type`, 10 variantes) ; `type RefusRecette` ; `MESSAGES_REFUS: Record<RefusRecette, string>`.
  - `estRecalculable(r: Recette): boolean` ; `exigePerimetre(r: Recette): boolean` ; `refusPerimetreLocal(r: Recette): RefusRecette | null` ; `libelleRecette(r: Recette): string`.
- Produces (serveur seul) : `RecetteSchema` (Zod) ; `lireRecette(v: unknown): { ok: true; recette: Recette } | { ok: false; message: string }`.

- [ ] **Step 1: Tests (échec)** — `tests/unit/zones/recette.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  INDICATEURS_SEUIL_CARREAUX, MESSAGES_REFUS, TYPES_RECETTE, estRecalculable, exigePerimetre, libelleRecette,
  refusPerimetreLocal, type Recette,
} from '@/lib/zones/recette';
import { lireRecette } from '@/lib/zones/recette-schema';

const PER = { type: 'departement', code: '13' } as const;

describe('la recette d’une zone', () => {
  it('dix types, et le CHECK de la migration les liste tous', async () => {
    expect(TYPES_RECETTE).toHaveLength(10);
    const { readFileSync, readdirSync } = await import('node:fs');
    const f = readdirSync('sql').find((n) => /_zones_a_recette\.sql$/.test(n));
    if (!f) return; // la migration arrive en Task 3 ; ce test redevient strict ensuite
    const sql = readFileSync(`sql/${f}`, 'utf8');
    for (const t of TYPES_RECETTE) expect(sql, t).toContain(`'${t}'`);
  });

  it('recalculable : rayon, rayon POI, seuils, CP, combinaison — pas les formes figées', () => {
    const r = (type: string) => ({ v: 1, type } as unknown as Recette);
    expect(['rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux', 'combinaison'].every((t) => estRecalculable(r(t)))).toBe(true);
    expect(['dessin', 'import', 'isochrone', 'capture'].some((t) => estRecalculable(r(t)))).toBe(false);
  });

  it('les recettes lourdes exigent un périmètre et refusent la France', () => {
    const lourde: Recette = { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'france', code: 'FR' } };
    expect(exigePerimetre(lourde)).toBe(true);
    expect(refusPerimetreLocal(lourde)).toBe('perimetre_national_refuse');
    expect(refusPerimetreLocal({ ...lourde, perimetre: null })).toBe('perimetre_absent');
    expect(refusPerimetreLocal({ ...lourde, perimetre: PER })).toBeNull();
    expect(refusPerimetreLocal({ v: 1, type: 'codes_postaux', codes: ['13001'] })).toBeNull();
  });

  it('un message français pour chaque refus', () => {
    for (const [cle, m] of Object.entries(MESSAGES_REFUS)) expect(m.length, cle).toBeGreaterThan(10);
  });

  it('libellé d’une ligne, en sentence case', () => {
    expect(libelleRecette({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: PER })).toBe('Rayon de 5 km autour des POI « lycee »');
    expect(libelleRecette({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: PER }))
      .toBe('Carreaux où part des ménages pauvres ≥ 40 %');
    expect(libelleRecette({ v: 1, type: 'combinaison', operation: 'difference', zones: ['a', 'b', 'c'] })).toBe('Différence de 3 zones');
  });

  it('13 indicateurs de seuil sur carreaux, ids uniques', () => {
    expect(INDICATEURS_SEUIL_CARREAUX).toHaveLength(13);
    expect(new Set(INDICATEURS_SEUIL_CARREAUX.map((i) => i.id)).size).toBe(13);
  });
});

describe('lireRecette (Zod)', () => {
  it('accepte une recette complète', () => {
    expect(lireRecette({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: PER }).ok).toBe(true);
  });
  it.each([
    ['version inconnue', { v: 2, type: 'dessin' }],
    ['type inconnu', { v: 1, type: 'pluie' }],
    ['rayon trop grand', { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 60_000, perimetre: PER }],
    ['indicateur hors liste', { v: 1, type: 'seuil_carreaux', indicateur: 'men', operateur: '>=', seuil: 1, perimetre: PER }],
    ['opérateur', { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>', seuil: 1, perimetre: PER }],
    ['combinaison d’une seule zone', { v: 1, type: 'combinaison', operation: 'union', zones: ['3f2504e0-4f89-11d3-9a0c-0305e82c3301'] }],
    ['périmètre zone non UUID', { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 500, perimetre: { type: 'zone', code: 'abc' } }],
    ['clé en trop', { v: 1, type: 'dessin', geometrie: {} }],
  ])('refuse : %s, avec un message français', (_n, v) => {
    const r = lireRecette(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/^Recette/);
  });
});
```

`tests/unit/angular/recette-paritaire.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import * as R from '@/lib/zones/recette';
import * as A from '../../../angular/src/app/features/carte/logique/zones/recette';

describe('recette de zone : Angular = serveur', () => {
  it('mêmes constantes', () => {
    for (const k of ['VERSION_RECETTE', 'TYPES_RECETTE', 'TYPES_RECALCULABLES', 'TYPES_BORNES_PAR_PERIMETRE', 'TYPES_PERIMETRE',
      'RAYON_POI_MIN_M', 'RAYON_POI_MAX_M', 'MAX_POI_RAYON', 'MAX_CARREAUX_SEUIL', 'MAX_TERRITOIRES_SEUIL', 'MAX_SOMMETS_FORME',
      'MAX_CODES_POSTAUX', 'SURFACE_MAX_PERIMETRE_KM2', 'INDICATEURS_SEUIL_CARREAUX', 'MESSAGES_REFUS'] as const) {
      expect((A as unknown as Record<string, unknown>)[k], k).toEqual((R as unknown as Record<string, unknown>)[k]);
    }
  });
  it('mêmes réponses', () => {
    const cas: R.Recette[] = [
      { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 20_000 },
      { v: 1, type: 'rayon_poi', categorie: 'cirfa', rayon_m: 10_000, perimetre: { type: 'france', code: 'FR' } },
      { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '<=', seuil: 10, perimetre: null },
      { v: 1, type: 'import', format: 'kml', fichier: 'zones.kml' },
      { v: 1, type: 'combinaison', operation: 'union', zones: ['a', 'b'] },
    ];
    for (const r of cas) {
      expect(A.estRecalculable(r)).toBe(R.estRecalculable(r));
      expect(A.exigePerimetre(r)).toBe(R.exigePerimetre(r));
      expect(A.refusPerimetreLocal(r)).toBe(R.refusPerimetreLocal(r));
      expect(A.libelleRecette(r)).toBe(R.libelleRecette(r));
    }
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run --project unit tests/unit/zones/recette.test.ts tests/unit/angular/recette-paritaire.test.ts`.

- [ ] **Step 3: Implémenter** — `lib/zones/recette.ts` (la copie Angular est IDENTIQUE, en-tête « Copie VERBATIM de `lib/zones/recette.ts`, verrouillée par `tests/unit/angular/recette-paritaire.test.ts` ») :

```ts
/**
 * @file lib/zones/recette.ts — la recette d'une zone (spec carte-en-parcours § 16.3, décisions du 14/10).
 *
 * À l'étape ③, toute sélection devient UNE zone (`custom_geo_zones`) qui garde la recette qui l'a produite, pour être
 * recalculée. La recette est stockée telle quelle dans `custom_geo_zones.recette` (sql/253, CHECK sur `v` et `type`).
 * Une recette « figée » (dessin, import, isochrone, capture) garde sa trace mais n'est pas rejouée (arbitrage A-3).
 *
 * Les plafonds sont ceux des RPC (sql/254-256) : un dépassement est un REFUS dit à l'utilisateur, jamais une troncature.
 * Copie Angular : angular/src/app/features/carte/logique/zones/recette.ts (parité verrouillée).
 */
export const VERSION_RECETTE = 1;

export const TYPES_RECETTE = [
  'rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux',
  'dessin', 'import', 'isochrone', 'combinaison', 'capture',
] as const;
export type TypeRecette = (typeof TYPES_RECETTE)[number];

/** Rejouées par l'exécuteur serveur (`lib/zones/executer-recette.ts`). */
export const TYPES_RECALCULABLES: readonly TypeRecette[] = ['rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux', 'combinaison'];
/** Coûteuses : bornées par le périmètre de ①, refusent la France entière (spec § 16.2-5). */
export const TYPES_BORNES_PAR_PERIMETRE: readonly TypeRecette[] = ['rayon_poi', 'seuil_carreaux', 'seuil_territoire'];

export const TYPES_PERIMETRE = ['region', 'departement', 'commune', 'cp', 'zone', 'france'] as const;
export type TypePerimetre = (typeof TYPES_PERIMETRE)[number];
export interface PerimetreRecette {
  readonly type: TypePerimetre;
  /** Code INSEE, code postal, UUID de zone ; `FR` pour la France. */
  readonly code: string;
}

export const RAYON_POI_MIN_M = 100;
export const RAYON_POI_MAX_M = 50_000;
export const MAX_POI_RAYON = 5_000;
export const MAX_CARREAUX_SEUIL = 20_000;
export const MAX_TERRITOIRES_SEUIL = 5_000;
export const MAX_SOMMETS_FORME = 20_000;
export const MAX_CODES_POSTAUX = 3_000;
export const SURFACE_MAX_PERIMETRE_KM2 = 100_000;

export type OperateurSeuil = '>=' | '<=';

/**
 * Les indicateurs d'un seuil sur carreaux Filosofi 200 m — liste FERMÉE, la même que le `case` de
 * `zone_seuil_carreaux` (sql/255, verrouillé par tests/integration/zone-seuil-carreaux.test.ts). Une part est en %
 * (numérateur / ménages ou individus du carreau) ; la densité en habitants par km² (individus / 0,04 km²).
 */
export const INDICATEURS_SEUIL_CARREAUX: readonly { readonly id: string; readonly libelle: string; readonly unite: '%' | 'hab./km²' }[] = [
  { id: 'part_men_pauv', libelle: 'Part des ménages pauvres', unite: '%' },
  { id: 'part_men_1ind', libelle: 'Part des ménages d’une personne', unite: '%' },
  { id: 'part_men_5ind', libelle: 'Part des ménages de 5 personnes ou plus', unite: '%' },
  { id: 'part_men_prop', libelle: 'Part des ménages propriétaires', unite: '%' },
  { id: 'part_men_fmp', libelle: 'Part des familles monoparentales', unite: '%' },
  { id: 'part_men_coll', libelle: 'Part des ménages en logement collectif', unite: '%' },
  { id: 'part_ind_18_24', libelle: 'Part des 18-24 ans', unite: '%' },
  { id: 'part_ind_25_39', libelle: 'Part des 25-39 ans', unite: '%' },
  { id: 'part_ind_40_54', libelle: 'Part des 40-54 ans', unite: '%' },
  { id: 'part_ind_55_64', libelle: 'Part des 55-64 ans', unite: '%' },
  { id: 'part_ind_65_79', libelle: 'Part des 65-79 ans', unite: '%' },
  { id: 'part_ind_80p', libelle: 'Part des 80 ans et plus', unite: '%' },
  { id: 'densite_ind', libelle: 'Densité d’habitants', unite: 'hab./km²' },
];

export type Recette =
  | { readonly v: 1; readonly type: 'rayon_point'; readonly lon: number; readonly lat: number; readonly rayon_m: number }
  | { readonly v: 1; readonly type: 'rayon_poi'; readonly categorie: string; readonly rayon_m: number; readonly perimetre: PerimetreRecette | null }
  | { readonly v: 1; readonly type: 'seuil_carreaux'; readonly indicateur: string; readonly operateur: OperateurSeuil; readonly seuil: number; readonly perimetre: PerimetreRecette | null }
  | { readonly v: 1; readonly type: 'seuil_territoire'; readonly indicateur: string; readonly operateur: OperateurSeuil; readonly seuil: number; readonly perimetre: PerimetreRecette | null }
  | { readonly v: 1; readonly type: 'codes_postaux'; readonly codes: readonly string[] }
  | { readonly v: 1; readonly type: 'dessin' }
  | { readonly v: 1; readonly type: 'import'; readonly format: 'geojson' | 'kml'; readonly fichier: string }
  | { readonly v: 1; readonly type: 'isochrone'; readonly parametres: Readonly<Record<string, string | number | boolean>> }
  | { readonly v: 1; readonly type: 'combinaison'; readonly operation: 'union' | 'intersection' | 'difference'; readonly zones: readonly string[] }
  | { readonly v: 1; readonly type: 'capture'; readonly source_type: string };

/** Les refus que rend une RPC de recette (`{ refus }`) ou que l'écran pose avant d'appeler. */
export type RefusRecette =
  | 'perimetre_absent' | 'perimetre_national_refuse' | 'perimetre_inconnu' | 'perimetre_trop_grand'
  | 'trop_de_poi' | 'trop_de_carreaux' | 'trop_de_territoires' | 'trop_de_sommets'
  | 'indicateur_inconnu' | 'zone_introuvable' | 'zone_referencee' | 'forme_vide' | 'forme_figee';

export const MESSAGES_REFUS: Readonly<Record<RefusRecette, string>> = {
  perimetre_absent: 'Choisissez un périmètre à l’étape ① avant ce calcul.',
  perimetre_national_refuse: 'Ce calcul ne se lance pas sur la France entière : choisissez une région, un département ou une zone à l’étape ①.',
  perimetre_inconnu: 'Le périmètre de l’étape ① est introuvable ou n’appartient pas à cet espace.',
  perimetre_trop_grand: 'Le périmètre dépasse 100 000 km² : resserrez-le à l’étape ①.',
  trop_de_poi: 'Plus de 5 000 POI dans le périmètre : resserrez le périmètre.',
  trop_de_carreaux: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.',
  trop_de_territoires: 'Plus de 5 000 territoires retenus : resserrez le périmètre ou relevez le seuil.',
  trop_de_sommets: 'La forme dépasse 20 000 sommets : simplifiez-la avant de l’importer.',
  indicateur_inconnu: 'Cet indicateur n’est pas disponible pour un seuil.',
  zone_introuvable: 'Zone introuvable dans cet espace.',
  zone_referencee: 'Cette zone est utilisée par un plan : dupliquez-la avant de la recalculer.',
  forme_vide: 'Aucun territoire français dans cette forme : rien à enregistrer.',
  forme_figee: 'Cette zone a une forme figée (dessin, import, isochrone ou capture) : elle ne se recalcule pas.',
};

export function estRecalculable(r: Recette): boolean {
  return TYPES_RECALCULABLES.includes(r.type);
}

export function exigePerimetre(r: Recette): boolean {
  return TYPES_BORNES_PAR_PERIMETRE.includes(r.type);
}

/** Le refus que l'écran pose AVANT tout appel ; la surface et l'appartenance d'une zone se vérifient en base. */
export function refusPerimetreLocal(r: Recette): RefusRecette | null {
  if (!exigePerimetre(r) || !('perimetre' in r)) return null;
  if (!r.perimetre) return 'perimetre_absent';
  if (r.perimetre.type === 'france') return 'perimetre_national_refuse';
  return null;
}

function km(m: number): string {
  return m >= 1000 ? `${Math.round(m / 100) / 10} km`.replace('.', ',') : `${m} m`;
}

const OPERATIONS = { union: 'Union', intersection: 'Intersection', difference: 'Différence' } as const;

/** Une ligne lisible, sans le nom de la zone (affichée dans « Mes zones »). */
export function libelleRecette(r: Recette): string {
  switch (r.type) {
    case 'rayon_point': return `Rayon de ${km(r.rayon_m)} autour d’un point`;
    case 'rayon_poi': return `Rayon de ${km(r.rayon_m)} autour des POI « ${r.categorie} »`;
    case 'seuil_carreaux': {
      const i = INDICATEURS_SEUIL_CARREAUX.find((x) => x.id === r.indicateur);
      const nom = i ? i.libelle.charAt(0).toLowerCase() + i.libelle.slice(1) : r.indicateur;
      return `Carreaux où ${nom} ${r.operateur === '>=' ? '≥' : '≤'} ${String(r.seuil).replace('.', ',')} ${i?.unite ?? ''}`.trim();
    }
    case 'seuil_territoire': return `Territoires où ${r.indicateur} ${r.operateur === '>=' ? '≥' : '≤'} ${String(r.seuil).replace('.', ',')}`;
    case 'codes_postaux': return `${r.codes.length} code${r.codes.length > 1 ? 's' : ''} postal${r.codes.length > 1 ? 'aux' : ''}`;
    case 'dessin': return 'Dessin à main levée';
    case 'import': return `Import ${r.format === 'kml' ? 'KML' : 'GeoJSON'} (${r.fichier})`;
    case 'isochrone': return 'Isochrones';
    case 'combinaison': return `${OPERATIONS[r.operation]} de ${r.zones.length} zones`;
    case 'capture': return 'Capture de la carte';
  }
}
```

`lib/zones/recette-schema.ts` :

```ts
/**
 * @file lib/zones/recette-schema.ts — la recette validée côté serveur (Zod). Les bornes sont celles de
 * `lib/zones/recette.ts` ; `.strict()` partout : une clé inconnue est refusée (une géométrie ne voyage JAMAIS dans la
 * recette, elle a son propre champ dans les routes).
 */
import { z } from 'zod';
import {
  INDICATEURS_SEUIL_CARREAUX, MAX_CODES_POSTAUX, RAYON_POI_MAX_M, RAYON_POI_MIN_M, TYPES_PERIMETRE, type Recette,
} from './recette';

const Uuid = z.string().uuid();
const Perimetre = z.object({ type: z.enum(TYPES_PERIMETRE), code: z.string().min(1).max(64) }).strict()
  .refine((p) => p.type !== 'zone' || Uuid.safeParse(p.code).success, { message: 'zone non UUID' })
  .nullable();
const Operateur = z.enum(['>=', '<=']);
const IDS_CARREAUX = INDICATEURS_SEUIL_CARREAUX.map((i) => i.id) as [string, ...string[]];

export const RecetteSchema = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), type: z.literal('rayon_point'), lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90), rayon_m: z.number().int().min(RAYON_POI_MIN_M).max(100_000) }).strict(),
  z.object({ v: z.literal(1), type: z.literal('rayon_poi'), categorie: z.string().regex(/^[a-z0-9_-]{1,64}$/), rayon_m: z.number().int().min(RAYON_POI_MIN_M).max(RAYON_POI_MAX_M), perimetre: Perimetre }).strict(),
  z.object({ v: z.literal(1), type: z.literal('seuil_carreaux'), indicateur: z.enum(IDS_CARREAUX), operateur: Operateur, seuil: z.number().finite().min(0).max(100_000), perimetre: Perimetre }).strict(),
  z.object({ v: z.literal(1), type: z.literal('seuil_territoire'), indicateur: z.string().regex(/^[a-z0-9_]{1,64}$/), operateur: Operateur, seuil: z.number().finite(), perimetre: Perimetre }).strict(),
  z.object({ v: z.literal(1), type: z.literal('codes_postaux'), codes: z.array(z.string().regex(/^\d{5}$/)).min(1).max(MAX_CODES_POSTAUX) }).strict(),
  z.object({ v: z.literal(1), type: z.literal('dessin') }).strict(),
  z.object({ v: z.literal(1), type: z.literal('import'), format: z.enum(['geojson', 'kml']), fichier: z.string().min(1).max(200) }).strict(),
  z.object({ v: z.literal(1), type: z.literal('isochrone'), parametres: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).refine((o) => Object.keys(o).length <= 20) }).strict(),
  z.object({ v: z.literal(1), type: z.literal('combinaison'), operation: z.enum(['union', 'intersection', 'difference']), zones: z.array(Uuid).min(2).max(20) }).strict(),
  z.object({ v: z.literal(1), type: z.literal('capture'), source_type: z.string().min(1).max(100) }).strict(),
]);

export function lireRecette(v: unknown): { ok: true; recette: Recette } | { ok: false; message: string } {
  const r = RecetteSchema.safeParse(v);
  if (r.success) return { ok: true, recette: r.data as Recette };
  const i = r.error.issues[0];
  return { ok: false, message: `Recette invalide : ${i?.path.join('.') || 'racine'} — ${i?.message ?? 'forme inattendue'}.` };
}
```

- [ ] **Step 4: PASS** — `npx vitest run --project unit tests/unit/zones tests/unit/angular/recette-paritaire.test.ts` ; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(zones): la recette d'une zone, serveur et Angular`.

---

### Task 3: La colonne `recette`, le périmètre en base, écrire et remplacer une zone

**Files:**
- Create: `sql/253_zones_a_recette.sql`
- Modify: `types/database.types.ts` (régénéré)
- Test: `tests/integration/zones-recette.test.ts`
- Doc: `ARCHITECTURE.md` (ligne `custom_geo_zones` sous `## Tables Supabase` ; quatre fonctions sous `## Fonctions RPC PostGIS`)

**Interfaces:**
- Consumes: `create_custom_geo_zone(p_name, p_description, p_org_id, p_source_type, p_source_metadata, p_geometry_geojson) → uuid` (sql/247).
- Produces:
  - colonne `custom_geo_zones.recette jsonb null`, CHECK `custom_geo_zones_recette_forme` (`v = 1`, `type` ∈ les 10 de `TYPES_RECETTE`).
  - `geometrie_perimetre(p_type text, p_code text, p_org_id uuid) → geometry` (NULL si inconnu ou zone d'un autre espace ; `france` → NULL).
  - `refus_perimetre(p_type text, p_geom geometry, p_max_km2 numeric) → text` (`perimetre_national_refuse` · `perimetre_inconnu` · `perimetre_trop_grand` · NULL).
  - `creer_zone_recette(p_nom text, p_org_id uuid, p_cree_par uuid, p_recette jsonb, p_geometry_geojson text) → jsonb {id}` ; `source_type = 'recette_' || type`.
  - `remplacer_geometrie_zone(p_zone_id uuid, p_org_id uuid, p_geometry_geojson text) → jsonb` : `{remplace: true}` | `{refus: 'zone_introuvable'}` | `{refus: 'zone_referencee', par: 'strategie'|'jeu_de_zones'|'composite'|'combinaison'}`.
  - Droits : `service_role` seul pour les quatre.

- [ ] **Step 1: Test d'intégration (échec)** — `tests/integration/zones-recette.test.ts` :

```ts
/**
 * Zones à recette (spec carte-en-parcours § 16) : une zone garde la recette qui l'a produite ; la remplacer est refusé
 * dès qu'un plan la cite. Le périmètre de ① est résolu EN BASE (jamais une géométrie fournie par le client).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
let org = '';
let autreOrg = '';
const CARRE = JSON.stringify({ type: 'Polygon', coordinates: [[[5.36, 43.29], [5.40, 43.29], [5.40, 43.32], [5.36, 43.32], [5.36, 43.29]]] });
const RECETTE = { v: 1, type: 'dessin' };

async function nouvelleOrg(nom: string) {
  const { data, error } = await admin.from('organizations').insert({ name: `[ESSAI lot3] ${nom}`, slug: `essai-lot3-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}
async function creer(recette: unknown = RECETTE, o = org) {
  return admin.rpc('creer_zone_recette', { p_nom: 'Essai', p_org_id: o, p_cree_par: null, p_recette: recette, p_geometry_geojson: CARRE });
}

beforeAll(async () => { org = await nouvelleOrg('a'); autreOrg = await nouvelleOrg('b'); });
afterAll(async () => {
  for (const o of [org, autreOrg]) {
    const { error } = await admin.from('organizations').delete().eq('id', o);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('creer_zone_recette', () => {
  it('écrit la zone, sa recette et un source_type lisible', async () => {
    const { data, error } = await creer();
    expect(error).toBeNull();
    const id = (data as { id: string }).id;
    const { data: z } = await admin.from('custom_geo_zones').select('recette, source_type, org_id').eq('id', id).single();
    expect(z).toEqual({ recette: RECETTE, source_type: 'recette_dessin', org_id: org });
  });
  it('une recette d’une autre version, ou d’un type inconnu, est refusée et rien n’est écrit', async () => {
    const avant = await admin.from('custom_geo_zones').select('id', { count: 'exact', head: true }).eq('org_id', org);
    for (const r of [{ v: 2, type: 'dessin' }, { v: 1, type: 'pluie' }]) {
      const { error } = await creer(r);
      expect(error?.code).toBe('23514');
    }
    const apres = await admin.from('custom_geo_zones').select('id', { count: 'exact', head: true }).eq('org_id', org);
    expect(apres.count).toBe(avant.count);
  });
});

// geometrie_perimetre / refus_perimetre rendent un `geometry` et un texte appelés de SQL à SQL : ils se vérifient
// en psql (Step 4) et à travers les RPC des Tasks 4-6 — aucune fonction d'essai n'est créée en base pour eux.

describe('remplacer_geometrie_zone', () => {
  it('remplace la forme d’une zone libre et efface ses statistiques', async () => {
    const id = ((await creer()).data as { id: string }).id;
    await admin.from('custom_geo_zones').update({ audience_stats: { pop: 1 } }).eq('id', id);
    const AUTRE = JSON.stringify({ type: 'Polygon', coordinates: [[[5.30, 43.25], [5.45, 43.25], [5.45, 43.35], [5.30, 43.35], [5.30, 43.25]]] });
    const { data, error } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: id, p_org_id: org, p_geometry_geojson: AUTRE });
    expect(error).toBeNull();
    expect(data).toEqual({ remplace: true });
    const { data: z } = await admin.from('custom_geo_zones').select('audience_stats, resolved_at').eq('id', id).single();
    expect(z).toEqual({ audience_stats: {}, resolved_at: null });
  });
  it('une zone d’un autre espace : introuvable, rien ne change', async () => {
    const id = ((await creer(RECETTE, autreOrg)).data as { id: string }).id;
    const { data } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: id, p_org_id: org, p_geometry_geojson: CARRE });
    expect(data).toEqual({ refus: 'zone_introuvable' });
  });
  it('une zone citée par une combinaison : refus, la forme ne bouge pas', async () => {
    const a = ((await creer()).data as { id: string }).id;
    const b = ((await creer()).data as { id: string }).id;
    await creer({ v: 1, type: 'combinaison', operation: 'union', zones: [a, b] });
    const { data } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: a, p_org_id: org, p_geometry_geojson: CARRE });
    expect(data).toEqual({ refus: 'zone_referencee', par: 'combinaison' });
  });
  it('une zone membre d’un composite (React) : refus', async () => {
    const a = ((await creer()).data as { id: string }).id;
    await admin.rpc('create_custom_geo_zone', {
      p_name: 'Composite', p_description: null, p_org_id: org, p_source_type: 'composite',
      p_source_metadata: { kind: 'union', member_zone_ids: [a] }, p_geometry_geojson: CARRE,
    });
    const { data } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: a, p_org_id: org, p_geometry_geojson: CARRE });
    expect(data).toEqual({ refus: 'zone_referencee', par: 'composite' });
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run --project integration tests/integration/zones-recette.test.ts` (fonction inexistante).

- [ ] **Step 3: Migration** — `sql/253_zones_a_recette.sql` :

```sql
-- 253 — Zones à recette (2026-10-14)
--
-- Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md § 16 (décisions du 14/10), arbitrages A-1, A-2.
-- À l'étape ③, toute sélection devient UNE zone de custom_geo_zones qui garde sa RECETTE (lib/zones/recette.ts),
-- pour être recalculée. Une zone d'avant le 14/10 a recette NULL : forme figée.
--
-- geometrie_perimetre : le périmètre de l'étape ① résolu EN BASE (jamais une géométrie fournie par le client) ; une
--   zone d'un autre espace rend NULL. `france` rend NULL exprès : les recettes lourdes le refusent (refus_perimetre).
-- refus_perimetre : la garde commune des recettes lourdes (sql/254-256) — national refusé, inconnu, > p_max_km2.
--   Mesuré : ST_Area(geography) de la région ARA (la plus lourde à résoudre) en < 60 ms.
-- creer_zone_recette : create_custom_geo_zone (sql/247 : validation, réparation, ST_Multi) PUIS la recette et l'auteur,
--   dans la MÊME transaction — une recette refusée par le CHECK n'écrit aucune zone.
-- remplacer_geometrie_zone : le recalcul (A-2). Refusé dès qu'un plan cite la zone : stratégie de bidding, jeu de zones
--   (miroir), composite React (source_metadata.member_zone_ids), combinaison (recette.zones). Verrou FOR UPDATE sur la
--   ligne : deux recalculs simultanés se suivent.
-- Droits : service_role seul (les routes passent par createAdminClient). Rejouable. Aucun DROP.

begin;

alter table public.custom_geo_zones add column if not exists recette jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'custom_geo_zones_recette_forme') then
    alter table public.custom_geo_zones add constraint custom_geo_zones_recette_forme check (
      recette is null or (
        jsonb_typeof(recette) = 'object'
        and recette->>'v' = '1'
        and recette->>'type' in ('rayon_point', 'rayon_poi', 'seuil_carreaux', 'seuil_territoire', 'codes_postaux',
                                 'dessin', 'import', 'isochrone', 'combinaison', 'capture')
      )
    );
  end if;
end $$;

comment on column public.custom_geo_zones.recette is
  'Recette de la zone (lib/zones/recette.ts, v=1) : ce qui la recalcule. NULL = forme figee (zones d avant le 2026-10-14). sql/253.';

create index if not exists idx_custom_geo_zones_recette_zones
  on public.custom_geo_zones using gin ((recette->'zones')) where recette->>'type' = 'combinaison';

create or replace function public.geometrie_perimetre(p_type text, p_code text, p_org_id uuid)
returns geometry
language plpgsql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v geometry;
begin
  case p_type
    when 'region' then
      select ST_Multi(geom) into v from public.ref_regions where code_region = p_code;
    when 'departement' then
      select ST_Multi(geom) into v from public.ref_departements where code_dept = p_code;
    when 'commune' then
      select ST_Multi(geom) into v from public.ref_communes where code_commune = p_code;
    when 'cp' then
      select ST_Multi(geom) into v from public.ref_codes_postaux where code_postal = p_code limit 1;
    when 'zone' then
      -- plpgsql et non sql : un cast ::uuid d'un code invalide lèverait, même derrière un CASE replié à la planification.
      if p_code ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select z.geometry into v from public.custom_geo_zones z where z.id = p_code::uuid and z.org_id = p_org_id;
      end if;
    else
      v := null;
  end case;
  return v;
end
$fn$;

create or replace function public.refus_perimetre(p_type text, p_geom geometry, p_max_km2 numeric)
returns text
language sql
stable
set search_path to 'public', 'pg_catalog'
as $fn$
  select case
    when p_type = 'france' then 'perimetre_national_refuse'
    when p_geom is null or ST_IsEmpty(p_geom) then 'perimetre_inconnu'
    when ST_Area(p_geom::geography) / 1e6 > p_max_km2 then 'perimetre_trop_grand'
  end
$fn$;

create or replace function public.creer_zone_recette(
  p_nom text, p_org_id uuid, p_cree_par uuid, p_recette jsonb, p_geometry_geojson text
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_id uuid;
begin
  v_id := public.create_custom_geo_zone(
    p_nom, null, p_org_id, 'recette_' || coalesce(p_recette->>'type', 'inconnue'), '{}'::jsonb, p_geometry_geojson
  );
  update public.custom_geo_zones set recette = p_recette, created_by = p_cree_par where id = v_id;
  return jsonb_build_object('id', v_id);
end
$fn$;

create or replace function public.remplacer_geometrie_zone(p_zone_id uuid, p_org_id uuid, p_geometry_geojson text)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_geom geometry;
  v_par text;
begin
  perform 1 from public.custom_geo_zones where id = p_zone_id and org_id = p_org_id for update;
  if not found then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;

  v_par := case
    when exists (select 1 from public.bidding_strategies where zone_id = p_zone_id) then 'strategie'
    when exists (select 1 from public.zone_sets where custom_geo_zone_id = p_zone_id) then 'jeu_de_zones'
    when exists (select 1 from public.custom_geo_zones
                  where source_metadata @> jsonb_build_object('member_zone_ids', jsonb_build_array(p_zone_id))) then 'composite'
    when exists (select 1 from public.custom_geo_zones
                  where recette->>'type' = 'combinaison'
                    and recette->'zones' @> jsonb_build_array(p_zone_id)) then 'combinaison'
  end;
  if v_par is not null then
    return jsonb_build_object('refus', 'zone_referencee', 'par', v_par);
  end if;

  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geometry_geojson), 4326);
  if GeometryType(v_geom) not in ('POLYGON', 'MULTIPOLYGON') then
    raise exception 'geometrie non surfacique (%)', GeometryType(v_geom) using errcode = '22023';
  end if;
  if not ST_IsValid(v_geom) then
    v_geom := ST_CollectionExtract(ST_MakeValid(v_geom), 3);
  end if;
  if v_geom is null or ST_IsEmpty(v_geom) then
    raise exception 'geometrie sans surface' using errcode = '22023';
  end if;

  update public.custom_geo_zones
     set geometry = ST_Multi(v_geom), resolved_at = null,
         audience_stats = '{}'::jsonb, audience_computed_at = null,
         items_audience_stats = null, items_audience_computed_at = null
   where id = p_zone_id;
  return jsonb_build_object('remplace', true);
end
$fn$;

revoke all on function public.geometrie_perimetre(text, text, uuid) from public, anon, authenticated;
revoke all on function public.refus_perimetre(text, geometry, numeric) from public, anon, authenticated;
revoke all on function public.creer_zone_recette(text, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.remplacer_geometrie_zone(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.geometrie_perimetre(text, text, uuid) to service_role;
grant execute on function public.refus_perimetre(text, geometry, numeric) to service_role;
grant execute on function public.creer_zone_recette(text, uuid, uuid, jsonb, text) to service_role;
grant execute on function public.remplacer_geometrie_zone(uuid, uuid, text) to service_role;

commit;
```

Appliquer DEUX fois, recharger PostgREST, régénérer les types :

```bash
docker exec -i supabase_db_genesis_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < sql/253_zones_a_recette.sql
docker exec -i supabase_db_genesis_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < sql/253_zones_a_recette.sql
docker exec supabase_db_genesis_app psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';"
npx supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > types/database.types.ts
git diff --stat types/database.types.ts   # seulement recette + les quatre fonctions
```

- [ ] **Step 4: PASS + vérifications psql + EXPLAIN** — le test du Step 1, puis :

```bash
docker exec supabase_db_genesis_app psql -U postgres -At -c "
  select t, c, public.refus_perimetre(t, public.geometrie_perimetre(t, c, null), 100000)
  from (values ('departement','13'),('region','84'),('commune','13055'),('cp','13001'),('region','99'),('france','FR'),('zone','pas-un-uuid')) v(t, c);"
# attendu : 13 / 84 / 13055 / 13001 → vide ; 99 → perimetre_inconnu ; FR → perimetre_national_refuse ; pas-un-uuid → perimetre_inconnu (sans exception)
docker exec supabase_db_genesis_app psql -U postgres -c "EXPLAIN (ANALYZE, BUFFERS) select public.refus_perimetre('region', public.geometrie_perimetre('region','84',null), 100000);"
```

Reporter le temps et les buffers dans le rapport (attendu < 100 ms).

- [ ] **Step 5: Doc + commit** — `ARCHITECTURE.md` ; `git add sql/253_zones_a_recette.sql types/database.types.ts tests/integration/zones-recette.test.ts ARCHITECTURE.md` ; `feat(db): zones à recette — colonne recette, périmètre en base, écrire et remplacer (sql/253)`.

---

### Task 4: `zone_rayon_poi` — un rayon autour de tous les POI d'un type, dans le périmètre

**Files:**
- Create: `sql/254_zone_rayon_poi.sql`
- Modify: `types/database.types.ts`
- Test: `tests/integration/zone-rayon-poi.test.ts`
- Doc: `ARCHITECTURE.md` (`## Fonctions RPC PostGIS`)

**Interfaces:**
- Consumes: `geometrie_perimetre`, `refus_perimetre` (Task 3).
- Produces: `zone_rayon_poi(p_categorie text, p_rayon_m integer, p_perimetre_type text, p_perimetre_code text, p_org_id uuid, p_sources uuid[], p_max_poi integer default 5000) → jsonb` :
  `{ vide, compte, geometry (MultiPolygon 4326 | null), surface_km2, part_retenue }` ou `{ refus, plafond? }` ; rayon hors [100, 50 000] ou plafond hors [1, 5 000] → exception `22023`.
  Visibilité des POI : `data_source_id is null or data_source_id = any(p_sources)` — la règle de `source_visible` (sql/234) ; `p_sources` = `sourcesVisiblesDeLaRequete`.

- [ ] **Step 1: Test d'intégration (échec)** — `tests/integration/zone-rayon-poi.test.ts` :

```ts
/**
 * Rayon autour de TOUS les POI d'un type, dans le périmètre de ① (spec § 16.3, arbitrage L3-1 : la zone est découpée
 * par le périmètre). Mesures du 2026-10-14 : 5 584 lycées, 5 km, région ARA → 0,8 s.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
// Les lycées ont TOUS une source (0 sur 5 584 sans data_source_id, mesuré le 14/10) : sans elle, ils sont invisibles.
let sourcesLycees: string[] = [];
beforeAll(async () => {
  const { data, error } = await admin.from('poi_france').select('data_source_id').eq('categorie', 'lycee').limit(1);
  if (error || !data?.[0]?.data_source_id) throw new Error(`source des lycées : ${error?.message ?? 'absente'}`);
  sourcesLycees = [data[0].data_source_id as string];
});
const appeler = (args: Record<string, unknown>) => admin.rpc('zone_rayon_poi', {
  p_categorie: 'lycee', p_rayon_m: 5000, p_perimetre_type: 'departement', p_perimetre_code: '13',
  p_org_id: null, p_sources: sourcesLycees, p_max_poi: 5000, ...args,
});

describe('zone_rayon_poi', () => {
  it('les lycées des Bouches-du-Rhône à 5 km : une zone, découpée par le département', async () => {
    const { data, error } = await appeler({});
    expect(error).toBeNull();
    const r = data as { vide: boolean; compte: number; geometry: { type: string }; surface_km2: number; part_retenue: number };
    expect(r.vide).toBe(false);
    expect(r.compte).toBeGreaterThan(50);
    expect(r.geometry.type).toBe('MultiPolygon');
    expect(r.part_retenue).toBeGreaterThan(0);
    expect(r.part_retenue).toBeLessThanOrEqual(1);
  });
  it('POI d’une source NON visible : invisibles (les lycées sans leur source, les CIRFA)', async () => {
    expect((await appeler({ p_sources: [] })).data).toMatchObject({ vide: true, compte: 0, geometry: null });
    const { data } = await appeler({ p_categorie: 'cirfa', p_perimetre_type: 'region', p_perimetre_code: '93' });
    expect(data).toMatchObject({ vide: true, compte: 0, geometry: null });
  });
  it.each([
    ['France entière', { p_perimetre_type: 'france', p_perimetre_code: 'FR' }, 'perimetre_national_refuse'],
    ['département inconnu', { p_perimetre_code: '00' }, 'perimetre_inconnu'],
  ])('%s : refus, sans calcul', async (_n, args, refus) => {
    const { data, error } = await appeler(args);
    expect(error).toBeNull();
    expect(data).toEqual({ refus });
  });
  it('plus de POI que le plafond : refus « trop_de_poi », jamais une zone partielle', async () => {
    const { data } = await appeler({ p_max_poi: 10 });
    expect(data).toEqual({ refus: 'trop_de_poi', plafond: 10 });
  });
  it('rayon hors bornes : 22023', async () => {
    const { error } = await appeler({ p_rayon_m: 60_000 });
    expect(error?.code).toBe('22023');
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run --project integration tests/integration/zone-rayon-poi.test.ts`.

- [ ] **Step 3: Migration** — `sql/254_zone_rayon_poi.sql` :

```sql
-- 254 — Zone : rayon autour de tous les POI d'un type, dans le périmètre (2026-10-14)
--
-- Spec : carte-en-parcours § 16.3 ; arbitrages A-4 (plafond 5 000 POI, national refusé) et L3-1 (zone découpée par le
-- périmètre : le périmètre BORNE, une zone qui le déborderait ne serait plus bornée au recalcul).
-- zone_rayon (sql/155) ne fait qu'UN point ; ceci fait tous les POI d'une catégorie.
--
-- Visibilité : la règle de source_visible (sql/234) — un POI sans source est commun, sinon sa source doit être dans
-- p_sources (sourcesVisiblesDeLaRequete côté route).
-- Plafond : on lit p_max_poi + 1 points ; au-delà, refus (jamais une zone partielle).
-- Buffer en geography (rayon en MÈTRES sur la sphère), comme zone_rayon.
-- Mesuré le 2026-10-14 (EXPLAIN ANALYZE local) : lycées × 5 km × région 84 → 0,8 s, 834 buffers ;
-- sites ICPE × 2 km × région 84 plafonnés à 5 000 → 2,0 s, 31 900 buffers.
-- Rend jsonb (une géométrie, pas des lignes : rien à tronquer). Droits : service_role. Rejouable.

begin;

create or replace function public.zone_rayon_poi(
  p_categorie text, p_rayon_m integer, p_perimetre_type text, p_perimetre_code text,
  p_org_id uuid, p_sources uuid[], p_max_poi integer default 5000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_per geometry;
  v_refus text;
  v_pts geometry[];
  v_n integer;
  v_brut geometry;
  v_g geometry;
begin
  if p_rayon_m is null or p_rayon_m < 100 or p_rayon_m > 50000 then
    raise exception 'rayon hors bornes (100 m a 50 km) : %', p_rayon_m using errcode = '22023';
  end if;
  if p_max_poi is null or p_max_poi < 1 or p_max_poi > 5000 then
    raise exception 'plafond de POI hors bornes (1 a 5 000) : %', p_max_poi using errcode = '22023';
  end if;

  v_per := public.geometrie_perimetre(p_perimetre_type, p_perimetre_code, p_org_id);
  v_refus := public.refus_perimetre(p_perimetre_type, v_per, 100000);
  if v_refus is not null then
    return jsonb_build_object('refus', v_refus);
  end if;

  select array_agg(s.geom) into v_pts
    from (select p.geom
            from public.poi_france p
           where p.categorie = p_categorie
             and (p.data_source_id is null or p.data_source_id = any (coalesce(p_sources, '{}'::uuid[])))
             and p.geom && v_per
             and ST_Intersects(p.geom, v_per)
           limit p_max_poi + 1) s;
  v_n := coalesce(cardinality(v_pts), 0);

  if v_n > p_max_poi then
    return jsonb_build_object('refus', 'trop_de_poi', 'plafond', p_max_poi);
  end if;
  if v_n = 0 then
    return jsonb_build_object('vide', true, 'compte', 0, 'geometry', null, 'surface_km2', 0, 'part_retenue', 0);
  end if;

  select ST_Union(ST_Buffer(g::geography, p_rayon_m)::geometry) into v_brut from unnest(v_pts) as g;
  v_g := ST_Multi(ST_CollectionExtract(ST_Intersection(v_brut, v_per), 3));

  return jsonb_build_object(
    'vide', v_g is null or ST_IsEmpty(v_g),
    'compte', v_n,
    'geometry', case when v_g is null or ST_IsEmpty(v_g) then null else ST_AsGeoJSON(v_g)::jsonb end,
    'surface_km2', case when v_g is null or ST_IsEmpty(v_g) then 0
                        else round((ST_Area(v_g::geography) / 1e6)::numeric, 2) end,
    'part_retenue', case when v_g is null or ST_IsEmpty(v_g) then 0
                         else round((ST_Area(v_g::geography) / nullif(ST_Area(v_brut::geography), 0))::numeric, 3) end
  );
end
$fn$;

revoke all on function public.zone_rayon_poi(text, integer, text, text, uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.zone_rayon_poi(text, integer, text, text, uuid, uuid[], integer) to service_role;

commit;
```

Appliquer deux fois, `NOTIFY pgrst`, régénérer les types (commandes de la Task 3).

- [ ] **Step 4: PASS + EXPLAIN** — le test ; puis, en local :

```bash
docker exec supabase_db_genesis_app psql -U postgres -c "EXPLAIN (ANALYZE, BUFFERS) select public.zone_rayon_poi('lycee', 5000, 'region', '84', null, (select array_agg(distinct data_source_id) from poi_france where categorie = 'lycee'), 5000);"
docker exec supabase_db_genesis_app psql -U postgres -c "EXPLAIN (ANALYZE, BUFFERS) select public.zone_rayon_poi('arret_transport', 1000, 'departement', '13', null, '{}', 5000);"   # arrêts sans source : communs
```

Reporter temps et buffers. Si le premier dépasse 3 s ou 10 000 buffers, s'arrêter et le signaler (écart à la mesure du 14/10 : 0,8 s / 834).

- [ ] **Step 5: Doc + commit** — `feat(db): zone par rayon autour des POI d'un type, bornée par le périmètre (sql/254)`.

---

### Task 5: `zone_seuil_carreaux` — l'union des carreaux Filosofi au-dessus d'un seuil

**Files:**
- Create: `sql/255_zone_seuil_carreaux.sql`
- Modify: `types/database.types.ts`
- Test: `tests/integration/zone-seuil-carreaux.test.ts`
- Doc: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: `geometrie_perimetre`, `refus_perimetre` ; `INDICATEURS_SEUIL_CARREAUX` (Task 2).
- Produces: `zone_seuil_carreaux(p_indicateur text, p_operateur text, p_seuil numeric, p_perimetre_type text, p_perimetre_code text, p_org_id uuid, p_max_carreaux integer default 20000) → jsonb` :
  `{ vide, compte, population, geometry, surface_km2 }` ou `{ refus, plafond? }` ; opérateur ∉ {`>=`,`<=`}, seuil NULL, plafond hors [1, 20 000] → `22023`.

- [ ] **Step 1: Test d'intégration (échec)** — `tests/integration/zone-seuil-carreaux.test.ts` :

```ts
/**
 * Seuil sur carreaux Filosofi 200 m (spec § 16.3 : « indicateur > 40 % → l'union des carreaux = un polygone »).
 * Un carreau est retenu par son CENTROÏDE dans le périmètre (L3-2), calculé sur geom_3857 : geom_centroid est NULL
 * partout en local (spec § 16.6). Mesures du 2026-10-14 : Bouches-du-Rhône, ménages pauvres ≥ 40 % → 505 carreaux,
 * 1,7 s ; ARA à 10 % → 144 088 carreaux (d'où le plafond de 20 000, refus en 1,2 s).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { creerClientTest } from './_client';
import { INDICATEURS_SEUIL_CARREAUX } from '@/lib/zones/recette';

const admin = creerClientTest();
const appeler = (args: Record<string, unknown>) => admin.rpc('zone_seuil_carreaux', {
  p_indicateur: 'part_men_pauv', p_operateur: '>=', p_seuil: 40, p_perimetre_type: 'departement',
  p_perimetre_code: '13', p_org_id: null, p_max_carreaux: 20000, ...args,
});

describe('zone_seuil_carreaux', () => {
  it('le case SQL connaît EXACTEMENT les 13 indicateurs de lib/zones/recette.ts', () => {
    const f = readdirSync('sql').find((n) => /_zone_seuil_carreaux\.sql$/.test(n))!;
    const sql = readFileSync(`sql/${f}`, 'utf8');
    const ids = [...sql.matchAll(/when '([a-z0-9_]+)'\s+then v_num/g)].map((m) => m[1]).sort();
    expect(ids).toEqual(INDICATEURS_SEUIL_CARREAUX.map((i) => i.id).sort());
  });
  it('ménages pauvres ≥ 40 % dans les Bouches-du-Rhône : quelques centaines de carreaux, une forme, une population', async () => {
    const { data, error } = await appeler({});
    expect(error).toBeNull();
    const r = data as { vide: boolean; compte: number; population: number; geometry: { type: string }; surface_km2: number };
    expect(r.vide).toBe(false);
    expect(r.compte).toBeGreaterThan(100);
    expect(r.compte).toBeLessThan(5000);
    expect(r.population).toBeGreaterThan(0);
    expect(r.geometry.type).toBe('MultiPolygon');
    // un carreau 200 m = 0,04 km² ; l'union ne peut pas dépasser compte × 0,04
    expect(r.surface_km2).toBeLessThanOrEqual(r.compte * 0.04 + 0.01);
  });
  it('densité ≥ 20 000 hab./km² à Paris (commune 75056) : non vide', async () => {
    const { data } = await appeler({ p_indicateur: 'densite_ind', p_seuil: 20000, p_perimetre_type: 'commune', p_perimetre_code: '75056' });
    expect((data as { compte: number }).compte).toBeGreaterThan(0);
  });
  it('plus de carreaux que le plafond : refus, jamais une zone partielle', async () => {
    const { data } = await appeler({ p_seuil: 1, p_max_carreaux: 50 });
    expect(data).toEqual({ refus: 'trop_de_carreaux', plafond: 50 });
  });
  it.each([
    ['France', { p_perimetre_type: 'france', p_perimetre_code: 'FR' }, { refus: 'perimetre_national_refuse' }],
    ['indicateur hors liste', { p_indicateur: 'men' }, { refus: 'indicateur_inconnu' }],
  ])('%s : refus', async (_n, args, attendu) => {
    expect((await appeler(args)).data).toEqual(attendu);
  });
  it('opérateur inconnu : 22023', async () => {
    expect((await appeler({ p_operateur: '>' })).error?.code).toBe('22023');
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run --project integration tests/integration/zone-seuil-carreaux.test.ts`.

- [ ] **Step 3: Migration** — `sql/255_zone_seuil_carreaux.sql` :

```sql
-- 255 — Zone : l'union des carreaux Filosofi 200 m au-dessus (ou au-dessous) d'un seuil (2026-10-14)
--
-- Spec : carte-en-parcours § 16.3 ; arbitrages A-4 (périmètre ≤ 100 000 km², national refusé, plafond 20 000
-- carreaux) et L3-2 (carreau retenu par son CENTROÏDE dans le périmètre ; zone = union des carreaux ENTIERS).
-- Remplace, POUR L'ÉTAPE ③ SEULEMENT, get_carreaux_capture_geometry (sql/252, 48 s par appel : elle reparse du
-- GeoJSON produit par get_carreaux_by_zoom) — qui reste pour React.
--
-- ⚠ geom_centroid est NULL sur les 2 324 577 carreaux locaux (spec § 16.6) : le centroïde est ST_Centroid(geom_3857),
-- par l'index GIST idx_carreaux_filosofi_geom_3857, contre le périmètre subdivisé (ST_Subdivide 256) en 3857.
-- Indicateurs : liste FERMÉE (INDICATEURS_SEUIL_CARREAUX, lib/zones/recette.ts — test qui lit ce case). Une part en %
-- (numérateur / ménages ou individus du carreau, dénominateur nul exclu) ; densite_ind = individus / 0,04 km².
-- Plafond : on lit p_max_carreaux + 1 carreaux ; au-delà, refus AVANT toute union. Les doublons d'un centroïde posé
-- sur la couture de deux morceaux subdivisés sont comptés une fois (distinct sur l'id).
--
-- Mesuré le 2026-10-14 (EXPLAIN ANALYZE local, cache tiède) :
--   Bouches-du-Rhône, part_men_pauv ≥ 40 %  → 505 carreaux,    1,7 s,  46 000 buffers
--   Île-de-France,    part_men_pauv ≥ 40 %  → 730 carreaux,    3,0 s,  90 000 buffers
--   ARA,              part_men_pauv ≥ 35 %  → 9 839 carreaux,  2,6 s, 351 000 buffers, 39 271 sommets, 843 Ko GeoJSON
--   ARA,              part_men_pauv ≥ 10 %  → refus à 20 001,  1,2 s,  37 000 buffers (sans plafond : 21,8 s)
-- Le coût est la lecture du jsonb metadata (811 o par carreau, sql/229) : c'est pourquoi la route a un quota de 6/min.
-- Rend jsonb. Droits : service_role. Rejouable.

begin;

create or replace function public.zone_seuil_carreaux(
  p_indicateur text, p_operateur text, p_seuil numeric, p_perimetre_type text, p_perimetre_code text,
  p_org_id uuid, p_max_carreaux integer default 20000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_num text;
  v_den text;
  v_per geometry;
  v_refus text;
  v_ids bigint[];
  v_geoms geometry[];
  v_pops numeric[];
  v_n integer;
  v_g geometry;
begin
  if p_operateur is null or p_operateur not in ('>=', '<=') then
    raise exception 'operateur non autorise : %', p_operateur using errcode = '22023';
  end if;
  if p_seuil is null then
    raise exception 'seuil absent' using errcode = '22023';
  end if;
  if p_max_carreaux is null or p_max_carreaux < 1 or p_max_carreaux > 20000 then
    raise exception 'plafond de carreaux hors bornes (1 a 20 000) : %', p_max_carreaux using errcode = '22023';
  end if;

  case p_indicateur
    when 'part_men_pauv'  then v_num := 'men_pauv';  v_den := 'men';
    when 'part_men_1ind'  then v_num := 'men_1ind';  v_den := 'men';
    when 'part_men_5ind'  then v_num := 'men_5ind';  v_den := 'men';
    when 'part_men_prop'  then v_num := 'men_prop';  v_den := 'men';
    when 'part_men_fmp'   then v_num := 'men_fmp';   v_den := 'men';
    when 'part_men_coll'  then v_num := 'men_coll';  v_den := 'men';
    when 'part_ind_18_24' then v_num := 'ind_18_24'; v_den := 'ind';
    when 'part_ind_25_39' then v_num := 'ind_25_39'; v_den := 'ind';
    when 'part_ind_40_54' then v_num := 'ind_40_54'; v_den := 'ind';
    when 'part_ind_55_64' then v_num := 'ind_55_64'; v_den := 'ind';
    when 'part_ind_65_79' then v_num := 'ind_65_79'; v_den := 'ind';
    when 'part_ind_80p'   then v_num := 'ind_80p';   v_den := 'ind';
    when 'densite_ind'    then v_num := 'ind';       v_den := null;
    else return jsonb_build_object('refus', 'indicateur_inconnu');
  end case;

  v_per := public.geometrie_perimetre(p_perimetre_type, p_perimetre_code, p_org_id);
  v_refus := public.refus_perimetre(p_perimetre_type, v_per, 100000);
  if v_refus is not null then
    return jsonb_build_object('refus', v_refus);
  end if;

  with morceaux as materialized (
    select ST_Subdivide(ST_Transform(v_per, 3857), 256) as g
  ), retenus as materialized (
    select cf.id, cf.geom_3857 as g, (cf.metadata->>'ind')::numeric as pop
      from public.carreaux_filosofi cf
      join morceaux m on cf.geom_3857 && m.g and ST_Intersects(ST_Centroid(cf.geom_3857), m.g)
      cross join lateral (
        select case
                 when v_den is null then (cf.metadata->>v_num)::numeric / 0.04
                 else (cf.metadata->>v_num)::numeric * 100 / nullif((cf.metadata->>v_den)::numeric, 0)
               end as val
      ) x
     where x.val is not null
       and ((p_operateur = '>=' and x.val >= p_seuil) or (p_operateur = '<=' and x.val <= p_seuil))
     limit p_max_carreaux + 1
  )
  select array_agg(id), array_agg(g), array_agg(pop) into v_ids, v_geoms, v_pops from retenus;

  v_n := coalesce((select count(distinct i) from unnest(v_ids) as i), 0);
  if v_n > p_max_carreaux then
    return jsonb_build_object('refus', 'trop_de_carreaux', 'plafond', p_max_carreaux);
  end if;
  if v_n = 0 then
    return jsonb_build_object('vide', true, 'compte', 0, 'population', 0, 'geometry', null, 'surface_km2', 0);
  end if;

  select ST_Multi(ST_Transform(ST_Union(g), 4326)) into v_g from unnest(v_geoms) as g;

  return jsonb_build_object(
    'vide', v_g is null or ST_IsEmpty(v_g),
    'compte', v_n,
    'population', round(coalesce((select sum(p) from (select distinct on (i) i, p from unnest(v_ids, v_pops) as u(i, p)) d), 0)),
    'geometry', case when v_g is null or ST_IsEmpty(v_g) then null else ST_AsGeoJSON(v_g, 6)::jsonb end,
    'surface_km2', case when v_g is null or ST_IsEmpty(v_g) then 0
                        else round((ST_Area(v_g::geography) / 1e6)::numeric, 2) end
  );
end
$fn$;

revoke all on function public.zone_seuil_carreaux(text, text, numeric, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.zone_seuil_carreaux(text, text, numeric, text, text, uuid, integer) to service_role;

commit;
```

Appliquer deux fois, `NOTIFY pgrst`, types.

- [ ] **Step 4: PASS + EXPLAIN** — le test, puis les quatre mesures de l'en-tête :

```bash
for args in "'part_men_pauv','>=',40,'departement','13'" "'part_men_pauv','>=',40,'region','11'" "'part_men_pauv','>=',35,'region','84'" "'part_men_pauv','>=',10,'region','84'"; do
  docker exec supabase_db_genesis_app psql -U postgres -c "EXPLAIN (ANALYZE, BUFFERS) select public.zone_seuil_carreaux($args, null, 20000);"
done
```

Reporter les quatre temps et buffers. Écart > 2× sur l'un d'eux : s'arrêter et le signaler.

- [ ] **Step 5: Doc + commit** — `feat(db): zone par seuil sur les carreaux Filosofi, centroïde dans le périmètre (sql/255)`.

---

### Task 6: `zone_seuil_territoire` — IRIS ou CP au-dessus d'un seuil d'indicateur, dans le périmètre

**Files:**
- Create: `sql/256_zone_seuil_territoire.sql`
- Modify: `types/database.types.ts`
- Test: `tests/integration/zone-seuil-territoire.test.ts`
- Doc: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: `cible_indicator_registry` (`indicator_code`, `data_source` ∈ `iris_column|abstention|pollen|atmo`, `data_column`, `normalize`, `scale`, `active`) — la dérivation de `get_indicator_threshold_selection` (sql/100:79), RECOPIÉE et non appelée (elle n'a pas de périmètre et sa borne est 10 000) ; `geometrie_perimetre`, `refus_perimetre`.
- Produces: `zone_seuil_territoire(p_indicateur text, p_operateur text, p_seuil numeric, p_perimetre_type text, p_perimetre_code text, p_org_id uuid, p_max_territoires integer default 5000) → jsonb` : `{ vide, compte, maille: 'iris'|'cp', geometry, surface_km2 }` ou `{ refus, plafond? }`.

- [ ] **Step 1: Test d'intégration (échec)** — `tests/integration/zone-seuil-territoire.test.ts` :

```ts
/**
 * Seuil d'indicateur au territoire (IRIS ou CP), borné par le périmètre de ① (spec § 16.3). Même dérivation de la
 * valeur que get_indicator_threshold_selection (sql/100) ; mesuré le 2026-10-14 : taux de pauvreté ≥ 20 % sur ARA,
 * 472 IRIS, 0,55 s.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const appeler = (args: Record<string, unknown>) => admin.rpc('zone_seuil_territoire', {
  p_indicateur: 'taux_pauvrete', p_operateur: '>=', p_seuil: 20, p_perimetre_type: 'region', p_perimetre_code: '84',
  p_org_id: null, p_max_territoires: 5000, ...args,
});

describe('zone_seuil_territoire', () => {
  it('IRIS : taux de pauvreté ≥ 20 % en ARA', async () => {
    const { data, error } = await appeler({});
    expect(error).toBeNull();
    expect(data).toMatchObject({ vide: false, maille: 'iris' });
    expect((data as { compte: number }).compte).toBeGreaterThan(100);
  });
  it('IRIS par département et par commune : un sous-ensemble de la région', async () => {
    const region = (await appeler({})).data as { compte: number };
    const dept = (await appeler({ p_perimetre_type: 'departement', p_perimetre_code: '69' })).data as { compte: number };
    expect(dept.compte).toBeLessThan(region.compte);
  });
  it('CP : abstention 2022 dans les Bouches-du-Rhône', async () => {
    const { data } = await appeler({ p_indicateur: 'abstention_pres_2022', p_seuil: 25, p_perimetre_type: 'departement', p_perimetre_code: '13' });
    expect(data).toMatchObject({ maille: 'cp' });
  });
  it.each([
    ['France', { p_perimetre_type: 'france', p_perimetre_code: 'FR' }, { refus: 'perimetre_national_refuse' }],
    ['indicateur inconnu', { p_indicateur: 'pas_un_indicateur' }, { refus: 'indicateur_inconnu' }],
    ['plafond dépassé', { p_seuil: 0, p_max_territoires: 5 }, { refus: 'trop_de_territoires', plafond: 5 }],
  ])('%s : refus', async (_n, args, attendu) => {
    expect((await appeler(args)).data).toEqual(attendu);
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run --project integration tests/integration/zone-seuil-territoire.test.ts`.

- [ ] **Step 3: Migration** — `sql/256_zone_seuil_territoire.sql` :

```sql
-- 256 — Zone : IRIS ou codes postaux au-dessus (ou au-dessous) d'un seuil d'indicateur, dans le périmètre (2026-10-14)
--
-- Spec : carte-en-parcours § 16.3 ; arbitrage A-4 (national refusé, plafond 5 000 territoires).
-- La valeur est dérivée du registre cible_indicator_registry EXACTEMENT comme get_indicator_threshold_selection
-- (sql/100:79) — recopiée et non appelée : celle-ci n'a pas de périmètre et rend jusqu'à 10 000 codes à l'échelle
-- nationale. Toute évolution de la dérivation se fait DANS LES DEUX.
-- Périmètre : IRIS filtrés par leurs codes (region/departement/commune) quand c'est possible, sinon par
-- ST_PointOnSurface dans la géométrie ; CP toujours par ST_PointOnSurface de leur contour (ref_codes_postaux).
-- SQL dynamique : noms de table et de colonne TOUJOURS venus du registre (%I), opérateur validé, valeurs en USING.
-- Mesuré le 2026-10-14 : taux_pauvrete ≥ 20 % sur la région 84 → 472 IRIS, 0,55 s, 3 766 buffers.
-- Rend jsonb. Droits : service_role. Rejouable.

begin;

create or replace function public.zone_seuil_territoire(
  p_indicateur text, p_operateur text, p_seuil numeric, p_perimetre_type text, p_perimetre_code text,
  p_org_id uuid, p_max_territoires integer default 5000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  reg record;
  v_expr text;
  v_table text;
  v_extra text := '';
  v_filtre text;
  v_per geometry;
  v_refus text;
  v_codes text[];
  v_n integer;
  v_g geometry;
begin
  if p_operateur is null or p_operateur not in ('>=', '<=') then
    raise exception 'operateur non autorise : %', p_operateur using errcode = '22023';
  end if;
  if p_seuil is null then
    raise exception 'seuil absent' using errcode = '22023';
  end if;
  if p_max_territoires is null or p_max_territoires < 1 or p_max_territoires > 5000 then
    raise exception 'plafond hors bornes (1 a 5 000) : %', p_max_territoires using errcode = '22023';
  end if;

  select * into reg from public.cible_indicator_registry where indicator_code = p_indicateur and active;
  if not found then
    return jsonb_build_object('refus', 'indicateur_inconnu');
  end if;

  v_per := public.geometrie_perimetre(p_perimetre_type, p_perimetre_code, p_org_id);
  v_refus := public.refus_perimetre(p_perimetre_type, v_per, 100000);
  if v_refus is not null then
    return jsonb_build_object('refus', v_refus);
  end if;

  if reg.data_source = 'iris_column' then
    v_expr := case when reg.normalize = 'pct_of_population'
                   then format('(t.%I::float / nullif(t.population, 0) * 100)', reg.data_column)
                   else format('t.%I', reg.data_column) end;
    v_filtre := case p_perimetre_type
      when 'region'      then 't.code_region = $4'
      when 'departement' then 't.code_dept = $4'
      when 'commune'     then 't.code_commune = $4'
      else 't.geom && $1 and ST_Intersects(ST_PointOnSurface(t.geom), $1)'
    end;
    execute format(
      'select array_agg(code) from (select t.code_iris as code from public.iris t
        where t.is_true_iris and %s is not null and %s %s $2 and %s limit $3) s',
      v_expr, v_expr, p_operateur, v_filtre)
      into v_codes using v_per, p_seuil, p_max_territoires + 1, p_perimetre_code;
    v_n := coalesce(cardinality(v_codes), 0);
    if v_n > p_max_territoires then
      return jsonb_build_object('refus', 'trop_de_territoires', 'plafond', p_max_territoires);
    end if;
    if v_n > 0 then
      select ST_Multi(ST_Union(geom)) into v_g from public.iris where code_iris = any (v_codes);
    end if;
  else
    v_table := case reg.data_source
      when 'abstention' then 'dataset_abstention_2022'
      when 'pollen'     then 'pollen_map_daily'
      else 'atmo_map_daily' end;
    if reg.data_source in ('pollen', 'atmo') then
      v_extra := format(' and t.date_ech = (select max(date_ech) from public.%I)', v_table);
    end if;
    v_expr := format('t.%I', reg.data_column);
    execute format(
      'select array_agg(code) from (select distinct t.code_postal as code from public.%I t
         join public.ref_codes_postaux r on r.code_postal = t.code_postal
        where %s is not null and %s %s $2 %s
          and r.geom && $1 and ST_Intersects(ST_PointOnSurface(r.geom), $1) limit $3) s',
      v_table, v_expr, v_expr, p_operateur, v_extra)
      into v_codes using v_per, p_seuil, p_max_territoires + 1;
    v_n := coalesce(cardinality(v_codes), 0);
    if v_n > p_max_territoires then
      return jsonb_build_object('refus', 'trop_de_territoires', 'plafond', p_max_territoires);
    end if;
    if v_n > 0 then
      select ST_Multi(ST_Union(geom)) into v_g from public.ref_codes_postaux where code_postal = any (v_codes);
    end if;
  end if;

  return jsonb_build_object(
    'vide', v_g is null or ST_IsEmpty(v_g),
    'compte', v_n,
    'maille', reg.scale,
    'geometry', case when v_g is null or ST_IsEmpty(v_g) then null else ST_AsGeoJSON(v_g, 6)::jsonb end,
    'surface_km2', case when v_g is null or ST_IsEmpty(v_g) then 0
                        else round((ST_Area(v_g::geography) / 1e6)::numeric, 2) end
  );
end
$fn$;

revoke all on function public.zone_seuil_territoire(text, text, numeric, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.zone_seuil_territoire(text, text, numeric, text, text, uuid, integer) to service_role;

commit;
```

Appliquer deux fois, `NOTIFY pgrst`, types. Si le test CP échoue sur le nom de colonne (`data_column` de `abstention_pres_2022`), lire la ligne du registre (`select * from cible_indicator_registry where indicator_code = 'abstention_pres_2022'`) : la dérivation doit rester celle de sql/100, jamais un nom en dur.

- [ ] **Step 4: PASS + EXPLAIN** — le test ; `EXPLAIN (ANALYZE, BUFFERS) select public.zone_seuil_territoire('taux_pauvrete','>=',20,'region','84',null,5000);` et la même chose avec `'abstention_pres_2022','>=',25,'departement','13'` — reporter.
- [ ] **Step 5: Doc + commit** — `feat(db): zone par seuil d'indicateur à l'IRIS ou au CP, bornée par le périmètre (sql/256)`.

---

### Task 7: L'exécuteur de recettes (serveur)

**Files:**
- Create: `lib/zones/executer-recette.ts`
- Test: `tests/unit/zones/executer-recette.test.ts`

**Interfaces:**
- Consumes: `Recette`, `MAX_SOMMETS_FORME`, `MESSAGES_REFUS`, `refusPerimetreLocal` (Task 2) ; RPC `zone_rayon` (sql/155), `zone_rayon_poi`, `zone_seuil_carreaux`, `zone_seuil_territoire`, `get_admin_filter_geometry` (sql/252), `get_composite_zone_geometry` (sql/100), `zone_intersection`, `zone_difference` (sql/151), `zone_dessin` (sql/156).
- Produces:
  ```ts
  export type FormeZone = GeoJSON.Polygon | GeoJSON.MultiPolygon;
  export interface ContexteRecette { orgId: string; sources: string[]; geometrie?: unknown }
  export type IssueRecette =
    | { ok: true; geometry: FormeZone; surface_km2: number | null; compte: number | null; part_retenue: number | null; population: number | null }
    | { ok: false; statut: 400 | 404 | 409 | 422 | 500; refus: RefusRecette | null; message: string };
  export function compterSommets(g: unknown): number;
  export async function executerRecette(supabase: ClientAdmin, recette: Recette, ctx: ContexteRecette): Promise<IssueRecette>;
  ```
  Règles : recette figée → `ctx.geometrie` OBLIGATOIRE (400 sinon), validée par `zone_dessin` (réparation + clip France) ; recette recalculable → `ctx.geometrie` IGNORÉE ; refus SQL → 422 + `MESSAGES_REFUS[refus]` ; forme vide → 409 `forme_vide` ; opérande de combinaison hors espace → 404 `zone_introuvable` ; erreur Postgres → 500 « Calcul de la zone impossible. » (détail dans `console.error`).

- [ ] **Step 1: Tests (échec)** — `tests/unit/zones/executer-recette.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compterSommets, executerRecette } from '@/lib/zones/executer-recette';
import type { Recette } from '@/lib/zones/recette';

const CARRE = { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]]] };
const PER = { type: 'departement', code: '13' } as const;
const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const Z1 = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';
const Z2 = '3f2504e0-4f89-11d3-9a0c-0305e82c3303';

let appels: { nom: string; args: Record<string, unknown> }[] = [];
let reponses: Record<string, { data: unknown; error: { message: string } | null }> = {};
let zonesDeLOrg: string[] = [];
const faux = {
  rpc(nom: string, args: Record<string, unknown>) {
    appels.push({ nom, args });
    return Promise.resolve(reponses[nom] ?? { data: null, error: { message: `rpc ${nom} non prévue` } });
  },
  from() {
    const chaine = {
      select() { return chaine; }, eq() { return chaine; },
      in(_c: string, ids: string[]) { return Promise.resolve({ data: ids.filter((i) => zonesDeLOrg.includes(i)).map((id) => ({ id })), error: null }); },
    };
    return chaine;
  },
};
const ctx = { orgId: ORG, sources: ['s1'] };
const exec = (r: Recette, c: Partial<typeof ctx & { geometrie: unknown }> = {}) => executerRecette(faux as never, r, { ...ctx, ...c });

beforeEach(() => { appels = []; reponses = {}; zonesDeLOrg = []; vi.spyOn(console, 'error').mockImplementation(() => undefined); });

describe('executerRecette', () => {
  it('rayon POI : une seule RPC, le périmètre et les sources de l’espace', async () => {
    reponses.zone_rayon_poi = { data: { vide: false, compte: 12, geometry: CARRE, surface_km2: 4.2, part_retenue: 0.9 }, error: null };
    const r = await exec({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: PER });
    expect(r).toEqual({ ok: true, geometry: CARRE, surface_km2: 4.2, compte: 12, part_retenue: 0.9, population: null });
    expect(appels).toEqual([{ nom: 'zone_rayon_poi', args: {
      p_categorie: 'lycee', p_rayon_m: 5000, p_perimetre_type: 'departement', p_perimetre_code: '13',
      p_org_id: ORG, p_sources: ['s1'], p_max_poi: 5000,
    } }]);
  });

  it('périmètre absent ou national : 422 SANS appel', async () => {
    for (const perimetre of [null, { type: 'france', code: 'FR' } as const]) {
      const r = await exec({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre });
      expect(r).toMatchObject({ ok: false, statut: 422 });
    }
    expect(appels).toEqual([]);
  });

  it('refus SQL : 422 et le message français', async () => {
    reponses.zone_seuil_carreaux = { data: { refus: 'trop_de_carreaux', plafond: 20000 }, error: null };
    const r = await exec({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 10, perimetre: PER });
    expect(r).toEqual({ ok: false, statut: 422, refus: 'trop_de_carreaux', message: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.' });
  });

  it('forme vide : 409 « forme_vide », jamais une zone sans surface', async () => {
    reponses.zone_seuil_territoire = { data: { vide: true, compte: 0, geometry: null }, error: null };
    const r = await exec({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 99, perimetre: PER });
    expect(r).toMatchObject({ ok: false, statut: 409, refus: 'forme_vide' });
  });

  it('recette recalculable : une géométrie fournie est IGNORÉE', async () => {
    reponses.get_admin_filter_geometry = { data: { geometry: CARRE }, error: null };
    await exec({ v: 1, type: 'codes_postaux', codes: ['13001'] }, { geometrie: { type: 'Polygon', coordinates: [] } });
    expect(appels.map((a) => a.nom)).toEqual(['get_admin_filter_geometry']);
  });

  it('forme figée : géométrie obligatoire, validée et découpée par zone_dessin', async () => {
    expect(await exec({ v: 1, type: 'dessin' })).toMatchObject({ ok: false, statut: 400 });
    reponses.zone_dessin = { data: { vide: false, geometry: CARRE, surface_km2: 1, part_retenue: 1 }, error: null };
    const r = await exec({ v: 1, type: 'import', format: 'kml', fichier: 'a.kml' }, { geometrie: CARRE });
    expect(r).toMatchObject({ ok: true, geometry: CARRE });
    expect(appels.at(-1)).toEqual({ nom: 'zone_dessin', args: { p_geojson: CARRE } });
  });

  it('import de plus de 20 000 sommets : 422 SANS appel', async () => {
    const anneau = Array.from({ length: 20_001 }, (_, i) => [5 + i * 1e-6, 43]);
    const r = await exec({ v: 1, type: 'import', format: 'geojson', fichier: 'a.json' }, { geometrie: { type: 'Polygon', coordinates: [anneau] } });
    expect(r).toMatchObject({ ok: false, statut: 422, refus: 'trop_de_sommets' });
    expect(appels).toEqual([]);
  });

  it('combinaison : opérandes hors espace → 404 ; sinon union par get_composite_zone_geometry', async () => {
    zonesDeLOrg = [Z1];
    expect(await exec({ v: 1, type: 'combinaison', operation: 'union', zones: [Z1, Z2] })).toMatchObject({ ok: false, statut: 404 });
    zonesDeLOrg = [Z1, Z2];
    reponses.get_composite_zone_geometry = { data: { geometry: CARRE }, error: null };
    expect(await exec({ v: 1, type: 'combinaison', operation: 'union', zones: [Z1, Z2] })).toMatchObject({ ok: true });
    reponses.zone_difference = { data: { vide: false, geometry: CARRE, surface_km2: 1 }, error: null };
    await exec({ v: 1, type: 'combinaison', operation: 'difference', zones: [Z1, Z2] });
    expect(appels.at(-1)).toEqual({ nom: 'zone_difference', args: { p_base: Z1, p_retires: [Z2] } });
  });

  it('erreur Postgres : 500 en français, détail en console seulement', async () => {
    reponses.zone_rayon = { data: null, error: { message: 'canceling statement due to statement timeout' } };
    const r = await exec({ v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 1000 });
    expect(r).toEqual({ ok: false, statut: 500, refus: null, message: 'Calcul de la zone impossible.' });
  });
});

describe('compterSommets', () => {
  it('Polygon, MultiPolygon, et 0 pour autre chose', () => {
    expect(compterSommets(CARRE)).toBe(5);
    expect(compterSommets({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]], [[0.1, 0.1], [0.2, 0.1], [0.1, 0.2], [0.1, 0.1]]] })).toBe(8);
    expect(compterSommets({ type: 'Point', coordinates: [0, 0] })).toBe(0);
    expect(compterSommets(null)).toBe(0);
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run --project unit tests/unit/zones/executer-recette.test.ts`.

- [ ] **Step 3: Implémenter** — `lib/zones/executer-recette.ts` :

```ts
/**
 * @file lib/zones/executer-recette.ts — une recette de zone → sa géométrie (spec carte-en-parcours § 16.3).
 *
 * UNE RPC `jsonb` par recette, appelée avec le périmètre et les sources de l'espace ACTIF. Les recettes lourdes sont
 * refusées AVANT tout appel quand le périmètre manque ou est national (`refusPerimetreLocal`) ; la base refait la
 * garde (surface, appartenance d'une zone-périmètre). Un refus est une réponse 422 en français, jamais une exception.
 *
 * Une recette RECALCULABLE ignore toute géométrie fournie par le client (le serveur la recalcule) ; une recette FIGÉE
 * (dessin, import, isochrone, capture) l'exige, et `zone_dessin` (sql/156) la répare et la découpe sur la France.
 */
import type { createAdminClient } from '@/lib/auth';
import { MAX_POI_RAYON, MAX_SOMMETS_FORME, MESSAGES_REFUS, estRecalculable, refusPerimetreLocal, type Recette, type RefusRecette } from './recette';

type ClientAdmin = ReturnType<typeof createAdminClient>;
export type FormeZone = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface ContexteRecette {
  orgId: string;
  /** `sourcesVisiblesDeLaRequete` : les sources de POI que l'espace voit. */
  sources: string[];
  /** La forme d'une recette figée ; ignorée pour une recette recalculable. */
  geometrie?: unknown;
}

export type IssueRecette =
  | { ok: true; geometry: FormeZone; surface_km2: number | null; compte: number | null; part_retenue: number | null; population: number | null }
  | { ok: false; statut: 400 | 404 | 409 | 422 | 500; refus: RefusRecette | null; message: string };

interface ReponseRpc {
  vide?: boolean; geometry?: unknown; surface_km2?: number; compte?: number; part_retenue?: number;
  population?: number; refus?: RefusRecette;
}

const ECHEC: IssueRecette = { ok: false, statut: 500, refus: null, message: 'Calcul de la zone impossible.' };

function refuser(refus: RefusRecette, statut: 404 | 409 | 422 = 422): IssueRecette {
  return { ok: false, statut, refus, message: MESSAGES_REFUS[refus] };
}

function estForme(g: unknown): g is FormeZone {
  const t = (g as { type?: unknown } | null)?.type;
  return (t === 'Polygon' || t === 'MultiPolygon') && Array.isArray((g as { coordinates?: unknown }).coordinates);
}

/** Le nombre de sommets d'un Polygon/MultiPolygon (anneaux compris) ; 0 pour toute autre valeur. */
export function compterSommets(g: unknown): number {
  if (!estForme(g)) return 0;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.reduce((n, anneaux) => n + anneaux.reduce((m, a) => m + (Array.isArray(a) ? a.length : 0), 0), 0);
}

function issue(r: ReponseRpc | null): IssueRecette {
  if (!r) return ECHEC;
  if (r.refus) return refuser(r.refus);
  if (r.vide || !estForme(r.geometry)) return refuser('forme_vide', 409);
  return {
    ok: true, geometry: r.geometry, surface_km2: r.surface_km2 ?? null, compte: r.compte ?? null,
    part_retenue: r.part_retenue ?? null, population: r.population ?? null,
  };
}

async function appeler(supabase: ClientAdmin, nom: string, args: Record<string, unknown>): Promise<IssueRecette> {
  const { data, error } = await (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(nom, args);
  if (error) {
    console.error(`[zones/recette] ${nom} :`, error.message);
    return ECHEC;
  }
  return issue((data ?? null) as ReponseRpc | null);
}

export async function executerRecette(supabase: ClientAdmin, recette: Recette, ctx: ContexteRecette): Promise<IssueRecette> {
  const local = refusPerimetreLocal(recette);
  if (local) return refuser(local);

  if (!estRecalculable(recette)) {
    if (!estForme(ctx.geometrie)) {
      return { ok: false, statut: 400, refus: null, message: 'Une forme (Polygon ou MultiPolygon) est attendue pour cette recette.' };
    }
    if (compterSommets(ctx.geometrie) > MAX_SOMMETS_FORME) return refuser('trop_de_sommets');
    return appeler(supabase, 'zone_dessin', { p_geojson: ctx.geometrie });
  }

  switch (recette.type) {
    case 'rayon_point':
      return appeler(supabase, 'zone_rayon', { p_lon: recette.lon, p_lat: recette.lat, p_rayon_m: recette.rayon_m });
    case 'rayon_poi':
      return appeler(supabase, 'zone_rayon_poi', {
        p_categorie: recette.categorie, p_rayon_m: recette.rayon_m,
        p_perimetre_type: recette.perimetre!.type, p_perimetre_code: recette.perimetre!.code,
        p_org_id: ctx.orgId, p_sources: ctx.sources, p_max_poi: MAX_POI_RAYON,
      });
    case 'seuil_carreaux':
      return appeler(supabase, 'zone_seuil_carreaux', {
        p_indicateur: recette.indicateur, p_operateur: recette.operateur, p_seuil: recette.seuil,
        p_perimetre_type: recette.perimetre!.type, p_perimetre_code: recette.perimetre!.code, p_org_id: ctx.orgId,
      });
    case 'seuil_territoire':
      return appeler(supabase, 'zone_seuil_territoire', {
        p_indicateur: recette.indicateur, p_operateur: recette.operateur, p_seuil: recette.seuil,
        p_perimetre_type: recette.perimetre!.type, p_perimetre_code: recette.perimetre!.code, p_org_id: ctx.orgId,
      });
    case 'codes_postaux':
      return appeler(supabase, 'get_admin_filter_geometry', { p_scale: 'cp', p_codes: [...recette.codes] });
    case 'combinaison': {
      // ≤ 20 identifiants (schéma) : une lecture bornée par construction.
      const { data, error } = await supabase.from('custom_geo_zones').select('id').eq('org_id', ctx.orgId).in('id', [...recette.zones]);
      if (error) {
        console.error('[zones/recette] opérandes :', error.message);
        return ECHEC;
      }
      if ((data ?? []).length !== new Set(recette.zones).size) return refuser('zone_introuvable', 404);
      if (recette.operation === 'union') return appeler(supabase, 'get_composite_zone_geometry', { p_zone_ids: [...recette.zones] });
      if (recette.operation === 'intersection') return appeler(supabase, 'zone_intersection', { p_zone_ids: [...recette.zones] });
      return appeler(supabase, 'zone_difference', { p_base: recette.zones[0], p_retires: recette.zones.slice(1) });
    }
    default:
      return ECHEC;
  }
}
```

- [ ] **Step 4: PASS** — le test ; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(zones): exécuteur de recettes — une RPC par recette, refus en français`.

---

### Task 8: Les routes — aperçu, écriture, recalcul ; `recette` lue par la liste

**Files:**
- Create: `app/api/zones/apercu/route.ts`, `app/api/zones/route.ts`, `app/api/zones/[id]/recalculer/route.ts`, `lib/zones/session-zones.ts`
- Modify: `app/api/custom-geo/list/route.ts:49` (ajouter `recette` au `select`)
- Test: `tests/unit/api/zones-routes.test.ts` ; `tests/unit/api/validation-corps.test.ts` et `tests/unit/api/routes-publiques.test.ts` doivent rester verts sans exemption
- Doc: `ARCHITECTURE.md` (table des routes : Grep `/api/zones/jeux` ; ligne `custom_geo_zones`)

**Interfaces:**
- Consumes: `lireRecette` (Task 2), `executerRecette` (Task 7), `creer_zone_recette`, `remplacer_geometrie_zone` (Task 3), `resolve_custom_geo_zone_codes(p_zone_id, p_caller_user_id)` (sql/252), `getSessionOrg`, `sourcesVisiblesDeLaRequete` (`lib/auth/perimetre-donnees.ts`), `createRateLimiter`/`rateLimitResponse`, `lireCorps`.
- Produces:
  - `POST /api/zones/apercu` `{ recette, geometrie? }` → 200 `{ geometry, surface_km2, compte, part_retenue, population }` | 400 | 401 | 403 | 404 | 409 | 422 `{ error, refus }` | 429 | 500. Quota 20/60 s (`geo:rl:zones-apercu`), 6/60 s pour `seuil_carreaux` (`geo:rl:zones-carreaux`).
  - `POST /api/zones` `{ nom (1-200), recette, geometrie? }` → 200 `{ zone_id, count_cp, count_iris, surface_km2 }` | 207 `{ zone_id, warning: 'codes_non_resolus' }` | erreurs comme l'aperçu. Quota 20/60 s (`geo:rl:zones-ecrire`) + 6/60 s pour `seuil_carreaux`.
  - `POST /api/zones/[id]/recalculer` (sans corps) → 200 `{ zone_id, count_cp, count_iris, surface_km2 }` | 207 | 404 `zone_introuvable` | 409 `forme_figee` ou `zone_referencee` (`par`) | 422. Quota 6/60 s (`geo:rl:zones-recalcul`).
  - `lib/zones/session-zones.ts` : `async function sessionDeZone(req): Promise<{ ok: true; userId: string; orgId: string } | { ok: false; reponse: NextResponse }>` (401 sans session, 403 sans espace) ; `async function repondreResolue(supabase, zoneId: string, userId: string, surface: number | null): Promise<NextResponse>` (200 avec compteurs, 207 `codes_non_resolus`).
  - `GET /api/custom-geo/list` : chaque zone porte `recette` (`null` pour une zone d'avant le lot).

- [ ] **Step 1: Tests (échec)** — `tests/unit/api/zones-routes.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Routes des zones à recette (spec carte-en-parcours § 16 ; Review Focus 2, 4, 5).
 */
type Session = { userId: string; role: string; orgId: string | null } | null;
let session: Session = { userId: 'u1', role: 'super_admin', orgId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' };
vi.mock('@/lib/auth/getSessionOrg', () => ({ getSessionOrg: async () => session }));
vi.mock('@/lib/auth/perimetre-donnees', () => ({ sourcesVisiblesDeLaRequete: async () => ['s1'] }));
let quotaOk = true;
vi.mock('@/lib/api/rate-limit', () => ({
  createRateLimiter: () => async () => (quotaOk ? { ok: true, retrySec: 0 } : { ok: false, retrySec: 30 }),
  rateLimitResponse: (s: number) => new Response(JSON.stringify({ error: 'Trop de requêtes.' }), { status: 429, headers: { 'Retry-After': String(s) } }),
}));
const CARRE = { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]]] };
let issue: unknown = { ok: true, geometry: CARRE, surface_km2: 3, compte: 4, part_retenue: 1, population: null };
const executions: { recette: unknown; ctx: unknown }[] = [];
vi.mock('@/lib/zones/executer-recette', () => ({
  executerRecette: async (_s: unknown, recette: unknown, ctx: unknown) => { executions.push({ recette, ctx }); return issue; },
}));
const rpcs: { nom: string; args: Record<string, unknown> }[] = [];
let reponsesRpc: Record<string, { data: unknown; error: unknown }> = {};
let zoneLue: unknown = null;
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc(nom: string, args: Record<string, unknown>) { rpcs.push({ nom, args }); return Promise.resolve(reponsesRpc[nom] ?? { data: null, error: null }); },
    from() {
      const c = { select() { return c; }, eq() { return c; }, maybeSingle() { return Promise.resolve({ data: zoneLue, error: null }); } };
      return c;
    },
  }),
}));

const { POST: apercu } = await import('@/app/api/zones/apercu/route');
const { POST: ecrire } = await import('@/app/api/zones/route');
const { POST: recalculer } = await import('@/app/api/zones/[id]/recalculer/route');

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3309';
const req = (corps: unknown) => new Request('http://localhost/api/zones', { method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } }) as never;
const RAYON = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'departement', code: '13' } };

beforeEach(() => {
  session = { userId: 'u1', role: 'super_admin', orgId: ORG }; quotaOk = true;
  issue = { ok: true, geometry: CARRE, surface_km2: 3, compte: 4, part_retenue: 1, population: null };
  executions.length = 0; rpcs.length = 0; reponsesRpc = {}; zoneLue = null;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('POST /api/zones/apercu', () => {
  it('exécute la recette dans l’espace ACTIF avec ses sources', async () => {
    const res = await apercu(req({ recette: RAYON }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ geometry: CARRE, surface_km2: 3, compte: 4, part_retenue: 1, population: null });
    expect(executions[0].ctx).toEqual({ orgId: ORG, sources: ['s1'], geometrie: undefined });
  });
  it('sans session : 401 ; sans espace : 403 ; recette invalide : 400 français', async () => {
    session = null; expect((await apercu(req({ recette: RAYON }))).status).toBe(401);
    session = { userId: 'u1', role: 'client', orgId: null }; expect((await apercu(req({ recette: RAYON }))).status).toBe(403);
    session = { userId: 'u1', role: 'client', orgId: ORG };
    const r = await apercu(req({ recette: { v: 1, type: 'pluie' } }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/^Recette invalide/);
    expect(executions).toEqual([]);
  });
  it('un refus de l’exécuteur passe tel quel (422, message, refus)', async () => {
    issue = { ok: false, statut: 422, refus: 'trop_de_carreaux', message: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.' };
    const r = await apercu(req({ recette: RAYON }));
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.', refus: 'trop_de_carreaux' });
  });
  it('quota épuisé : 429', async () => {
    quotaOk = false;
    expect((await apercu(req({ recette: RAYON }))).status).toBe(429);
  });
});

describe('POST /api/zones', () => {
  it('ré-exécute la recette, écrit dans l’espace actif, puis résout les codes', async () => {
    reponsesRpc.creer_zone_recette = { data: { id: ZONE }, error: null };
    reponsesRpc.resolve_custom_geo_zone_codes = { data: { count_cp: 12, count_iris: 30 }, error: null };
    const res = await ecrire(req({ nom: 'Lycées 13', recette: RAYON, geometrie: { type: 'Polygon', coordinates: [] } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ zone_id: ZONE, count_cp: 12, count_iris: 30, surface_km2: 3 });
    expect(rpcs[0]).toEqual({ nom: 'creer_zone_recette', args: {
      p_nom: 'Lycées 13', p_org_id: ORG, p_cree_par: 'u1', p_recette: RAYON, p_geometry_geojson: JSON.stringify(CARRE),
    } });
    expect(rpcs[1]).toEqual({ nom: 'resolve_custom_geo_zone_codes', args: { p_zone_id: ZONE, p_caller_user_id: 'u1' } });
  });
  it('résolution refusée (super_admin non membre de l’espace) : 207, la zone est créée', async () => {
    reponsesRpc.creer_zone_recette = { data: { id: ZONE }, error: null };
    reponsesRpc.resolve_custom_geo_zone_codes = { data: null, error: { message: 'Access denied to zone' } };
    const res = await ecrire(req({ nom: 'Z', recette: RAYON }));
    expect(res.status).toBe(207);
    expect(await res.json()).toEqual({ zone_id: ZONE, warning: 'codes_non_resolus', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' });
  });
  it('nom vide : 400, rien d’exécuté', async () => {
    expect((await ecrire(req({ nom: '', recette: RAYON }))).status).toBe(400);
    expect(executions).toEqual([]);
  });
});

describe('POST /api/zones/[id]/recalculer', () => {
  const appel = (id = ZONE) => recalculer(new Request(`http://localhost/api/zones/${id}/recalculer`, { method: 'POST' }) as never, { params: Promise.resolve({ id }) });
  it('zone introuvable dans l’espace : 404', async () => {
    zoneLue = null;
    expect((await appel()).status).toBe(404);
  });
  it('forme figée (recette null ou dessin) : 409 forme_figee, rien d’exécuté', async () => {
    for (const recette of [null, { v: 1, type: 'dessin' }]) {
      zoneLue = { id: ZONE, recette };
      const r = await appel();
      expect(r.status).toBe(409);
      expect((await r.json()).refus).toBe('forme_figee');
    }
    expect(executions).toEqual([]);
  });
  it('zone citée par un plan : 409 zone_referencee, le message nomme le référent', async () => {
    zoneLue = { id: ZONE, recette: RAYON };
    reponsesRpc.remplacer_geometrie_zone = { data: { refus: 'zone_referencee', par: 'strategie' }, error: null };
    const r = await appel();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'Cette zone est utilisée par un plan : dupliquez-la avant de la recalculer.', refus: 'zone_referencee', par: 'strategie' });
  });
  it('zone libre : remplacée puis résolue', async () => {
    zoneLue = { id: ZONE, recette: RAYON };
    reponsesRpc.remplacer_geometrie_zone = { data: { remplace: true }, error: null };
    reponsesRpc.resolve_custom_geo_zone_codes = { data: { count_cp: 3, count_iris: 9 }, error: null };
    const r = await appel();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ zone_id: ZONE, count_cp: 3, count_iris: 9, surface_km2: 3 });
  });
  it('identifiant non UUID : 404 sans lecture', async () => {
    expect((await appel('pas-un-uuid')).status).toBe(404);
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run --project unit tests/unit/api/zones-routes.test.ts`.

- [ ] **Step 3: Implémenter.** `lib/zones/session-zones.ts` :

```ts
/**
 * @file lib/zones/session-zones.ts — la session des routes de zones : JWT local (`getSessionOrg`, jamais `getUser()`),
 * espace ACTIF (vue espace : un super_admin écrit dans l'espace choisi, spec droits § 4).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';

export async function sessionDeZone(req: NextRequest): Promise<{ ok: true; userId: string; orgId: string } | { ok: false; reponse: NextResponse }> {
  const s = await getSessionOrg(req);
  if (!s) return { ok: false, reponse: NextResponse.json({ error: 'Session expirée.' }, { status: 401 }) };
  if (!s.orgId) return { ok: false, reponse: NextResponse.json({ error: 'Aucun espace actif.' }, { status: 403 }) };
  return { ok: true, userId: s.userId, orgId: s.orgId };
}

/**
 * Résout les codes de la zone (compteurs de « Mes zones » ; n'achète rien) ; 207 si la résolution échoue — la zone
 * existe (Review Focus 5 : un super_admin non membre de l'espace actif est refusé par la fonction). Partagé par
 * l'écriture et le recalcul : un fichier `route.ts` ne peut exporter que ses verbes HTTP.
 */
export async function repondreResolue(supabase: ReturnType<typeof createAdminClient>, zoneId: string, userId: string, surface: number | null) {
  const res = await supabase.rpc('resolve_custom_geo_zone_codes', { p_zone_id: zoneId, p_caller_user_id: userId });
  if (res.error) {
    console.error('[zones] resolve_custom_geo_zone_codes :', res.error.message);
    return NextResponse.json({ zone_id: zoneId, warning: 'codes_non_resolus', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' }, { status: 207 });
  }
  const c = (res.data ?? {}) as { count_cp?: number; count_iris?: number };
  return NextResponse.json({ zone_id: zoneId, count_cp: c.count_cp ?? 0, count_iris: c.count_iris ?? 0, surface_km2: surface });
}
```

(En tête du fichier : `import type { createAdminClient } from '@/lib/auth';`.)

`app/api/zones/apercu/route.ts` :

```ts
/**
 * POST /api/zones/apercu — la forme d'une recette, SANS l'écrire (étape ③, spec carte-en-parcours § 16).
 * Corps : `{ recette, geometrie? }` (géométrie : recettes figées seulement). Quotas en base (`consommer_quota`) :
 * 20 aperçus/min, 6/min pour un seuil sur carreaux (jusqu'à 351 000 buffers par appel, sql/255).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { sourcesVisiblesDeLaRequete } from '@/lib/auth/perimetre-donnees';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { lireCorps } from '@/lib/api/valider-corps';
import { executerRecette } from '@/lib/zones/executer-recette';
import { lireRecette } from '@/lib/zones/recette-schema';
import { sessionDeZone } from '@/lib/zones/session-zones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const limiteur = createRateLimiter({ max: 20, window: '60 s', prefix: 'geo:rl:zones-apercu' });
const limiteurCarreaux = createRateLimiter({ max: 6, window: '60 s', prefix: 'geo:rl:zones-carreaux' });
const Corps = z.object({ recette: z.unknown(), geometrie: z.unknown().optional() }).strict();

export async function POST(req: NextRequest) {
  const s = await sessionDeZone(req);
  if (!s.ok) return s.reponse;
  const corps = await lireCorps(req, Corps);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const lue = lireRecette(corps.valeur.recette);
  if (!lue.ok) return NextResponse.json({ error: lue.message }, { status: 400 });

  const quota = await (lue.recette.type === 'seuil_carreaux' ? limiteurCarreaux : limiteur)(s.userId);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const r = await executerRecette(createAdminClient(), lue.recette, {
    orgId: s.orgId, sources: await sourcesVisiblesDeLaRequete(req), geometrie: corps.valeur.geometrie,
  });
  if (!r.ok) return NextResponse.json({ error: r.message, ...(r.refus ? { refus: r.refus } : {}) }, { status: r.statut });
  return NextResponse.json({ geometry: r.geometry, surface_km2: r.surface_km2, compte: r.compte, part_retenue: r.part_retenue, population: r.population });
}
```

`app/api/zones/route.ts` :

```ts
/**
 * POST /api/zones — écrire une zone à recette dans l'espace ACTIF (spec carte-en-parcours § 16, arbitrage L3-4).
 * La recette est RÉ-EXÉCUTÉE ici : une géométrie cliente n'est lue que pour une recette figée. Puis
 * `creer_zone_recette` (sql/253) et `resolve_custom_geo_zone_codes` (compteurs de « Mes zones », il n'achète rien) ;
 * une résolution refusée rend 207 — la zone existe.
 * N'est PAS `/api/custom-geo/save`, que React gelé garde (arbitrage A-5) : les deux écrivent `custom_geo_zones`.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { sourcesVisiblesDeLaRequete } from '@/lib/auth/perimetre-donnees';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { lireCorps } from '@/lib/api/valider-corps';
import { toJson } from '@/lib/supabase/rpc-json';
import { executerRecette } from '@/lib/zones/executer-recette';
import { lireRecette } from '@/lib/zones/recette-schema';
import { sessionDeZone } from '@/lib/zones/session-zones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const limiteur = createRateLimiter({ max: 20, window: '60 s', prefix: 'geo:rl:zones-ecrire' });
const limiteurCarreaux = createRateLimiter({ max: 6, window: '60 s', prefix: 'geo:rl:zones-carreaux' });
const Corps = z.object({ nom: z.string().trim().min(1).max(200), recette: z.unknown(), geometrie: z.unknown().optional() }).strict();

export async function POST(req: NextRequest) {
  const s = await sessionDeZone(req);
  if (!s.ok) return s.reponse;
  const corps = await lireCorps(req, Corps);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const lue = lireRecette(corps.valeur.recette);
  if (!lue.ok) return NextResponse.json({ error: lue.message }, { status: 400 });

  const quota = await (lue.recette.type === 'seuil_carreaux' ? limiteurCarreaux : limiteur)(s.userId);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();
  const r = await executerRecette(supabase, lue.recette, {
    orgId: s.orgId, sources: await sourcesVisiblesDeLaRequete(req), geometrie: corps.valeur.geometrie,
  });
  if (!r.ok) return NextResponse.json({ error: r.message, ...(r.refus ? { refus: r.refus } : {}) }, { status: r.statut });

  const cree = await supabase.rpc('creer_zone_recette', {
    p_nom: corps.valeur.nom, p_org_id: s.orgId, p_cree_par: s.userId,
    p_recette: toJson(lue.recette), p_geometry_geojson: JSON.stringify(r.geometry),
  });
  const zoneId = (cree.data as { id?: string } | null)?.id;
  if (cree.error || !zoneId) {
    console.error('[zones] creer_zone_recette :', cree.error?.message);
    return NextResponse.json({ error: 'Enregistrement de la zone impossible.' }, { status: 500 });
  }
  return repondreResolue(supabase, zoneId, s.userId, r.surface_km2);
}
```

(Import en tête : `import { repondreResolue, sessionDeZone } from '@/lib/zones/session-zones';` à la place du seul `sessionDeZone`.)

`app/api/zones/[id]/recalculer/route.ts` :

```ts
/**
 * POST /api/zones/[id]/recalculer — rejouer la recette d'une zone de l'espace actif et remplacer sa forme EN PLACE
 * (arbitrage A-2). Refusé pour une forme figée (409 forme_figee) et pour une zone qu'un plan cite (409
 * zone_referencee, `par` : strategie · jeu_de_zones · composite · combinaison). Quota 6/min.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { sourcesVisiblesDeLaRequete } from '@/lib/auth/perimetre-donnees';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { executerRecette } from '@/lib/zones/executer-recette';
import { MESSAGES_REFUS, estRecalculable } from '@/lib/zones/recette';
import { lireRecette } from '@/lib/zones/recette-schema';
import { repondreResolue, sessionDeZone } from '@/lib/zones/session-zones';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const limiteur = createRateLimiter({ max: 6, window: '60 s', prefix: 'geo:rl:zones-recalcul' });
const Uuid = z.string().uuid();
const introuvable = () => NextResponse.json({ error: MESSAGES_REFUS.zone_introuvable, refus: 'zone_introuvable' }, { status: 404 });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await sessionDeZone(req);
  if (!s.ok) return s.reponse;
  const { id } = await params;
  if (!Uuid.safeParse(id).success) return introuvable();
  const quota = await limiteur(s.userId);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();
  const { data: zone, error } = await supabase.from('custom_geo_zones').select('id, recette').eq('id', id).eq('org_id', s.orgId).maybeSingle();
  if (error) {
    console.error('[zones/recalculer] lecture :', error.message);
    return NextResponse.json({ error: 'Lecture de la zone impossible.' }, { status: 500 });
  }
  if (!zone) return introuvable();
  const lue = zone.recette == null ? null : lireRecette(zone.recette);
  if (!lue || !lue.ok || !estRecalculable(lue.recette)) {
    return NextResponse.json({ error: MESSAGES_REFUS.forme_figee, refus: 'forme_figee' }, { status: 409 });
  }

  const r = await executerRecette(supabase, lue.recette, { orgId: s.orgId, sources: await sourcesVisiblesDeLaRequete(req) });
  if (!r.ok) return NextResponse.json({ error: r.message, ...(r.refus ? { refus: r.refus } : {}) }, { status: r.statut });

  const rem = await supabase.rpc('remplacer_geometrie_zone', { p_zone_id: id, p_org_id: s.orgId, p_geometry_geojson: JSON.stringify(r.geometry) });
  if (rem.error) {
    console.error('[zones/recalculer] remplacer :', rem.error.message);
    return NextResponse.json({ error: 'Recalcul de la zone impossible.' }, { status: 500 });
  }
  const sortie = (rem.data ?? {}) as { remplace?: boolean; refus?: 'zone_introuvable' | 'zone_referencee'; par?: string };
  if (sortie.refus === 'zone_introuvable') return introuvable();
  if (sortie.refus === 'zone_referencee') {
    return NextResponse.json({ error: MESSAGES_REFUS.zone_referencee, refus: 'zone_referencee', par: sortie.par }, { status: 409 });
  }
  return repondreResolue(supabase, id, s.userId, r.surface_km2);
}
```

`app/api/custom-geo/list/route.ts:49` : `.select('id, name, description, source_type, source_metadata, recette, feature_count_iris, feature_count_cp, created_at, created_by, bbox')` (ajout seul ; React ignore le champ).

- [ ] **Step 4: PASS** — `npx vitest run --project unit tests/unit/api tests/unit/zones` (dont `validation-corps`, `routes-publiques`, `quotas-partages`) ; `npx tsc --noEmit`.
- [ ] **Step 5: Preuve curl** (serveur `:3000`, compte local de la mémoire `reference_geomatik_credentials`, cookie de session) : un aperçu `seuil_carreaux` 13 → 200 ; le même en `france` → 422 français ; une écriture → 200 et la ligne en base (`select recette from custom_geo_zones where id = …`). Reporter dans le rapport.
- [ ] **Step 6: Doc + commit** — `ARCHITECTURE.md` (3 routes, `recette` dans la liste) ; `feat(api): zones à recette — aperçu, écriture, recalcul`.

---

### Task 9: Angular — l'API, le périmètre, la lecture d'un fichier, l'atelier et l'aperçu sur la carte

**Files:**
- Create: `angular/src/app/features/carte/data/zones.api.ts`, `logique/zones/perimetre-recette.ts`, `logique/zones/import-forme.ts`, `etat/atelier-zone.service.ts`, `couches/apercu-zone.ts`
- Modify: `angular/src/app/app.routes.ts` (`ZonesApi` dans `FOURNISSEURS_DISTANTS`), `data/zones-custom.api.ts` (`ZoneCustomResume.recette?: Recette | null`), `carte.page.ts` + `carte.page.html` (+ `carte.page.spec.ts`) : **la page carte ne fournit pas `ChargementService` au 14/10** (`carte.page.ts:121`) — l'ajouter à ses `providers` et monter `<mg-barre-progression />` juste sous la barre du parcours, comme `features/risques/risque.page.html:50` (spec § 3 : la barre de progression pour tout calcul) ; la spec de la page vérifie qu'elle est présente et vide au repos
- Test: `data/zones.api.spec.ts`, `logique/zones/perimetre-recette.spec.ts`, `logique/zones/import-forme.spec.ts`, `etat/atelier-zone.service.spec.ts`

**Interfaces:**
- Consumes: `Recette`, `PerimetreRecette`, `MESSAGES_REFUS`, `refusPerimetreLocal`, `MAX_SOMMETS_FORME` (copie Angular, Task 2) ; `FiltreActif` (`logique/filtre.ts`) ; `EtatCarteService.filtre` ; `CouchesCarteService.carteCourante`, `quandStyleCharge` ; `CouleursService.palette` ; `ChargementService.suivre` ; `avantDe` (`logique/ordre-couches.ts`).
- Produces:
  - `ZonesApi` : `apercu(corps: { recette: Recette; geometrie?: GeoJSON.Geometry }): Observable<ApercuZone>` ; `enregistrer(corps: { nom: string; recette: Recette; geometrie?: GeoJSON.Geometry }): Observable<HttpResponse<ZoneEcrite>>` ; `recalculer(id: string): Observable<HttpResponse<ZoneEcrite>>`. `interface ApercuZone { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; surface_km2: number | null; compte: number | null; part_retenue: number | null; population: number | null }` ; `interface ZoneEcrite { zone_id: string; count_cp?: number; count_iris?: number; surface_km2?: number | null; warning?: string; message?: string }`.
  - `perimetreDeFiltre(f: FiltreActif | null): PerimetreRecette | null` ; `messageErreurZone(e: { status?: number; error?: unknown }): string`.
  - `lireForme(texte: string, nomFichier: string): FormeLue` avec `type FormeLue = { ok: true; format: 'geojson' | 'kml'; geometrie: GeoJSON.MultiPolygon; polygones: number; ignores: number; sommets: number } | { ok: false; message: string }`.
  - `AtelierZoneService` (fourni par `mg-panneau-zones`) : signaux `recette`, `apercu`, `enCours`, `erreur`, `message` ; `apercevoir(recette: Recette, geometrie?: GeoJSON.Geometry): void` ; `enregistrer(nom: string): void` ; `effacer(): void` ; sortie `zoneCreee: Subject<string>` (identifiant) ; dessine l'aperçu (`poserApercuZone`/`retirerApercuZone`).
  - `couches/apercu-zone.ts` : `SOURCE_APERCU_ZONE = 'apercu-zone'`, `REMPLISSAGE_APERCU_ZONE`, `CONTOUR_APERCU_ZONE`, `poserApercuZone(carte, forme: GeoJSON.Geometry, teal: string)`, `retirerApercuZone(carte)` — l'id `apercu-zone-fill` ajouté à `logique/ordre-couches.ts` à côté de `apercu-rayon-fill` (même rang).

- [ ] **Step 1: Tests (échec).** `logique/zones/perimetre-recette.spec.ts` :

```ts
import { perimetreDeFiltre, messageErreurZone } from './perimetre-recette';

describe('perimetreDeFiltre', () => {
  it.each([
    [{ type: 'departement', code: '13', label: 'Bouches-du-Rhône' }, { type: 'departement', code: '13' }],
    [{ type: 'region', code: '84', label: 'ARA' }, { type: 'region', code: '84' }],
    [{ type: 'commune', code: '13055', label: 'Marseille' }, { type: 'commune', code: '13055' }],
    [{ type: 'cp', code: '13001', label: '13001' }, { type: 'cp', code: '13001' }],
    [{ type: 'zone', code: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', label: 'Ma zone' }, { type: 'zone', code: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }],
    [{ type: 'france', code: 'france', label: 'France' }, { type: 'france', code: 'FR' }],
  ] as const)('%o', (f, attendu) => {
    expect(perimetreDeFiltre(f as never)).toEqual(attendu);
  });
  it('aucun filtre : null', () => expect(perimetreDeFiltre(null)).toBeNull());
});

describe('messageErreurZone', () => {
  it('le message français de la route, sinon un message par statut', () => {
    expect(messageErreurZone({ status: 422, error: { error: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.' } })).toMatch(/^Plus de 20 000/);
    expect(messageErreurZone({ status: 429, error: {} })).toBe('Trop de calculs à la suite : patientez une minute.');
    expect(messageErreurZone({ status: 0 })).toBe('Serveur injoignable : réessayez.');
    expect(messageErreurZone({ status: 500, error: 'texte' })).toBe('Calcul de la zone impossible.');
  });
});
```

`logique/zones/import-forme.spec.ts` :

```ts
import { lireForme } from './import-forme';

const CARRE = [[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]];
const TROU = [[5.02, 43.02], [5.04, 43.02], [5.04, 43.04], [5.02, 43.02]];

describe('lireForme — GeoJSON', () => {
  it('FeatureCollection mêlant polygones et points : polygones gardés, points comptés comme ignorés', () => {
    const fc = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [CARRE, TROU] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 43] }, properties: {} },
      { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[CARRE]] }, properties: {} },
    ] };
    const r = lireForme(JSON.stringify(fc), 'zones.geojson');
    expect(r).toEqual({ ok: true, format: 'geojson', polygones: 2, ignores: 1, sommets: 14,
      geometrie: { type: 'MultiPolygon', coordinates: [[CARRE, TROU], [CARRE]] } });
  });
  it('un Polygon nu, un Feature nu', () => {
    expect(lireForme(JSON.stringify({ type: 'Polygon', coordinates: [CARRE] }), 'a.json')).toMatchObject({ ok: true, polygones: 1 });
    expect(lireForme(JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [CARRE] } }), 'a.json')).toMatchObject({ ok: true, polygones: 1 });
  });
  it.each([
    ['JSON illisible', '{pas du json', 'Fichier illisible : ni GeoJSON ni KML.'],
    ['aucun polygone', JSON.stringify({ type: 'Point', coordinates: [5, 43] }), 'Aucun polygone dans ce fichier.'],
    ['fichier vide', '   ', 'Fichier vide.'],
  ])('%s', (_n, texte, message) => {
    expect(lireForme(texte, 'a.geojson')).toEqual({ ok: false, message });
  });
  it('plus de 20 000 sommets : refusé avec le compte', () => {
    const anneau = Array.from({ length: 20_001 }, (_, i) => [5 + i * 1e-6, 43]);
    const r = lireForme(JSON.stringify({ type: 'Polygon', coordinates: [anneau] }), 'a.geojson');
    expect(r).toEqual({ ok: false, message: 'La forme compte 20 001 sommets, au-delà de 20 000 : simplifiez-la avant de l’importer.' });
  });
  it('coordonnées manifestement inversées (lat, lon) : dit, pas corrigé en silence', () => {
    const inverse = CARRE.map(([x, y]) => [y, x]);
    const r = lireForme(JSON.stringify({ type: 'Polygon', coordinates: [inverse] }), 'a.geojson');
    expect(r).toEqual({ ok: false, message: 'Coordonnées hors des bornes longitude/latitude : le fichier inverse-t-il latitude et longitude ?' });
  });
});

describe('lireForme — KML', () => {
  it('Polygon avec trou, altitude ignorée, MultiGeometry', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><MultiGeometry>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>5,43,0 5.1,43,0 5.1,43.1,0 5,43.1,0 5,43,0</coordinates></LinearRing></outerBoundaryIs>
          <innerBoundaryIs><LinearRing><coordinates>5.02,43.02 5.04,43.02 5.04,43.04 5.02,43.02</coordinates></LinearRing></innerBoundaryIs></Polygon>
        <Point><coordinates>5,43</coordinates></Point>
      </MultiGeometry></Placemark></Document></kml>`;
    expect(lireForme(kml, 'zones.kml')).toEqual({ ok: true, format: 'kml', polygones: 1, ignores: 1, sommets: 9,
      geometrie: { type: 'MultiPolygon', coordinates: [[CARRE, TROU]] } });
  });
  it('KML sans polygone', () => {
    expect(lireForme('<kml><Placemark><Point><coordinates>5,43</coordinates></Point></Placemark></kml>', 'a.kml'))
      .toEqual({ ok: false, message: 'Aucun polygone dans ce fichier.' });
  });
});
```

`etat/atelier-zone.service.spec.ts` (squelette complet — fournir `AtelierZoneService` avec des faux `ZonesApi`, `EtatCarteService`, `CouchesCarteService` (`carteCourante` = `signal(null)`), `CouleursService` (`palette: () => signal({ teal: '#4ecdc4' })`), `ChargementService` réel) :

```ts
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { ZonesApi } from '../data/zones.api';
import { AtelierZoneService } from './atelier-zone.service';
import { CouchesCarteService } from './couches-carte.service';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { signal } from '@angular/core';

const CARRE: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]]] };
const RECETTE = { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: { type: 'departement', code: '13' } } as const;

function monter(api: Partial<Record<keyof ZonesApi, unknown>>) {
  TestBed.configureTestingModule({ providers: [
    AtelierZoneService,
    ChargementService,
    { provide: ZonesApi, useValue: api },
    { provide: CouchesCarteService, useValue: { carteCourante: signal(null) } },
    { provide: CouleursService, useValue: { palette: () => signal({ teal: '#4ecdc4' }) } },
  ] });
  return TestBed.inject(AtelierZoneService);
}

describe('AtelierZoneService', () => {
  it('aperçu : la forme et ses chiffres ; « Enregistrer » envoie la RECETTE et le nom', () => {
    const enregistrer = vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z1', count_cp: 12 } })));
    const s = monter({ apercu: () => of({ geometry: CARRE, surface_km2: 3, compte: 40, part_retenue: 1, population: null }), enregistrer });
    const creees: string[] = [];
    s.zoneCreee.subscribe((id) => creees.push(id));
    s.apercevoir(RECETTE);
    expect(s.apercu()?.compte).toBe(40);
    s.enregistrer('Lycées 13');
    expect(enregistrer).toHaveBeenCalledWith({ nom: 'Lycées 13', recette: RECETTE });
    expect(creees).toEqual(['z1']);
    expect(s.message()).toBe('Zone « Lycées 13 » enregistrée — 12 codes postaux touchés.');
  });

  it('une recette lourde sans périmètre : refus local, AUCUN appel', () => {
    const apercu = vi.fn();
    const s = monter({ apercu });
    s.apercevoir({ ...RECETTE, perimetre: null });
    expect(apercu).not.toHaveBeenCalled();
    expect(s.erreur()).toBe('Choisissez un périmètre à l’étape ① avant ce calcul.');
  });

  it('un second aperçu annule le premier : la réponse tardive n’est jamais dessinée', () => {
    const premiere = new Subject<unknown>();
    const reponses = [premiere, of({ geometry: CARRE, surface_km2: 1, compte: 2, part_retenue: 1, population: null })];
    const s = monter({ apercu: () => reponses.shift() });
    s.apercevoir(RECETTE);
    s.apercevoir({ ...RECETTE, rayon_m: 1000 });
    premiere.next({ geometry: CARRE, surface_km2: 99, compte: 999, part_retenue: 1, population: null });
    expect(s.apercu()?.compte).toBe(2);
  });

  it('refus serveur 422 : son message, l’aperçu effacé', () => {
    const s = monter({ apercu: () => throwError(() => new HttpErrorResponse({ status: 422, error: { error: 'Plus de 20 000 carreaux retenus : resserrez le périmètre ou relevez le seuil.' } })) });
    s.apercevoir(RECETTE);
    expect(s.apercu()).toBeNull();
    expect(s.erreur()).toMatch(/^Plus de 20 000/);
  });

  it('207 : réussite, message de résolution manquée', () => {
    const s = monter({
      apercu: () => of({ geometry: CARRE, surface_km2: 3, compte: 4, part_retenue: 1, population: null }),
      enregistrer: () => of(new HttpResponse({ status: 207, body: { zone_id: 'z2', warning: 'codes_non_resolus', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' } })),
    });
    s.apercevoir(RECETTE);
    s.enregistrer('Z');
    expect(s.message()).toBe('Zone créée ; ses codes postaux n’ont pas pu être résolus.');
  });

  it('enregistrer sans aperçu ou sans nom : rien ne part', () => {
    const enregistrer = vi.fn();
    const s = monter({ enregistrer });
    s.enregistrer('Z');
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it('forme figée : la géométrie lue part avec la recette', () => {
    const enregistrer = vi.fn(() => of(new HttpResponse({ status: 200, body: { zone_id: 'z3' } })));
    const s = monter({ apercu: () => of({ geometry: CARRE, surface_km2: 3, compte: null, part_retenue: 0.8, population: null }), enregistrer });
    s.apercevoir({ v: 1, type: 'import', format: 'kml', fichier: 'a.kml' }, CARRE);
    s.enregistrer('Import');
    expect(enregistrer).toHaveBeenCalledWith({ nom: 'Import', recette: { v: 1, type: 'import', format: 'kml', fichier: 'a.kml' }, geometrie: CARRE });
  });
});
```

`data/zones.api.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from '../../../core/config/config.service';
import { ZonesApi } from './zones.api';

function preparer() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), ZonesApi, { provide: ConfigService, useValue: { valeur: { apiBaseUrl: '' } } }],
  });
  return { api: TestBed.inject(ZonesApi), http: TestBed.inject(HttpTestingController) };
}

describe('ZonesApi', () => {
  it('aperçu, écriture (réponse complète), recalcul (id encodé)', () => {
    const { api, http } = preparer();
    const recette = { v: 1, type: 'dessin' } as const;
    let statut = 0;
    api.apercu({ recette }).subscribe();
    api.enregistrer({ nom: 'Z', recette }).subscribe((r) => (statut = r.status));
    api.recalculer('a/b').subscribe();
    const a = http.expectOne('/api/zones/apercu');
    expect([a.request.method, a.request.body]).toEqual(['POST', { recette }]);
    const e = http.expectOne('/api/zones');
    expect(e.request.body).toEqual({ nom: 'Z', recette });
    e.flush({ zone_id: 'z' }, { status: 207, statusText: 'Multi-Status' });
    expect(statut).toBe(207);
    expect(http.expectOne('/api/zones/a%2Fb/recalculer').request.method).toBe('POST');
    http.verify();
  });
});
```

- [ ] **Step 2: FAIL** — `cd angular && npx ng test --watch=false --include='**/zones/*.spec.ts' --include='**/atelier-zone.service.spec.ts' --include='**/zones.api.spec.ts'`.

- [ ] **Step 3: Implémenter.** `logique/zones/perimetre-recette.ts` :

```ts
import type { FiltreActif } from '../filtre';
import type { PerimetreRecette } from './recette';

/**
 * Le périmètre de ① (le filtre actif) tel qu'une recette l'enregistre (spec carte-en-parcours § 16.2-5). Le code est
 * celui du filtre ; la France s'écrit `FR`. Aucun filtre : `null` — une recette lourde est alors refusée avant tout appel.
 */
export function perimetreDeFiltre(f: FiltreActif | null): PerimetreRecette | null {
  if (!f) return null;
  if (f.type === 'france') return { type: 'france', code: 'FR' };
  return { type: f.type, code: f.code };
}

/** Le message d'un échec HTTP des routes de zones : celui de la route s'il existe, sinon un message par statut. */
export function messageErreurZone(e: { status?: number; error?: unknown }): string {
  const m = (e.error as { error?: unknown } | null | undefined)?.error;
  if (typeof m === 'string' && m.length > 0) return m;
  if (e.status === 429) return 'Trop de calculs à la suite : patientez une minute.';
  if (e.status === 0) return 'Serveur injoignable : réessayez.';
  return 'Calcul de la zone impossible.';
}
```

`logique/zones/import-forme.ts` :

```ts
/**
 * Lire une forme importée (GeoJSON ou KML) en un MultiPolygon (spec carte-en-parcours § 16.3, « import de polygone »).
 * Pur : `DOMParser` pour le KML (pas d'écouteur, pas de document global modifié — contrainte AIDA).
 * On garde les polygones, on COMPTE ce qu'on ignore (points, lignes), on refuse au-delà de 20 000 sommets et on
 * signale des coordonnées hors bornes (lat/lon inversées) au lieu de les corriger. La réparation géométrique
 * (auto-intersection) et le découpage sur la France sont faits par le serveur (`zone_dessin`, sql/156).
 */
import { MAX_SOMMETS_FORME } from './recette';

type Anneau = number[][];
type Poly = Anneau[];
export type FormeLue =
  | { ok: true; format: 'geojson' | 'kml'; geometrie: GeoJSON.MultiPolygon; polygones: number; ignores: number; sommets: number }
  | { ok: false; message: string };

const nombre = (n: number) => n.toLocaleString('fr-FR').replace(/ /g, ' ');

function terminer(format: 'geojson' | 'kml', polys: Poly[], ignores: number): FormeLue {
  if (polys.length === 0) return { ok: false, message: 'Aucun polygone dans ce fichier.' };
  const sommets = polys.reduce((n, p) => n + p.reduce((m, a) => m + a.length, 0), 0);
  if (sommets > MAX_SOMMETS_FORME) {
    return { ok: false, message: `La forme compte ${nombre(sommets)} sommets, au-delà de ${nombre(MAX_SOMMETS_FORME)} : simplifiez-la avant de l’importer.` };
  }
  const horsBornes = polys.some((p) => p.some((a) => a.some(([x, y]) => !(Math.abs(x) <= 180 && Math.abs(y) <= 90))));
  // La métropole INVERSÉE : « longitude » entre 41 et 51,5 et « latitude » entre −5,5 et 10. Mayotte (lon 45,
  // lat −12,8) n'y tombe pas : la règle ne refuse jamais un DROM.
  const inverse = !horsBornes && polys.every((p) => p.every((a) => a.every(([x, y]) => x >= 41 && x <= 51.5 && y >= -5.5 && y <= 10)));
  if (horsBornes || inverse) {
    return { ok: false, message: 'Coordonnées hors des bornes longitude/latitude : le fichier inverse-t-il latitude et longitude ?' };
  }
  return { ok: true, format, geometrie: { type: 'MultiPolygon', coordinates: polys }, polygones: polys.length, ignores, sommets };
}

function depuisGeoJson(v: unknown): FormeLue {
  const polys: Poly[] = [];
  let ignores = 0;
  const geometrie = (g: unknown): void => {
    const o = g as { type?: string; coordinates?: unknown; geometries?: unknown[] } | null;
    if (o?.type === 'Polygon' && Array.isArray(o.coordinates)) polys.push(o.coordinates as Poly);
    else if (o?.type === 'MultiPolygon' && Array.isArray(o.coordinates)) polys.push(...(o.coordinates as Poly[]));
    else if (o?.type === 'GeometryCollection' && Array.isArray(o.geometries)) o.geometries.forEach(geometrie);
    else ignores += 1;
  };
  const o = v as { type?: string; features?: unknown[]; geometry?: unknown } | null;
  if (o?.type === 'FeatureCollection' && Array.isArray(o.features)) o.features.forEach((f) => geometrie((f as { geometry?: unknown }).geometry));
  else if (o?.type === 'Feature') geometrie(o.geometry);
  else geometrie(o);
  return terminer('geojson', polys, ignores);
}

function anneauKml(el: Element | null): Anneau | null {
  const txt = el?.getElementsByTagName('coordinates')[0]?.textContent?.trim();
  if (!txt) return null;
  return txt.split(/\s+/).map((t) => t.split(',').slice(0, 2).map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
}

function depuisKml(texte: string): FormeLue {
  const doc = new DOMParser().parseFromString(texte, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, message: 'Fichier illisible : ni GeoJSON ni KML.' };
  const polys: Poly[] = [];
  for (const p of Array.from(doc.getElementsByTagName('Polygon'))) {
    const ext = anneauKml(p.getElementsByTagName('outerBoundaryIs')[0] ?? null);
    if (!ext) continue;
    const trous = Array.from(p.getElementsByTagName('innerBoundaryIs')).map((i) => anneauKml(i)).filter((a): a is Anneau => !!a);
    polys.push([ext, ...trous]);
  }
  const ignores = ['Point', 'LineString'].reduce((n, t) => n + doc.getElementsByTagName(t).length, 0);
  return terminer('kml', polys, ignores);
}

export function lireForme(texte: string, nomFichier: string): FormeLue {
  const t = texte.replace(/^﻿/, '').trim();
  if (t.length === 0) return { ok: false, message: 'Fichier vide.' };
  if (t.startsWith('<') || /\.kml$/i.test(nomFichier)) return depuisKml(t);
  try {
    return depuisGeoJson(JSON.parse(t));
  } catch {
    return { ok: false, message: 'Fichier illisible : ni GeoJSON ni KML.' };
  }
}
```

La règle « inversé » est un heuristique pour la métropole : ajouter au spec un cas Mayotte (`[[45.1, -12.8], [45.2, -12.8], [45.2, -12.7], [45.1, -12.8]]`) qui doit rester `ok: true`. Le test des sommets du KML compte 5 + 4 = 9.

`couches/apercu-zone.ts` : copie de `couches/apercu-rayon.ts` avec les identifiants `apercu-zone`, `apercu-zone-fill`, `apercu-zone-line`, une forme (`GeoJSON.Geometry`) au lieu d'un cercle, opacité de remplissage `0.15`, contour plein `1.5` (la zone est CALCULÉE : `line-dasharray: [2, 2]`, convention `lib/carte/nature-zone.ts`). Ajouter `apercu-zone-fill` et `apercu-zone-line` à `logique/ordre-couches.ts` à côté des deux identifiants `apercu-rayon-*`, et à `tests/unit/angular/carte-ordre-couches.test.ts` si ce test énumère les identifiants.

`data/zones.api.ts` :

```ts
import type { HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { Recette } from '../logique/zones/recette';

export interface ApercuZone {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  surface_km2: number | null;
  compte: number | null;
  part_retenue: number | null;
  population: number | null;
}

export interface ZoneEcrite {
  zone_id: string;
  count_cp?: number;
  count_iris?: number;
  surface_km2?: number | null;
  warning?: string;
  message?: string;
}

/**
 * Les zones à recette (lot 3) : `POST /api/zones/apercu`, `POST /api/zones`, `POST /api/zones/[id]/recalculer`.
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`), jamais à la racine (intercepteurs du shell AIDA).
 */
@Injectable()
export class ZonesApi extends HttpBaseService {
  apercu(corps: { recette: Recette; geometrie?: GeoJSON.Geometry }): Observable<ApercuZone> {
    return this.httpClient.post<ApercuZone>(`${this.baseUrl}/zones/apercu`, corps);
  }

  enregistrer(corps: { nom: string; recette: Recette; geometrie?: GeoJSON.Geometry }): Observable<HttpResponse<ZoneEcrite>> {
    return this.httpClient.post<ZoneEcrite>(`${this.baseUrl}/zones`, corps, { observe: 'response' });
  }

  recalculer(id: string): Observable<HttpResponse<ZoneEcrite>> {
    return this.httpClient.post<ZoneEcrite>(`${this.baseUrl}/zones/${encodeURIComponent(id)}/recalculer`, null, { observe: 'response' });
  }
}
```

`etat/atelier-zone.service.ts` :

```ts
import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Subject, type Subscription } from 'rxjs';
import { ChargementService } from '../../../core/chargement/chargement.service';
import { CouleursService } from '../../../core/theme/couleurs.service';
import { poserApercuZone, retirerApercuZone } from '../couches/apercu-zone';
import { type ApercuZone, ZonesApi } from '../data/zones.api';
import { messageErreurZone } from '../logique/zones/perimetre-recette';
import { MESSAGES_REFUS, refusPerimetreLocal, type Recette } from '../logique/zones/recette';
import { CouchesCarteService, quandStyleCharge } from './couches-carte.service';

/**
 * L'atelier de l'étape ③ (lot 3) : une recette → un aperçu dessiné → une zone enregistrée. Fourni par
 * `mg-panneau-zones` (qui reste MONTÉ entre les étapes : l'aperçu survit à ③ → ① → ③) ; un changement d'espace
 * recrée la page, donc l'atelier (spec droits § 4.1) — aucune réponse de l'ancien espace n'arrive ici.
 *
 * Un aperçu en remplace un autre : l'abonnement précédent est COUPÉ (Review Focus 4). Une recette lourde sans
 * périmètre est refusée avant tout appel. « Enregistrer » envoie la RECETTE : le serveur la rejoue (L3-4) ; seule une
 * forme figée envoie sa géométrie.
 */
@Injectable()
export class AtelierZoneService {
  private readonly api = inject(ZonesApi);
  private readonly couches = inject(CouchesCarteService);
  private readonly couleurs = inject(CouleursService).palette({ teal: 'brand-teal' });

  readonly recette = signal<Recette | null>(null);
  readonly apercu = signal<ApercuZone | null>(null);
  readonly enCours = signal(false);
  readonly erreur = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  /** L'identifiant de chaque zone écrite : « Mes zones » se relit. */
  readonly zoneCreee = new Subject<string>();

  private geometrieFigee: GeoJSON.Geometry | undefined;
  private vol: Subscription | null = null;

  constructor() {
    inject(ChargementService).suivre('atelier-zone', 'Calcul de la zone…', () => this.enCours());
    // Dessin de l'aperçu : suit la forme ET la carte courante (un changement de fond recrée les couches).
    effect((nettoyer) => {
      const carte = this.couches.carteCourante();
      const a = this.apercu();
      const teal = this.couleurs().teal;
      if (!carte) return;
      const annuler = untracked(() => quandStyleCharge(carte, () => (a ? poserApercuZone(carte, a.geometry, teal) : retirerApercuZone(carte))));
      nettoyer(annuler);
    });
    inject(DestroyRef).onDestroy(() => {
      this.vol?.unsubscribe();
      const carte = this.couches.carteCourante();
      if (carte) retirerApercuZone(carte);
    });
  }

  apercevoir(recette: Recette, geometrie?: GeoJSON.Geometry): void {
    this.vol?.unsubscribe();
    this.recette.set(recette);
    this.geometrieFigee = geometrie;
    this.apercu.set(null);
    this.message.set(null);
    const refus = refusPerimetreLocal(recette);
    if (refus) {
      this.erreur.set(MESSAGES_REFUS[refus]);
      return;
    }
    this.erreur.set(null);
    this.enCours.set(true);
    this.vol = this.api.apercu(geometrie ? { recette, geometrie } : { recette }).subscribe({
      next: (a) => { this.apercu.set(a); this.enCours.set(false); },
      error: (e: { status?: number; error?: unknown }) => { this.erreur.set(messageErreurZone(e)); this.enCours.set(false); },
    });
  }

  enregistrer(nom: string): void {
    const recette = this.recette();
    const n = nom.trim();
    if (!recette || !this.apercu() || n.length === 0 || this.enCours()) return;
    this.vol?.unsubscribe();
    this.enCours.set(true);
    this.erreur.set(null);
    const corps = this.geometrieFigee ? { nom: n, recette, geometrie: this.geometrieFigee } : { nom: n, recette };
    this.vol = this.api.enregistrer(corps).subscribe({
      next: (r) => {
        this.enCours.set(false);
        const b = r.body;
        if (!b?.zone_id) { this.erreur.set('Enregistrement de la zone impossible.'); return; }
        this.message.set(r.status === 207
          ? (b.message ?? 'Zone créée ; ses codes postaux n’ont pas pu être résolus.')
          : `Zone « ${n} » enregistrée — ${b.count_cp ?? 0} codes postaux touchés.`);
        this.zoneCreee.next(b.zone_id);
      },
      error: (e: { status?: number; error?: unknown }) => { this.erreur.set(messageErreurZone(e)); this.enCours.set(false); },
    });
  }

  effacer(): void {
    this.vol?.unsubscribe();
    this.recette.set(null);
    this.apercu.set(null);
    this.erreur.set(null);
    this.message.set(null);
    this.enCours.set(false);
    this.geometrieFigee = undefined;
  }
}
```

(Le message « 12 codes postaux touchés » parle de CP TOUCHÉS — l'intersection de `resolve_custom_geo_zone_codes` — jamais « retenus » : ③ ne convertit pas.)

`app.routes.ts` : importer `ZonesApi` et l'ajouter à `FOURNISSEURS_DISTANTS` à côté de `ZonesCustomApi`. `data/zones-custom.api.ts` : `recette?: Recette | null;` dans `ZoneCustomResume` (import type depuis `../logique/zones/recette`).

- [ ] **Step 4: PASS** — les specs du Step 2 ; `cd angular && npx ng test --watch=false` (suite entière) ; `npx vitest run --project unit tests/unit/angular`.
- [ ] **Step 5: Commit** — `feat(angular): atelier de zone — API, périmètre, lecture GeoJSON/KML, aperçu sur la carte`.

---

### Task 10: Angular — l'étape ③ rangée par familles, quatre formulaires de recette

**Files:**
- Create: `angular/src/app/features/carte/panneaux/zones/pied-recette.component.ts`, `recette-rayon-poi.component.ts`, `recette-seuil-carreaux.component.ts`, `recette-seuil-territoire.component.ts`, `recette-import.component.ts` (+ une spec chacun)
- Modify: `panneaux/zones/panneau-zones.component.ts` (+ spec), `etat/creation-zone.service.ts` (+ spec : enregistre par `ZonesApi` avec la recette), `panneaux/zones/creer-codes-postaux.component.ts`, `creer-rayon.component.ts`, `creer-dessin.component.ts` (passent leur recette), `panneaux/zones/operations-zones.component.ts` (+ spec : recette `combinaison`), `logique/parcours.ts` (consigne de ③)
- Doc: `angular/src/app/features/carte/README.md`

**Interfaces:**
- Consumes: `AtelierZoneService` (Task 9), `perimetreDeFiltre`, `lireForme`, `INDICATEURS_SEUIL_CARREAUX`, `RAYON_POI_MIN_M`, `RAYON_POI_MAX_M`, `libelleRecette`, `EtatCarteService.filtre`, `CataloguePoiService.types` (+ `chargerUneFois()`), `CatalogueIndicateursService.charger()` (fourni ICI aussi), `ZonesApi.enregistrer`, `OutilsCarteService.zonesModifiees()`.
- Produces:
  - `mg-pied-recette` : entrées `pret: boolean` ; affiche les chiffres de `atelier.apercu()` (surface, compte, population, part retenue), le champ « Nom de la zone », « Aperçu » (sortie `apercevoir`) et « Enregistrer la zone » (`atelier.enregistrer(nom)`), l'erreur et le message ; nom par défaut = `libelleRecette(recette)` tronqué à 200.
  - `mg-recette-rayon-poi`, `mg-recette-seuil-carreaux`, `mg-recette-seuil-territoire`, `mg-recette-import` : chacun compose SA recette depuis ses champs et le périmètre de ①, et appelle `atelier.apercevoir(recette[, geometrie])`.
  - `CreationZoneService.creer(source, zone, recette: (geo) => Recette)` : la troisième fonction donne la recette ; l'écriture passe par `ZonesApi.enregistrer({ nom, recette, geometrie? })` (géométrie seulement pour `dessin`).
  - Panneau ③ : quatre sections `mg-entete-section` repliables — « Autour des POI » (rayon autour d'un point, rayon autour d'un type de POI ; les isochrones arrivent en Task 11), « Par seuil » (carreaux, IRIS ou CP), « À la main » (dessin, import, codes postaux), « Capture » (le bouton existant) ; une ligne d'état du périmètre en tête (« Périmètre : Bouches-du-Rhône » ou « Aucun périmètre : les calculs par seuil et autour des POI sont désactivés. Choisissez-en un à l'étape ① ») ; puis le renvoi existant vers « Mes zones ».

- [ ] **Step 1: Specs (échec)** — pour chaque formulaire, sur le modèle de `creer-codes-postaux.component.spec.ts` (TestBed, faux services, `stable()`), au minimum :

`recette-seuil-carreaux.component.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AtelierZoneService } from '../../etat/atelier-zone.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { RecetteSeuilCarreauxComponent } from './recette-seuil-carreaux.component';

const attendre = () => new Promise((r) => setTimeout(r, 0));

function monter(filtre: unknown) {
  const apercevoir = vi.fn();
  TestBed.configureTestingModule({ providers: [
    { provide: AtelierZoneService, useValue: { apercevoir, apercu: signal(null), enCours: signal(false), erreur: signal(null), message: signal(null), recette: signal(null), enregistrer: vi.fn() } },
    { provide: EtatCarteService, useValue: { filtre: signal(filtre) } },
  ] });
  const f = TestBed.createComponent(RecetteSeuilCarreauxComponent);
  return { f, el: f.nativeElement as HTMLElement, apercevoir };
}

describe('RecetteSeuilCarreauxComponent', () => {
  it('13 indicateurs, « Part des ménages pauvres » par défaut, seuil 40 %', async () => {
    const { f, el } = monter({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
    f.detectChanges(); await attendre();
    expect(el.querySelectorAll('select[data-indicateur] option')).toHaveLength(13);
    expect((el.querySelector('input[data-seuil]') as HTMLInputElement).value).toBe('40');
    expect(el.querySelector('[data-unite]')!.textContent!.trim()).toBe('%');
  });
  it('« Aperçu » compose la recette avec le périmètre de ①', async () => {
    const { f, el, apercevoir } = monter({ type: 'departement', code: '13', label: 'Bouches-du-Rhône' });
    f.detectChanges(); await attendre();
    el.querySelector<HTMLButtonElement>('[data-apercu]')!.click();
    expect(apercevoir).toHaveBeenCalledWith({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '13' } });
  });
  it('sans périmètre : bouton désactivé, la raison dite', async () => {
    const { f, el } = monter(null);
    f.detectChanges(); await attendre();
    expect(el.querySelector<HTMLButtonElement>('[data-apercu]')!.disabled).toBe(true);
    expect(el.querySelector('[data-garde]')!.textContent).toContain('étape ①');
  });
  it('France : désactivé aussi, message national', async () => {
    const { f, el } = monter({ type: 'france', code: 'france', label: 'France' });
    f.detectChanges(); await attendre();
    expect(el.querySelector<HTMLButtonElement>('[data-apercu]')!.disabled).toBe(true);
    expect(el.querySelector('[data-garde]')!.textContent).toContain('France entière');
  });
});
```

`recette-rayon-poi.component.spec.ts` : la liste des types vient de `CataloguePoiService.types` (faux : `signal([{ id: 'lycee', label: 'Lycées', origine: 'commune' }, { id: 'bmw', label: 'Concessions', origine: 'espace' }])`, `chargerUneFois: vi.fn()`), `chargerUneFois` est appelé UNE fois à l'ouverture ; la réglette va de 100 m à 50 km par pas de 100 m ; « Aperçu » → `{ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: {…} }` ; sans périmètre, désactivé.

`recette-seuil-territoire.component.spec.ts` : `CatalogueIndicateursService.charger` (faux `of([{ indicator_code: 'taux_pauvrete', label: 'Taux de pauvreté', famille: 'Revenus', unit: '%' }])`) appelé UNE fois ; opérateur `≥`/`≤` ; « Aperçu » → `{ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre }` ; lecture du catalogue en échec → « Indicateurs indisponibles. » et bouton désactivé.

`recette-import.component.spec.ts` : un `File` GeoJSON déposé (`new File([texte], 'zones.geojson')`, événement `change` sur `input[type=file]`, lecture par `file.text()`) → « 2 polygones · 1 élément ignoré » puis `apercevoir({ v: 1, type: 'import', format: 'geojson', fichier: 'zones.geojson' }, geometrie)` ; un fichier refusé par `lireForme` → son message, aucun appel ; un fichier de plus de 5 Mo → « Fichier trop lourd (5 Mo au plus). » sans lecture.

`pied-recette.component.spec.ts` : chiffres affichés depuis `apercu` (« 3,2 km² · 505 carreaux · 41 230 habitants », `part_retenue` < 0,98 → « 87 % de la forme dans le périmètre ») mis en forme par `formaterNombre` (`angular/src/app/core/format/nombre.ts`, copie de `lib/format/nombre.ts` — jamais un `fmtNum` local), le nom par défaut = libellé de la recette, « Enregistrer la zone » désactivé sans aperçu, `atelier.enregistrer('Nom saisi')` au clic.

`panneau-zones.component.spec.ts` (remplace l'existant) : quatre en-têtes dans l'ordre « Autour des POI », « Par seuil », « À la main », « Capture » ; la ligne de périmètre suit `EtatCarteService.filtre` ; une zone écrite (`atelier.zoneCreee.next('z')`) appelle `OutilsCarteService.zonesModifiees()` ; le panneau fournit `AtelierZoneService`, `CreationZoneService` et `CatalogueIndicateursService`.

`operations-zones.component.spec.ts` : « Union » de deux zones → `ZonesApi.enregistrer({ nom: <nomZoneCreee>, recette: { v: 1, type: 'combinaison', operation: 'union', zones: [a, b] } })` et PLUS AUCUN appel à `ZonesCustomApi.operation` ni `enregistrer` ; un 404 → message de la route.

`creation-zone.service.spec.ts` : `creer(source, zone, recette)` écrit par `ZonesApi.enregistrer` avec `{ nom, recette }` (CP, rayon) ou `{ nom, recette, geometrie }` (dessin) ; un 207 reste une réussite ; un échec → `MESSAGE_SAUVEGARDE_ECHOUEE`.

- [ ] **Step 2: FAIL** — `cd angular && npx ng test --watch=false --include='**/panneaux/zones/**/*.spec.ts' --include='**/creation-zone.service.spec.ts'`.

- [ ] **Step 3: Implémenter.** Le formulaire de référence — `recette-seuil-carreaux.component.ts` (les trois autres suivent le même patron : champs → `computed` de la recette → garde → bouton) :

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AtelierZoneService } from '../../etat/atelier-zone.service';
import { EtatCarteService } from '../../etat/etat-carte.service';
import { perimetreDeFiltre } from '../../logique/zones/perimetre-recette';
import { INDICATEURS_SEUIL_CARREAUX, MESSAGES_REFUS, type OperateurSeuil, type Recette, refusPerimetreLocal } from '../../logique/zones/recette';

/**
 * « Carreaux au-dessus d'un seuil » (lot 3, spec § 16.3) : un indicateur Filosofi 200 m de la liste fermée, un
 * opérateur, un seuil ; la zone est l'union des carreaux retenus DANS le périmètre de ① (sql/255). Le calcul coûte
 * jusqu'à quelques secondes : la barre de progression de la page le suit (`ChargementService`, clé atelier-zone).
 */
@Component({
  selector: 'mg-recette-seuil-carreaux',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2 px-3.5 py-3' },
  template: `
    <label class="text-[12px] text-tertiary" for="seuil-carreaux-indicateur">Indicateur</label>
    <select id="seuil-carreaux-indicateur" data-indicateur class="champ" [value]="indicateur()" (change)="indicateur.set($any($event.target).value)">
      @for (i of indicateurs; track i.id) { <option [value]="i.id">{{ i.libelle }}</option> }
    </select>
    <div class="flex items-center gap-2">
      <select data-operateur class="champ w-16" [value]="operateur()" (change)="operateur.set($any($event.target).value)">
        <option value=">=">≥</option><option value="<=">≤</option>
      </select>
      <input data-seuil type="number" class="champ w-24 font-mono" min="0" [value]="seuil()" (input)="seuil.set(+$any($event.target).value)" />
      <span data-unite class="text-[12px] text-tertiary">{{ unite() }}</span>
    </div>
    @if (garde(); as g) { <p data-garde class="m-0 text-[12px] leading-[1.5] text-tertiary">{{ g }}</p> }
    <button type="button" data-apercu class="cta-teal" [disabled]="!!garde() || atelier.enCours()" (click)="apercevoir()">Aperçu</button>
  `,
  styles: `
    .champ { background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); border-radius: 6px; padding: 6px 10px;
      font-size: 13px; color: var(--text-primary); }
    .champ:focus { outline: none; border-color: var(--brand-teal-50); }
    .cta-teal { background: transparent; border: 0.5px solid var(--brand-teal); color: var(--brand-teal); border-radius: 6px;
      padding: 8px 16px; font-size: 12px; font-weight: 500; cursor: pointer; }
    .cta-teal:hover:not(:disabled) { background: var(--brand-teal-10); }
    .cta-teal:disabled { border-color: var(--border-default); color: var(--text-tertiary); cursor: not-allowed; opacity: 0.5; }
  `,
})
export class RecetteSeuilCarreauxComponent {
  protected readonly atelier = inject(AtelierZoneService);
  private readonly filtre = inject(EtatCarteService).filtre;
  protected readonly indicateurs = INDICATEURS_SEUIL_CARREAUX;
  protected readonly indicateur = signal(INDICATEURS_SEUIL_CARREAUX[0].id);
  protected readonly operateur = signal<OperateurSeuil>('>=');
  protected readonly seuil = signal(40);
  protected readonly unite = computed(() => INDICATEURS_SEUIL_CARREAUX.find((i) => i.id === this.indicateur())?.unite ?? '');
  private readonly recette = computed<Recette>(() => ({
    v: 1, type: 'seuil_carreaux', indicateur: this.indicateur(), operateur: this.operateur(), seuil: this.seuil(),
    perimetre: perimetreDeFiltre(this.filtre()),
  }));
  protected readonly garde = computed(() => {
    const r = refusPerimetreLocal(this.recette());
    return r ? MESSAGES_REFUS[r] : null;
  });

  protected apercevoir(): void {
    if (!this.garde()) this.atelier.apercevoir(this.recette());
  }
}
```

Les styles `.champ` / `.cta-teal` sont répétés dans les quatre formulaires : les placer dans `panneaux/zones/styles-recette.ts` (`export const STYLES_RECETTE = \`…\``) et les importer (`styles: [STYLES_RECETTE]`), sur le modèle de `panneaux/analyse/styles-analyse.ts`.

`recette-rayon-poi.component.ts` : `CataloguePoiService` injecté (le fournisseur est celui de la page) ; `constructor() { this.catalogue.chargerUneFois(); }` ; un `select` des types (`types()`), une réglette `type="range"` `min=100 max=50000 step=100` (valeur affichée « 5 km » en JetBrains Mono), recette `{ v: 1, type: 'rayon_poi', categorie, rayon_m, perimetre }`.

`recette-seuil-territoire.component.ts` : `CatalogueIndicateursService.charger()` une fois (abonnement coupé à la destruction : `DestroyRef`) ; `select` des indicateurs groupés par `famille` (`optgroup`), opérateur, seuil (défaut 20), recette `{ v: 1, type: 'seuil_territoire', … }`.

`recette-import.component.ts` : `input type="file" accept=".geojson,.json,.kml"` ; refus > 5 Mo avant lecture ; `await fichier.text()` puis `lireForme(texte, fichier.name)` ; résumé « {polygones} polygone(s) · {ignores} élément(s) ignoré(s) » ; « Aperçu » → `atelier.apercevoir({ v: 1, type: 'import', format, fichier: nom.slice(0, 200) }, geometrie)`.

`pied-recette.component.ts` : monté UNE fois en bas du panneau (pas dans chaque formulaire) — il lit `atelier.recette()` / `apercu()` ; champ nom (`model`), réinitialisé au libellé de la recette quand la recette change (`linkedSignal({ source: atelier.recette, computation: (r) => r ? libelleRecette(r).slice(0, 200) : '' })`) ; « Enregistrer la zone » (CTA teal) → `atelier.enregistrer(nom())` ; erreur (`role="alert"`, jeton `--danger` à 8 %) et message (`role="status"`, `--success` à 8 %) avec les styles de `outil-creation.component.ts`.

`panneau-zones.component.ts` : `providers: [CreationZoneService, AtelierZoneService, CatalogueIndicateursService]` ; template : la ligne de périmètre (`perimetreDeFiltre(etat.filtre())` + `filtre().label`), puis

```html
<mg-entete-section libelle="Autour des POI" repliable [(ouvert)]="ouverts.poi" />
@if (ouverts.poi()) { <mg-creer-rayon (cree)="relire()" /> <mg-recette-rayon-poi /> }
<mg-entete-section libelle="Par seuil" repliable [(ouvert)]="ouverts.seuil" />
@if (ouverts.seuil()) { <mg-recette-seuil-carreaux /> <mg-recette-seuil-territoire /> }
<mg-entete-section libelle="À la main" repliable [(ouvert)]="ouverts.main" />
@if (ouverts.main()) { <mg-creer-dessin (cree)="relire()" /> <mg-recette-import /> <mg-creer-codes-postaux (cree)="relire()" /> }
<mg-entete-section libelle="Capture" repliable [(ouvert)]="ouverts.capture" />
@if (ouverts.capture()) { …le bouton « Capturer zone custom » existant, inchangé… }
<mg-pied-recette />
…le renvoi « Ouvrir “Mes zones” » existant…
```

⚠ `@if` sur une SECTION repliée démonte ses formulaires : acceptable (aucun calcul ne vit dans un formulaire, l'aperçu vit dans `AtelierZoneService`) — mais `mg-creer-dessin` prend la carte pendant un tracé : le replier doit arrêter le tracé (comportement existant de son `basculer`). Vérifier dans la spec du panneau : replier « À la main » pendant un tracé libère la carte (`EtatCarteService.rendreCarte` appelé). `ouverts` : `{ poi: signal(true), seuil: signal(false), main: signal(false), capture: signal(false) }`. Le constructeur abonne `atelier.zoneCreee` à `relire()` (désabonné à la destruction). Le fichier reste < 400 lignes.

`etat/creation-zone.service.ts` : `creer(source, zone, recette)` — remplacer `this.api.enregistrer({ ...zone(geo), geometry, org_id })` par `this.zonesApi.enregistrer({ nom: zone(geo).name, recette: recette(geo), ...(recette(geo).type === 'dessin' ? { geometrie: geo.geometry } : {}) })` ; la lecture de l'organisation (`AuthService.lireProfil`) n'est plus nécessaire pour écrire (l'espace est celui de la session côté serveur) — la garder seulement si un composant lit encore `org()` (Grep `\.org()` dans `panneaux/zones` et `panneaux/analyse`) ; sinon la retirer avec sa spec. Les trois créateurs passent : CP → `{ v: 1, type: 'codes_postaux', codes }` (codes reconnus de la réponse source ; si la réponse ne les rend pas, les codes saisis valides `parse-cp.ts`) ; rayon → `{ v: 1, type: 'rayon_point', lon, lat, rayon_m }` ; dessin → `{ v: 1, type: 'dessin' }`. Le score composite (`panneau-analyse`, « Créer la zone ») appelle aussi `CreationZoneService.creer` : lui passer `{ v: 1, type: 'capture', source_type: 'score' }` (forme figée, géométrie envoyée — ajuster la condition : envoyer `geometrie` pour TOUT type non recalculable, via `estRecalculable`).

`operations-zones.component.ts` : remplacer l'enchaînement `api.operation(...)` puis `api.enregistrer(...)` par `zonesApi.enregistrer({ nom: nomZoneCreee(op, selection, noms), recette: { v: 1, type: 'combinaison', operation: op, zones: [...selection] } })`, messages inchangés (`messageZoneCreee(count_cp, surface_km2)`, `messageErreurZone` pour l'échec).

`logique/parcours.ts` : consigne de ③ → « Définissez vos zones : autour des POI, par seuil sur une donnée, à la main, ou en capturant la carte. Chaque zone garde sa recette et se recalcule. » (+ test de `parcours.spec.ts` si la consigne y est figée).

- [ ] **Step 4: PASS** — `cd angular && npx ng test --watch=false` (suite entière), `cd angular && npm run build -- --output-path=/tmp/ng-lot3`, `npx vitest run --project unit tests/unit/angular`.
- [ ] **Step 5: Preuve navigateur** (`:4202`, deux thèmes) : ① Bouches-du-Rhône → ③ « Par seuil » → part des ménages pauvres ≥ 40 % → Aperçu (barre de progression, forme teal tiretée, « 505 carreaux ») → Enregistrer → la zone apparaît dans « Mes zones » ; ① France → les deux formulaires lourds désactivés avec le message ; import d'un KML de test (`.superpowers/sdd/2026-10-14-carte-lot-3/essai.kml`, non suivi) ; ③ → ① → ③ : l'aperçu est toujours là. Captures dans le dossier non suivi.
- [ ] **Step 6: Doc + commit** — README carte ; `feat(angular): ③ Zones par familles — rayon autour des POI, seuils, import, recettes partout`.

---

### Task 11: Isochrones et bataille quittent ④ pour ③ ; la capture garde une recette

**Files:**
- Create: `angular/src/app/features/carte/panneaux/zones/section-isochrones.component.ts` (+ spec)
- Modify: `panneaux/analyse/panneau-analyse.component.ts` (+ spec), `panneaux/zones/panneau-zones.component.ts`, `panneaux/zones/capture.component.ts` (+ spec), `data/zones-custom.api.ts` (`capturer` : champ `recette` facultatif), `app/api/custom-geo/capture/route.ts`, `tests/unit/angular/panneau-analyse-garde.test.ts`, `logique/parcours.ts` (consigne de ④)
- Test: `tests/unit/api/capture-recette.test.ts` (créé)
- Doc: `ARCHITECTURE.md` (route capture), README carte

**Interfaces:**
- Consumes: le bloc « Analyse spatiale » de `panneau-analyse.component.ts:75-110` (mode de transport, `mg-outil-bataille-v2`, `mg-outil-isochrones`) et ses gestionnaires (`verifierCacheV1/V2`, `remplirV2`, `lancerV1/V2`, `appliquerBataille`, `verifierPerimetreOutil` pour les deux batailles), `ContexteBatailleService`, `BatailleV1Service`, `BatailleV2Service` (fournis par la page — vérifier dans `carte.page.ts` ; s'ils étaient fournis par le panneau Analyse, les déplacer au même niveau que le nouveau composant).
- Produces:
  - `mg-section-isochrones` : le bloc et ses gestionnaires DÉPLACÉS tels quels (garde comprise), monté dans la section « Autour des POI » de ③ ; `mg-panneau-analyse` ne garde que score, corrélation, clustering.
  - `POST /api/custom-geo/capture` accepte `recette` facultative (`lireRecette`, types autorisés : `isochrone` et `capture` seulement — sinon 400) ; si présente, `update custom_geo_zones set recette = … where id = zoneId` après la création, erreur LUE (`console.error`, la réponse garde la zone : `warning: 'recette_non_enregistree'`, statut 207). React n'envoie pas le champ : comportement inchangé pour lui.
  - `mg-capture` envoie `recette: { v: 1, type: 'isochrone', parametres: { mode, minutes, version } }` quand la couche capturée est une bataille, sinon `{ v: 1, type: 'capture', source_type }`.

- [ ] **Step 1: Tests (échec).** `tests/unit/api/capture-recette.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** La capture (route partagée avec React) garde une recette FIGÉE quand l'Angular en envoie une (lot 3, L3-5). */
const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: async () => ({ id: 'u1', role: 'super_admin', organization_id: ORG }),
  authUnauthorized: () => new Response(null, { status: 401 }),
}));
vi.mock('@/lib/campaigns/access', () => ({ resolveOrgWriteAccess: () => true }));
const CARRE = { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43.1], [5, 43]]]] };
const rpcs: string[] = [];
const miseAJour: { valeur: unknown; id: unknown }[] = [];
let echecUpdate = false;
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc(nom: string) {
      rpcs.push(nom);
      const data = ({
        transform_geometries_for_save: CARRE, create_custom_geo_zone: 'z1',
        resolve_custom_geo_zone_codes: { count_cp: 2, count_iris: 5 }, compute_zone_audience_stats: {},
      } as Record<string, unknown>)[nom] ?? null;
      return Promise.resolve({ data, error: null });
    },
    from() {
      return { update(valeur: unknown) { return { eq(_c: string, id: unknown) { miseAJour.push({ valeur, id }); return Promise.resolve({ error: echecUpdate ? { message: 'x' } : null }); } }; } };
    },
  }),
}));
const { POST } = await import('@/app/api/custom-geo/capture/route');

const corps = (extra: Record<string, unknown> = {}) => new Request('http://localhost/api/custom-geo/capture', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Bataille', org_id: ORG, source_type: 'isochrone_battle', geometries: [CARRE], transformation: 'union', ...extra }),
}) as never;
const ISO = { v: 1, type: 'isochrone', parametres: { mode: 'drive', minutes: 15, version: 'v2' } };

beforeEach(() => { rpcs.length = 0; miseAJour.length = 0; echecUpdate = false; vi.spyOn(console, 'error').mockImplementation(() => undefined); });

describe('POST /api/custom-geo/capture — recette facultative', () => {
  it('sans recette : comportement d’avant (React), aucune écriture de recette', async () => {
    const r = await POST(corps());
    expect(r.status).toBe(200);
    expect(rpcs).toEqual(['transform_geometries_for_save', 'create_custom_geo_zone', 'resolve_custom_geo_zone_codes', 'compute_zone_audience_stats']);
    expect(miseAJour).toEqual([]);
  });
  it('recette isochrone : écrite sur la zone créée', async () => {
    const r = await POST(corps({ recette: ISO }));
    expect(r.status).toBe(200);
    expect(miseAJour).toEqual([{ valeur: { recette: ISO }, id: 'z1' }]);
  });
  it('recette d’un type recalculable : 400, rien n’est créé', async () => {
    const r = await POST(corps({ recette: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 5000, perimetre: null } }));
    expect(r.status).toBe(400);
    expect(rpcs).toEqual([]);
  });
  it('écriture de la recette en échec : 207, la zone existe', async () => {
    echecUpdate = true;
    const r = await POST(corps({ recette: ISO }));
    expect(r.status).toBe(207);
    expect(await r.json()).toEqual({ zone_id: 'z1', warning: 'recette_non_enregistree', count_iris: 5, count_cp: 2 });
  });
});
```

`tests/unit/angular/panneau-analyse-garde.test.ts` : il lit le SOURCE de `panneau-analyse.component.ts` pour vérifier le câblage de la garde sur les batailles ; le faire lire AUSSI `panneaux/zones/section-isochrones.component.ts` et exiger que `verifierPerimetreOutil('bataille_v1')` / `('bataille_v2')` y figurent avant `lancerV1`/`lancerV2` (même assertion, autre fichier) ; et que `panneau-analyse.component.ts` ne contienne PLUS `mg-outil-isochrones` ni `mg-outil-bataille-v2`.

`section-isochrones.component.spec.ts` : reprendre À L'IDENTIQUE les cas « bataille » et « isochrones » de `panneau-analyse.component.spec.ts` (Grep `bataille` / `isochrones` dans cette spec), en montant `SectionIsochronesComponent` ; les retirer de la spec du panneau Analyse.

`capture.component.spec.ts` : une capture dont la couche contributive est une bataille envoie `recette.type === 'isochrone'` ; une capture de Voronoï envoie `{ v: 1, type: 'capture', source_type: 'voronoi_cells' }`.

- [ ] **Step 2: FAIL** — `npx vitest run --project unit tests/unit/api/capture-recette.test.ts tests/unit/angular/panneau-analyse-garde.test.ts` ; `cd angular && npx ng test --watch=false --include='**/section-isochrones.component.spec.ts' --include='**/panneau-analyse.component.spec.ts' --include='**/capture.component.spec.ts'`.

- [ ] **Step 3: Implémenter** — DÉPLACER (couper-coller, pas réécrire) le bloc et ses méthodes ; `mg-section-isochrones` affiche son propre bandeau de garde (`gardeMessage`, même `linkedSignal` que le panneau Analyse).

Dans `app/api/custom-geo/capture/route.ts` : ajouter `recette: z.unknown().optional(),` à `CaptureSchema`, puis, juste après le contrôle `resolveOrgWriteAccess` (AVANT toute RPC) :

```ts
  // Lot 3 : la capture garde une recette FIGÉE (isochrone ou capture) ; React n'envoie pas le champ.
  let recette: Recette | null = null;
  if (parsed.data.recette !== undefined) {
    const lue = lireRecette(parsed.data.recette);
    if (!lue.ok || (lue.recette.type !== 'isochrone' && lue.recette.type !== 'capture')) {
      return NextResponse.json({ error: 'Recette invalide pour une capture.' }, { status: 400 });
    }
    recette = lue.recette;
  }
```

et, juste avant le `return NextResponse.json({ zone_id: zoneId, … })` final :

```ts
  if (recette) {
    const { error: recetteError } = await supabase.from('custom_geo_zones').update({ recette: toJson(recette) }).eq('id', zoneId);
    if (recetteError) {
      console.error('[custom-geo/capture] recette', recetteError.message);
      return NextResponse.json(
        { zone_id: zoneId, warning: 'recette_non_enregistree', count_iris: resolved.count_iris ?? 0, count_cp: resolved.count_cp ?? 0 },
        { status: 207 },
      );
    }
  }
```

Imports : `import { lireRecette } from '@/lib/zones/recette-schema';` et `import type { Recette } from '@/lib/zones/recette';`. Cette route lit son corps par `request.json()` puis `safeParse` : elle satisfait déjà `tests/unit/api/validation-corps.test.ts` ; ne pas la réécrire en `lireCorps` dans ce lot (React l'emploie, hors sujet).

Consigne de ④ (`logique/parcours.ts`) : « Calculez sur vos zones : score, corrélation, clustering. Chaque résultat s'affiche sur la carte. »

- [ ] **Step 4: PASS** — suites unitaires racine et Angular entières ; build Angular (sortie séparée).
- [ ] **Step 5: Preuve navigateur** — ③ « Autour des POI » : bataille V2 sur les CIRFA (espace Marine nationale, périmètre une région) → capture → la zone porte la recette `isochrone` (`select recette from custom_geo_zones order by created_at desc limit 1`) ; ④ n'a plus le bloc ; la garde « Choisissez un périmètre » s'affiche dans ③ sans filtre.
- [ ] **Step 6: Doc + commit** — `refactor(angular): isochrones et bataille passent de ④ à ③ ; la capture garde sa recette`.

---

### Task 12: « Mes zones » montre la recette et recalcule ; preuve et documentation du lot

**Files:**
- Modify: `angular/src/app/features/carte/panneaux/zones/carte-zone.component.ts` (+ spec), `panneaux/zones/mes-zones.component.ts` (+ spec), `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md`, l'inventaire « aucune fonction perdue » du lot 1 (Grep `INVENTAIRE` dans `angular/src/app/features/carte` : ajouter les entrées des recettes et retirer isochrones/bataille de ④ pour les placer en ③)
- Test: specs ci-dessus ; inventaire

**Interfaces:**
- Consumes: `ZoneCustomResume.recette` (Task 9), `libelleRecette`, `estRecalculable` (Task 2), `ZonesApi.recalculer` (Task 9), `messageErreurZone`.
- Produces: `mg-carte-zone` : une ligne `data-recette` (`libelleRecette(zone.recette)` ou « Forme figée » si `recette` est `null`) ; un bouton « Recalculer » (`data-recalculer`) quand `estRecalculable`, sortie `recalculer = output<void>()` ; `mg-mes-zones` : `recalculer(id)` → `ZonesApi.recalculer(id)`, ligne `enCours`, puis relit la liste ; 409 `zone_referencee` → le message de la route dans le bandeau d'erreur existant ; 207 → message de résolution.

- [ ] **Step 1: Specs (échec)** — `carte-zone.component.spec.ts` : zone avec `recette: { v: 1, type: 'rayon_poi', … }` → `[data-recette]` = « Rayon de 5 km autour des POI « lycee » » et `[data-recalculer]` présent ; zone `recette: null` → « Forme figée », pas de bouton ; zone `{ type: 'dessin' }` → « Dessin à main levée », pas de bouton. `mes-zones.component.spec.ts` : clic « Recalculer » → `ZonesApi.recalculer('z1')` puis relecture (`ZonesCustomApi.lister` rappelé une fois) ; 409 → `[data-erreur]` = « Cette zone est utilisée par un plan : dupliquez-la avant de la recalculer. » ; deux clics rapides → un seul appel (bouton désactivé pendant le vol).
- [ ] **Step 2: FAIL** — `cd angular && npx ng test --watch=false --include='**/carte-zone.component.spec.ts' --include='**/mes-zones.component.spec.ts'`.
- [ ] **Step 3: Implémenter** — dans `carte-zone.component.ts`, sous le nom de la zone :

```html
<div data-recette class="truncate text-[11px] text-tertiary">{{ recette() }}</div>
@if (recalculable()) {
  <button type="button" data-recalculer [disabled]="enCours()" (click)="recalculer.emit()"
    class="cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-2 py-1 text-[11px] text-secondary hover:border-hover hover:bg-elevated hover:text-primary disabled:cursor-not-allowed disabled:opacity-40">Recalculer</button>
}
```

avec `protected readonly recette = computed(() => { const r = this.zone().recette; return r ? libelleRecette(r) : 'Forme figée'; })`, `protected readonly recalculable = computed(() => { const r = this.zone().recette; return !!r && estRecalculable(r); })`, `readonly recalculer = output<void>()`. Dans `mes-zones.component.ts`, `(recalculer)="recalculer(l.zone.id)"` et :

```ts
  private readonly zonesApi = inject(ZonesApi);
  protected readonly recalculs = signal<ReadonlySet<string>>(new Set());

  protected recalculer(id: string): void {
    if (this.recalculs().has(id)) return;
    this.recalculs.update((s) => new Set(s).add(id));
    this.erreur.set(null);
    this.zonesApi.recalculer(id).subscribe({
      next: () => { this.retirerRecalcul(id); this.relecture.update((n) => n + 1); },
      error: (e: { status?: number; error?: unknown }) => { this.retirerRecalcul(id); this.erreur.set(messageErreurZone(e)); },
    });
  }

  private retirerRecalcul(id: string): void {
    this.recalculs.update((s) => { const c = new Set(s); c.delete(id); return c; });
  }
```

(`enCours` de la ligne : `l.enCours || recalculs().has(l.zone.id)` dans `lignes()`.) Le fichier reste < 400 lignes.

- [ ] **Step 4: PASS + vérification complète** — sans pipe : `npx tsc --noEmit` ; `npm run test:unit` ; `npm run test:integration` ; `cd angular && npx ng test --watch=false` ; `cd angular && npm run build -- --output-path=/tmp/ng-lot3` ; `npm run lint`.
- [ ] **Step 5: Preuve navigateur du lot** (`:4202`, BMW GROUP puis Marine nationale, deux thèmes) — les cinq cas du Review Focus, un par un, chacun capturé : (1) France → refus dit, aucune requête lourde (onglet Réseau) ; (2) recalcul d'une zone rattachée à une stratégie → 409 dit ; (3) KML avec trou + point, puis GeoJSON de 25 000 sommets → message ; (4) aperçu lancé puis changement d'espace → rien de l'ancien espace ; ③ → ① → ③ → aperçu gardé ; (5) super admin dans un espace non membre → 207 dit. Puis : « Recalculer » une zone `seuil_carreaux` libre → la forme se redessine.
- [ ] **Step 6: Doc + commit** — `ARCHITECTURE.md` (§ zones custom : « une zone = une recette », les trois routes, la colonne, les cinq RPC, les plafonds, le constat `geom_centroid`) ; README carte (③ par familles, `AtelierZoneService`) ; spec : ajouter « Écarts à la livraison du lot 3 » à la fin du § 16 (sur `feat/angular-lot0`, commit `docs(spec)` séparé par le contrôleur) ; `feat(angular): Mes zones — la recette affichée, recalculer ; preuve du lot 3`.

---

## Lots suivants — sommaire (plans détaillés à écrire à la fin du lot précédent)

Découpage de la spec § 16.5. Chaque lot se termine par `ARCHITECTURE.md` à jour et une preuve navigateur dans les deux thèmes.

### Lot 4 — ④ Couverture générique (dépend du lot 3)

Objectif : chiffrer N'IMPORTE QUELLE zone (population, cible) sur sa forme TELLE QUELLE ou découpée par CP ou IRIS, sans la convertir ; brancher les analyses existantes sur « la zone choisie ».
1. Caractérisation : figer les chiffres actuels de la couverture du module risque (`couverture_carreau_risque`, Seveso France : 1 102 CP retenus, 73,1 % d'utile) AVANT toute réécriture.
2. RPC `couverture_geometrie(p_zone_id, p_cible, p_decoupage: 'forme'|'cp'|'iris') → jsonb` : carreaux par `ST_Centroid(geom_3857)` dans la zone subdivisée, CP par `cp_des_points` (sql/228), IRIS par `ST_PointOnSurface` ; jumelle `jsonb` (6 187 CP / 49 448 IRIS > 1 000) ; mesures ARA.
3. Route `GET /api/zones/[id]/couverture?cible=&decoupage=` (quota, cache par `updated_at` de la zone).
4. Angular : `mg-analyse-couverture` en ④ (sélecteur de zone, de cible, de découpage ; tableau par territoire ; vignette carte).
5. Couverture par rayon du risque généralisée à tout type de POI (anneaux par valeur d'un champ, Q3) ; `carte/risques` redirige vers ③/④ quand la parité est prouvée.
6. Score, clustering, Voronoï, corrélation : entrée « zone choisie » en plus du périmètre (aucun retrait).
7. Preuve, doc, inventaire.

### Lot 5 — ⑤ Jeu de zones multi-plateformes (dépend du lot 4)

Objectif : figer ce qui sera acheté ; l'utilisateur choisit la maille plateforme par plateforme ; la perte est chiffrée.
1. Table `plateformes_geo` (plateforme, maille, limites, lien doc officielle, `verifie_le`, `a_verifier`) + seed du relevé du 14/10 (mémoire `reference_dsp_maille_geo`) ; lecture `GET /api/zones/plateformes`.
2. Caractérisation Seveso du moteur `remplir_zone_set_cp` / `appliquer_seuil_zone_set` (simulation 62 → 89).
3. `zone_sets` généralisé : `profil`/`gravites`/`natures` facultatifs, `zone_set_cp.classe/cluster_id` facultatifs, source = une ou plusieurs zones à recette ; remplissage par `couverture_geometrie` (lot 4).
4. Mailles par plateforme : forme exacte (TTD si Q-A), CP pondérés (DV360), cercles, communes/départements (TikTok) ; perte chiffrée (diffusion hors zone, habitants manqués) pour chacune.
5. Brique `paver_cercles(geom, rayon_min, rayon_max, n_max, pop_min) → jsonb` (pavage d'un polygone sous contraintes Meta ≤ 200, DV360 ≥ 1 km et ≥ 1 000 hab.) ; mesures.
6. Angular : l'étape ⑤ (« bientôt » remplacé) — une colonne par plateforme, sélecteur de maille, lien doc, perte ; enregistrer, extraire (versions, sql/231).
7. Preuve, doc.

### Lot 6 — Exports natifs depuis le jeu de zones (dépend du lot 5)

Objectif : des fichiers prêts pour TTD, Meta, DV360 cercles, TikTok, sans campagne.
1. TTD : GeoJSON des polygones (si Q-A), liste lat/long + rayon, liste de CP.
2. Meta : ≤ 200 cercles (paliers), CP si Q-C confirmé.
3. DV360 : liste de proximité (cercles ≥ 1 km) en plus du CP/SDF existant.
4. TikTok : communes / départements en paliers (seuil 1 000 personnes, fusion des paliers trop petits).
5. Pré-vol réglementaire (politique Meta/TikTok UE, catégories sensibles Meta, facteurs TTD non empilés), lu dans `plateformes_geo`.
6. `GET /api/zones/jeux/[id]/export?plateforme=&maille=` ; Angular : bouton par plateforme dans ⑤.

### Lot 7 — ⑥ Plan et ⑦ Activation en Angular (dépend du lot 6)

Objectif : la boucle ① → ⑦ en Angular, au CP comme aujourd'hui.
1. Sélecteur de campagne dans la barre (⑥-⑧, Q2).
2. Portage du wizard en sections (Cible = extraction, Plateformes et budget, Pression, Stratégie), skill `porting-react-to-angular`, parité verrouillée.
3. Portage d'`ActivationPanel` : une carte par plateforme, pré-vol, push DV360 (NDJSON), téléchargement, historique, annulation.
4. Connexion API de l'ESPACE ACTIF ; « Dupliquer vers un autre espace » dans Connexions API (admin, lot 6 Angular).
5. React gelé : overlay campagne marqué « remplacé » (retrait après le lot 8, Q5).

### Lot 8 — ⑧ Live (dépend du lot 7 ; peut démarrer après le lot 1)

Objectif : le Suivi V2 en Angular, au CP. Portage de `components/campagne/suivi-v2/*` (alignement, constats, coût et rythme, trio de cartes, qui a diffusé, pression par classe, réconciliation), lecture des rollups existants (aucun `refresh_campaign_rollups` à l'ouverture), « Recaler » → extraction v+1. Corrélation déplacée en ⑧ (Q1).

### Lot 9 — Plan et suivi au-delà du CP (dépend des lots 7 et 8)

Objectif : ⑥ et ⑧ dans la même unité que ⑤ (polygone, cercle, commune). Refonte de `refresh_campaign_rollups` et de `calculer_alignement_geo` par unité ; rollups par unité ; vignettes et constats par unité ; caractérisation CP d'abord.

### Lot 10 — Zones météo dynamiques (si Q-D les sort du hors champ ; dépend des lots 3, 5, 9)

Objectif : une recette « zone pluvieuse » (prévisions Open-Meteo stockées), recalculée par cycle (Inngest), nouvelle extraction par cycle, suivi recalé.

### Lot 11 — Catalogue et groupes (ex-lot 8 ; dépend du lot 2, indépendant du reste)

Inchangé : `catalogue_jeux`, droits sur les indicateurs (abstention → Bercy), fiche catalogue, groupes d'espaces dans Accès.

---

## Registre d'exécution

À tenir dans `.superpowers/sdd/2026-10-14-carte-lot-3/progress.md` (non suivi), même format que le registre des lots 1-2 : une ligne par dispatch, implémentation, revue, ruling (avec « coût si faux »), et les mesures EXPLAIN de chaque migration.
