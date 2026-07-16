# Wizard campagne 100% complet (hors API) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le wizard de création de campagne (overlay MAGELIAN) autonome de bout en bout sans connexion API : naissance de campagne, rattachement Adform/CM, double validation des liaisons, pression sur l'indicateur réellement ciblé, brouillon persistant, forecast, stratégie enrichie.

**Architecture:** 6 phases indépendantes, chacune livrable seule (spec `docs/superpowers/specs/2026-07-16-wizard-completion-design.md`). Les données pilotent tout (registre cibles, `indicator_cp_values`, `bidding_objectives`) — jamais de catalogue en dur côté code.

**Tech Stack:** Next.js 14 App Router · TypeScript strict · Supabase (MCP `apply_migration`/`execute_sql`, projet `vkkdbygwbrxyogqosten`) · Zod · Vitest · Playwright MCP pour la vérif browser.

## Global Constraints

- Supabase **Nano** : max 3 requêtes parallèles, jamais de full scan iris (51k) sans index, `EXPLAIN ANALYZE` sur toute nouvelle requête, batch insert/update par 50.
- SQL : TOUJOURS via MCP Supabase (`apply_migration` pour le DDL) + copie du fichier dans `sql/NNN_*.sql`. Prochain numéro : 106.
- Jamais de valeur en dur (IDs, colonnes, listes de canaux/objectifs) — tout vient d'une table ou du registre.
- Jamais de hex en dur en UI — tokens `var(--…)` ou constantes `C` de `components/campaign/wizard/steps/ui.tsx`.
- Sentence case, Inter/JetBrains Mono, flat (DESIGN_SYSTEM.md).
- Placeholders génériques uniquement (jamais de marque réelle).
- Routes API : `export const dynamic = 'force-dynamic'`, validation Zod, `createAdminClient()` de `@/lib/auth`, auth via `requireAuth`/`requireAdmin` de `@/lib/api/middleware`.
- Traitement DB long → progression temps réel (SSE/NDJSON), jamais silencieux.
- Fichiers protégés : `app/api/isochrone-battle/route.ts`, `middleware.ts` — ne pas toucher.
- Après chaque tâche : `npx tsc --noEmit` puis `npx vitest run <fichiers touchés>` verts avant commit. Commits atomiques `type: description`.
- Login browser local : http://localhost:3000, admin@geoprompt.com / G3oPrompt_Admin#2026. Campagne démo : `dccc0000-0000-4000-8000-000000000002`.

---

## Phase 1 — Pression sur l'indicateur choisi

### Task 1: Table `indicator_cp_values` + RPC de matérialisation + généralisation `apply_zone_weights_to_strategy`

**Files:**
- Create: `sql/106_indicator_cp_values.sql` (copie de la migration MCP)

**Interfaces:**
- Produces: table `indicator_cp_values(indicator_code text, postal_code text, value numeric, computed_at timestamptz, PK(indicator_code, postal_code))` ; RPC `materialize_indicator_cp_values(p_indicator_code text) returns int` ; RPC `apply_zone_weights_to_strategy` acceptant tout `variable_code` présent dans la table.

- [ ] **Step 1: Appliquer la migration via MCP** (`apply_migration`, name `indicator_cp_values`), puis recopier le SQL dans `sql/106_indicator_cp_values.sql` :

```sql
-- 106 — Valeurs d'indicateur par code postal : socle de la pression sur l'indicateur choisi.
-- La courbe d'enchère (apply_zone_weights_to_strategy) et l'export custom bidding lisent ici,
-- quel que soit l'indicateur du registre cibles (l'abstention devient un indicateur comme un autre).

CREATE TABLE IF NOT EXISTS public.indicator_cp_values (
  indicator_code text NOT NULL REFERENCES cible_indicator_registry(indicator_code),
  postal_code text NOT NULL,
  value numeric NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (indicator_code, postal_code)
);
ALTER TABLE public.indicator_cp_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "icv_read_auth" ON public.indicator_cp_values
  FOR SELECT TO authenticated USING (true);

-- Matérialise un indicateur : IRIS → commune (code_commune) → CP (postal_code_commune),
-- moyenne pondérée par population. Échelle 'cp' (abstention/pollen/atmo) : copie directe.
CREATE OR REPLACE FUNCTION public.materialize_indicator_cp_values(p_indicator_code text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  reg record;
  v_expr text;
  n int := 0;
BEGIN
  SELECT * INTO reg FROM cible_indicator_registry
   WHERE indicator_code = p_indicator_code AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'indicateur inconnu ou inactif %', p_indicator_code; END IF;

  DELETE FROM indicator_cp_values WHERE indicator_code = p_indicator_code;

  IF reg.data_source = 'iris_column' THEN
    IF reg.normalize = 'pct_of_population' THEN
      v_expr := format('(i.%I::float / nullif(i.population,0) * 100)', reg.data_column);
    ELSE
      v_expr := format('i.%I', reg.data_column);
    END IF;
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, pcc.code_postal,
              sum(%s * coalesce(i.population,0)) / nullif(sum(coalesce(i.population,0)),0)
         FROM iris i
         JOIN postal_code_commune pcc ON pcc.code_commune = i.code_commune
        WHERE i.is_true_iris AND %s IS NOT NULL
        GROUP BY pcc.code_postal
       HAVING sum(coalesce(i.population,0)) > 0',
      p_indicator_code, v_expr, v_expr);
  ELSIF reg.data_source = 'abstention' THEN
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, code_postal, %I FROM dataset_abstention_2022 WHERE %I IS NOT NULL',
      p_indicator_code, reg.data_column, reg.data_column);
  ELSIF reg.data_source = 'pollen' THEN
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, code_postal, %I FROM pollen_map_daily
        WHERE date_ech = (SELECT max(date_ech) FROM pollen_map_daily) AND %I IS NOT NULL',
      p_indicator_code, reg.data_column, reg.data_column);
  ELSE -- atmo
    EXECUTE format(
      'INSERT INTO indicator_cp_values (indicator_code, postal_code, value)
       SELECT %L, code_postal, %I FROM atmo_map_daily
        WHERE date_ech = (SELECT max(date_ech) FROM atmo_map_daily) AND %I IS NOT NULL',
      p_indicator_code, reg.data_column, reg.data_column);
  END IF;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.materialize_indicator_cp_values(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_indicator_cp_values(text) TO service_role;

-- Seed : l'abstention (seule source historique de la courbe) est matérialisée immédiatement.
SELECT public.materialize_indicator_cp_values('abstention_pres_2022');
```

- [ ] **Step 2: Généraliser `apply_zone_weights_to_strategy`** — 2e migration MCP (name `apply_zone_weights_generic`), à AJOUTER dans le même fichier `sql/106`. Reprendre la définition actuelle (`SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='apply_zone_weights_to_strategy'`) et faire exactement ces remplacements, rien d'autre :
  - Déclarer `v_var text;` et l'initialiser : `v_var := COALESCE(p_in_weights->>'variable_code', 'abstention_pres_2022');`
  - Branche nationale (zone_id NULL) : remplacer `LEFT JOIN dataset_abstention_2022 av ON av.code_postal = cp.postal_code` par `LEFT JOIN indicator_cp_values av ON av.postal_code = cp.postal_code AND av.indicator_code = v_var`, et `av.taux_abstention` par `av.value`. Supprimer la garde `AND COALESCE(p_in_weights->>'variable_code', 'abstention_pres_2022') = 'abstention_pres_2022'` (le CASE `by_insee_variable` interpole toujours).
  - Branche zone : même remplacement dans le CTE `classified` (`LEFT JOIN dataset_abstention_2022 av …` → `indicator_cp_values` + `av.indicator_code = v_var` ; `av.taux_abstention` → `av.value`) et suppression de la même garde dans `with_multiplier`.

- [ ] **Step 3: Vérifier via MCP `execute_sql`** :

```sql
SELECT count(*) FROM indicator_cp_values WHERE indicator_code = 'abstention_pres_2022'; -- attendu : ~6000+
SELECT materialize_indicator_cp_values('rev_median'); -- attendu : ~5000-6000
SELECT postal_code, value FROM indicator_cp_values WHERE indicator_code='rev_median' AND postal_code='75116'; -- attendu : valeur élevée (>30000)
```
Puis `EXPLAIN ANALYZE` de la requête d'agrégation IRIS→CP (copier le SELECT interne avec un indicateur) : pas de Seq Scan sur iris hors index `is_true_iris`; durée < 5 s. Si > 5 s, ajouter un index `idx_iris_code_commune ON iris(code_commune) WHERE is_true_iris` dans la migration.

- [ ] **Step 4: Non-régression du re-arm** — via MCP :

```sql
SELECT apply_zone_weights_to_strategy('dccc0000-0000-4000-8000-000000000012',
  '{"mode":"by_insee_variable","variable_code":"abstention_pres_2022","curve":[{"x":20,"y":0.63},{"x":30,"y":1},{"x":45,"y":1.6}]}'::jsonb,
  '{"mode":"exclusion"}'::jsonb); -- attendu : ~11000+ (comme avant)
SELECT apply_zone_weights_to_strategy('dccc0000-0000-4000-8000-000000000012',
  '{"mode":"by_insee_variable","variable_code":"rev_median","curve":[{"x":15000,"y":0.6},{"x":25000,"y":1},{"x":35000,"y":2}]}'::jsonb,
  '{"mode":"exclusion"}'::jsonb); -- attendu : même ordre de grandeur, multiplicateurs cohérents
-- Remettre l'état d'origine (re-run du 1er appel abstention) après le test rev_median.
```

