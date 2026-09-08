# Audit des pipelines d'import — 2026-07-02

> ⚠️ **PARTIELLEMENT PÉRIMÉ — relu le 2026-09-08.** Ne pas s'y fier seul ;
> la carte à jour est `docs/PLAN_SAAS.md`. Ce qui a changé depuis :
> • **C2 (IRIS, colonnes jetées) : corrigé aux trois quarts.** Le RPC
>   `update_iris_core_batch` a été regénéré ; `taux_pauvrete`, `indice_gini` et
>   `rev_d1` sont remplis à 14 480 / 16 404. **`nb_emplois` reste à 0** — seul
>   reliquat du constat.
> • **C4 et C6 (panneaux, OOH) : résolus** en 07/2026, pipeline
>   `integration-panneaux` supprimé.
> • **C3 (`ref_codes_postaux` sans pipeline) : toujours vrai** — 6 187 lignes en
>   base, consommées par les RPC d'analyse digitale, aucune route pour les
>   régénérer.
> • **C1 (carreaux, post-traitements non orchestrés) : SANS OBJET.** Mesuré le
>   08/09 : `metadata`, `geom_3857` et les agrégats 2/5/20 km sont peuplés et
>   utilisés ; `carreaux_1km` et les colonnes `ind*` sont vides mais **rien ne
>   les lit** (`get_tile` lit le JSONB au zoom fin). Orchestrer coûterait
>   2,3 M d'UPDATE sur Nano pour zéro bénéfice — voir `docs/PLAN_SAAS.md` §4ter.
> • Le pipeline `iris-import/insee` décrit ici a été **supprimé le 08/09**.

