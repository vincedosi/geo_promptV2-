# Audit des appels sortants — météo, pollen/air, flux routier, ORS, BAN

> 2026-09-13 · branche `feat/nav-5-themes` · commande : « optimiser à fond le
> code de la météo, du flux routier, du pollen et de tout ce qui appelle une
> API — rapide, sûr, correct ».
>
> Chaque constat est cité en `fichier:ligne` **dans l'état d'avant** (commit
> `409616e`). Ce qui n'a pas été vérifié dans le code n'est pas écrit.

## Périmètre

| Famille | Tiers | Fichiers |
|---|---|---|
| Météo | Open-Meteo (forecast / historical / archive) | `app/api/meteo-geo/route.ts`, `lib/meteo/*`, `app/map/_hooks/useMeteoLayer.ts` |
| Santé environnementale | GeoServer WFS Atmo France (public), Atmo Data v2 (authentifié, opt-in) | `lib/civic-health/*`, `app/api/civic-indicators/**`, `app/api/admin/civic-ingest/route.ts` |
| Flux routier (TMJA) | aucun tiers — base seule | `app/api/tmja-tiles/**`, `app/api/custom-geo/source/tmja/route.ts`, `app/api/admin/transport-stats/route.ts` |
| Isochrones | OpenRouteService | `lib/isochrones/fetcher.ts` |
| Géocodage | BAN (`api-adresse.data.gouv.fr`), geo.api.gouv.fr | `lib/import/geocoder.ts`, `lib/import/geo-enricher.ts`, `lib/smart-prompt/geo-resolver.ts` |
| Autres | data.gouv MCP, ArcGIS, ANFR/Arcom, GitHub, Mistral, Modal, DV360, TikTok, auto-appels internes | `lib/mcp/datagouv.ts`, `app/api/admin/import-*`, `lib/radio/*`, `app/api/admin/trigger-pmtiles`, `app/api/admin/sources/[id]/summary`, `lib/bidding-ml`, `lib/dsp/*`, `lib/agent/autonomy.ts`, `lib/inngest/functions/agentAutoPilotDaily.ts` |

## Baseline (avant)

- `npx tsc --noEmit` : 0 erreur · `vitest` : 868 tests verts, 103 fichiers.
- Base (mesures MCP) : `get_zone_centroids('cp')` → **0 ligne** ;
  `pollen_map_daily` / `atmo_map_daily` : une seule date, **2026-07-03** ;
  `civic_health_cache` : 113 lignes ; `postal_code_commune` : 35 358 lignes.

## Constats

Gravité : 🔴 casse ou perd de la donnée · 🟠 I/O Nano ou tiers hors contrat · 🟡 robustesse.