- [ ] **Step 5: Commit**

```bash
git add sql/106_indicator_cp_values.sql
git commit -m "feat(sql): indicator_cp_values + apply_zone_weights générique — la pression suit n'importe quel indicateur du registre"
```

### Task 2: Courbe généralisée + variable de pression dans le draft (logique pure)

**Files:**
- Modify: `components/campaign/wizard/steps/types.ts`
- Modify: `lib/cibles/draft.ts` (type `CibleZoneRef`)
- Modify: `components/campaign/wizard/steps/StepCible.tsx` (enrichir la cible matérialisée)
- Test: `tests/unit/campaigns/pressure-variable.test.ts`

**Interfaces:**
- Consumes: `CibleIndicator` de `lib/cibles/naming.ts` (`indicator_code`, `label`, `slider_min`, `slider_max`).
- Produces: `CibleZoneRef.indicator?: { code: string; label: string; min: number; max: number }` ; `ProgDraft.pressureVariable: string | null` (code choisi si plusieurs) ; `pressureCurve(m, floor?, domain?)` où `domain = { min, max }` ; `resolvePressureIndicators(cibles): Array<{code,label,min,max}>` (dédupliqués, ordre du panier).

- [ ] **Step 1: Écrire les tests qui échouent** dans `tests/unit/campaigns/pressure-variable.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { pressureCurve, resolvePressureIndicators } from '@/components/campaign/wizard/steps/types';
import type { CibleZoneRef } from '@/lib/cibles/draft';

const IND = { code: 'rev_median', label: 'Revenu médian', min: 10000, max: 45000 };
const cible = (over: Partial<CibleZoneRef>): CibleZoneRef =>
  ({ id: 'z1', name: 'Z', sourceType: 'indicator_threshold', ...over });

describe('pressureCurve (domaine paramétré)', () => {
  it('sans domaine : rétro-compatible abstention (x = 20/30/45)', () => {
    expect(pressureCurve(2).map((p) => p.x)).toEqual([20, 30, 45]);
  });
  it('avec domaine : x = min+20%, min+40%, min+70% de la plage', () => {
    const xs = pressureCurve(2, undefined, { min: 10000, max: 45000 }).map((p) => p.x);
    expect(xs).toEqual([17000, 24000, 34500]);
  });
  it('y inchangés : 1/M, 1, M — et floor respecté', () => {
    expect(pressureCurve(2, undefined, { min: 0, max: 100 }).map((p) => p.y)).toEqual([0.5, 1, 2]);
    expect(pressureCurve(2, 1, { min: 0, max: 100 }).map((p) => p.y)).toEqual([1, 1, 2]);
  });
});

describe('resolvePressureIndicators', () => {
  it('extrait les indicateurs du panier, dédupliqués, ordre conservé', () => {
    const out = resolvePressureIndicators([
      cible({ id: 'a', indicator: IND }),
      cible({ id: 'b' }), // zone galerie sans indicateur
      cible({ id: 'c', indicator: IND }), // doublon
      cible({ id: 'd', indicator: { code: 'taux_chomage', label: 'Taux de chômage', min: 0, max: 40 } }),
    ]);
    expect(out.map((i) => i.code)).toEqual(['rev_median', 'taux_chomage']);
  });
  it('panier vide ou sans indicateur → []', () => {
    expect(resolvePressureIndicators([])).toEqual([]);
    expect(resolvePressureIndicators([cible({})])).toEqual([]);
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — `npx vitest run tests/unit/campaigns/pressure-variable.test.ts` → FAIL (`resolvePressureIndicators` inexistant, `pressureCurve` sans 3e param).

- [ ] **Step 3: Implémenter** :

Dans `lib/cibles/draft.ts`, étendre le type (garder l'existant) :
```typescript
export interface CibleZoneRef {
  id: string;
  name: string;
  sourceType: string;
  /** Indicateur d'origine (cibles indicator_threshold) — pilote la variable de pression. */
  indicator?: { code: string; label: string; min: number; max: number };
  /** Population couverte (preview au moment de la matérialisation) — forecast. */
  population?: number | null;
}
```

Dans `components/campaign/wizard/steps/types.ts` :
- Supprimer `export const TARGET_VARIABLE_CODE = 'abstention_pres_2022';`
- Ajouter au `ProgDraft` : `pressureVariable: string | null;` (défaut `null` dans `DEFAULT_PROG_DRAFT`).
- Remplacer `pressureCurve` :
```typescript
export function pressureCurve(
  m: number,
  floor?: number,
  domain?: { min: number; max: number },
): { x: number; y: number }[] {
  const p = clampPressure(m);
  const lo = Math.round((1 / p) * 100) / 100;
  const f = (y: number) => (floor != null ? Math.max(floor, y) : y);
  const { min, max } = domain ?? { min: 10, max: 60 }; // défaut = bornes registre abstention
  const range = max - min;
  const x = (frac: number) => Math.round((min + frac * range) * 100) / 100;
  return [
    { x: x(0.2), y: f(lo) },
    { x: x(0.4), y: f(1.0) },
    { x: x(0.7), y: f(p) },
  ];
}
```
- Ajouter :
```typescript
/** Indicateurs distincts portés par le panier de cibles (ordre du panier). */
export function resolvePressureIndicators(
  cibles: CibleZoneRef[],
): Array<{ code: string; label: string; min: number; max: number }> {
  const seen = new Set<string>();
  const out: Array<{ code: string; label: string; min: number; max: number }> = [];
  for (const c of cibles) {
    if (c.indicator && !seen.has(c.indicator.code)) {
      seen.add(c.indicator.code);
      out.push(c.indicator);
    }
  }
  return out;
}
```

Dans `StepCible.tsx`, fonction `materialize`, enrichir l'ajout au panier :
```typescript
cibles: addCible(prev.cibles, {
  id: saved.zone_id, name, sourceType: 'indicator_threshold',
  indicator: {
    code: selected.indicator_code, label: selected.label,
    min: selected.slider_min, max: selected.slider_max,
  },
  population: preview?.population ?? null,
}),
```

- [ ] **Step 4: Corriger les usages cassés de `TARGET_VARIABLE_CODE`** — `grep -rn "TARGET_VARIABLE_CODE"` : le seul consommateur est `StepLancement.tsx` (corrigé en Task 3 ; en attendant, y mettre `draft.pressureVariable ?? 'abstention_pres_2022'` pour compiler).

- [ ] **Step 5: Vérifier** — `npx vitest run tests/unit/campaigns/pressure-variable.test.ts` PASS, `npx tsc --noEmit` propre, `npx vitest run` global vert.

- [ ] **Step 6: Commit**

```bash
git add components/campaign/wizard/steps/types.ts lib/cibles/draft.ts components/campaign/wizard/steps/StepCible.tsx components/campaign/wizard/steps/StepLancement.tsx tests/unit/campaigns/pressure-variable.test.ts
git commit -m "feat: variable de pression portée par le panier de cibles — courbe généralisée aux bornes de l'indicateur"
```

### Task 3: StepPression (« pression sur : X ») + StepLancement (in_zone_weights dynamique) + matérialisation lazy

**Files:**
- Modify: `components/campaign/wizard/steps/StepPression.tsx`
- Modify: `components/campaign/wizard/steps/StepLancement.tsx`
- Modify: `app/api/bidding/strategies/route.ts` et `app/api/bidding/strategies/[id]/route.ts` (matérialisation lazy avant `apply_zone_weights`)
- Test: `tests/unit/campaigns/pressure-variable.test.ts` (cas `buildInZoneWeights`)

**Interfaces:**
- Consumes: `resolvePressureIndicators`, `pressureCurve(m, floor, domain)` (Task 2) ; RPC `materialize_indicator_cp_values` (Task 1).
- Produces: `buildInZoneWeights(draft): Record<string, unknown>` exporté de `types.ts` — utilisé par StepLancement.

- [ ] **Step 1: Test qui échoue** (ajouter au fichier de Task 2) :

```typescript
import { buildInZoneWeights } from '@/components/campaign/wizard/steps/types';

describe('buildInZoneWeights', () => {
  const base = { pressure: 2, diffusion: 'zones_only' as const };
  it('cible avec indicateur → by_insee_variable sur cet indicateur, courbe à ses bornes', () => {
    const w = buildInZoneWeights({ ...base, cibles: [cible({ indicator: IND })], pressureVariable: 'rev_median' } as never);
    expect(w).toMatchObject({ mode: 'by_insee_variable', variable_code: 'rev_median' });
    expect((w.curve as { x: number }[]).map((p) => p.x)).toEqual([17000, 24000, 34500]);
  });
  it('cible sans indicateur → uniform à la pression', () => {
    const w = buildInZoneWeights({ ...base, cibles: [cible({})], pressureVariable: null } as never);
    expect(w).toEqual({ mode: 'uniform', value: 2 });
  });
  it('national pur (panier vide) → by_insee_variable abstention (comportement historique)', () => {
    const w = buildInZoneWeights({ ...base, cibles: [], pressureVariable: null } as never);
    expect(w).toMatchObject({ mode: 'by_insee_variable', variable_code: 'abstention_pres_2022' });
  });
});
```

- [ ] **Step 2: FAIL** puis implémenter dans `types.ts` :

```typescript
/** in_zone_weights de la stratégie : courbe sur l'indicateur de la cible,
 *  uniforme si la cible n'a pas d'indicateur, abstention en national pur (historique). */