> Audit read-only (protocole cleanup-geomatik). 4 agents d'exploration code + vérification de l'état réel de la base (volumétries, historiques d'imports). Aucune modification effectuée.

## Verdicts par pipeline (code × données)

| # | Pipeline | Code | Données en base | Verdict |
|---|----------|------|-----------------|---------|
| 1 | **Carreaux Filosofi** (`/admin/carreaux-import` → `import-geo`) | Chaîne principale câblée, UI avec progression % / ETA / logs | 2 298 582 lignes (4,6 GB), 0 erreur (12/03) + agrégats 2km/5km/20km/lookup peuplés | ⚠️ **A fonctionné UNE fois, à la main** — post-traitements non orchestrés (voir C1) |
| 2 | **POI universel** (`/admin/import` → `import-poi/*`) | Complet : parse → dry-run → geocode → execute SSE, batch 50 | `poi_france` 291k lignes, 3 imports tracés OK | ✅ **FONCTIONNEL** (réserve : geocode batch sans progression) |
| 3 | **OOH ArcGIS** (`/admin/ooh-import`) | Upsert documenté mais `.insert()` codé → ré-import cassé, compteurs MAJ/doublons morts | `global_ooh` 1 434 lignes, 1 seul run (Brest, 09/03) | 🔴 **SUSPECT — ré-import cassé** |
| 4 | **Intégration panneaux** (`/integration-panneaux`) | UI mappe 15 champs, n'en envoie que 6 ; l'inserter n'a pas les colonnes régie/réseau/faces/digital/audience | `panneaux_affichage` 938 lignes | 🔴 **INCOMPLET — perte de données silencieuse** |
| 5 | **IRIS crawler** (`/dashboard/iris-crawler`) | 3 pipelines redondants ; stockage disque local **cassé en prod serverless** ; routes sans guard admin | `iris` 49k, imports mars réussis (en dev local) | 🔴 **SUSPECT + perte de données (voir C2)** |
| 6 | **Campagnes DSP** (`/admin/campaigns`) | SSE conforme, batch 50, libs propres — MAIS mapping éditable du preview **ignoré par la route** | 4 campagnes, 344k lignes | ⚠️ **FONCTIONNEL avec leurre UI** |
| 7 | **Radio ANFR/Arcom** (`/admin/radio`) | 3 flux NDJSON aboutis — MAIS upsert N+1 (ODS), batchs 500, debug « Radio Scoop » en prod | 11,8k émetteurs, 1 175 radios, 570k liaisons | ⚠️ **FONCTIONNEL mais fragile (Nano)** |
| 8 | **Réf. La Poste** (`populate-postal`) | Alimente `postal_code_commune` uniquement, aucune progression | 35k lignes OK ; `ref_codes_postaux` 6 187 lignes **sans pipeline** | 🔴 **PARTIELLEMENT CASSÉ (voir C3)** |
| 9 | **data.gouv** (copilote) | NDJSON + barre %, SSRF whitelist OK ; doublons par design au ré-import | alimente `poi_france` | ✅ **FONCTIONNEL** |

## 🔴 Constats critiques (perte de données / cassé)

### C1 — Carreaux : l'import « réussi » n'alimente pas la carte
L'import n'écrit que `metadata` JSONB. Tout l'aval est **orphelin, déclenché à la main** :
- `populateCarreauxColumns` (Inngest) : event `carreaux/populate-columns` **jamais envoyé** par le code
- `scripts/populate_geom_3857.ts` : manuel — sans lui, `geom_3857` reste NULL (tuiles mortes)
- `scripts/populate_carreaux_1km.ts` : manuel, dépend du précédent — **`carreaux_1km` est VIDE en base** (jamais abouti)
- Migration `034` (agrégats 2km/5km) : à exécuter à la main dans le SQL Editor
- ⚠️ Les deux RPC critiques `import_carreaux_batch` et `populate_carreaux_columns` ne sont **versionnées dans aucun .sql** du repo (seule trace : DATABASE.md) — dérive DB↔repo garantie
- L'UI permet de renommer les clés metadata → casserait silencieusement tout l'aval (`metadata->>'ind'`…)
- Bonus : le type `carreaux` de l'Import Universel (`lib/import`) est un **leurre** — exposé dans les types/UI, jamais implémenté (ni validator ni inserter)

### C2 — IRIS : le RPC jette 6 colonnes core en silence
`update_iris_core_batch` (sql/069) n'a pas de clause SET pour `nb_emplois`, `taux_emploi`, `rev_d1`, `rev_d9`, `taux_pauvrete`, `indice_gini` — colonnes ajoutées à la table APRÈS (sql/070-071) sans régénérer le RPC. Les valeurs sont calculées, envoyées, puis **ignorées** — sur les 3 chemins d'import. Les traces `[DIAG]` laissées dans `upload/route.ts` sondent exactement ce symptôme (debug jamais conclu).
Aussi : pipeline crawler (`discover`/`download`/`upload`) **cassé en prod** (staging sur disque local, incompatible lambdas Vercel) ; `upload/route.ts` = doublon dégradé de `manual-import` (sans historique, sans retry, sans auth).

### C3 — `ref_codes_postaux` : consommé par l'analytics Digital, plus aucun pipeline
Les RPC analytics Digital (choroplèthes CP, breakdowns) JOIGNENT sur `ref_codes_postaux`, mais sa route d'alimentation (`import-laposte`) a été **supprimée** (commit 66e7c5c) et ses 3 RPC (`build_ref_codes_postaux`, `truncate_laposte_hexasmal`, `update_laposte_centroids`) sont orphelins. Seul un script SQL manuel peut régénérer. `populate-postal` n'alimente que l'autre référentiel (`postal_code_commune`). **Deux référentiels postaux parallèles.**

> **✅ C4 et C6 résolus le 2026-07-02** (`sql/082_consolidation_panneaux.sql`) :
> le pipeline « Intégration panneaux » (#4) a ensuite été **supprimé** (page
> `/integration-panneaux`, routes `/api/integration-panneaux/*`, branche
> `panneaux` de `lib/import`) — les panneaux s'importent via `/admin/ooh-import`.
> `global_ooh` fusionnée dans `panneaux_affichage` (table unique, 1 434 panneaux),
> upsert ArcGIS réparé (UNIQUE `source, source_ref`, batch 50, compteurs MAJ réels,
> `data_source_id` renseigné). Anciennes lignes CSV (géocodage défaillant : 440/656
> lignes sur 96 positions) sauvegardées dans `panneaux_affichage_backup_csv_20260702`.
> Scores à recalculer via `/api/scoring`.

### C4 — Panneaux : perte silencieuse d'attributs + double magasin
- `integration-panneaux` : les colonnes mappées `nom_regie`, `nom_reseau`, `nb_faces`, `format_digital`, `eclaire`, `audience_vac` ne sont **jamais transmises ni stockées** — l'utilisateur croit les importer
- **Deux tables de panneaux concurrentes** : `global_ooh` (import ArcGIS, lue par `/api/map/ooh`) vs `panneaux_affichage` (intégration CSV, lue par le scoring) — aucune source de vérité unique

### C5 — DSP : mapping éditable fantôme
L'UI du preview envoie `column_mapping` édité ; `import/route.ts` ne le lit jamais. Seuls les mappings DB s'appliquent. Contrat UI↔API rompu en silence.

### C6 — OOH ArcGIS : ré-import cassé
`.insert()` au lieu de l'upsert documenté (`ON CONFLICT source+source_ref`) → ré-import = erreurs en bloc ou doublons ; compteurs MAJ/doublons figés à 0 dans l'UI.

## 🟡 Sécurité

- Routes IRIS `upload`, `manual-upload`, `manual-import`, `delete`, `preview`, `status` : `requireAdmin` importé mais **jamais appelé** (ou absent) → tout utilisateur authentifié peut écraser/supprimer la table `iris`
- `register` (carreaux) : `organization_id` hardcodé `00000000-…-01`

## 🟡 Contraintes Nano violées

- `import-arcom-ods` : upsert **N+1** (~1 174 allers-retours DB)
- Batchs de 500 (règle : 50) : `anfr-import`, `radio-matcher`, `import-ooh`, `import-datagouv`
- `populate-postal` et `geocode/batch` : traitements longs sans progression (règle projet violée)

## 🧹 Opportunités de simplification (objectif : simplifier l'app)

| Cible | Action proposée | Gain |
|-------|-----------------|------|
| IRIS crawler 3-temps (`discover`+`download`+`upload`) | Supprimer (cassé en prod, supplanté par `iris-import/insee` + `manual-*`) | −3 routes, −1 lib storage disque |
| `upload/route.ts` IRIS | Supprimer (doublon dégradé sans auth ni historique) | −1 route à risque |
| Type `carreaux` de `lib/import` | Retirer (leurre jamais implémenté) | −confusion UI |
| `carreaux_1km` (vide) + `poi_metadata_index` (vide) + `isochrone_carreaux_coverage` (quasi vide) | Valider puis dropper | −3 tables mortes |
| Doublon panneaux `global_ooh` vs `panneaux_affichage` | Trancher une source de vérité | −1 table, −1 pipeline |
| Doublon CP `ref_codes_postaux` vs `postal_code_commune` | Trancher OU re-créer le pipeline manquant | cohérence analytics |
| Code debug : `[DIAG]` IRIS, phase « Radio Scoop », bloc DEBUG campagnes, `dataSourceId` mort OOH | Supprimer | hygiène |

## Écarts doc (ARCHITECTURE.md ↔ base réelle)

- Tables radio : `emetteurs_radio` / `radios` (pas `emetteur_radio` / `radio_stations`)
- `poi_france` est une **table** (pas une vue) — 291k lignes
- `carreaux_2km` : 122k lignes (pas ~75k) ; `carreaux_20km` (MV) et `carreaux_commune_lookup` (2,2M) absents de la doc
- `lib/campaigns/**` n'existe plus (remplacé par `lib/dsp-mapping/**`)
