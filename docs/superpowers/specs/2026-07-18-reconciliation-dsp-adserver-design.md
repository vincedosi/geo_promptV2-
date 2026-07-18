# Réconciliation DSP ⇔ ad server (design)

> Validé par Vincent le 2026-07-18. Objectif : relier le flux DSP (buy side,
> ce qu'on a acheté/payé/livré) au flux ad server (measured side, déjà importé)
> pour mesurer les écarts de délivrance et de coût, à la maille code postal.

## Décisions validées

- **Source DSP = API uniquement** (jamais d'import fichier — règle
  api-first-jamais-import-fichier). Pattern miroir de `lib/dsp/push` :
  réel / simulé (démo) / skipped.
- **Maille v1 = date × CP** (deux côtés, géographique) + **canal** en
  breakdown DSP. `format` / `creative` en plomberie nullable, activés plus
  tard quand l'ingestion ad server les conservera.
- **Emplacement** = section « Réconciliation DSP ⇔ mesure » du cockpit Suivi
  (sous les tuiles existantes), pas un onglet séparé.
- **Démo obligatoire** : la campagne démo pilotage
  (`dccc0000-…-0002`) doit réconcilier via un générateur SQL simulé.

## Contrainte de données (état réel)

`dsp_campaign_data` (ad server) porte : date, CP, `media`='Display' (bucket
unique), impressions, clicks, spend, `metrics.leads`. **Pas de canal DSP, pas
de format, pas de création.** Donc :

- **date × CP** est réconciliable des deux côtés (l'ad server a le CP, le DSP
  remonte le CP en reporting) → cœur du livrable, géographique.
- **canal / format / création** n'existent que côté DSP → v1 les traite en
  **composition de l'achat DSP** (descriptif), pas en réconciliation à deux
  côtés. La bascule en réconciliation vraie viendra quand l'ingestion ad
  server conservera ces dimensions.

## Architecture

### 1. Flux DSP entrant — `lib/dsp/report/`

Miroir de `lib/dsp/push/`. Un reporter par canal, même signature.

- `types.ts` : `DspReportContext` { channel, campaign{id,name,is_demo},
  connection, links, dateStart, dateEnd, isDemo }, `DspReportRow` { date,
  channel, postal_code|null, format|null, creative_ref|null, impressions,
  clicks, spend }, `DspReportResult` { channel, status:
  'api'|'simulated'|'skipped'|'failed', rows, detail }.
- `index.ts` : `selectReporter(channel, isDemo, hasConnection)` +
  `runReport(ctx)` (catch → failed).
  - réel + connexion + connecteur → API pull ;
  - connexion sans connecteur → skipped ;
  - pas de connexion (prod) → skipped « connecte un DSP pour réconcilier »
    (jamais de faux chiffres hors démo) ;
  - démo → géré à part par la RPC set-based (voir §5), pas via le loop TS.
- `dv360.ts` : reporter réel DV360 (Bid Manager reporting API). Structure
  posée ; renvoie `skipped('reporting — droits Google en attente')` tant que
  les droits ne sont pas débloqués, exactement comme le push. Le point
  d'ancrage de l'appel API réel est documenté (TODO wire Bid Manager).

### 2. Table — `campaign_dsp_report`

```
campaign_id uuid  (FK dsp_campaigns ON DELETE CASCADE)
date        date
channel     text
postal_code text        -- '' si non fourni à cette maille
format      text NULL   -- plomberie future
creative_ref text NULL  -- plomberie future
impressions bigint
clicks      bigint
spend       numeric
source      text        -- 'api' | 'simulated' | 'skipped'
pulled_at   timestamptz
```
Unicité par index expression sur (campaign_id, date, channel,
COALESCE(postal_code,''), COALESCE(format,''), COALESCE(creative_ref,''))
— pattern `dsp_campaign_data`. RLS deny-all (lecture via routes service role).
Miroir « buy side » de `campaign_cp_rollup` / `campaign_daily_rollup`.

### 3. RPC (SECURITY DEFINER service_role)

- `get_campaign_reconciliation(p_campaign_id) RETURNS jsonb` :
  ```json
  {
    "as_of": "2026-04-30",
    "has_dsp_report": true,
    "source": "simulated",
    "global": {
      "dsp_impressions": 50716000, "adserver_impressions": 49239022,
      "measure_rate": 97.1, "gap_pct": 2.9,
      "dsp_spend": 314460.5, "dsp_cpm": 6.2
    },
    "by_channel": [
      { "channel": "dv360", "impressions": 22800000, "spend": 141000, "cpm": 6.18, "share_pct": 45.0 }
    ],
    "daily": [
      { "date": "2026-04-01", "dsp_impressions": 1650000, "adserver_impressions": 1600000, "dsp_spend": 10230 }
    ]
  }
  ```
  - `measure_rate` = adserver_impressions ÷ dsp_impressions × 100.
  - global/daily : jointure `campaign_dsp_report` (par date) ↔
    `campaign_daily_rollup`. by_channel : agrégat DSP seul (l'ad server ne
    splitte pas par canal).
  - Pas de rapport DSP → `{ has_dsp_report: false }` (le panel affiche l'état
    « connecte un DSP / actualise »).
- `get_campaign_reconciliation_map(p_campaign_id, p_metric, bbox…) RETURNS json` :
  par CP → `{ code, nom, measure_rate | dsp_cpm, geometry }`. Jointure
  `campaign_dsp_report` (sommé par CP) ↔ `campaign_cp_rollup`, géométries
  `ref_codes_postaux.geom_simplified` (pattern `get_campaign_suivi_map`).
  `p_metric` ∈ 'measure' | 'dspcpm'.
- `simulate_dsp_report(p_campaign_id) RETURNS jsonb` (démo) : **set-based**,
  `INSERT … SELECT` depuis `dsp_campaign_data` (date × CP), croisé avec les
  canaux déclarés `geo_strategy.channels.dsps ∪ .socials` (démo :
  dv360, ttd, tiktok, meta). Répartition des impressions par **part de budget**
  `geo_strategy.channels.budgets` (démo : dv360 32000, ttd 5000, tiktok 15000 ;
  canal sans budget → part égale résiduelle). impressions × 1,03 (le DSP
  reporte toujours un peu plus que la mesure), spend = impressions × un CPM par
  canal proche du CPM campagne (≈ 6,2 € avec léger jitter). Une passe SQL,
  indexée campaign_id — ne fait PAS transiter 185 k lignes par le code TS.
  `source='simulated'`.

### 4. Routes API

- `POST /api/digital/[campaignId]/reconcile/pull` (**requireAdmin** — déclenche
  API externe + écriture) : lit `is_demo` ; si démo → `simulate_dsp_report` ;
  sinon boucle `runReport` sur les canaux déclarés connectés, DELETE ciblé +
  insert idempotent dans `campaign_dsp_report` (pattern DELETE+insert, pas
  d'upsert onConflict — cf. contrainte `dsp_campaign_data`). Renvoie un résumé
  par canal { channel, status, rows }.
- `GET /api/digital/[campaignId]/reconcile` (**requireAuth** + scope org) →
  `get_campaign_reconciliation`.
- `GET /api/digital/[campaignId]/reconcile/map?metric=measure|dspcpm&bbox=`
  (**requireAuth** + scope) → `get_campaign_reconciliation_map`.

### 5. Mode démo

`simulate_dsp_report` génère un rapport crédible depuis les données ad server
existantes : taux de mesure ~97 %, coût réel par CP, 4 canaux (dv360, ttd,
tiktok, meta si déclarés — sinon les canaux réellement présents dans
`geo_strategy.channels`). Aucun code spécial démo côté UI : le panel lit
`/reconcile` comme en prod. La démo est déclenchée par le bouton « Actualiser »
(ou un backfill one-shot à la migration).

### 6. UI — `components/campaign/suivi/ReconciliationPanel.tsx`

Rendu sous les tuiles du cockpit dans `CampaignSuivi` (au-dessus ou sous les
graphes — sous les alertes, avant les graphes). Contenu :

- Bandeau section « Réconciliation DSP ⇔ mesure » (dot teal).
- Si `has_dsp_report=false` : encart « Aucun rapport DSP — actualise depuis
  les DSP connectés » + bouton (admin).
- Sinon : **tuile Taux de mesure** (mesuré ÷ livré, colorée : vert ≥ 95 %,
  orange 85-95 %, rouge < 85 %) + petite mention source (simulé/api).
- **Tableau par canal** : canal · livré DSP · dépense · CPM DSP · part % ;
  pied « mesuré ad server (total) » + écart global.
- Bouton **« Actualiser depuis les DSP »** (visible si `mapAvailable`/admin) →
  POST pull → refetch.
- Bouton **« Voir sur la carte »** → dispatch `magelian:suivi-map` avec un
  nouveau `source: 'reconcile'` + metric ('measure'|'dspcpm') ; l'overlay se
  replie, `SuiviMapLayer` étendu fetch `/reconcile/map` pour ces metrics
  (paliers de couleur mesure/CPM).

Helpers purs dans `lib/campaigns/reconciliation-metrics.ts` (miroir de
`suivi-metrics.ts`) : types du payload + `measureRateTone(rate)` +
formats réutilisés.

## Extensibilité (hors v1, sans rebuild)

- `format` / `creative` : colonnes prêtes ; quand l'ingestion ad server les
  conservera, ajouter les breakdowns correspondants dans les RPC read.
- API DV360 réelle : brancher le Bid Manager dans `dv360.ts` quand les droits
  Google sont débloqués — le reste (table, RPC, UI) ne bouge pas.
- Autres DSP (TTD, Meta, TikTok) : ajouter un reporter dans `REAL_REPORTERS`.

## Hors périmètre v1

- Réconciliation à deux côtés par format/création (données ad server absentes).
- API DV360/TTD/Meta/TikTok réelles (bloquées / connecteur à écrire).
- Réconciliation des clics/conversions (v1 = impressions + dépense).
- Multi-devise (EUR).

## Fichiers principaux prévus

- `sql/110_campaign_dsp_report.sql` — table + index + RLS.
- `sql/111_reconciliation_rpc.sql` — get_campaign_reconciliation,
  get_campaign_reconciliation_map, simulate_dsp_report + backfill démo.
- `lib/dsp/report/{types,index,dv360,simulated}.ts`.
- `lib/campaigns/reconciliation-metrics.ts` (+ test unitaire).
- `app/api/digital/[campaignId]/reconcile/{route.ts,pull/route.ts,map/route.ts}`.
- `components/campaign/suivi/ReconciliationPanel.tsx` + intégration
  `CampaignSuivi.tsx`.
- `app/map/_components/SuiviMapLayer.tsx` — étendu (source reconcile + metrics).
