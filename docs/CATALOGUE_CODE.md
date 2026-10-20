# Catalogue du code

> Fichier **généré** par `npm run catalogue` (`scripts/catalogue.mjs`, via `knip`).
> Ne JAMAIS éditer ce fichier à la main — toute modification manuelle sera écrasée au
> prochain lancement, et une correction faite ici mentirait dès le prochain import.
>
> Généré le 2026-10-17 — commit `108d690d`.

## Totaux

- Exports morts : 140
- Fichiers morts : 0
- Dépendances inutilisées : 2

`tests/unit/docs/catalogue-code.test.ts` verrouille « Exports morts » avec un cliquet : la baisse est libre, la hausse fait échouer le test.

## Fichiers morts

_Aucun._

## Exports et types morts, par fichier

Trié par nombre d’occurrences décroissant.

| Fichier | Occurrences | Exports | Types |
|---|---|---|---|
| `lib/strategy-wizard/multiplier.ts` | 14 | computeMultiplier, inferTier, MULTIPLIER_COLOR_SCALE, colorForMultiplier, labelForMultiplier, plainFrenchForMultiplier, TIER_LABELS_FR, TIER_COLORS | Tier, WeightingMode, InZoneWeights, OutZoneWeights, SubzoneInput, MultiplierColorStop |
| `components/ui/sheet.tsx` | 7 | SheetPortal, SheetOverlay, SheetClose, SheetHeader, SheetFooter, SheetTitle, SheetDescription | — |
| `lib/campaigns/channels.ts` | 6 | PlatformLinksSchema, linksComplete, linksSummary | LinkLevel, PlatformLinks, ChannelCategory |
| `components/ui/dialog.tsx` | 6 | DialogPortal, DialogOverlay, DialogTrigger, DialogClose, DialogFooter, DialogDescription | — |
| `lib/isochrones/fetcher.ts` | 5 | ORS_MAX_RETRIES, ORS_RETRY_DELAY, ORS_DELAI_MS, fetchIsochrones | IsochroneCacheCtx |
| `lib/geo/locations.ts` | 5 | VILLES, CITY_BASE_RADIUS, REGIONS, getCoordsForVille, getCoordsForRegion | — |
| `lib/meteo/types.ts` | 5 | — | GridPoint, MeteoSquare, MeteoMeta, MeteoSummary, MeteoApiResponse |
| `lib/import/types.ts` | 4 | INSEE_CARREAUX_INDICATORS | ImportConfig, DryRunStats, LogLevel |
| `lib/campaigns/suivi-metrics.ts` | 4 | — | SuiviAlert, SuiviLevel1Row, SuiviDeptRow, SuiviMedia |
| `app/admin/sources/_hooks/usePoiAdmin.ts` | 3 | emptyPoiForm | PoiForm, PoiModalState |
| `lib/dsp/report/index.ts` | 3 | selectReporter | DspReportRow, DspReporter |
| `components/ui/GeoSkeleton.tsx` | 3 | SkeletonCard, SkeletonChart, SkeletonMap | — |
| `types/spatial.ts` | 3 | — | BattleData, GeoJSONFeatureCollection, SpatialResult |
| `components/ui/button.tsx` | 2 | buttonVariants | ButtonProps |
| `components/ui/badge.tsx` | 2 | badgeVariants | BadgeProps |
| `components/ui/table.tsx` | 2 | TableFooter, TableCaption | — |
| `app/map/_lib/constants.ts` | 2 | applyChoropleth, CATEGORY_COLORS | — |
| `app/map/_components/CivicIndicatorsLayer.tsx` | 2 | CIVIC_VARIABLES, getCivicLegendStops | — |
| `lib/dsp/dv360/auth.ts` | 2 | DV360_SCOPES, buildOAuthClient | — |
| `lib/demo/constants.ts` | 2 | PERIOD_LEN_DAYS, CALENDAR_START | — |
| `lib/dsp-mapping/loader.ts` | 2 | listAvailableDsps, invalidateMappingsCache | — |
| `lib/import/schemas.ts` | 2 | MappageChampsSchema, ConfigGeoSchema | — |
| `lib/iris-crawler/parser.ts` | 2 | GEO_COLUMNS, classifyColumns | — |
| `lib/donnees/registre-fraicheur.ts` | 2 | — | CoutMesure, JournalSource |
| `lib/dsp/validation.ts` | 2 | — | Dv360ConnectInput, Dv360OAuthConfigInput |
| `lib/dsp/report/types.ts` | 2 | — | ReportStatus, DspReportRow |
| `components/campagne/BarreContexteCampagne.tsx` | 1 | libellePeriode | — |
| `lib/version.ts` | 1 | APP_NAME | — |
| `lib/auth.ts` | 1 | createServerClient | — |
| `lib/api/rate-limit.ts` | 1 | getClientKey | — |
| `lib/geo/region-lookup-server.ts` | 1 | invalidateRegionCache | — |
| `lib/http/lecture-avec-reprise.ts` | 1 | ATTENTE_MAX_MS | — |
| `lib/meteo/requete.ts` | 1 | ARCHIVE_CUTOFF | — |
| `lib/import/column-detector.ts` | 1 | normalizeColumnName | — |
| `lib/iris-crawler/db-columns.ts` | 1 | getCoreColumnType | — |
| `lib/campagne/constats.ts` | 1 | SEUIL_ECART_SIGNALE_PCT | — |
| `components/campagne/suivi-v2/TableauDeregles.tsx` | 1 | LIGNES_MAX | — |
| `lib/dsp-mapping/parser.ts` | 1 | parseRow | — |
| `lib/campaigns/platform-links.ts` | 1 | PlatformLinksSchema | — |
| `lib/civic-health/atmofrance-client.ts` | 1 | AASQA_REGION_CODES | — |
| `lib/pacing/rebid.ts` | 1 | REBID_EPSILON | — |
| `lib/geo/dept-lookup-server.ts` | 1 | invalidateDeptCache | — |
| `lib/civic-health/provider.ts` | 1 | _resetProvider | — |
| `lib/metrics-display/loader.ts` | 1 | invalidateMetricsCache | — |
| `app/map/_components/filter-panel/styles.ts` | 1 | hexToRgb | — |
| `lib/dsp-mapping/transformer.ts` | 1 | listKnownTransforms | — |
| `lib/dsp/push/simulated.ts` | 1 | buildPayloadSummary | — |
| `lib/import/sheet-common.ts` | 1 | dedupeHeaders | — |
| `lib/metrics-display/types.ts` | 1 | UnknownMetricError | — |
| `components/campaign/_shared.tsx` | 1 | SH | — |
| `components/ui/input.tsx` | 1 | — | InputProps |
| `lib/logger.ts` | 1 | — | Logger |
| `types/admin.ts` | 1 | — | HealthCheck |
| `app/admin/import/_components/GeocodeStep.tsx` | 1 | — | GeocodeFilter |
| `lib/supabase/tables.ts` | 1 | — | TableUpdate |
| `types/campaign.ts` | 1 | — | DspCampaign |
| `lib/civic-health/civic-ingest.ts` | 1 | — | CivicDatasetSummary |
| `lib/campagne/vignette-carte.ts` | 1 | — | Maille |
| `lib/campaigns/actor-metrics.ts` | 1 | — | ActorsPayload |
| `lib/dsp-mapping/types.ts` | 1 | — | TargetLocation |
| `lib/campaigns/reconciliation-metrics.ts` | 1 | — | ReconChannelRow |
| `lib/demo/pilot-types.ts` | 1 | — | PilotItem |
| `lib/dsp/push/types.ts` | 1 | — | PushStatus |
| `lib/qualite/verdict.ts` | 1 | — | Verdict |
| `lib/report/types.ts` | 1 | — | ReportHeader |
| `lib/radio/import-logger.ts` | 1 | — | LogEntry |
| `lib/meteo/use-meteo-data.ts` | 1 | — | MeteoProgress |
| `app/map/_components/filter-panel/use-poi-catalog.ts` | 1 | — | PoiType |
| `app/map/_components/filter-panel/use-poi-styles.ts` | 1 | — | PoiStyleEntry |
| `app/map/_components/filter-panel/use-civic-ingest.ts` | 1 | — | CivicIngestState |
| `app/map/_components/filter-panel/use-isochrone-battle.ts` | 1 | — | CacheStatusValue |
| `lib/radio/types.ts` | 1 | — | RadioStreamEvent |

## Dépendances déclarées jamais importées

`devDependencies` :

- `@typescript-eslint/eslint-plugin`
- `@typescript-eslint/parser`

## Doublons d’export (même valeur exportée sous deux noms)

Informationnel — pas comptabilisé dans « exports morts » : un alias assumé n’est pas mort.

- `lib/iris-crawler/db-columns.ts` : IRIS_DB_COLUMN_NAMES / CORE_COLUMN_NAMES
