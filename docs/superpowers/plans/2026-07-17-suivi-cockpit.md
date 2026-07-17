# Cockpit de suivi en cours de campagne — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'onglet Suivi campagne devient un cockpit media planner : pacing budget/temps, CPM réel vs prévu, tenue de la pression par zone, alertes par exception, tableau hiérarchique et choroplèthe carte — lisible même avec 12 000 CP.

**Architecture:** Tout est pré-agrégé côté serveur dans deux tables rollup rafraîchies à l'import (jamais de scan des lignes brutes à l'ouverture). Une RPC unique renvoie le payload complet du cockpit ; deux RPC annexes servent le drill par département et la couche carte. Le front est découpé en composants purs (tuiles/alertes, graphes, tableau) qui consomment un seul fetch.

**Tech Stack:** Next.js 14 App Router · Supabase (PostgreSQL/PostGIS, compute Nano) · Recharts · MapLibre GL · Vitest · Zod.

## Global Constraints

- Supabase Nano : jamais de scan de `dsp_campaign_data` à l'ouverture du cockpit — lecture des rollups uniquement. Max 3 appels parallèles.
- Migrations SQL via MCP Supabase (`apply_migration`) ET copie dans `sql/1xx_*.sql` (convention repo).
- Design system : tokens `var(--…)` uniquement (jamais de hex), sentence case, Inter + JetBrains Mono, flat.
- « À jour au … » : toutes les métriques sont calculées à `as_of` = MAX(date) des données ad server, pas à aujourd'hui.
- Mode démo : aucun code spécial — la campagne démo (`dccc0000-0000-4000-8000-000000000002`, stratégie `dccc0000-0000-4000-8000-000000000012`) doit fonctionner par les mêmes chemins.
- Spec de référence : `docs/superpowers/specs/2026-07-17-suivi-cockpit-design.md`.
- Auth routes : `requireAuth` + `checkCampaignAccess` (pattern `app/api/digital/[campaignId]/analysis/route.ts`).

---

### Task 1: Tables rollup + RPC refresh + recalibrage démo (SQL 107)

**Files:**
- Create: `sql/107_campaign_rollups.sql` (copie de la migration)
- Migration MCP : `campaign_rollups`

**Interfaces:**
- Produces: tables `campaign_daily_rollup(campaign_id, date, media, impressions, clicks, spend)` PK (campaign_id, date, media) et `campaign_cp_rollup(campaign_id, postal_code, dept, impressions, clicks, spend, imps_7d, imps_prev7d, in_target, planned_share)` PK (campaign_id, postal_code) ; RPC `refresh_campaign_rollups(p_campaign_id uuid) RETURNS jsonb` → `{daily_rows, cp_rows, as_of}`.
- Convention impressions : `dsp_source='adform'` → `tracked_ads`, sinon `COALESCE(NULLIF(impressions,0), tracked_ads, 0)` (même règle que `get_digital_campaign_map`).
- `in_target` : mode `exclusion` → `bid_multiplier > 0` ; sinon → `bid_multiplier > 1`. `planned_share` = `bid_multiplier / Σ bid_multiplier` du plan actif. Stratégie de référence = la plus récente de la campagne.

- [ ] **Step 1: Appliquer la migration** via `mcp__claude_ai_Supabase__apply_migration` (name `campaign_rollups`) :