export function buildInZoneWeights(d: ProgDraft): Record<string, unknown> {
  const hasZones = d.cibles.length > 0;
  const floor = diffusionCurveFloor(d.diffusion, hasZones);
  const indicators = resolvePressureIndicators(d.cibles);
  const chosen = indicators.find((i) => i.code === d.pressureVariable) ?? indicators[0] ?? null;
  if (hasZones && !chosen) {
    return { mode: 'uniform', value: clampPressure(d.pressure) };
  }
  const variable = chosen ?? { code: 'abstention_pres_2022', label: '', min: 10, max: 60 };
  return {
    mode: 'by_insee_variable',
    variable_code: variable.code,
    curve: pressureCurve(d.pressure, floor, { min: variable.min, max: variable.max }),
  };
}
```

- [ ] **Step 3: StepLancement** — remplacer le bloc `in_zone_weights` de `commonFields` par `in_zone_weights: buildInZoneWeights(draft)` (supprimer l'import du fallback de Task 2). Adapter la ligne du récap « Cible · pression ×N » : `Taux d'abstention (2022)` devient le label de l'indicateur choisi (`resolvePressureIndicators(draft.cibles).find(i => i.code === draft.pressureVariable)?.label ?? indicators[0]?.label ?? (draft.cibles.length ? 'pression uniforme' : "Taux d'abstention (2022)")`).

- [ ] **Step 4: StepPression** — sous le `<Lead>`, afficher la variable :

```tsx
{(() => {
  const indicators = resolvePressureIndicators(draft.cibles);
  if (draft.cibles.length > 0 && indicators.length === 0) {
    return (
      <div style={{ fontFamily: fInter, fontSize: 12, color: C.textSec, marginBottom: 16 }}>
        Ta cible ne porte pas d&apos;indicateur (zones dessinées) — la pression s&apos;applique
        uniformément (×{draft.pressure.toLocaleString('fr-FR')}) dans la cible.
      </div>
    );
  }
  if (indicators.length === 0) return null; // national pur : abstention historique, rien à choisir
  return (
    <FieldBlock label="Pression sur">
      {indicators.length === 1 ? (
        <div style={{ fontFamily: fInter, fontSize: 13, color: C.text }}>{indicators[0].label}</div>
      ) : (
        <select
          value={draft.pressureVariable ?? indicators[0].code}
          onChange={(e) => setDraft((prev) => ({ ...prev, pressureVariable: e.target.value }))}
          aria-label="Indicateur de pression"
          style={{ width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: C.text }}
        >
          {indicators.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
        </select>
      )}
    </FieldBlock>
  );
})()}
```
(Imports à ajouter : `resolvePressureIndicators`, `C`, `fInter` — `FieldBlock` déjà importé.)

- [ ] **Step 5: Matérialisation lazy côté serveur** — dans `app/api/bidding/strategies/route.ts` (POST) et `[id]/route.ts` (PATCH), juste AVANT l'appel RPC `apply_zone_weights_to_strategy` :

```typescript
// L'indicateur de la courbe doit être matérialisé par CP (frais < 30 j) avant l'application.
const varCode = (newInWeights as { variable_code?: string }).variable_code;
if (varCode) {
  const { data: fresh } = await supabase
    .from('indicator_cp_values')
    .select('computed_at')
    .eq('indicator_code', varCode)
    .limit(1)
    .maybeSingle();
  const stale = !fresh || Date.now() - new Date(fresh.computed_at).getTime() > 30 * 24 * 3600 * 1000;
  if (stale) {
    const { error: matErr } = await supabase.rpc('materialize_indicator_cp_values', { p_indicator_code: varCode });
    if (matErr) {
      return NextResponse.json({ error: 'indicator_not_ready', detail: matErr.message }, { status: 422 });
    }
  }
}
```
(Dans le POST, la variable équivalente à `newInWeights` est le `in_zone_weights` du body — adapter le nom local.)

- [ ] **Step 6: Vérifier** — vitest ciblé PASS, `npx tsc --noEmit`, suite complète verte.

- [ ] **Step 7: Vérif browser (mode démo)** — `npm run dev` ; wizard campagne démo : construire une cible « Revenu médian ≥ 30000 », étape Pression affiche « Pression sur : Revenu médian », Lancement → succès ; puis en SQL vérifier `bidding_strategies.in_zone_weights->>'variable_code' = 'rev_median'` et des `bidding_zone_configs` variés. Restaurer ensuite la stratégie démo (relancer un wizard abstention ou re-run SQL Task 1 Step 4).

- [ ] **Step 8: Commit**

```bash
git add components/campaign/wizard/steps/ app/api/bidding/strategies/ tests/unit/campaigns/pressure-variable.test.ts
git commit -m "feat: la pression s'applique à l'indicateur réellement ciblé — select multi-indicateurs, uniforme sans indicateur, matérialisation lazy"
```

### Task 4: Export custom bidding sur `indicator_cp_values`

**Files:**
- Modify: `app/api/bidding/strategies/[id]/export/route.ts`
- Test: existant `tests/` export (repérer via `grep -rn "bidding-export" tests/`) — ajouter un cas si la logique testable bouge, sinon tests inchangés (la route lit juste une autre table).

**Interfaces:**
- Consumes: table `indicator_cp_values` (Task 1).

- [ ] **Step 1: Localiser `VARIABLE_SOURCES`** en tête de `app/api/bidding/strategies/[id]/export/route.ts` (map `variableCode → { table, cpCol, valCol }`). La remplacer par une source unique :

```typescript
// Toutes les variables lisent indicator_cp_values (matérialisée au Lancement).
const INDICATOR_SOURCE = { table: 'indicator_cp_values', cpCol: 'postal_code', valCol: 'value' } as const;
```
Aux deux endroits qui requêtent `source.table` (bloc zoneCps chunké et bloc national paginé), ajouter `.eq('indicator_code', target.variableCode)` à la requête. Supprimer le 422 `unsupported_variable` (toute variable du registre est supportée) — le remplacer par : si 0 valeur lue ET une courbe est demandée → 422 `{ error: 'indicator_not_materialized', variable: target.variableCode }`.

- [ ] **Step 2: Vérifier** — `npx tsc --noEmit` ; `npx vitest run` (les tests unitaires d'export portent sur le binning/CSV, pas la source).

- [ ] **Step 3: Vérif fonctionnelle** — dev server, étape Lancement de la campagne démo (stratégie active) : télécharger le fichier dv360 → paliers non triviaux (≠ tout à 1).

- [ ] **Step 4: Commit**

```bash
git add app/api/bidding/strategies/[id]/export/route.ts
git commit -m "feat: export custom bidding lit indicator_cp_values — toute variable du registre supportée"
```

---

## Phase 2 — Naissance & rattachement

### Task 5: `POST /api/admin/campaigns` — campagne vierge

**Files:**
- Modify: `app/api/admin/campaigns/route.ts` (ajouter POST à côté du GET existant)
- Create: `lib/campaigns/blank-campaign.ts`
- Test: `tests/unit/campaigns/blank-campaign.test.ts`

**Interfaces:**
- Produces: `defaultCampaignName(d: Date): string` (`Nouvelle campagne — JJ/MM/AAAA`) ; route POST body `{ name?: string; organization_id?: string }` → `{ campaign: { id, name } }` (201).

- [ ] **Step 1: Test qui échoue** :

```typescript
import { describe, it, expect } from 'vitest';
import { defaultCampaignName } from '@/lib/campaigns/blank-campaign';

describe('defaultCampaignName', () => {
  it('format « Nouvelle campagne — JJ/MM/AAAA »', () => {
    expect(defaultCampaignName(new Date('2026-07-16T10:00:00Z'))).toBe('Nouvelle campagne — 16/07/2026');
  });
});
```

- [ ] **Step 2: FAIL puis implémenter** `lib/campaigns/blank-campaign.ts` :

```typescript
/** Nom par défaut d'une campagne créée vierge depuis l'overlay (naissance MAGELIAN). */
export function defaultCampaignName(d: Date): string {
  return `Nouvelle campagne — ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

/** Source des campagnes nées dans MAGELIAN (pas d'import DSP à la création). */
export const MAGELIAN_SOURCE = 'magelian';
```

- [ ] **Step 3: Ajouter le POST** dans `app/api/admin/campaigns/route.ts` (mêmes imports middleware que le GET du fichier) :

```typescript
import { z } from 'zod';
import { defaultCampaignName, MAGELIAN_SOURCE } from '@/lib/campaigns/blank-campaign';

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  organization_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  let raw: unknown;
  try { raw = await request.json(); } catch { raw = {}; }
  const parsed = CreateSchema.safeParse(raw ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const orgId = parsed.data.organization_id ?? profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'organization_required' }, { status: 400 });
  if (profile.role !== 'super_admin' && orgId !== profile.organization_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: campaign, error } = await supabase
    .from('dsp_campaigns')
    .insert({
      name: parsed.data.name ?? defaultCampaignName(new Date()),
      dsp_source: MAGELIAN_SOURCE,
      organization_id: orgId,
      created_by: profile.id,
      total_tracked_ads: 0,
      total_unique_impressions: 0,
    })
    .select('id, name')
    .single();
  if (error || !campaign) {
    console.error('[POST /api/admin/campaigns]', error?.message);
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
  await supabase.from('campaign_organizations').upsert(
    { campaign_id: campaign.id, organization_id: orgId, added_by: profile.id },
    { onConflict: 'campaign_id,organization_id', ignoreDuplicates: true },
  );
  return NextResponse.json({ campaign }, { status: 201 });
}
```
Vérifier les colonnes NOT NULL de `dsp_campaigns` via MCP (`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='dsp_campaigns'`) et compléter l'insert si besoin.

- [ ] **Step 4: Vérifier** — vitest PASS, `npx tsc --noEmit`. Test manuel : `curl -X POST` impossible sans token → vérifier au Step browser de Task 6.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/blank-campaign.ts app/api/admin/campaigns/route.ts tests/unit/campaigns/blank-campaign.test.ts
git commit -m "feat: POST /api/admin/campaigns — naissance de campagne vierge (dsp_source magelian)"
```

