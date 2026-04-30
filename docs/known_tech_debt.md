# Known tech debt — GEOMATIK

> Date : 2026-04-30 · Référencé par chantier A4.6.2

Ce document liste **la dette technique connue et reportée** du projet, pour
qu'un dev externe sache où sont les zones sensibles avant d'y toucher.

## 1. Trois fichiers > 2000 lignes (refactor reporté)

Décision produit chantier A4.6.2 (D3) : ces 3 fichiers ont reçu un cleanup
interne (any → typage, console.log à migrer, naming) mais **n'ont pas été
splittés** en sous-composants. Le risque de régression pitch est trop élevé.

### `app/map/_components/FilterPanel.tsx` — 3789 lignes

**Pourquoi c'est gros** : composant central de la carte `/map` qui orchestre
TOUS les filtres + les résultats des analyses. Onze sections logiques internes
(POI / IRIS / Battle / Voronoi / Coverage / Corrélation / Scoring / Carreaux /
TMJA / Radio / Meteo) qui partagent énormément de state.

**Risque refactor** : casser un sub-flow (ex: bataille V2 + custom zone +
isochrone) qui croise plusieurs sections.

**Stratégie de refactor future (à faire dans chantier dédié)** :
1. Extraire chaque section en `_components/<Section>Filter.tsx` avec props
   stables (callbacks parents)
2. Lifter le state commun dans un context `<FilterPanelContext>` plutôt que
   ~150 props
3. Cibler ~600 lignes de wrapper + 11 fichiers de ~250 lignes chacun
4. **Smoke E2E manuel après chaque extraction** (cf risques.md A4.6.2 ⚠️ #2)

**Effort estimé** : 1 chantier dédié 8-10 h Claude Code + tests E2E par Vince.

---

### `app/admin/sources/page.tsx` — 2831 lignes

**Pourquoi c'est gros** : page back-office qui gère toutes les Data Sources
GEOMATIK (POI, OOH, panneaux, radio, INSEE, etc.) avec 3 tabs (Liste / Détail /
Imports) et un CRUD complet par source.

**Risque refactor** : casser le flow d'import / export / suppression d'une
source (utilisé en prod admin).

**Stratégie de refactor future** :
1. Extraire chaque tab : `_components/SourcesListTab.tsx` /
   `_components/SourceDetailTab.tsx` / `_components/SourceImportsTab.tsx`
2. Extraire les handlers CRUD : `_lib/sources-actions.ts` (createSource,
   updateSource, deleteSource, exportSourceCSV)
3. Cibler ~400 lignes orchestrateur + 3 tabs ~700 lignes chacun
4. Smoke test : login admin → ouvrir chaque tab → faire un cycle CRUD complet

**Effort estimé** : ~6-8 h Claude Code.

---

### `app/map/page.tsx` — 2329 lignes

**Pourquoi c'est gros** : page principale carte qui :
- Tient ~70 `useState` en top-level (battle, radio, meteo, coverage, etc.)
- Gère 7 overlays (IconBar items)
- Centralise les query params (?customZone, ?layer=digital, etc.)
- Wire les hooks `useMapInit`, `useMapLayers`, `useChatControls` etc.

**Risque refactor** : casser un overlay ou une URL handler — le map est la
page la plus testée du pitch.

**Stratégie de refactor future** :
1. Extraire les `useState` thématiques dans des hooks dédiés :
   `useBattleState()`, `useRadioState()`, `useMeteoState()`
2. Extraire les handlers query params dans `_lib/url-state.ts`
3. Cibler ~600 lignes orchestrateur principal + 5-6 hooks ~150 lignes chacun
4. Smoke E2E pitch flow systématique (cliquer chaque icône IconBar, tester
   chaque overlay)

**Effort estimé** : ~8-10 h Claude Code.

---

## 2. Console.log → logger migration (149 occurrences) — chantier A4.6.2-B partiel

Le wrapper `lib/logger.ts` a été créé en sous-phase B (commit
[ecd4dc9](#)). La migration des 149 occurrences `console.log/debug/info`
vers `logger.info/warn/error/debug` n'a pas été effectuée car chaque
call site nécessite une décision sémantique (debug vs prod-info vs warn)
qu'un sed bulk ne peut pas prendre safely.

**Pattern attendu pour la migration** :
```ts
// Avant
console.log('[campaigns] fetch status:', res.status);

// Après
import { logger } from '@/lib/logger';
logger.info('campaigns', `fetch status ${res.status}`);
```

**Effort estimé** : ~3-4 h Claude Code, 1 commit atomique. Tester `pnpm
build && tsc && lint` après.

---

## 3. xlsx → exceljs (vuln HIGH sans fix officiel)

Voir `docs/cleanup/deps_audit.md`. `xlsx` (SheetJS) a 2 vulnérabilités HIGH
publiées sans fix dispo (prototype pollution + ReDoS). Utilisé pour les
imports/exports Excel dans `/admin/import-poi`, `/admin/carreaux-import`,
`scripts/`.

**Migration** : `exceljs` est compatible API et activement maintenu.

**Effort estimé** : ~4-6 h Claude Code (audit imports/exports, tests E2E des
flows d'import).

---

## 4. Routes API sans auth explicite (40 routes)

Voir `docs/cleanup/security_audit.md` section 1.5. Sur 189 routes, 53 ont
été détectées sans `requireAuth/requireAdmin` ; 12 sont légitimement
publiques (webhooks Inngest, MVT tiles, INSEE open-data) ; **40 restent à
classer cas par cas** : ajouter l'auth ou justifier la public-ness en
commentaire.

**Effort estimé** : ~3-4 h Claude Code, 1 commit dédié.

---

## 5. Table sans PRIMARY KEY : `carreaux_1km`

Voir `docs/cleanup/db_audit.md`. Une seule table métier sans PK détectée.
À investiguer : table d'agrégat possiblement régénérée ; vérifier qu'aucun
UPSERT non-keyé ne dépend de cette absence.

**Effort estimé** : ~1 h (audit + migration `add_pk_carreaux_1km.sql`).

---

## 6. Sous-phase C de A4.6.2 (refactor 500-1500 lignes)

25 fichiers entre 500 et 1500 lignes listés dans
`docs/cleanup_targets_phase2.md`. Le splitting de chacun est un risque
modéré : 1 fichier à la fois, smoke E2E manuel par Vince après chaque
extraction.

**Effort estimé** : ~6-8 h Claude Code (1-3 sessions selon la rigueur du
smoke E2E entre chaque fichier).

---

## Résumé des effort estimés

| Item | Effort | Risque pitch |
|---|---|---|
| FilterPanel split | 8-10 h | élevé |
| sources/page split | 6-8 h | medium |
| map/page split | 8-10 h | élevé |
| console.log migration | 3-4 h | faible |
| xlsx → exceljs | 4-6 h | faible |
| 40 routes API auth | 3-4 h | medium |
| `carreaux_1km` PK | 1 h | nul |
| 25 fichiers 500-1500 split | 6-8 h | medium |
| **Total dette identifiée** | **~40-50 h** | — |

Chaque item est isolable et peut faire l'objet d'un chantier dédié indépendant.