```sql
CREATE TABLE IF NOT EXISTS public.campaign_daily_rollup (
  campaign_id uuid NOT NULL REFERENCES public.dsp_campaigns(id) ON DELETE CASCADE,
  date date NOT NULL,
  media text NOT NULL DEFAULT '',
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  spend numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, date, media)
);
CREATE TABLE IF NOT EXISTS public.campaign_cp_rollup (
  campaign_id uuid NOT NULL REFERENCES public.dsp_campaigns(id) ON DELETE CASCADE,
  postal_code text NOT NULL,
  dept text,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  spend numeric NOT NULL DEFAULT 0,
  imps_7d bigint NOT NULL DEFAULT 0,
  imps_prev7d bigint NOT NULL DEFAULT 0,
  in_target boolean NOT NULL DEFAULT false,
  planned_share numeric,
  PRIMARY KEY (campaign_id, postal_code)
);
-- RLS deny-all : lecture exclusivement via les routes (service role bypass).
ALTER TABLE public.campaign_daily_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_cp_rollup ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.refresh_campaign_rollups(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_source text;
  v_as_of date;
  v_strategy_id uuid;
  v_out_mode text;
  v_daily int := 0;
  v_cp int := 0;
BEGIN
  SELECT dsp_source INTO v_source FROM dsp_campaigns WHERE id = p_campaign_id;
  IF v_source IS NULL THEN
    RETURN jsonb_build_object('error', 'campaign_not_found');
  END IF;

  DELETE FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;
  INSERT INTO campaign_daily_rollup (campaign_id, date, media, impressions, clicks, spend)
  SELECT p_campaign_id, d.date, COALESCE(d.media, ''),
         SUM(CASE WHEN v_source = 'adform' THEN COALESCE(d.tracked_ads, 0)
                  ELSE COALESCE(NULLIF(d.impressions, 0), d.tracked_ads, 0) END),
         SUM(COALESCE(d.clicks, 0)),
         SUM(COALESCE(d.spend, 0))
  FROM dsp_campaign_data d
  WHERE d.campaign_id = p_campaign_id AND d.date IS NOT NULL
  GROUP BY d.date, COALESCE(d.media, '');
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  SELECT MAX(date) INTO v_as_of
  FROM campaign_daily_rollup WHERE campaign_id = p_campaign_id;

  SELECT s.id, s.out_zone_weights->>'mode' INTO v_strategy_id, v_out_mode
  FROM bidding_strategies s
  WHERE s.campaign_id = p_campaign_id
  ORDER BY s.created_at DESC LIMIT 1;

  DELETE FROM campaign_cp_rollup WHERE campaign_id = p_campaign_id;
  INSERT INTO campaign_cp_rollup
    (campaign_id, postal_code, dept, impressions, clicks, spend,
     imps_7d, imps_prev7d, in_target, planned_share)
  WITH raw AS (
    SELECT d.postal_code, d.date,
           CASE WHEN v_source = 'adform' THEN COALESCE(d.tracked_ads, 0)
                ELSE COALESCE(NULLIF(d.impressions, 0), d.tracked_ads, 0) END AS imp,
           COALESCE(d.clicks, 0) AS clk,
           COALESCE(d.spend, 0) AS sp
    FROM dsp_campaign_data d
    WHERE d.campaign_id = p_campaign_id AND d.postal_code IS NOT NULL
  ),
  plan AS (
    SELECT z.postal_code,
           z.bid_multiplier / NULLIF(SUM(z.bid_multiplier) OVER (), 0) AS planned_share,
           CASE WHEN v_out_mode = 'exclusion' THEN z.bid_multiplier > 0
                ELSE z.bid_multiplier > 1 END AS in_target
    FROM bidding_zone_configs z
    WHERE z.strategy_id = v_strategy_id AND z.is_active
  )
  SELECT p_campaign_id, r.postal_code, LEFT(r.postal_code, 2),
         SUM(r.imp), SUM(r.clk), SUM(r.sp),
         COALESCE(SUM(r.imp) FILTER (WHERE r.date > v_as_of - 7), 0),
         COALESCE(SUM(r.imp) FILTER (WHERE r.date <= v_as_of - 7 AND r.date > v_as_of - 14), 0),
         COALESCE(BOOL_OR(p.in_target), false),
         MAX(p.planned_share)
  FROM raw r
  LEFT JOIN plan p ON p.postal_code = r.postal_code
  GROUP BY r.postal_code;
  GET DIAGNOSTICS v_cp = ROW_COUNT;

  RETURN jsonb_build_object('daily_rows', v_daily, 'cp_rows', v_cp, 'as_of', v_as_of);
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_campaign_rollups(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_rollups(uuid) TO service_role;
```

- [ ] **Step 2: Recalibrage démo** (via `execute_sql`, pas une migration) :

```sql
UPDATE bidding_strategies
SET total_budget = 600000, end_date = '2026-05-31'
WHERE id = 'dccc0000-0000-4000-8000-000000000012';
SELECT public.refresh_campaign_rollups('dccc0000-0000-4000-8000-000000000002');
```
Expected : `{"daily_rows": 30, "cp_rows": 6186, "as_of": "2026-04-30"}` (30 jours × 1 média).