| # | Grav. | Où (avant) | Constat | Preuve |
|---|---|---|---|---|
| A1 | 🔴 | RPC `get_zone_centroids`, palier `cp` | Lisait `ref_codes_postaux.centroid_lat/lon`, **NULL sur les 6 187 lignes**. `/api/meteo-geo?scale=cp` répondait toujours `500 No zones found for scale`. La granularité « Code postal » du configurateur météo n'a jamais fonctionné. | `select count(*) from get_zone_centroids('cp')` → 0 ; `count(centroid_lat is not null)` → 0 ; même piège que sql/144 |
| A2 | 🟠 | `app/api/meteo-geo/route.ts:197,212` | `fetch(url)` **nu**, sans délai. Un Open-Meteo muet figeait le flux NDJSON jusqu'au `maxDuration` de 300 s. | lecture du code |
| A3 | 🔴 | `app/api/meteo-geo/route.ts:230-237` vs `:358-362` | Clé de cache = bbox arrondie au demi-degré ; zones filtrées sur la bbox **exacte**. Deux vues voisines partageaient une clé pour des jeux de CP différents : la seconde lisait en cache des données qui ne couvraient pas son viewport — CP sans valeur, sans erreur. | test `requete.test.ts` « deux viewports voisins » |
| A4 | 🟡 | `app/api/meteo-geo/route.ts:293-306` | Période bornée d'un seul côté : `startDate=2020-01-01&endDate=demain` passait la validation puis partait vers l'hôte de prévision, qui refuse. | test `validerPeriode` |
| A5 | 🟠 | `app/api/meteo-geo/route.ts` | Aucun quota. Un appel en cache froid = jusqu'à 500 unités du quota Open-Meteo gratuit (5 000/h) : dix applications de filtre épuisaient le quota pour tous. | lecture du code |
| A6 | 🟡 | `app/map/_hooks/useMeteoLayer.ts:160-161` | Polygones (3,8 Mo au palier CP) attendus **avant** de lancer l'appel météo : temps de transfert additionné à celui d'Open-Meteo. | lecture du code |
| B1 | 🟠 | `app/api/civic-indicators/health-map/route.ts:172-198` | Échelle département : `getHealthWithCache` **par commune** → 104 lectures de cache, puis en cache froid 104 appels provider + 104 upserts + jusqu'à 104 lectures périmées. Jusqu'à **312 allers-retours** vers un Nano à 250 IOPS pour 104 polygones. | lecture du code + `civic_health_cache` 113 lignes |
| B2 | 🔴 | `app/api/civic-indicators/health-map/route.ts:137-138` | `.in('code_postal', codes)` **sans borne** : au-delà d'environ 2 000 codes (16 104 caractères mesurés, CLAUDE.md), PostgREST échoue muettement → 500. Une bbox de région large ou une zone enregistrée dépassait la limite. | mesure citée dans CLAUDE.md pour `/api/custom-geo/source/codes-postaux` |
| B3 | 🔴 | `lib/civic-health/wfs-civic.ts:109-111` | Pagination WFS arrêtée dès `numberReturned < PAGE_SIZE`. Un serveur qui plafonne `count` (10 000, valeur usuelle GeoServer) rend 10 000 < 40 000 → boucle interrompue, 10 000 communes sur 35 000 passent le seuil de vraisemblance (1 000) : **couverture partielle de la France sans erreur**. La pagination « par sécurité » ne paginait pas. | test `pageSuivanteAttendue` |
| B4 | 🟡 | `lib/civic-health/utils.ts:10-14` | `isoDate` = date **UTC**. Entre 22 h/23 h et minuit heure de Paris, « aujourd'hui » était la veille : un rejeu manuel du soir demandait J-1 au WFS en croyant demander J. Le cron de 05 h 30 n'était pas touché. | test `utils.test.ts` |
| B5 | 🟡 | `lib/civic-health/atmofrance-client.ts:136-138,171-173` | Sur 401, le jeton était vidé mais l'appel **échouait** : seule la fiche suivante profitait du nouveau jeton. La première consultation après expiration (~1 h) manquait toujours. Et `fetchHealth` lit air et pollen en parallèle : deux 401 simultanés → **deux logins**. | test « jeton expiré » |
| C1 | 🟠 | `lib/import/geo-enricher.ts:53-63` | 500 appels BAN `reverse/` unitaires + 500 `UPDATE` d'une ligne, lancés **5 à la fois** — au-delà des 3 requêtes Supabase simultanées de CLAUDE.md, sur le chemin d'un import qui vient d'écrire des milliers de lignes. `reverseGeocodeRows` (CSV, 500 points par appel) existait dans `geocoder.ts` et n'était pas utilisée. | lecture du code |
| C2 | 🟡 | `lib/import/geocoder.ts:64-69,376-384` | Reprise aveugle sur **tout** échec, y compris un 400 que rejouer ne corrige pas ; `console.*` au lieu du logger. | lecture du code |
| D1 | 🟡 | `lib/isochrones/fetcher.ts:148-152` | Un HTTP non-429 (502 ORS, fréquent) sortait de la boucle **sans reprise** : le lot de 5 POI était perdu. `.single()` sur le cache transformait l'absence (normale) en erreur ignorée. | lecture du code |
| E1 | 🟡 | `app/api/admin/trigger-pmtiles/route.ts:20`, `app/api/admin/sources/[id]/summary/route.ts:40`, `lib/agent/autonomy.ts:147`, `lib/inngest/functions/agentAutoPilotDaily.ts:100,112,162` | Six appels sortants **sans délai** (GitHub, Mistral, auto-appels vers nos routes depuis le worker Inngest). | grep `fetch(` sans `signal` |
| F1 | ✅ | `app/api/tmja-tiles/**`, `get_tmja_tile` | Aucun tiers. Cache mémoire + déduplication + CDN 1 semaine + gzip : rien à corriger. `transport-stats` séquence déjà ses 3 COUNT. | lecture du code + définition SQL |
| F2 | ✅ | `lib/mcp/datagouv.ts`, `import-datagouv`, `import-ooh/arcgis`, `lib/radio/*`, `lib/dsp/*`, `lib/bidding-ml` | Délais présents partout (`AbortSignal.timeout` ou `fetchAvecDelai`), whitelists SSRF revalidées à chaque redirection. Rien à corriger. | grep |

