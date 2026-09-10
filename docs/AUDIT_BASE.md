# Audit de traçabilité base — MAGELIAN

> Réalisé le 2026-09-08 via MCP Supabase (projet `vkkdbygwbrxyogqosten`, eu-west-3).
> Objet : réconcilier ce que le code appelle et ce que la base expose, et produire
> `types/database.types.ts`, absent du dépôt jusqu'ici.

## Méthode

1. Extraction de tous les `.rpc('…')` du code TypeScript — **en mode multiligne**,
   voir le piège n° 1 ci-dessous.
2. Ajout des RPC appelées depuis les scripts Python (client `supabase-py` **et**
   appels HTTP directs à `/rest/v1/rpc/<nom>`).
3. Confrontation à `pg_proc` (schéma `public`, hors fonctions appartenant à une
   extension — PostGIS en installe plusieurs centaines).
4. Pour chaque fonction sans appelant apparent : vérification qu'elle n'est pas
   un trigger, appelée par une autre fonction SQL, ou utilisée par une policy RLS.

## Les trois pièges qui faussent ce genre d'audit

Ils ont tous produit des faux positifs au premier passage, corrigés ensuite.

**1. `.rpc(` sur plusieurs lignes.** Un `grep` ligne à ligne rate
`await supabase.rpc(\n  'get_isochrone_battle',`. Quatre fonctions bien vivantes
étaient classées mortes : `get_isochrone_battle`, `compute_zone_audience_stats`,
`merge_iris_indicators_batch`, `resolve_custom_geo_zone_codes`.

**2. Noms de RPC construits dynamiquement.** `app/api/custom-geo/capture/route.ts`
choisit sa fonction par ternaire :
`const createRpc = hasSubzones ? 'create_custom_geo_zone_with_subzones' : 'create_custom_geo_zone'`.
Deux fonctions de plus, invisibles à une recherche de littéraux.

**3. Les scripts Python.** `scripts/scoring/geo_alignment.py` appelle trois RPC
`geo_alignment_*`, et `scripts/export_iris_geojson.py` appelle `export_iris_batch`
par URL REST (`/rest/v1/rpc/export_iris_batch`), sans jamais écrire `.rpc(`.

## Résultat — 92 RPC appelées, 90 existent

### 🔴 Appelées par le code, absentes de la base

| RPC | Appelant | Conséquence réelle |
|---|---|---|
| ~~`get_radio_coverage_geometry`~~ | `app/api/custom-geo/source/radio/route.ts`, exposé par `CaptureLayers.tsx` | **RÉSOLU le 2026-09-10** (`sql/121`). La fonction n'avait jamais été écrite et la route répondait 400 à chaque appel. Elle unit les buffers de `rayon_couverture_m` des émetteurs de la radio, en `geography` (754 émetteurs sont en outre-mer). Mesuré : 1,4 s dans le pire cas — France Inter, 11 836 émetteurs — pour 1 bloc lu. |
| `get_check_constraint_values` | `app/api/admin/roles/route.ts` | Fallback silencieux : la liste des rôles retombe sur la constante `ROLE_LEVELS` du fichier. L'intention (lire les rôles depuis la contrainte CHECK de `profiles`) n'est jamais honorée — le `as never` sur l'appel montre qu'on savait le type absent. |
| `compute_panneau_scores` | `scripts/rescore_all_villes.py` | Le script de rescoring des panneaux est cassé. Ni `compute_panneau_scores` ni `compute_panneau_scores_v2` n'existent en base — alors que `CLAUDE.md` et la skill de cleanup citent `compute_panneau_scores_v2` comme fonction protégée. |

### Fonctions définies en base sans appelant applicatif

Sur ~150 fonctions maison, après élimination des faux positifs :

| Nature | Nombre | Verdict |
|---|---|---|
| Triggers | 11 | normal — `auto_set_geom`, `handle_new_user`, `set_updated_at`, `tg_comptages_set_geom_3857`… |
| Appelées par une autre fonction SQL | 8 | normal — `interpolate_on_curve`, `infer_tier`, `get_carreaux`, `get_campaign_expected`… |
| Utilisées par une policy RLS | 3 | normal et **intentionnel** — `get_user_org`, `get_user_role`, `get_user_orgs` (cf. durcissement SECURITY DEFINER du 06/07, à ne pas « corriger ») |
| Protégées par `CLAUDE.md` | 2 | `clip_rings_to_france` et `get_isochrone_battle_v10` : plus d'appelant, **ne pas y toucher** |
| Réellement sans usage | ~55 | legacy accumulé, voir ci-dessous |