- [ ] **Step 3: Vérifier les rollups démo** :

```sql
SELECT (SELECT count(*) FROM campaign_daily_rollup WHERE campaign_id='dccc0000-0000-4000-8000-000000000002') AS daily,
       (SELECT count(*) FROM campaign_cp_rollup WHERE campaign_id='dccc0000-0000-4000-8000-000000000002') AS cps,
       (SELECT count(*) FILTER (WHERE in_target) FROM campaign_cp_rollup WHERE campaign_id='dccc0000-0000-4000-8000-000000000002') AS in_target,
       (SELECT round(sum(spend)) FROM campaign_cp_rollup WHERE campaign_id='dccc0000-0000-4000-8000-000000000002') AS spend;
```
Expected : daily=30, cps=6186, in_target > 0, spend ≈ 305301.

- [ ] **Step 4: Copier la migration** dans `sql/107_campaign_rollups.sql` (avec un en-tête `-- Appliquée le 2026-07-17 via MCP Supabase` + le UPDATE de recalibrage démo en commentaire documenté) et commit :

```bash
git add sql/107_campaign_rollups.sql
git commit -m "feat(sql): rollups de suivi campagne + refresh — agrégats pré-calculés à l'import (Nano-safe)"
```

---

### Task 2: RPC get_campaign_suivi (SQL 108)

**Files:**
- Create: `sql/108_get_campaign_suivi.sql`
- Migration MCP : `get_campaign_suivi`

**Interfaces:**
- Consumes: rollups Task 1, `bidding_strategies` (total_budget, forecast_cpm, start_date, end_date, out_zone_weights, in_zone_weights, kpi_target, objective_code).
- Produces: `get_campaign_suivi(p_campaign_id uuid) RETURNS jsonb` :

```json
{
  "as_of": "2026-04-30", "start_date": "2026-04-01", "end_date": "2026-05-31",
  "pacing": { "spend": 305301.32, "total_budget": 600000, "budget_pct": 50.9, "time_pct": 49.2, "index": 1.03 },
  "cpm": { "real": 6.2, "forecast": 7.1, "delta_pct": -12.7 },
  "pressure": { "mode": "exclusion", "requested": null, "obtained": null,
                "in_target_share": 87.4, "out_share": 12.6 },
  "objective": { "code": "maximize_leads", "kpi_target": null,
                 "realized": 49239022, "expected": 47700000, "pct": 103.2 },
  "alerts": [ { "kind": "zones_under", "severity": "warning",
                "title": "312 CP cibles sous 70 % du plan",
                "detail": "8 420 € de spend · 6,1 % du volume cible" } ],
  "level1": [ { "zone": "cible", "impressions": 43000000, "share_real": 87.4,
                "share_plan": 100, "cpm": 6.1, "spend": 265000 },
              { "zone": "hors_cible", "impressions": 6200000, "share_real": 12.6,
                "share_plan": 0, "cpm": 6.5, "spend": 40300 } ],
  "depts": [ { "dept": "75", "in_target": true, "impressions": 1200000,
               "hold_index": 64, "cpm": 6.9, "spend": 8300, "delta7_pct": -18 } ],
  "daily": [ { "date": "2026-04-01", "impressions": 1600000, "spend": 10100, "cpm": 6.31 } ],
  "medias": [ { "media": "ttd", "impressions": 49239022, "spend": 305301.32, "cpm": 6.2 } ]
}
```
Si aucune stratégie → `{"error":"no_strategy"}`. Si rollup vide → `{"error":"no_rollup"}` (la route déclenche alors un refresh, Task 5).
- Règles d'alerte (constantes SQL, documentées en tête de fonction) : pacing index < 0,85 (retard) ou > 1,15 (avance) — severity `warning`, `danger` sous 0,70/au-delà de 1,30 ; CPM réel > prévu × 1,25 ; CP cibles à `hold_index < 70` (agrégat : count, spend, % du volume cible) ; mode exclusion et `out_share > 5` → fuite hors cible. Aucune → tableau vide (le front affiche « Tout est dans les rails ✓ »).
- Formules : `hold_index` (dept et CP) = `(imps_zone / imps_total) / NULLIF(planned_share_zone, 0) * 100` (planned_share_zone = somme des planned_share des CP de la zone) ; `pressure.requested` (mode non-exclusion) = `MAX(bid_multiplier)` du plan ; `pressure.obtained` = `(part imps in_target / part CP in_target) / ((part imps hors) / (part CP hors))` ; `objective.expected` = `kpi_target × time_pct` si kpi_target sinon `total_budget × time_pct ÷ forecast_cpm × 1000` ; `delta7_pct` = `(imps_7d − imps_prev7d) / NULLIF(imps_prev7d,0) × 100`.
- `time_pct` = `LEAST(1, (as_of − start_date + 1)::numeric / NULLIF(end_date − start_date + 1, 0)) × 100`.