### Task 6: Bouton « + Nouvelle campagne » dans l'overlay

**Files:**
- Modify: `components/magelian/MagelianOverlay.tsx` (bloc sélecteur, lignes ~300-329)

**Interfaces:**
- Consumes: `POST /api/admin/campaigns` (Task 5).

- [ ] **Step 1: Ajouter le handler** (près de `handleCampaignDeleted`, ~ligne 138) :

```typescript
const [creating, setCreating] = useState(false);
const handleCreateCampaign = useCallback(async () => {
  if (creating) return;
  setCreating(true);
  try {
    const res = await adminFetch('/api/admin/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.campaign) return;
    setCampaigns((prev) => [{ id: d.campaign.id, name: d.campaign.name }, ...(prev ?? [])]);
    setSelectedId(d.campaign.id);
    setTab('creation');
  } finally {
    setCreating(false);
  }
}, [creating]);
```

- [ ] **Step 2: Ajouter le bouton** à droite du `<select>` (dans le div ligne ~300) :

```tsx
<button
  type="button"
  onClick={() => { void handleCreateCampaign(); }}
  disabled={creating}
  style={{
    background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)',
    borderRadius: 6, padding: '8px 14px', fontFamily: fInter, fontSize: 12, fontWeight: 500,
    cursor: creating ? 'wait' : 'pointer',
  }}
>
  {creating ? 'Création…' : '+ Nouvelle campagne'}
</button>
```

- [ ] **Step 3: Vérif browser** — login, ouvrir l'overlay MAGELIAN, cliquer « + Nouvelle campagne » : la campagne apparaît sélectionnée, onglet Création s'ouvre sur l'étape Cible avec le nom par défaut. Renommer, avancer d'une étape, revenir : OK. SQL : `SELECT dsp_source FROM dsp_campaigns ORDER BY created_at DESC LIMIT 1` → `magelian`. **Supprimer la campagne de test** via l'UI (Aperçu → Supprimer) ou SQL.

- [ ] **Step 4: `npx tsc --noEmit` + commit**

```bash
git add components/magelian/MagelianOverlay.tsx
git commit -m "feat: bouton + Nouvelle campagne dans l'overlay — le wizard démarre sans import préalable"
```

### Task 7: Auto-match à l'import (liaison ad server ou nom)

**Files:**
- Create: `lib/campaigns/import-match.ts`
- Modify: `app/api/admin/campaigns/import/route.ts` (~lignes 150 et 200-215)
- Test: `tests/unit/campaigns/import-match.test.ts`