## Ce qui a été fait — 6 commits

| Commit | Lot | Constats |
|---|---|---|
| `9318e55` | `lib/http/lecture-avec-reprise.ts` — lecture idempotente bornée + reprise (`Retry-After` honoré, plafonné 30 s), 12 tests | socle de A2, C2, D1 |
| `678a6af` | Météo : sql/160 (`get_zone_centroids` lit `ST_X/ST_Y(centroid)`), route réécrite sur `lib/meteo/requete.ts` (15 tests), quota `geo:rl:meteo-geo` 20/min, client parallèle | A1 à A6 |
| `e0b266d` | Santé : `getHealthEnMasse` (1 lecture groupée + provider sur les manquants + ⌈n/50⌉ écritures + 1 lecture périmée, 5 tests), `.in()` borné à 500 sinon lecture nationale + filtre mémoire, `numberMatched`, `isoDate` Paris, re-login 401 en vol unique | B1 à B5 |
| `144a662` | BAN/ORS : `geo-enricher` en 1 appel CSV + `UPDATE … IN` par (région, département), lots de 50, séquentiels (3 tests) ; `geocoder` et `fetcher` sur le patron partagé | C1, C2, D1 |
| (ce commit) | Six appels restants bornés (`fetchAvecDelai`, sans reprise : non idempotents) ; doc | E1 |

### Mesures après

| Quoi | Avant | Après |
|---|---|---|
| `get_zone_centroids('cp')` | 0 ligne | 6 187 lignes, 34 ms, 1 505 blocs partagés |
| Carte santé départementale, cache chaud | 104 requêtes DB | 1 |
| Carte santé départementale, cache froid (104 communes) | jusqu'à 312 requêtes DB | 1 + 3 + 0 (= 4) |
| Enrichissement géo de 500 POI | 500 appels BAN + 500 UPDATE (5 en vol) | 1 appel BAN + 1 UPDATE par (région, dept), 1 en vol |
| Appels sortants sans délai | 8 (`fetch` nu) | 0 |
| Tests | 868 | 910 (+42) |

Toutes les vérifications : `tsc` 0 erreur · `eslint` 0 avertissement sur les
fichiers touchés · `vitest` 910/910 · `next build` OK.

## Hors périmètre — à arbitrer

- **Les données pollen/air datent du 2026-07-03.** Le cron Inngest
  `civic-daily-ingest` ne tourne pas (Inngest non configuré en prod, cf.
  mémoire projet). La carte CP peint des indices vieux de 72 jours ; le
  bandeau « données vieilles de N jours » de `CivicHealthSection` le dit, mais
  seul un admin peut relancer. Ce n'est pas un défaut de code.
- `civic-ingest.ts` lit le WFS pollen puis le WFS air **séquentiellement**
  (~2 s chacun). Les paralléliser ferait gagner ~2 s sur un job nocturne de
  plusieurs minutes ; les upserts, eux, doivent rester séquentiels. Laissé tel quel.
- Le cache fichier de `/api/meteo-geo` vit dans `/tmp` de l'instance : sur
  Vercel il n'est partagé par rien. Un cache en base (une table clé → payload,
  TTL 1 h/24 h) rendrait les hits réels entre utilisateurs. Non fait : c'est
  une table et une migration de plus, à décider.
- `lib/smart-prompt/geo-resolver.ts` garde jusqu'à 500 contours en mémoire
  (un contour de région pèse plusieurs Mo). Aucun incident connu ; à surveiller.
- `app/api/admin/transport-stats/route.ts` fait 3 `COUNT exact` sur des tables
  de 285 k et 408 k lignes — séquencés, admin seulement. Une RPC lisant
  `pg_class.reltuples` rendrait des estimations en 1 ms mais **changerait les
  chiffres affichés**. Non fait.
- `app/api/tmja-tiles/**` : `Access-Control-Allow-Origin` replie sur
  `https://genesis.vercel.app` en dur si `NEXT_PUBLIC_APP_URL` manque.