- [ ] **Step 1: Écrire et appliquer la migration** — fonction `plpgsql STABLE SECURITY DEFINER`, `SET search_path = public, pg_catalog`, GRANT service_role uniquement (même pattern que Task 1). Corps : lire la stratégie (la plus récente), agréger `campaign_cp_rollup` (deux passes CTE : totaux cible/hors-cible, départements), `campaign_daily_rollup` (daily + medias), construire le jsonb ci-dessus. Arrondir : pourcentages à 1 décimale, CPM à 2, index à 2.

- [ ] **Step 2: Vérifier sur la démo** :

```sql
SELECT jsonb_pretty(public.get_campaign_suivi('dccc0000-0000-4000-8000-000000000002'));
```
Expected : `as_of=2026-04-30`, `pacing.index` entre 0,95 et 1,10, `cpm.real` ≈ 6,20, `depts` ≤ ~100 lignes, `daily` = 30 lignes, `alerts` cohérentes (vérifier à la main 2 valeurs contre un `SELECT sum(...)` direct).

- [ ] **Step 3: Copier dans `sql/108_get_campaign_suivi.sql` + commit** :

```bash
git add sql/108_get_campaign_suivi.sql
git commit -m "feat(sql): get_campaign_suivi — payload cockpit complet (pacing, cpm, pression, alertes, depts, daily)"
```

---

### Task 3: RPC drill CP + couche carte (SQL 109)

**Files:**
- Create: `sql/109_suivi_cps_map.sql`
- Migration MCP : `suivi_cps_map`