**Interfaces:**
- Produces: `findMatchingCampaign(candidates, dspSource, fileCampaignName): { id: string; name: string; matchedBy: 'link' | 'name' } | null` où `candidates = Array<{ id, name, dsp_source, geo_strategy }>`.
- Consumes (route): `existingCampaign` (mécanisme d'append idempotent déjà en place — l'auto-match ne fait qu'alimenter cette variable quand `requestedCampaignId` est absent).

- [ ] **Step 1: Tests qui échouent** :

```typescript
import { describe, it, expect } from 'vitest';
import { findMatchingCampaign } from '@/lib/campaigns/import-match';

const camp = (id: string, name: string, links?: Record<string, Record<string, string>>) => ({
  id, name, dsp_source: 'magelian',
  geo_strategy: links ? { channels: { links } } : {},
});

describe('findMatchingCampaign', () => {
  it('match par liaison : links.<dspSource>.campaign_id == nom de campagne du fichier', () => {
    const c = camp('1', 'Ma campagne', { adform: { campaign_id: '886641' } });
    expect(findMatchingCampaign([c], 'adform', '886641')).toMatchObject({ id: '1', matchedBy: 'link' });
  });
  it('match par liaison sur campaign_name (trim + insensible à la casse)', () => {
    const c = camp('1', 'Interne', { adform: { campaign_name: ' Vague Été ' } });
    expect(findMatchingCampaign([c], 'adform', 'vague été')).toMatchObject({ id: '1', matchedBy: 'link' });
  });
  it('match par nom de campagne à défaut de liaison', () => {
    const c = camp('2', 'Vague été');
    expect(findMatchingCampaign([c], 'adform', 'VAGUE ÉTÉ ')).toMatchObject({ id: '2', matchedBy: 'name' });
  });
  it('la liaison prime sur le nom ; aucun match → null', () => {
    const byLink = camp('1', 'autre', { adform: { campaign_id: 'X1' } });
    const byName = camp('2', 'X1');
    expect(findMatchingCampaign([byLink, byName], 'adform', 'X1')?.id).toBe('1');
    expect(findMatchingCampaign([byName], 'tiktok', 'zzz')).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL puis implémenter** `lib/campaigns/import-match.ts` :

```typescript
/**
 * Rattachement import → campagne existante (spec 2026-07-16) : quand aucun
 * campaign_id n'est demandé explicitement, on cherche la campagne de l'org
 * dont la liaison plateforme du canal source (channels.links[dspSource])
 * référence la campagne du fichier — à défaut, dont le nom est identique.
 */
export interface MatchCandidate {
  id: string;
  name: string;
  dsp_source: string | null;
  geo_strategy: Record<string, unknown> | null;
}

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export function findMatchingCampaign(
  candidates: MatchCandidate[],
  dspSource: string,
  fileCampaignName: string,
): { id: string; name: string; matchedBy: 'link' | 'name' } | null {
  const wanted = norm(fileCampaignName);
  if (!wanted) return null;
  for (const c of candidates) {
    const links = ((c.geo_strategy as { channels?: { links?: Record<string, Record<string, unknown>> } } | null)
      ?.channels?.links ?? {})[dspSource];
    if (links && (norm(links.campaign_id) === wanted || norm(links.campaign_name) === wanted)) {
      return { id: c.id, name: c.name, matchedBy: 'link' };
    }
  }
  const byName = candidates.find((c) => norm(c.name) === wanted);
  return byName ? { id: byName.id, name: byName.name, matchedBy: 'name' } : null;
}
```

- [ ] **Step 3: Brancher dans la route d'import** — dans `app/api/admin/campaigns/import/route.ts`, à l'intérieur du stream, juste avant le bloc `if (existingCampaign) { … } else { insert }` (~ligne 200). `existingCampaign` doit devenir mutable dans la portée du stream (le déclarer `let`). Ajouter :

```typescript
// Auto-rattachement : sans campaign_id explicite, chercher une campagne de l'org
// dont la liaison du canal source (ou le nom) référence la campagne du fichier.
if (!existingCampaign && campaignName) {
  const { data: candidates } = await supabase
    .from('dsp_campaigns')
    .select('id, name, dsp_source, geo_strategy, organization_id')
    .eq('organization_id', organizationId)
    .limit(200);
  const match = findMatchingCampaign((candidates ?? []) as never, dspSource, campaignName);
  if (match) {
    const { data: camp } = await supabase
      .from('dsp_campaigns')
      .select('id, organization_id, dsp_source')
      .eq('id', match.id)
      .single();
    if (camp) {
      existingCampaign = camp;
      send({
        type: 'progress', processed: 0, total: totalRows,
        message: `Données rattachées à la campagne existante « ${match.name} » (via ${match.matchedBy === 'link' ? 'liaison plateforme' : 'nom identique'})`,
      });
    }
  }
}
```
Import à ajouter en tête de fichier : `import { findMatchingCampaign } from '@/lib/campaigns/import-match';`.

- [ ] **Step 4: Vérifier** — vitest PASS, `npx tsc --noEmit`, suite complète verte.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/import-match.ts app/api/admin/campaigns/import/route.ts tests/unit/campaigns/import-match.test.ts
git commit -m "feat: l'import Adform/DSP se rattache automatiquement à la campagne liée (liaison plateforme ou nom)"
```

### Task 8: Rattacher un import orphelin depuis le wizard (absorb)

**Files:**
- Create: `app/api/admin/campaigns/[id]/absorb/route.ts`
- Create: `app/api/admin/campaigns/attachable/route.ts`
- Modify: `components/campaign/wizard/steps/StepCanaux.tsx` (bouton + modal dans la zone liaisons)
- Test: pas de test unitaire dédié (logique = SQL scoping) — vérif browser + SQL obligatoire.

**Interfaces:**
- Produces: `GET /api/admin/campaigns/attachable?exclude=<id>` → `{ campaigns: Array<{ id, name, dsp_source, rows: number, date_start, date_end }> }` ; `POST /api/admin/campaigns/[id]/absorb` body `{ source_campaign_id }` → `{ moved: number }`.
- Garde-fou : la cible doit avoir **0 ligne** de données (les campagnes nées `magelian` avant lancement) — sinon 409 `target_has_data`. Ça neutralise tout conflit d'unicité `idx_dsp_data_unique`, pas de pré-agrégation nécessaire.

- [ ] **Step 1: Route attachable** (`app/api/admin/campaigns/attachable/route.ts`) :

```typescript
/**
 * GET /api/admin/campaigns/attachable?exclude=<campaignId>
 * Campagnes importées de l'org rattachables à une campagne du wizard :
 * elles ont des données mais aucune stratégie de bidding.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const exclude = request.nextUrl.searchParams.get('exclude');

  const supabase = createAdminClient();
  const { data: exCamp } = exclude
    ? await supabase.from('dsp_campaigns').select('organization_id').eq('id', exclude).maybeSingle()
    : { data: null };
  const orgId = exCamp?.organization_id ?? profile.organization_id;
  if (!orgId) return NextResponse.json({ campaigns: [] });
  if (profile.role !== 'super_admin' && orgId !== profile.organization_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [{ data: camps }, { data: strats }] = await Promise.all([
    supabase.from('dsp_campaigns')
      .select('id, name, dsp_source, date_start, date_end, total_tracked_ads')
      .eq('organization_id', orgId)
      .neq('id', exclude ?? '00000000-0000-0000-0000-000000000000')
      .gt('total_tracked_ads', 0)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('bidding_strategies').select('campaign_id'),
  ]);
  const withStrategy = new Set((strats ?? []).map((s) => s.campaign_id));
  const campaigns = (camps ?? [])
    .filter((c) => !withStrategy.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, dsp_source: c.dsp_source, rows: c.total_tracked_ads, date_start: c.date_start, date_end: c.date_end }));
  return NextResponse.json({ campaigns });
}
```

- [ ] **Step 2: Route absorb** (`app/api/admin/campaigns/[id]/absorb/route.ts`) :

```typescript
/**
 * POST /api/admin/campaigns/[id]/absorb — fusionne un import orphelin dans
 * cette campagne (données + dates + totaux), puis supprime la coquille source.
 * Cible SANS données uniquement (409 sinon) : conflit d'unicité impossible.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ source_campaign_id: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();
  const { id } = await params;

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const sourceId = parsed.data.source_campaign_id;
  if (sourceId === id) return NextResponse.json({ error: 'self_absorb' }, { status: 400 });

  const supabase = createAdminClient();
  const [{ data: target }, { data: source }] = await Promise.all([
    supabase.from('dsp_campaigns').select('id, organization_id, total_tracked_ads, date_start, date_end').eq('id', id).maybeSingle(),
    supabase.from('dsp_campaigns').select('id, organization_id, dsp_source, total_tracked_ads, total_unique_impressions, countries, date_start, date_end').eq('id', sourceId).maybeSingle(),
  ]);
  if (!target || !source) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  const sameOrg = target.organization_id === source.organization_id;
  const inScope = profile.role === 'super_admin' || target.organization_id === profile.organization_id;
  if (!sameOrg || !inScope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { count } = await supabase.from('dsp_campaign_data').select('id', { count: 'exact', head: true }).eq('campaign_id', id);
  if ((count ?? 0) > 0) return NextResponse.json({ error: 'target_has_data' }, { status: 409 });

  const { error: moveErr } = await supabase
    .from('dsp_campaign_data')
    .update({ campaign_id: id })
    .eq('campaign_id', sourceId);
  if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 500 });

  await supabase.from('dsp_campaigns').update({
    total_tracked_ads: source.total_tracked_ads,
    total_unique_impressions: source.total_unique_impressions,
    countries: source.countries,
    date_start: target.date_start ?? source.date_start,
    date_end: target.date_end ?? source.date_end,
  }).eq('id', id);

  const { error: delErr } = await supabase.from('dsp_campaigns').delete().eq('id', sourceId);
  if (delErr) console.error('[absorb] coquille non supprimée:', delErr.message);

  return NextResponse.json({ moved: source.total_tracked_ads ?? 0 });
}
```
Note volumes : l'UPDATE par `campaign_id` est un seul statement indexé (`idx` sur campaign_id existe pour les FK/queries) — pas de boucle applicative ; si un test réel sur 200k+ lignes dépasse le timeout, passer par lots datés (`.gte('date', …)`).

- [ ] **Step 3: UI wizard** — dans `StepCanaux.tsx`, sous la section « Liaisons plateformes », si `draft.channels.ad_server` est sélectionné, afficher :

```tsx
<AbsorbPanel campaignId={campaignId} />
```
Créer le composant dans le même fichier (ou `AbsorbPanel.tsx` séparé si > 80 lignes) :

```tsx
function AbsorbPanel({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Array<{ id: string; name: string; dsp_source: string | null; rows: number }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = async () => {
    setOpen(true);
    const res = await adminFetch(`/api/admin/campaigns/attachable?exclude=${campaignId}`, { cache: 'no-store' });
    const d = res.ok ? await res.json() : { campaigns: [] };
    setList(d.campaigns ?? []);
  };
  const absorb = async (sourceId: string, name: string) => {
    if (busy) return;
    if (!window.confirm(`Rattacher les données de « ${name} » à cette campagne ? L'import source sera supprimé — action irréversible.`)) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${campaignId}/absorb`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_campaign_id: sourceId }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setDone(`${d.moved ?? 0} lignes rattachées depuis « ${name} »`); setOpen(false); }
      else if (d.error === 'target_has_data') setDone('Cette campagne a déjà des données — rattachement impossible.');
      else setDone(`Échec : ${d.error ?? res.status}`);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 10 }}>
      {!open && (
        <button type="button" onClick={() => { void load(); }}
          style={{ background: 'transparent', border: `0.5px solid ${C.borderDefault}`, color: C.textSec, borderRadius: 6, padding: '7px 12px', fontFamily: fInter, fontSize: 12, cursor: 'pointer' }}>
          Rattacher un import existant
        </button>
      )}
      {open && (
        <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list === null && <span style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Chargement…</span>}
          {list?.length === 0 && <span style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Aucun import non programmé dans ton organisation.</span>}
          {list?.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontFamily: fInter, fontSize: 12.5, color: C.text }}>{c.name}</span>
              <span style={{ fontFamily: fMono, fontSize: 11, color: C.textDim }}>{c.dsp_source} · {c.rows.toLocaleString('fr-FR')} lignes</span>
              <button type="button" disabled={busy} onClick={() => { void absorb(c.id, c.name); }}
                style={{ background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)', borderRadius: 6, padding: '5px 10px', fontFamily: fInter, fontSize: 11, cursor: 'pointer' }}>
                Rattacher
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setOpen(false)} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: C.textDim, fontFamily: fInter, fontSize: 11, cursor: 'pointer', padding: 0 }}>Fermer</button>
        </div>
      )}
      {done && <div style={{ marginTop: 6, fontFamily: fInter, fontSize: 12, color: C.textSec }}>{done}</div>}
    </div>
  );
}
```
(Utiliser `confirm-modal.tsx` de `components/ui/` à la place de `window.confirm` si son API est un simple `onConfirm` — vérifier le composant avant.)

- [ ] **Step 4: Vérif browser + SQL** — créer une campagne vierge (Task 6), sélectionner un ad server, « Rattacher un import existant » : la campagne démo n'apparaît PAS si elle a une stratégie (attendu). Créer un mini import de test si nécessaire, rattacher, puis vérifier : `SELECT count(*) FROM dsp_campaign_data WHERE campaign_id='<nouvelle>'` > 0 et la source supprimée. Nettoyer les données de test.

- [ ] **Step 5: `npx tsc --noEmit` + suite verte + commit**

```bash
git add app/api/admin/campaigns/ components/campaign/wizard/steps/StepCanaux.tsx
git commit -m "feat: rattacher un import orphelin à une campagne du wizard (absorb, cible vide uniquement)"
```

---

## Phase 3 — Hub de liaisons + double validation

### Task 9: `ChannelHubRecap` + coche de confirmation (étape Canaux)

**Files:**
- Create: `components/campaign/wizard/steps/ChannelHubRecap.tsx`
- Modify: `components/campaign/wizard/steps/StepCanaux.tsx`
- Modify: `components/campaign/wizard/steps/types.ts` (helper `linksSelectionHash`)
- Test: `tests/unit/campaigns/links-confirm.test.ts`

**Interfaces:**
- Produces: `linksSelectionHash(channels: CampaignChannels, links: DspLinks): string` (JSON canonique trié) ; composant `<ChannelHubRecap draft resolved />` (affichage pur) ; état local StepCanaux `confirmedHash: string | null` — `Continuer` exige `confirmedHash === linksSelectionHash(...)`.

- [ ] **Step 1: Test qui échoue** :

```typescript
import { describe, it, expect } from 'vitest';
import { linksSelectionHash } from '@/components/campaign/wizard/steps/types';

const sel = { dsps: ['dv360'], socials: [], ad_server: 'adform' as string | null };

describe('linksSelectionHash', () => {
  it('stable pour un contenu identique (ordre des clés indifférent)', () => {
    expect(linksSelectionHash(sel, { dv360: { advertiser_id: '1', campaign_id: '2' } }))
      .toBe(linksSelectionHash({ ...sel }, { dv360: { campaign_id: '2', advertiser_id: '1' } }));
  });
  it('change si un canal, l ad server ou une liaison change', () => {
    const h = linksSelectionHash(sel, {});
    expect(linksSelectionHash({ ...sel, dsps: ['dv360', 'ttd'] }, {})).not.toBe(h);
    expect(linksSelectionHash({ ...sel, ad_server: 'cm360' }, {})).not.toBe(h);
    expect(linksSelectionHash(sel, { dv360: { advertiser_id: '9' } })).not.toBe(h);
  });
});
```

- [ ] **Step 2: FAIL puis implémenter** dans `types.ts` :

```typescript
import type { DspLinks } from '@/lib/campaigns/channels';

/** Empreinte canonique de la sélection canaux + liaisons — la coche de
 *  confirmation (étape Canaux) se réinitialise dès qu'elle change. */
