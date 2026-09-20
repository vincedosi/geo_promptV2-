# Catalogue du code

> Fichier **généré** par `npm run catalogue` (`scripts/catalogue.mjs`, via `knip`).
> Ne JAMAIS éditer ce fichier à la main — toute modification manuelle sera écrasée au
> prochain lancement, et une correction faite ici mentirait dès le prochain import.
>
> Généré le 2026-09-20 — commit `122de42`.

## Totaux

- Exports morts : 194
- Fichiers morts : 4
- Dépendances inutilisées : 3

`tests/unit/docs/catalogue-code.test.ts` verrouille « Exports morts » avec un cliquet : la baisse est libre, la hausse fait échouer le test.

## Fichiers morts

Fichiers du périmètre analysé qu’aucun point d’entrée ne référence, directement ou
transitivement.

- `components/map/ClusteringResultsContent.tsx`
- `lib/chat/tools/_shared.ts`
- `lib/iris-crawler/types.ts`
- `lib/metrics-display/useSelectedMetric.ts`

## Exports et types morts, par fichier

Trié par nombre d’occurrences décroissant.

| Fichier | Occurrences | Exports | Types |
|---|---|---|---|
| `lib/strategy-wizard/multiplier.ts` | 14 | computeMultiplier, inferTier, MULTIPLIER_COLOR_SCALE, colorForMultiplier, labelForMultiplier, plainFrenchForMultiplier, TIER_LABELS_FR, TIER_COLORS | Tier, WeightingMode, InZoneWeights, OutZoneWeights, SubzoneInput, MultiplierColorStop |
| `lib/prompting/code-generation/index.ts` | 11 | DV360_PROMPT_SECTION, validateDV360Code, ADFORM_PROMPT_SECTION, validateAdformJSON, TTD_PROMPT_SECTION, validateTTDJSON | DV360Validation, AdformRule, AdformValidation, TTDLine, TTDValidation |
| `components/ui/sheet.tsx` | 7 | SheetPortal, SheetOverlay, SheetClose, SheetHeader, SheetFooter, SheetTitle, SheetDescription | — |
| `lib/prompting/chat-ui/index.ts` | 7 | CodeTabs, DownloadButton | MessageListProps, MessageInputProps, CodeTab, CodeTabsProps, DownloadButtonProps |
| `lib/campaigns/channels.ts` | 6 | PlatformLinksSchema, linksComplete, linksSummary | LinkLevel, PlatformLinks, ChannelCategory |
| `components/ui/dialog.tsx` | 6 | DialogPortal, DialogOverlay, DialogTrigger, DialogClose, DialogFooter, DialogDescription | — |
| `lib/bidding-ml/client.ts` | 5 | predictForStrategy, detectDrift | ExecutionMode, PredictResponse, DriftResponse |
| `lib/meteo/types.ts` | 5 | — | GridPoint, MeteoSquare, MeteoMeta, MeteoSummary, MeteoApiResponse |
| `lib/import/types.ts` | 4 | INSEE_CARREAUX_INDICATORS | ImportConfig, DryRunStats, LogLevel |
| `types/spatial.ts` | 4 | — | BattleData, ChatMessage, GeoJSONFeatureCollection, SpatialResult |
| `lib/campaigns/suivi-metrics.ts` | 4 | — | SuiviAlert, SuiviLevel1Row, SuiviDeptRow, SuiviMedia |
| `app/_components/agent/index.ts` | 3 | useAgent, AgentRecommendationCard, AgentAutonomyBadge | — |
| `lib/isochrones/fetcher.ts` | 3 | ORS_MAX_RETRIES, ORS_RETRY_DELAY, ORS_DELAI_MS | — |
| `app/admin/sources/_hooks/usePoiAdmin.ts` | 3 | emptyPoiForm | PoiForm, PoiModalState |
| `lib/dsp/report/index.ts` | 3 | selectReporter | DspReportRow, DspReporter |
| `components/ui/GeoSkeleton.tsx` | 3 | SkeletonCard, SkeletonChart, SkeletonMap | — |
| `lib/geo/france-admin.ts` | 3 | POI_TYPES, AUDIENCE_METRICS, POI_RAYONS | — |
| `components/ui/button.tsx` | 2 | buttonVariants | ButtonProps |
| `components/ui/badge.tsx` | 2 | badgeVariants | BadgeProps |
| `components/ui/table.tsx` | 2 | TableFooter, TableCaption | — |
| `app/copilote/_lib/constants.ts` | 2 | applyChoropleth, CATEGORY_COLORS | — |
| `app/map/_components/CivicIndicatorsLayer.tsx` | 2 | CIVIC_VARIABLES, getCivicLegendStops | — |
| `lib/meteo/requete.ts` | 2 | ARCHIVE_CUTOFF, daysBetween | — |
| `lib/campaigns/suivi-chat.ts` | 2 | ChatTurnSchema | CampaignChatBody |
| `lib/dsp/dv360/auth.ts` | 2 | DV360_SCOPES, buildOAuthClient | — |
| `lib/prompting/code-generation/adform.ts` | 2 | ADFORM_PROMPT_SECTION | AdformRule |
| `lib/prompting/code-generation/ttd.ts` | 2 | TTD_PROMPT_SECTION | TTDLine |
| `lib/demo/constants.ts` | 2 | PERIOD_LEN_DAYS, CALENDAR_START | — |
| `lib/geo/locations.ts` | 2 | VILLES, REGIONS | — |
| `lib/dsp-mapping/loader.ts` | 2 | listAvailableDsps, invalidateMappingsCache | — |
| `lib/import/schemas.ts` | 2 | MappageChampsSchema, ConfigGeoSchema | — |
| `lib/bidding-ml/comparison.ts` | 2 | aggregateByDate | DailyComparison |
| `lib/bidding-ml/targeting-kpis.ts` | 2 | quantile, selectTargetZones | — |
| `lib/agent/intents/index.ts` | 2 | getIntent, listIntents | — |
| `lib/prompting/rate-limiter.ts` | 2 | getClientKey, rateLimitResponse | — |
| `lib/iris-crawler/parser.ts` | 2 | GEO_COLUMNS, classifyColumns | — |
| `lib/smart-prompt/geo-resolver.ts` | 2 | resolveZoneToBbox | ZoneResolution |
| `lib/donnees/registre-fraicheur.ts` | 2 | — | CoutMesure, JournalSource |
| `lib/agent/types.ts` | 2 | — | ActionRisk, ActionType |
| `lib/dsp/validation.ts` | 2 | — | Dv360ConnectInput, Dv360OAuthConfigInput |
| `lib/smart-prompt/types.ts` | 2 | — | GeoParams, PoiStats |
| `lib/dsp/report/types.ts` | 2 | — | ReportStatus, DspReportRow |
| `lib/chat/tools/types.ts` | 2 | — | BillboardRaw, CarreauRow |
| `components/campagne/BarreContexteCampagne.tsx` | 1 | libellePeriode | — |
| `lib/version.ts` | 1 | APP_NAME | — |
| `lib/auth.ts` | 1 | createServerClient | — |
| `lib/geo/region-lookup-server.ts` | 1 | invalidateRegionCache | — |
| `lib/http/lecture-avec-reprise.ts` | 1 | ATTENTE_MAX_MS | — |
| `lib/dsp-mapping/parser.ts` | 1 | parseRow | — |
| `lib/campaigns/platform-links.ts` | 1 | PlatformLinksSchema | — |
| `lib/campagne/constats.ts` | 1 | SEUIL_ECART_SIGNALE_PCT | — |
| `components/campagne/suivi-v2/TableauDeregles.tsx` | 1 | LIGNES_MAX | — |
| `lib/civic-health/atmofrance-client.ts` | 1 | AASQA_REGION_CODES | — |
| `lib/pacing/rebid.ts` | 1 | REBID_EPSILON | — |
| `lib/demo/rng.ts` | 1 | hashStr | — |
| `lib/geo/dept-lookup-server.ts` | 1 | invalidateDeptCache | — |
| `lib/prompting/code-generation/dv360.ts` | 1 | DV360_PROMPT_SECTION | — |
| `lib/auth/roles.ts` | 1 | ROLES_MEMBRE | — |
| `lib/iris-crawler/db-columns.ts` | 1 | getCoreColumnType | — |
| `lib/demo/controller.ts` | 1 | latestVersion | — |
| `lib/api/safe-path.ts` | 1 | isValidUuid | — |
| `lib/import/column-detector.ts` | 1 | normalizeColumnName | — |
| `lib/civic-health/provider.ts` | 1 | _resetProvider | — |
| `lib/metrics-display/loader.ts` | 1 | invalidateMetricsCache | — |
| `app/map/_components/filter-panel/styles.ts` | 1 | hexToRgb | — |
| `lib/dsp-mapping/transformer.ts` | 1 | listKnownTransforms | — |
| `lib/dsp/push/simulated.ts` | 1 | buildPayloadSummary | — |
| `lib/import/sheet-common.ts` | 1 | dedupeHeaders | — |
| `lib/metrics-display/types.ts` | 1 | UnknownMetricError | — |
| `components/campaign/_shared.tsx` | 1 | SH | — |
| `lib/clustering/feature-themes.ts` | 1 | resolveThemesFromFeatures | — |
| `components/ui/input.tsx` | 1 | — | InputProps |
| `lib/logger.ts` | 1 | — | Logger |
| `types/admin.ts` | 1 | — | HealthCheck |
| `app/admin/import/_components/GeocodeStep.tsx` | 1 | — | GeocodeFilter |
| `lib/supabase/tables.ts` | 1 | — | TableUpdate |
| `lib/campaigns/actor-metrics.ts` | 1 | — | ActorsPayload |
| `lib/dsp-mapping/types.ts` | 1 | — | TargetLocation |
| `lib/campaigns/reconciliation-metrics.ts` | 1 | — | ReconChannelRow |
| `lib/campagne/vignette-carte.ts` | 1 | — | Maille |
| `lib/civic-health/civic-ingest.ts` | 1 | — | CivicDatasetSummary |
| `lib/demo/pilot-types.ts` | 1 | — | PilotItem |
| `lib/dsp/push/types.ts` | 1 | — | PushStatus |
| `lib/qualite/verdict.ts` | 1 | — | Verdict |
| `lib/prompting/system-prompt-builder.ts` | 1 | — | SystemPromptSection |
| `lib/report/types.ts` | 1 | — | ReportHeader |
| `lib/radio/import-logger.ts` | 1 | — | LogEntry |
| `types/campaign.ts` | 1 | — | DspCampaign |
| `lib/meteo/use-meteo-data.ts` | 1 | — | MeteoProgress |
| `app/map/_components/filter-panel/use-poi-catalog.ts` | 1 | — | PoiType |
| `app/map/_components/filter-panel/use-poi-styles.ts` | 1 | — | PoiStyleEntry |
| `app/map/_components/filter-panel/use-civic-ingest.ts` | 1 | — | CivicIngestState |
| `app/map/_components/filter-panel/use-isochrone-battle.ts` | 1 | — | CacheStatusValue |
| `lib/radio/types.ts` | 1 | — | RadioStreamEvent |

## Dépendances déclarées jamais importées

`dependencies` :

- `pmtiles`

`devDependencies` :

- `@typescript-eslint/eslint-plugin`
- `@typescript-eslint/parser`

## Doublons d’export (même valeur exportée sous deux noms)

Informationnel — pas comptabilisé dans « exports morts » : un alias assumé n’est pas mort.

- `lib/iris-crawler/db-columns.ts` : IRIS_DB_COLUMN_NAMES / CORE_COLUMN_NAMES