**Interfaces:**
- Produces:
  - `get_campaign_suivi_cps(p_campaign_id uuid, p_dept text) RETURNS jsonb` → tableau `[{ postal_code, in_target, impressions, hold_index, cpm, spend, delta7_pct }]` trié par hold_index croissant (pires d'abord), max 500 lignes.
  - `get_campaign_suivi_map(p_campaign_id uuid, p_metric text, p_bbox_xmin float8, p_bbox_ymin float8, p_bbox_xmax float8, p_bbox_ymax float8) RETURNS json` → `[{ code, nom, value, in_target, geometry }]` — `p_metric` ∈ `'hold'` (hold_index) | `'cpm'` ; géométries `ref_codes_postaux.geom_simplified` filtrées bbox (pattern du bloc `p_scale='cp'` de `get_digital_campaign_map`).

- [ ] **Step 1: Écrire + appliquer la migration** (deux fonctions, mêmes conventions sécurité que Task 2 ; `hold_index`/`cpm` calculés depuis `campaign_cp_rollup`, JOIN `ref_codes_postaux rcp ON rcp.code_postal = r.postal_code`).

- [ ] **Step 2: Vérifier sur la démo** :

```sql
SELECT jsonb_array_length(public.get_campaign_suivi_cps('dccc0000-0000-4000-8000-000000000002', '75'));
SELECT json_array_length(public.get_campaign_suivi_map('dccc0000-0000-4000-8000-000000000002', 'hold', 2.0, 48.6, 2.6, 49.0));
```
Expected : > 0 dans les deux cas ; la 2e < 500 features (bbox Paris).

- [ ] **Step 3: Copier dans `sql/109_suivi_cps_map.sql` + commit**

```bash
git add sql/109_suivi_cps_map.sql
git commit -m "feat(sql): drill CP par département + choroplèthe CP du suivi (hold/cpm)"
```

---

### Task 4: Helpers purs + types du payload (TDD)

**Files:**
- Create: `lib/campaigns/suivi-metrics.ts`
- Test: `tests/unit/campaigns/suivi-metrics.test.ts`

**Interfaces:**
- Produces: types TS du payload (`SuiviPayload`, `SuiviAlert`, `SuiviDeptRow`, `SuiviCpRow`, `SuiviDaily` — miroir exact du JSON Task 2) ; helpers purs :
  - `pacingTone(index: number | null): 'ok' | 'warn' | 'bad'` — ok 0,9–1,1 ; warn 0,75–0,9 et 1,1–1,25 ; bad ailleurs ; null → 'warn'.
  - `cpmTone(real: number | null, forecast: number | null): 'ok' | 'warn' | 'bad'` — ok ≤ prévu×1,10 ; warn ≤ ×1,25 ; bad au-delà ; null → 'ok' si pas de forecast.
  - `holdTone(index: number | null): 'ok' | 'warn' | 'bad'` — ok ≥ 80 ; warn 60–80 ; bad < 60 ; null → 'warn'.
  - `toneColor(tone): string` — `'var(--success)' | 'var(--warning)' | 'var(--danger)'`.
  - `fmtPct(v: number | null): string`, `fmtCpm(v: number | null): string`, `fmtInt(v: number | null): string` (fr-FR, '—' si null).

- [ ] **Step 1: Écrire le test qui échoue** :

```typescript
import { describe, it, expect } from 'vitest';
import { pacingTone, cpmTone, holdTone, toneColor, fmtPct } from '@/lib/campaigns/suivi-metrics';

describe('suivi-metrics tones', () => {
  it('pacing : 1,0 ok · 0,8 warn · 0,6 bad · null warn', () => {
    expect(pacingTone(1.0)).toBe('ok');
    expect(pacingTone(0.8)).toBe('warn');
    expect(pacingTone(1.2)).toBe('warn');
    expect(pacingTone(0.6)).toBe('bad');
    expect(pacingTone(null)).toBe('warn');
  });
  it('cpm : sous prévu ok · +20 % warn · +30 % bad', () => {
    expect(cpmTone(6.2, 7.1)).toBe('ok');
    expect(cpmTone(8.2, 7.1)).toBe('warn');
    expect(cpmTone(9.5, 7.1)).toBe('bad');
    expect(cpmTone(6.2, null)).toBe('ok');
  });
  it('hold : 100 ok · 70 warn · 50 bad', () => {
    expect(holdTone(100)).toBe('ok');
    expect(holdTone(70)).toBe('warn');
    expect(holdTone(50)).toBe('bad');
  });
  it('toneColor renvoie des tokens CSS', () => {
    expect(toneColor('ok')).toBe('var(--success)');
    expect(toneColor('bad')).toBe('var(--danger)');
  });
  it('fmtPct fr-FR et null', () => {
    expect(fmtPct(50.9)).toBe('50,9 %');
    expect(fmtPct(null)).toBe('—');
  });
});
```

- [ ] **Step 2: FAIL** — `npx vitest run tests/unit/campaigns/suivi-metrics.test.ts` (module absent).
- [ ] **Step 3: Implémenter** `lib/campaigns/suivi-metrics.ts` (types + helpers, zéro dépendance React).
- [ ] **Step 4: PASS** puis **commit** :

```bash
git add lib/campaigns/suivi-metrics.ts tests/unit/campaigns/suivi-metrics.test.ts
git commit -m "feat: types + helpers purs du cockpit de suivi (tons, formats)"
```

---

### Task 5: Routes API suivi

**Files:**
- Create: `app/api/digital/[campaignId]/suivi/route.ts`
- Create: `app/api/digital/[campaignId]/suivi/cps/route.ts`
- Create: `app/api/digital/[campaignId]/suivi/map/route.ts`

**Interfaces:**
- Consumes: RPC Tasks 1–3, `requireAuth`/`authUnauthorized` (`@/lib/api/middleware`), `checkCampaignAccess` (`@/lib/campaigns/access`), `createAdminClient` (`@/lib/auth`).
- Produces:
  - `GET /api/digital/[campaignId]/suivi` → payload Task 2. Si `no_rollup` : appelle `refresh_campaign_rollups` UNE fois puis relit (lazy backfill pour les campagnes historiques) — uniquement si la campagne a une stratégie (`no_strategy` → 409 `{ error: 'no_strategy' }`, le front affiche l'état d'attente actuel).
  - `GET .../suivi/cps?dept=75` → tableau CP (400 si `dept` absent ou non `^\d{2,3}$`).
  - `GET .../suivi/map?metric=hold|cpm&bbox=xmin,ymin,xmax,ymax` → features (metric validée par Zod enum, bbox 4 floats, défaut bbox métropole `-5.5,41.2,9.8,51.2`).
- Toutes : `export const dynamic = 'force-dynamic'`, scope org par `checkCampaignAccess` → 404 uniforme.

- [ ] **Step 1: Écrire les 3 routes** (suivre `app/api/digital/[campaignId]/analysis/route.ts` pour l'ossature ; validation Zod des query params dans `suivi/map`).
- [ ] **Step 2: Vérif manuelle** (dev server + session admin, ou `curl` avec cookie) : `GET /api/digital/dccc0000-0000-4000-8000-000000000002/suivi` → 200, payload complet ; `.../suivi/cps?dept=75` → 200 ; `.../suivi/map?metric=hold` → 200. Une campagne d'une autre org → 404.
- [ ] **Step 3: `npx tsc --noEmit` + commit** :

```bash
git add "app/api/digital/[campaignId]/suivi"
git commit -m "feat: routes API du cockpit de suivi (payload, drill CP, couche carte)"
```

---

### Task 6: SuiviCockpit (tuiles + alertes) + intégration CampaignSuivi

**Files:**
- Create: `components/campaign/suivi/SuiviCockpit.tsx`
- Modify: `components/campaign/CampaignSuivi.tsx` (colonne gauche)

**Interfaces:**
- Consumes: `GET /suivi` (un seul fetch, `useRef` anti-refetch), helpers Task 4.
- Produces: `<SuiviCockpit campaignId payload onDrillDept={(dept) => …} onShowMap={(metric) => …} />` — affiche : ligne « À jour au {as_of} » ; 4 tuiles (Pacing « Budget X % · Temps Y % » + indice ; CPM « réel vs prévu · Δ % » ; Pression — mode exclusion : « Volume dans la cible : N % », sinon « Demandée ×A · Obtenue ×B » ; Objectif « réalisé vs attendu · N % ») chacune bordée `toneColor` ; puis les alertes (cartes 1 ligne, icône par sévérité, `zones_under` cliquable → `onDrillDept(null)` scroll tableau) ; zéro alerte → « Tout est dans les rails ✓ » en `var(--success)`.
- Le fetch du payload vit dans `CampaignSuivi` (état partagé avec Tasks 7–8) : `const [suivi, setSuivi] = useState<SuiviPayload | null>(null)` + fetch au montage si stratégie présente et non terminée. Stratégie terminée → `FinalReport` inchangé ; 409 `no_strategy` → bloc d'attente actuel inchangé.

- [ ] **Step 1: Créer `SuiviCockpit.tsx`** (composant d'affichage pur, aucune logique de fetch ; styles inline tokens, tuiles en grid 4 colonnes → wrap ≤ 720 px).
- [ ] **Step 2: Brancher dans `CampaignSuivi.tsx`** — la colonne gauche devient : cockpit (stratégie active) / FinalReport (terminée) / attente (aucune stratégie). Le chat à droite ne bouge pas.
- [ ] **Step 3: Vérif browser** (dev server, campagne démo, onglet Suivi) : 4 tuiles remplies, « À jour au 30/04/2026 », pacing vert ≈ 1,0, CPM vert (−13 %), alertes plausibles.
- [ ] **Step 4: `npx tsc --noEmit` + commit** :

```bash
git add components/campaign/suivi/SuiviCockpit.tsx components/campaign/CampaignSuivi.tsx
git commit -m "feat: cockpit de suivi — tuiles pacing/CPM/pression/objectif + alertes par exception"
```

---

### Task 7: SuiviCharts (budget cumulé + CPM quotidien)

**Files:**
- Create: `components/campaign/suivi/SuiviCharts.tsx`
- Modify: `components/campaign/CampaignSuivi.tsx` (sous le cockpit)

**Interfaces:**
- Consumes: `payload.daily`, `payload.pacing`, `payload.cpm` (aucun fetch).
- Produces: `<SuiviCharts payload />` — deux graphes Recharts empilés (~200 px chacun) :
  1. **Budget cumulé** : AreaChart spend cumulé (accumulation côté client depuis `daily`) vs Line idéale `total_budget × (jour − start + 1)/(durée)` ; bande ±10 % (Area translucide).
  2. **CPM quotidien** : LineChart `daily[].cpm` vs ReferenceLine `cpm.forecast` (pointillée).
- Couleurs : courbes `var(--brand-teal)`, référence `var(--text-tertiary)`, tooltip fond `var(--bg-level-2)` — pas de hex.

- [ ] **Step 1: Créer le composant** (import dynamique `next/dynamic` ssr:false comme les autres usages Recharts du repo — vérifier `app/map/analyse/digital/_components` pour le pattern exact d'import).
- [ ] **Step 2: Brancher + vérif browser** : courbe démo régulière sur avril, droite idéale qui continue jusqu'au 31/05, CPM ~6,20 sous la référence 7,10.
- [ ] **Step 3: `npx tsc --noEmit` + commit** :

```bash
git add components/campaign/suivi/SuiviCharts.tsx components/campaign/CampaignSuivi.tsx
git commit -m "feat: graphes du suivi — budget cumulé vs idéal, CPM quotidien vs prévu"
```

---

### Task 8: SuiviTable hiérarchique + drill CP

**Files:**
- Create: `components/campaign/suivi/SuiviTable.tsx`
- Modify: `components/campaign/CampaignSuivi.tsx`

**Interfaces:**
- Consumes: `payload.level1`, `payload.depts` ; fetch drill `GET /suivi/cps?dept=` à l'ouverture d'un département (cache `Map<dept, SuiviCpRow[]>` en ref).
- Produces: `<SuiviTable payload campaignId />` — tableau JetBrains Mono :
  - Niveau 1 : lignes Cible / Hors cible (impressions, part réelle vs plan, CPM, spend).
  - Niveau 2 : départements (déplié par défaut côté Cible), tri par `hold_index` croissant, colonnes impressions · indice (badge coloré `holdTone`) · CPM · spend · Δ 7 j ; « Afficher plus » par paquets de 20.
  - Niveau 3 : clic département → ses CP (mêmes colonnes, max 500, message « triés du pire au meilleur »).
- Accepte une prop `focusRef` (scroll depuis l'alerte `zones_under`).

- [ ] **Step 1: Créer le composant** (état : `openDepts: Set<string>`, `cpCache: useRef(new Map())`, chargement par dept avec spinner inline).
- [ ] **Step 2: Brancher + vérif browser** : dépliage Cible, tri pires en premier, drill 75 → liste CP, aucune requête > 1 par département ouvert.
- [ ] **Step 3: `npx tsc --noEmit` + `npm test` + commit** :

```bash
git add components/campaign/suivi/SuiviTable.tsx components/campaign/CampaignSuivi.tsx
git commit -m "feat: tableau hiérarchique du suivi — cible/hors-cible → départements → CP au clic"
```

---

### Task 9: Couche carte + bouton « Voir sur la carte »

**Files:**
- Create: `app/map/_components/SuiviMapLayer.tsx`
- Modify: `app/map/page.tsx` (montage de la couche)
- Modify: `components/campaign/suivi/SuiviCockpit.tsx` (bouton)
- Modify: `components/magelian/MagelianOverlay.tsx` (repli de l'overlay)

**Interfaces:**
- Mécanisme : le cockpit dispatch `window.dispatchEvent(new CustomEvent('magelian:suivi-map', { detail: { campaignId, metric } }))` puis `MagelianOverlay` se replie (le cockpit appelle une prop `onShowMap` remontée jusqu'à l'overlay qui exécute `handleClose()` après le dispatch).
- `SuiviMapLayer` (pattern exact de `app/map/_components/CivicHealthMapLayer.tsx` : composant sans DOM React sauf sa légende, reçoit `map: maplibregl.Map`) : écoute l'événement, fetch `GET /suivi/map?metric=`, pose source GeoJSON + fill layer (paliers `holdTone`/`cpmTone` → couleurs lues par `getComputedStyle` comme CivicHealthMapLayer), popup au clic (CP, valeur, in_target), petite légende flottante avec « Fermer la couche » et un toggle métrique hold/CPM (refetch au toggle).
- Bouton visible uniquement sur `/map` (l'overlay connaît `onMap`, passer la prop).

- [ ] **Step 1: Créer `SuiviMapLayer.tsx`** en copiant la structure de `CivicHealthMapLayer.tsx` (ids `suivi-campaign-zones[-fill/-line]`).
- [ ] **Step 2: Monter dans `app/map/page.tsx`** à côté de CivicHealthMapLayer, câbler bouton + repli overlay.
- [ ] **Step 3: Vérif browser** : Suivi démo → « Voir sur la carte » → overlay se replie, choroplèthe CP colorée s'affiche, popup au clic, toggle hold/CPM, fermeture propre (source/layers retirés).
- [ ] **Step 4: `npx tsc --noEmit` + commit** :

```bash
git add app/map/_components/SuiviMapLayer.tsx app/map/page.tsx components/campaign/suivi/SuiviCockpit.tsx components/magelian/MagelianOverlay.tsx
git commit -m "feat: choroplèthe CP du suivi sur la carte — indice de tenue / CPM, depuis le cockpit"
```

---

### Task 10: Refresh des rollups aux bons moments

**Files:**
- Modify: `app/api/admin/campaigns/import/route.ts` (après le matching IRIS, avant l'événement final du flux SSE — chercher l'appel `match_campaign_postal_to_iris`)
- Modify: `app/api/admin/campaigns/[id]/absorb/route.ts` (après le déplacement des lignes)
- Modify: `app/api/bidding/strategies/route.ts` (POST, après création OK)
- Modify: `app/api/bidding/strategies/[id]/route.ts` (PATCH, quand `in_zone_weights`/`out_zone_weights`/`zone_id` changent ou statut passe active)

**Interfaces:**
- Consumes: `refresh_campaign_rollups` (Task 1).
- Chaque appel : `await supabase.rpc('refresh_campaign_rollups', { p_campaign_id })` best-effort (échec loggé, jamais bloquant). Dans l'import SSE : émettre une étape nommée `{ step: 'rollups', label: 'Agrégats de suivi' }` dans le flux existant (suivre le format des étapes actuelles du fichier — les imports DOIVENT montrer leurs étapes, règle CLAUDE.md).

- [ ] **Step 1: Câbler les 4 points d'accroche** (lire chaque fichier, insérer l'appel au bon endroit).
- [ ] **Step 2: Vérif SQL** : re-lancer un armement sur la démo n'est pas nécessaire — vérifier plutôt qu'un `PATCH` de stratégie démo (no-op re-save) régénère les rollups : `SELECT count(*) FROM campaign_cp_rollup WHERE campaign_id='dccc0000-…-0002'` inchangé (6186) après appel.
- [ ] **Step 3: `npx tsc --noEmit` + `npm test` + commit** :

```bash
git add app/api/admin/campaigns app/api/bidding/strategies
git commit -m "feat: refresh des rollups de suivi à l'import, l'absorb et l'armement (étape SSE visible)"
```

---

### Task 11: Vérification bout-en-bout + documentation

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Suite complète** — `npx tsc --noEmit` (0 erreur), `npm test` (vert), `npm run lint` (pas de nouvelle erreur).
- [ ] **Step 2: Parcours browser démo** : overlay → Suivi (démo pilotage) → tuiles/alertes/graphes/tableau OK, drill 75, « Voir sur la carte » → choroplèthe, retour. Vérifier qu'aucune requête ne touche `dsp_campaign_data` à l'ouverture (network : uniquement `/suivi*`).
- [ ] **Step 3: ARCHITECTURE.md** — section routes digital : 3 lignes (`/suivi`, `/suivi/cps`, `/suivi/map`) ; tables : `campaign_daily_rollup`, `campaign_cp_rollup` ; RPC : `refresh_campaign_rollups`, `get_campaign_suivi`, `get_campaign_suivi_cps`, `get_campaign_suivi_map` ; description de `CampaignSuivi` mise à jour (cockpit).
- [ ] **Step 4: Commit + push branche** :

```bash
git add ARCHITECTURE.md
git commit -m "docs: ARCHITECTURE — cockpit de suivi (rollups, RPC, routes, couche carte)"
git push -u origin feat/suivi-cockpit
```