export function linksSelectionHash(channels: CampaignChannels, links: DspLinks): string {
  const sortedLinks = Object.fromEntries(
    Object.entries(links)
      .filter(([, v]) => v && Object.keys(v).length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, Object.fromEntries(Object.entries(v ?? {}).sort(([a], [b]) => a.localeCompare(b)))]),
  );
  return JSON.stringify({
    d: [...channels.dsps].sort(),
    s: [...channels.socials].sort(),
    a: channels.ad_server,
    l: sortedLinks,
  });
}
```

- [ ] **Step 3: Composant `ChannelHubRecap.tsx`** (affichage pur, zéro fetch) :

```tsx
'use client';

/**
 * Mini-graph « câblage » de la campagne (étape Canaux, validé 16/07) :
 * hub central (nom + annonceur), branches MESURE / DSP / SOCIAL, état de
 * liaison par canal. Données 100% locales (draft + catalogue résolu).
 */
import type { ResolvedChannel } from '@/lib/campaigns/channels';
import { linksComplete, linksSummary } from '@/lib/campaigns/platform-links';
import type { ProgDraft } from './types';
import { C, fInter, fMono } from './ui';

interface Props { draft: ProgDraft; resolved: ResolvedChannel[] }

function Branch({ title, rows }: { title: string; rows: Array<{ code: string; label: string; linked: boolean; detail: string }> }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ flex: 1, minWidth: 150, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textDim, marginBottom: 8 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.code} style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: fInter, fontSize: 12.5, color: C.text }}>{r.label}</div>
          <div style={{ fontFamily: fMono, fontSize: 11, color: r.linked ? 'var(--success)' : C.textDim }}>
            {r.linked ? `✓ liée${r.detail ? ` · ${r.detail}` : ''}` : '— non liée'}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChannelHubRecap({ draft, resolved }: Props) {
  const byCode = new Map(resolved.map((r) => [r.code, r]));
  const row = (code: string) => {
    const r = byCode.get(code);
    const levels = r?.link_levels ?? [];
    const entry = draft.channelLinks[code];
    const linked = levels.length > 0 && linksComplete(entry, levels);
    const partial = !linked && !!entry && Object.values(entry).some((v) => (v ?? '').toString().trim() !== '');
    return {
      code, label: r?.label ?? code,
      linked: linked || partial,
      detail: linksSummary(entry, levels),
    };
  };
  const mesure = draft.channels.ad_server ? [row(draft.channels.ad_server)] : [];
  const dsps = draft.channels.dsps.map(row);
  const socials = draft.channels.socials.map(row);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
      <div style={{ alignSelf: 'center', border: `0.5px solid ${C.borderDefault}`, borderRadius: 8, padding: '10px 18px', textAlign: 'center' }}>
        <div style={{ fontFamily: fInter, fontSize: 13, fontWeight: 500, color: C.text }}>{draft.name || 'Campagne sans nom'}</div>
        {(draft.advertiser || draft.product) && (
          <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
            {[draft.advertiser, draft.product].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      <div aria-hidden style={{ alignSelf: 'center', width: 0.5, height: 14, background: C.borderDefault }} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Branch title="Mesure" rows={mesure} />
        <Branch title="DSP" rows={dsps} />
        <Branch title="Social" rows={socials} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Brancher dans `StepCanaux.tsx`** — après la section Liaisons plateformes, avant Période :

```tsx
{hasSelection && (
  <FieldBlock label="Récapitulatif du câblage">
    <ChannelHubRecap draft={draft} resolved={resolved} />
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', fontFamily: fInter, fontSize: 12.5, color: C.text }}>
      <input
        type="checkbox"
        checked={confirmedHash === currentHash}
        onChange={(e) => setConfirmedHash(e.target.checked ? currentHash : null)}
        style={{ accentColor: 'var(--brand-teal)' }}
      />
      Je confirme ces liaisons
    </label>
  </FieldBlock>
)}
```
Avec, en haut du composant :
```typescript
const [confirmedHash, setConfirmedHash] = useState<string | null>(null);
const currentHash = linksSelectionHash(draft.channels, draft.channelLinks);
```
Et durcir `nextDisabled` : `const nextDisabled = !hasSelection || !total || !draft.startDate || !draft.endDate || confirmedHash !== currentHash;` (hint : `'canal + budget + période + confirmation des liaisons requis'`).

- [ ] **Step 5: Vérifier** — vitest ciblé PASS, tsc propre. Browser : cocher, modifier un budget (ne décoche pas — le budget n'est pas dans le hash), modifier une liaison (décoche), Continuer grisé tant que décoché.

- [ ] **Step 6: Commit**

```bash
git add components/campaign/wizard/steps/ tests/unit/campaigns/links-confirm.test.ts
git commit -m "feat: hub de câblage + confirmation des liaisons à l'étape Canaux (reset sur modification)"
```

### Task 10: Seconde validation au Lancement

**Files:**
- Modify: `components/campaign/wizard/steps/StepLancement.tsx`

**Interfaces:**
- Consumes: `ChannelHubRecap` (Task 9).

- [ ] **Step 1: Afficher le hub condensé** — dans StepLancement, StepCanaux charge le catalogue mais pas Lancement. Le hub a besoin de `resolved` : refaire le fetch léger du catalogue (`/api/campaigns/${campaignId}/channels`, 1 appel, cache `useRef`) dans StepLancement :

```typescript
const [resolved, setResolved] = useState<ResolvedChannel[]>([]);
const catalogRef = useRef(false);
useEffect(() => {
  if (catalogRef.current) return;
  catalogRef.current = true;
  (async () => {
    try {
      const res = await adminFetch(`/api/campaigns/${campaignId}/channels`, { cache: 'no-store' });
      const d = res.ok ? await res.json() : null;
      if (d) setResolved(resolveChannelAvailability(d.catalog ?? [], d.connectedProviders ?? [], !!d.is_demo));
    } catch { /* hub sans détail de labels */ }
  })();
}, [campaignId]);
```
Puis, entre la ligne « Canaux : … » et les fichiers custom bidding :

```tsx
{(draft.channels.dsps.length > 0 || draft.channels.socials.length > 0) && (
  <div style={{ marginTop: 14 }}>
    <ChannelHubRecap draft={draft} resolved={resolved} />
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', fontFamily: fInter, fontSize: 12.5, color: C.text }}>
      <input type="checkbox" checked={linksVerified} onChange={(e) => setLinksVerified(e.target.checked)} style={{ accentColor: 'var(--brand-teal)' }} />
      Liaisons vérifiées — deuxième validation
    </label>
  </div>
)}
```
État : `const [linksVerified, setLinksVerified] = useState(false);` et `invalid` gagne `|| !linksVerified`.

- [ ] **Step 2: Vérif browser** — Lancement : CTA grisé sans la coche, hub visible avec les liaisons saisies à Canaux.

- [ ] **Step 3: tsc + suite verte + commit**

```bash
git add components/campaign/wizard/steps/StepLancement.tsx
git commit -m "feat: seconde validation des liaisons au Lancement (hub condensé + coche)"
```

---

## Phase 4 — Brouillon persistant

### Task 11: Autosave + restauration du ProgDraft

**Files:**
- Create: `components/campaign/wizard/useDraftAutosave.ts`
- Modify: `components/campaign/CampaignCockpit.tsx`
- Modify: `components/campaign/wizard/steps/StepLancement.tsx` (purge après création)
- Test: `tests/unit/campaigns/draft-autosave.test.ts` (sérialisation aller-retour)

**Interfaces:**
- Consumes: routes existantes `GET/POST /api/bidding/strategies/drafts` (`{ campaign_id, current_step (1-5), draft_data }`, upsert `user_id,campaign_id`) et `DELETE /api/bidding/strategies/drafts/[id]`.
- Produces: hook `useDraftAutosave(campaignId, draft, step, enabled): { restored: { draft: ProgDraft; step: number; savedAt: string } | null; draftId: string | null; discard: () => Promise<void> }` ; `PROG_STEP_ORDER: ProgStepKey[]` exporté de `CampaignCockpit` ou de `types.ts`.

- [ ] **Step 1: Test qui échoue** (`tests/unit/campaigns/draft-autosave.test.ts`) :

```typescript
import { describe, it, expect } from 'vitest';
import { serializeDraft, deserializeDraft } from '@/components/campaign/wizard/useDraftAutosave';
import { DEFAULT_PROG_DRAFT } from '@/components/campaign/wizard/steps/types';

describe('serializeDraft/deserializeDraft', () => {
  it('aller-retour sans perte', () => {
    const d = { ...DEFAULT_PROG_DRAFT, name: 'X', pressure: 2.4, channelLinks: { dv360: { advertiser_id: '1' } } };
    expect(deserializeDraft(serializeDraft(d))).toEqual(d);
  });
  it('données inconnues/corrompues → null (on repart du défaut)', () => {
    expect(deserializeDraft({ foo: 'bar' })).toBeNull();
    expect(deserializeDraft(null)).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL puis implémenter le hook** `components/campaign/wizard/useDraftAutosave.ts` :

```typescript
'use client';

/**
 * Autosave du brouillon Programmer vers bidding_strategy_drafts (routes du
 * chantier A4.7, jamais câblées jusqu'ici) : debounce 1 s, clé (user, campagne),
 * restauration au montage, discard explicite. Purgé au Lancement réussi.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { DEFAULT_PROG_DRAFT, type ProgDraft } from './steps/types';

export function serializeDraft(d: ProgDraft): Record<string, unknown> {
  return { v: 1, draft: d };
}

export function deserializeDraft(raw: unknown): ProgDraft | null {
  const data = raw as { v?: number; draft?: Record<string, unknown> } | null;
  if (!data || data.v !== 1 || !data.draft || typeof data.draft !== 'object') return null;
  // Merge sur le défaut : les champs ajoutés depuis la sauvegarde gardent leur défaut.
  return { ...DEFAULT_PROG_DRAFT, ...(data.draft as Partial<ProgDraft>) };
}

export function useDraftAutosave(
  campaignId: string,
  draft: ProgDraft,
  step: number,
  enabled: boolean,
) {
  const [restored, setRestored] = useState<{ draft: ProgDraft; step: number; savedAt: string } | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(true); // ne pas re-sauver l'état qu'on vient de restaurer

  // Restauration (une fois par campagne)
  useEffect(() => {
    loadedRef.current = false;
    setRestored(null);
    setDraftId(null);
  }, [campaignId]);
  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const res = await adminFetch(`/api/bidding/strategies/drafts?campaign_id=${campaignId}`, { cache: 'no-store' });
        const d = res.ok ? await res.json() : null;
        const row = d?.drafts?.[0];
        if (!row) return;
        const parsed = deserializeDraft(row.draft_data);
        if (parsed) {
          setDraftId(row.id);
          setRestored({ draft: parsed, step: row.current_step ?? 1, savedAt: row.last_saved_at });
        }
      } catch { /* pas de restauration */ }
    })();
  }, [campaignId, enabled]);

  // Autosave debounce 1 s
  useEffect(() => {
    if (!enabled) return;
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await adminFetch('/api/bidding/strategies/drafts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaign_id: campaignId, current_step: step, draft_data: serializeDraft(draft) }),
        });
        const d = res.ok ? await res.json() : null;
        if (d?.id) setDraftId(d.id);
      } catch { /* best-effort */ }
    }, 1000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [campaignId, draft, step, enabled]);

  const discard = useCallback(async () => {
    setRestored(null);
    if (!draftId) return;
    try { await adminFetch(`/api/bidding/strategies/drafts/${draftId}`, { method: 'DELETE' }); } catch { /* best-effort */ }
    setDraftId(null);
  }, [draftId]);

  return { restored, draftId, discard };
}
```

- [ ] **Step 3: Brancher dans `CampaignCockpit.tsx`** — le composant connaît `progStep` (clé) et `draft`. Mapper la clé d'étape sur 1-5 (`['cible','canaux','pression','strategie','lancement']`). Appeler le hook quand l'onglet programmer est actif ; à `restored` non nul : `setDraft(restored.draft)`, `setProgStep(clé de restored.step)`, et afficher un bandeau discret au-dessus du wizard :

```tsx
{draftBanner && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', border: '0.5px solid var(--border-subtle)', borderRadius: 6, margin: '0 0 10px', fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)' }}>
    Brouillon restauré ({new Date(draftBanner.savedAt).toLocaleString('fr-FR')})
    <button type="button" onClick={() => { void handleDiscardDraft(); }}
      style={{ background: 'transparent', border: 'none', color: 'var(--brand-teal)', fontFamily: fInter, fontSize: 12, cursor: 'pointer', padding: 0 }}>
      Repartir de zéro
    </button>
  </div>
)}
```
`handleDiscardDraft` = `discard()` + `setDraft(DEFAULT_PROG_DRAFT)` + re-préremplissage nom/dates depuis `detail.campaign` (réutiliser l'effet existant en le déclenchant : remettre `prev.name || camp.name` fonctionne car name vide).
Attention : l'effet de préremplissage existant (`name: prev.name || camp.name`) ne doit PAS écraser un draft restauré — il est déjà non-destructif (`prev.x || …`), OK.

- [ ] **Step 4: Purge au Lancement** — dans `StepLancement`, après le toast succès (`setArmedStrategyId(strategyId)`), appeler une prop `onLaunched?: () => void` fournie par le cockpit qui fait `void discard()`.

- [ ] **Step 5: Vérifier** — vitest ciblé PASS, tsc, suite verte. Browser : saisir nom+annonceur à l'étape Cible, attendre 2 s, recharger la page, rouvrir le wizard → bandeau « Brouillon restauré », valeurs présentes ; « Repartir de zéro » les efface ; après un Lancement réussi, plus de brouillon au rechargement.

- [ ] **Step 6: Commit**

```bash
git add components/campaign/wizard/useDraftAutosave.ts components/campaign/CampaignCockpit.tsx components/campaign/wizard/steps/StepLancement.tsx tests/unit/campaigns/draft-autosave.test.ts
git commit -m "feat: brouillon persistant du wizard — autosave 1 s, restauration, purge au lancement (câblage A4.7)"
```

---

## Phase 5 — Forecast en direct

### Task 12: `ForecastStrip` (impressions, audience, % France)

**Files:**
- Create: `components/campaign/wizard/steps/ForecastStrip.tsx`
- Modify: `components/campaign/wizard/steps/StepCanaux.tsx` (sous « Budget global »)
- Modify: `components/campaign/wizard/steps/StepLancement.tsx` (au-dessus des RecapRow)
- Test: `tests/unit/campaigns/forecast.test.ts`

**Interfaces:**
- Consumes: `CibleZoneRef.population` (Task 2) ; `GET /api/custom-geo/national-totals` (existant, → `{ totals: { total_population: number, … } }` — vérifier la clé exacte en lisant `app/api/custom-geo/national-totals/route.ts` avant d'écrire le fetch).
- Produces: `computeForecast(budget, cpm, ciblePops): { impressions: number | null; audience: number | null; costPerThousandPeople: number | null }` exporté du composant.

- [ ] **Step 1: Test qui échoue** :

```typescript
import { describe, it, expect } from 'vitest';
import { computeForecast } from '@/components/campaign/wizard/steps/ForecastStrip';