Le legacy se répartit en familles nettes : les v1 remplacées par des v2
(`get_digital_analysis_breakdown`, `get_digital_campaign_map`,
`get_digital_media_heatmap`), les tuiles d'avant `get_tile`
(`get_tile_mvt`, `get_tile_mvt_optimized`, `get_tile_mvt_with_properties`,
`get_tile_tmja`), l'export GeoJSON IRIS d'une route supprimée
(`get_iris_geojson_by_bbox`, `get_iris_geojson_by_codes`), les batches d'import
one-shot (`import_iris_batch`, `create_carreaux_table`, `populate_geom_3857_batch`),
et une poignée d'expérimentations jamais branchées (`get_equity_analysis`,
`geomatik_fill_holes`, `get_poi_near_panneau`, `smart_poi_*`).

**Rien n'a été supprimé en base.** Un `DROP FUNCTION` sur une base de production
demande un arbitrage explicite, et le gain est nul en performance — c'est du bruit
de lecture, pas de la charge.

## Tables `bidding_*` après le retrait de Pilotage ML

13 tables, ~24 MB. Neuf gardent un appelant :

| Table | Lue / écrite par |
|---|---|
| `bidding_strategies` | wizard de campagne, export, `lib/agent/*`, `lib/campaigns/access.ts` |
| `bidding_zone_configs` | `/api/bidding/strategies`, `apply_zone_weights_to_strategy`, `refresh_campaign_rollups` |
| `bidding_strategy_drafts` | autosave du wizard de campagne, `CampaignCockpit` |
| `bidding_strategy_subzones` | `/api/bidding/strategies` (POST/PATCH) |
| `bidding_objectives` | étape Stratégie du wizard, `lib/bidding-ml/metric-labels.ts` |
| `bidding_agent_actions` | GeoAgent (`orchestrator`, `apply-recommendation`, autopilot Inngest) |
| `bidding_drift_events` | GeoAgent (`analyze_drift`), chat campagne |
| `bidding_daily_state` | **lue seulement** par `analyze_drift` — plus aucun écrivain applicatif |
| `bidding_curve_history` | **lue seulement** par `final-report` — plus aucun écrivain applicatif |

Quatre sont désormais orphelines, pour **176 kB au total** :
`bidding_simulations`, `bidding_algorithms`, `bidding_init_presets`,
`bidding_zone_config_proposals`. Le gain à les supprimer est symbolique ;
la décision revient à Vincent.

## `types/database.types.ts`

Généré et versionné (6 684 lignes). En-tête du fichier : commande de régénération
et rappel de le refaire après chaque `apply_migration`.

**Il n'est pas encore branché sur le client Supabase.** Le câblage
(`createClient<Database>(…)` dans `lib/auth.ts`) a été essayé et annulé :
il fait apparaître **106 erreurs de typage réparties sur 60 fichiers**. Ce ne sont
pas des faux positifs — ce sont de vrais écarts que le code masquait :

- nullabilité : la base renvoie `string | null` là où le TS déclare `string | undefined` (50 cas) ;
- `Record<string, unknown>` passé là où la colonne est `jsonb` donc `Json` (insertions DSP) ;
- colonnes obligatoires absentes des objets d'insertion (`country` sur `dsp_campaign_data`).

Les corriger est un chantier à part entière, à faire fichier par fichier avec le
même protocole que les splits. Le fichier de types reste utile dès maintenant
comme référence de lecture du schéma.

## Suites proposées

1. Écrire `get_radio_coverage_geometry` — c'est la seule fonctionnalité
   réellement cassée pour l'utilisateur. Demande une décision produit : quel rayon
   de couverture par `portee` d'émetteur.
2. Trancher `get_check_constraint_values` : créer la fonction, ou assumer la liste
   de rôles en dur et retirer l'appel mort (aujourd'hui on a le pire des deux).
3. Statuer sur `compute_panneau_scores` : soit le script de rescoring est mort et
   part, soit la fonction manque et doit être écrite.
4. Brancher `Database` sur le client Supabase, 106 erreurs à traiter.
5. Éventuellement, `DROP` des 4 tables et des ~55 fonctions sans usage.