describe('computeForecast', () => {
  it('impressions = budget / CPM × 1000', () => {
    expect(computeForecast(52000, 7.1, []).impressions).toBe(Math.round((52000 / 7.1) * 1000));
  });
  it('audience = somme des populations connues ; null si aucune', () => {
    expect(computeForecast(1000, 5, [1200, 800]).audience).toBe(2000);
    expect(computeForecast(1000, 5, []).audience).toBeNull();
  });
  it('coût / 1000 habitants ; null sans budget, CPM ou audience', () => {
    expect(computeForecast(2000, 5, [1000000]).costPerThousandPeople).toBe(2);
    expect(computeForecast(null, 5, [100]).impressions).toBeNull();
    expect(computeForecast(2000, null, [100]).impressions).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL puis implémenter** `ForecastStrip.tsx` :

```tsx
'use client';

/**
 * Forecast en direct (étapes Canaux + Lancement) : impressions estimées
 * (budget ÷ CPM × 1000), audience de la cible (populations capturées à la
 * matérialisation), % France (total national, 1 fetch caché par montage).
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ProgDraft } from './types';
import { draftTotalBudget } from './types';
import { C, fInter, fMono } from './ui';

export function computeForecast(
  budget: number | null,
  cpm: number | null,
  ciblePops: number[],
): { impressions: number | null; audience: number | null; costPerThousandPeople: number | null } {
  const impressions = budget && cpm && cpm > 0 ? Math.round((budget / cpm) * 1000) : null;
  const audience = ciblePops.length > 0 ? ciblePops.reduce((s, v) => s + v, 0) : null;
  const costPerThousandPeople = budget && audience ? Math.round((budget / audience) * 1000 * 100) / 100 : null;
  return { impressions, audience, costPerThousandPeople };
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: fInter, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textDim }}>{label}</div>
      <div style={{ fontFamily: fMono, fontSize: 14, color: C.text }}>{value}</div>
    </div>
  );
}

export function ForecastStrip({ draft }: { draft: ProgDraft }) {
  const [nationalPop, setNationalPop] = useState<number | null>(null);
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const res = await adminFetch('/api/custom-geo/national-totals', { cache: 'no-store' });
        const d = res.ok ? await res.json() : null;
        const total = Number(d?.totals?.total_population ?? d?.total_population ?? NaN);
        if (Number.isFinite(total) && total > 0) setNationalPop(total);
      } catch { /* % France omis */ }
    })();
  }, []);

  const pops = draft.cibles.map((c) => c.population).filter((p): p is number => typeof p === 'number' && p > 0);
  const audienceIsPartial = draft.cibles.length > 0 && pops.length < draft.cibles.length;
  const { impressions, audience, costPerThousandPeople } = computeForecast(draftTotalBudget(draft), draft.forecastCpm, pops);
  const effAudience = draft.cibles.length === 0 ? nationalPop : audience;
  const pctFrance = effAudience && nationalPop ? Math.min(100, Math.round((effAudience / nationalPop) * 1000) / 10) : null;

  if (impressions == null && effAudience == null) return null;
  const fmtInt = (n: number) => n.toLocaleString('fr-FR');
  return (
    <div style={{ display: 'flex', gap: 14, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', margin: '0 0 18px' }}>
      <Cell label="Impressions estimées" value={impressions != null ? fmtInt(impressions) : '—'} />
      <Cell label={`Audience cible${audienceIsPartial ? ' (partielle)' : ''}`} value={effAudience != null ? `${fmtInt(effAudience)} hab.` : '—'} />
      <Cell label="% France" value={pctFrance != null ? `${pctFrance.toLocaleString('fr-FR')} %` : '—'} />
      <Cell label="€ / 1000 hab." value={costPerThousandPeople != null ? costPerThousandPeople.toLocaleString('fr-FR') : '—'} />
    </div>
  );
}
```
Avant d'écrire le fetch, lire `app/api/custom-geo/national-totals/route.ts` et corriger la clé (`d?.totals?...`) selon la forme réelle de la réponse.

- [ ] **Step 3: Brancher** — `StepCanaux.tsx` : `<ForecastStrip draft={draft} />` juste sous le div « Budget global (somme) ». `StepLancement.tsx` : idem au-dessus de la première `RecapRow`.

- [ ] **Step 4: Vérifier** — vitest PASS, tsc, browser : saisir budget + CPM → impressions bougent en direct ; cible matérialisée → audience + % France.

- [ ] **Step 5: Commit**

```bash
git add components/campaign/wizard/steps/ForecastStrip.tsx components/campaign/wizard/steps/StepCanaux.tsx components/campaign/wizard/steps/StepLancement.tsx tests/unit/campaigns/forecast.test.ts
git commit -m "feat: forecast en direct dans le wizard — impressions, audience cible, % France, € / 1000 hab."
```

---

## Phase 6 — Stratégie enrichie

### Task 13: Objectif + KPI + capping + pacing dans l'étape Stratégie

**Files:**
- Modify: `components/campaign/wizard/steps/types.ts` (draft étendu)
- Modify: `components/campaign/wizard/steps/StepStrategie.tsx`
- Modify: `components/campaign/wizard/steps/StepLancement.tsx` (envoi des champs + récap)
- Test: `tests/unit/campaigns/strategy-fields.test.ts`

**Interfaces:**
- Consumes: `GET /api/bidding/objectives` (existant — lire `app/api/bidding/objectives/route.ts` pour la forme exacte ; attendu `{ objectives: Array<{ code, display_name_fr, unit, display_order }> }`, table `bidding_objectives` : 8 objectifs `is_enabled`).
- Produces: draft étendu `{ objective: string; kpiTarget: number | null; freqCapImps: number | null; freqCapDays: number | null; pacing: 'even' | 'front_loaded' | 'back_loaded' }` ; `strategyFieldsFromDraft(d): { objective_code, kpi_target, frequency_cap_imps, frequency_cap_period_days, pacing_strategy }`.

- [ ] **Step 1: Test qui échoue** :

```typescript
import { describe, it, expect } from 'vitest';
import { strategyFieldsFromDraft } from '@/components/campaign/wizard/steps/types';
import { DEFAULT_PROG_DRAFT } from '@/components/campaign/wizard/steps/types';

describe('strategyFieldsFromDraft', () => {
  it('mappe les champs du draft vers le POST stratégie', () => {
    expect(strategyFieldsFromDraft({
      ...DEFAULT_PROG_DRAFT, objective: 'maximize_impressions', kpiTarget: 500000,
      freqCapImps: 3, freqCapDays: 7, pacing: 'front_loaded',
    })).toEqual({
      objective_code: 'maximize_impressions', kpi_target: 500000,
      frequency_cap_imps: 3, frequency_cap_period_days: 7, pacing_strategy: 'front_loaded',
    });
  });
  it('défauts : maximize_leads, pas de KPI, pas de cap, pacing even', () => {
    expect(strategyFieldsFromDraft(DEFAULT_PROG_DRAFT)).toEqual({
      objective_code: 'maximize_leads', kpi_target: null,
      frequency_cap_imps: null, frequency_cap_period_days: null, pacing_strategy: 'even',
    });
  });
  it('cap incomplet (imps sans jours ou l inverse) → pas de cap', () => {
    expect(strategyFieldsFromDraft({ ...DEFAULT_PROG_DRAFT, freqCapImps: 3 }).frequency_cap_imps).toBeNull();
    expect(strategyFieldsFromDraft({ ...DEFAULT_PROG_DRAFT, freqCapDays: 7 }).frequency_cap_period_days).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL puis implémenter dans `types.ts`** — ProgDraft gagne :

```typescript
  /** Objectif d'optimisation (bidding_objectives.code). */
  objective: string;
  /** KPI cible chiffré, dans l'unité de l'objectif (null = pas de cible). */
  kpiTarget: number | null;
  /** Capping fréquence : X impressions / Y jours (les 2 requis, sinon ignoré). */
  freqCapImps: number | null;
  freqCapDays: number | null;
  /** Rythme de dépense. */
  pacing: 'even' | 'front_loaded' | 'back_loaded';
```
Défauts dans `DEFAULT_PROG_DRAFT` : `objective: 'maximize_leads', kpiTarget: null, freqCapImps: null, freqCapDays: null, pacing: 'even'`. Et :

```typescript
export const PACING_META: Record<'even' | 'front_loaded' | 'back_loaded', { title: string; sub: string }> = {
  even: { title: 'Régulier', sub: 'Dépense lissée sur toute la période' },
  front_loaded: { title: 'Départ fort', sub: 'Accélère au début, ralentit ensuite' },
  back_loaded: { title: 'Montée en puissance', sub: 'Démarre doucement, accélère vers la fin' },
};

/** Champs stratégie (POST/PATCH /api/bidding/strategies) portés par l'étape Stratégie. */
export function strategyFieldsFromDraft(d: ProgDraft): {
  objective_code: string; kpi_target: number | null;
  frequency_cap_imps: number | null; frequency_cap_period_days: number | null;
  pacing_strategy: 'even' | 'front_loaded' | 'back_loaded';
} {
  const capComplete = d.freqCapImps != null && d.freqCapImps > 0 && d.freqCapDays != null && d.freqCapDays > 0;
  return {
    objective_code: d.objective || 'maximize_leads',
    kpi_target: d.kpiTarget,
    frequency_cap_imps: capComplete ? d.freqCapImps : null,
    frequency_cap_period_days: capComplete ? d.freqCapDays : null,
    pacing_strategy: d.pacing,
  };
}
```

- [ ] **Step 3: StepStrategie** — ajouter 3 blocs au-dessus de « Autonomie de l'agent » :
  - **Objectif** : fetch `/api/bidding/objectives` au montage (cache `useRef`), `OptsList` d'`OptionRow` (`title = display_name_fr`, `sub = description` tronquée), sélection → `draft.objective`.
  - **KPI cible (optionnel)** : input number → `draft.kpiTarget` (placeholder « valeur cible dans l'unité de l'objectif »).
  - **Capping fréquence (optionnel)** : deux inputs number côte à côte (`Row2`) « impressions max » / « par période (jours) » → `freqCapImps`/`freqCapDays`.
  - **Rythme de dépense** : 3 `OptionRow` depuis `PACING_META` → `draft.pacing`.
Suivre le pattern exact de fetch/état de `StepCible.tsx` (useEffect + cancelled) et les styles d'inputs de `RowBudgetInput`.

- [ ] **Step 4: StepLancement** — dans `commonFields`, ajouter `...strategyFieldsFromDraft(draft)` et retirer les valeurs en dur `objective_code: 'maximize_leads'` du POST (garder `algorithm_code: 'thompson_sampling'` — le choix d'algo reste hors périmètre). Récap : la RecapRow « Automatique » gagne dans son `sub` : objectif (display du code), cap éventuel (`3 imps / 7 j`), pacing.

- [ ] **Step 5: Vérifier** — vitest PASS, tsc, browser : wizard complet avec objectif « Maximiser les impressions », cap 3/7, pacing départ fort → SQL `SELECT objective_code, frequency_cap_imps, frequency_cap_period_days, pacing_strategy FROM bidding_strategies WHERE campaign_id='<id>'`.

- [ ] **Step 6: Commit**

```bash
git add components/campaign/wizard/steps/ tests/unit/campaigns/strategy-fields.test.ts
git commit -m "feat: étape Stratégie enrichie — objectif (catalogue), KPI cible, capping fréquence, pacing"
```

---

## Task 14: Vérification de bout en bout + documentation

**Files:**
- Modify: `ARCHITECTURE.md` (routes nouvelles : POST campaigns, attachable, absorb ; table `indicator_cp_values` ; RPC `materialize_indicator_cp_values`)

- [ ] **Step 1: Suite complète** — `npx tsc --noEmit` (0 erreur), `npm test` (tout vert), `npm run lint` (pas de nouvelle erreur).

- [ ] **Step 2: Parcours browser complet en mode démo** (Playwright MCP, login mémoire) :
  1. « + Nouvelle campagne » → wizard s'ouvre, brouillon nommé.
  2. Cible : nom, annonceur, produit, cible « Revenu médian ≥ 30000 ».
  3. Canaux : DV360 + TikTok + budgets, liaison manuelle DV360, ad server Adform + liaison, hub affiché, coche confirmation.
  4. Pression : « Pression sur : Revenu médian », ×2, zones strictes.
  5. Stratégie : objectif impressions, cap 3/7, pacing régulier.
  6. Recharger la page en cours de route → brouillon restauré.
  7. Lancement : forecast affiché, seconde coche, création OK, fichiers custom bidding téléchargeables.
  8. SQL : advertiser/product, links, in_zone_weights.variable_code='rev_median', objective/cap/pacing, bidding_zone_configs non triviaux, draft purgé.
  9. Nettoyer la campagne de test (Supprimer depuis l'Aperçu).

- [ ] **Step 3: Mettre à jour `ARCHITECTURE.md`** — section routes admin campagnes (3 lignes : POST création vierge, GET attachable, POST absorb), tables (ligne `indicator_cp_values`), RPC (ligne `materialize_indicator_cp_values` + note apply_zone_weights généralisé).

- [ ] **Step 4: Commit final + push**

```bash
git add ARCHITECTURE.md
git commit -m "docs: ARCHITECTURE — wizard complet hors API (naissance, rattachement, indicator_cp_values)"
git push origin main
```
Surveiller le build Vercel (`npx vercel ls`) jusqu'à Ready.
