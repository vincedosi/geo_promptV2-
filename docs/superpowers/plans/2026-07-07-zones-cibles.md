# Zones cibles (étape Cible du setup campagne) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'étape Cible du wizard campagne devient un constructeur de zones cibles : catalogue d'indicateurs (Audience/Comportement/Contexte/Mes zones), seuil dans l'unité naturelle, aperçu count, panier multi-cibles fusionné en zone composite au Lancement — wizard à 4 étapes.

**Architecture:** Tout s'appuie sur les zones custom existantes (`create_custom_geo_zone` + `resolve_custom_geo_zone_codes` via `/api/custom-geo/save`). Nouveau : une table registre `cible_indicator_registry` (fiche de ciblage par indicateur, seedée par migration), une RPC `get_indicator_threshold_selection` (preview count / liste de codes bornée), une RPC `get_composite_zone_geometry` (union de zones membres), deux routes source (`indicator-threshold`, `composite`) sur le pattern des routes source existantes, une route catalogue (`GET /api/cibles/indicators`), une route preview, et la refonte de `StepCible` + retrait de `StepZones`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (PostgreSQL + PostGIS) via MCP, Zod, Vitest.

## Global Constraints

- Spec source : `docs/superpowers/specs/2026-07-07-zones-cibles-design.md`.
- Supabase Nano : preview = COUNT indexé uniquement (jamais de géométrie), cap 10 000 codes avec tri pour troncature propre, max 3 appels Supabase parallèles, `EXPLAIN ANALYZE` documenté pour toute nouvelle requête, index partiels si seq scan.
- SQL : migrations appliquées via MCP Supabase (`apply_migration`, projet `vkkdbygwbrxyogqosten`) + fichier trace `sql/1XX_*.sql` committé — JAMAIS demander à l'utilisateur d'exécuter du SQL. RPC : `security definer` + `set search_path = public` + revoke public/anon/authenticated + grant service_role (pattern sql/098-099).
- Jamais de liste de colonnes hardcodée côté code : le catalogue vient de la table registre ; la RPC résout la colonne depuis le registre (jamais depuis le client).
- UI : tokens `var(--…)` uniquement (jamais de hex nu), Inter + JetBrains Mono, sentence case, flat, pas d'exemple de marque. Sliders conformes DESIGN_SYSTEM.md.
- Routes API : `export const dynamic = 'force-dynamic'`, `requireAuth`/`authUnauthorized` de `@/lib/api/middleware`, validation Zod, `createAdminClient()` de `@/lib/auth`.
- Ne PAS toucher : `middleware.ts`, `app/api/isochrone-battle/*`, moteur de bidding (`/api/bidding/*`), galerie `/map/custom-geo` (les zones créées y apparaissent naturellement).
- Fichiers du wizard : `app/campaigns/[id]/_components/steps/` + `components/campaign/CampaignCockpit.tsx`.
- Code complet, commits atomiques `type: description`. Branche : créer `feat/zones-cibles` depuis `main`.

---

### Task 1: Migration 100 — registre, RPC seuil, RPC composite, indexes

**Files:**
- Create: `sql/100_cibles_registry_and_rpcs.sql` (trace de la migration appliquée via MCP)

**Interfaces:**
- Consomme : tables existantes `iris` (colonnes numériques FR : `part_pop_moins_18`, `pop_15_29`, `population`, `taux_chomage`, `rev_median`…, filtre `is_true_iris`), `dataset_abstention_2022(code_postal, taux_abstention)`, `pollen_map_daily(code_postal, indice_global, date_ech)`, `atmo_map_daily(code_postal, indice_global, date_ech)`, `custom_geo_zones(id, geometry, org_id)`.
- Produit (consommé par Task 2) :
  - Table `cible_indicator_registry(indicator_code text pk, label text, famille text check in ('audience','comportement','contexte'), unit text, slider_min numeric, slider_max numeric, slider_step numeric, default_operator text check in ('>=','<='), data_source text check in ('iris_column','abstention','pollen','atmo'), data_column text, normalize text check in ('none','pct_of_population'), scale text check in ('iris','cp'), dynamic boolean, active boolean, created_at timestamptz)`.
  - RPC `get_indicator_threshold_selection(p_indicator_code text, p_operator text, p_threshold numeric, p_preview boolean) returns jsonb` — preview : `{"count": int, "population": bigint|null, "scale": "iris"|"cp"}` ; sélection : `{"codes": [...], "count": int, "truncated": bool, "scale": ...}` (cap 10 000, tri par valeur desc si `>=`, asc si `<=`).
  - RPC `get_composite_zone_geometry(p_zone_ids uuid[]) returns jsonb` — `{"geometry": <GeoJSON MultiPolygon>}`, 2 à 20 membres, erreur sinon.

- [ ] **Step 1: Rédiger le fichier de migration**

Créer `sql/100_cibles_registry_and_rpcs.sql` :

```sql
-- 100 — Zones cibles : registre d'indicateurs ciblables + RPC seuil + RPC composite.
-- Appliquée via MCP Supabase le 2026-07-07 (spec 2026-07-07-zones-cibles-design.md).

-- ── 1. Registre (catalogue dynamique — jamais de liste hardcodée côté code) ──
create table if not exists public.cible_indicator_registry (
  indicator_code text primary key,
  label text not null,
  famille text not null check (famille in ('audience','comportement','contexte')),
  unit text not null,
  slider_min numeric not null,
  slider_max numeric not null,
  slider_step numeric not null default 1,
  default_operator text not null default '>=' check (default_operator in ('>=','<=')),
  data_source text not null check (data_source in ('iris_column','abstention','pollen','atmo')),
  data_column text not null,
  normalize text not null default 'none' check (normalize in ('none','pct_of_population')),
  scale text not null check (scale in ('iris','cp')),
  dynamic boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.cible_indicator_registry enable row level security;
create policy "cible_registry_read_auth" on public.cible_indicator_registry
  for select to authenticated using (true);

-- ── 2. Seed (fiches curées — data, pas du code) ─────────────────────────────
insert into public.cible_indicator_registry
  (indicator_code, label, famille, unit, slider_min, slider_max, slider_step, default_operator, data_source, data_column, normalize, scale, dynamic)
values
  ('part_pop_moins_18',    'Part des moins de 18 ans',        'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'part_pop_moins_18', 'none', 'iris', false),
  ('part_15_29',           'Part des 15-29 ans',              'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'pop_15_29', 'pct_of_population', 'iris', false),
  ('part_30_44',           'Part des 30-44 ans',              'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'pop_30_44', 'pct_of_population', 'iris', false),
  ('part_45_59',           'Part des 45-59 ans',              'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'pop_45_59', 'pct_of_population', 'iris', false),
  ('part_pop_65_plus',     'Part des 65 ans et plus',         'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'part_pop_65_plus', 'none', 'iris', false),
  ('rev_median',           'Revenu médian',                   'audience', '€', 10000, 45000, 500, '>=', 'iris_column', 'rev_median', 'none', 'iris', false),
  ('taux_chomage',         'Taux de chômage',                 'audience', '%', 0, 40, 0.5, '>=', 'iris_column', 'taux_chomage', 'none', 'iris', false),
  ('taux_pauvrete',        'Taux de pauvreté',                'audience', '%', 0, 50, 0.5, '>=', 'iris_column', 'taux_pauvrete', 'none', 'iris', false),
  ('taux_proprio',         'Taux de propriétaires',           'audience', '%', 0, 100, 1, '>=', 'iris_column', 'taux_proprio', 'none', 'iris', false),
  ('part_logements_sociaux','Part de logements sociaux',      'audience', '%', 0, 80, 1, '>=', 'iris_column', 'part_logements_sociaux', 'none', 'iris', false),
  ('part_familles_mono',   'Part de familles monoparentales', 'audience', '%', 0, 40, 0.5, '>=', 'iris_column', 'part_familles_monoparentales', 'none', 'iris', false),
  ('part_couples_enfants', 'Part de couples avec enfants',    'audience', '%', 0, 60, 0.5, '>=', 'iris_column', 'part_couples_avec_enfants', 'none', 'iris', false),
  ('densite_pop',          'Densité de population',           'audience', 'hab/km²', 0, 25000, 100, '>=', 'iris_column', 'densite_pop', 'none', 'iris', false),
  ('indice_jeunesse',      'Indice de jeunesse',              'audience', 'indice', 0, 5, 0.1, '>=', 'iris_column', 'indice_jeunesse', 'none', 'iris', false),
  ('taux_diplome_sup',     'Taux de diplômés du supérieur',   'audience', '%', 0, 80, 1, '>=', 'iris_column', 'taux_diplome_sup', 'none', 'iris', false),
  ('part_transport_commun','Part actifs en transport commun', 'audience', '%', 0, 70, 1, '>=', 'iris_column', 'part_actifs_transport_commun', 'none', 'iris', false),
  ('abstention_pres_2022', 'Taux d''abstention (prés. 2022)', 'comportement', '%', 10, 60, 0.5, '>=', 'abstention', 'taux_abstention', 'none', 'cp', false),
  ('pollen_indice',        'Indice pollen (jour)',            'contexte', 'niveau', 0, 6, 1, '>=', 'pollen', 'indice_global', 'none', 'cp', true),
  ('atmo_indice',          'Indice qualité de l''air (jour)', 'contexte', 'niveau', 0, 6, 1, '>=', 'atmo', 'indice_global', 'none', 'cp', true)
on conflict (indicator_code) do nothing;

-- ── 3. Index partiels (preview = count indexé, pas de seq scan iris 51k) ────
create index if not exists idx_iris_cible_part_moins_18 on public.iris (part_pop_moins_18) where is_true_iris;
create index if not exists idx_iris_cible_pop_15_29 on public.iris (pop_15_29) where is_true_iris;
create index if not exists idx_iris_cible_pop_30_44 on public.iris (pop_30_44) where is_true_iris;
create index if not exists idx_iris_cible_pop_45_59 on public.iris (pop_45_59) where is_true_iris;
create index if not exists idx_iris_cible_part_65 on public.iris (part_pop_65_plus) where is_true_iris;
create index if not exists idx_iris_cible_rev_median on public.iris (rev_median) where is_true_iris;
create index if not exists idx_iris_cible_taux_chomage on public.iris (taux_chomage) where is_true_iris;
create index if not exists idx_iris_cible_taux_pauvrete on public.iris (taux_pauvrete) where is_true_iris;
create index if not exists idx_iris_cible_taux_proprio on public.iris (taux_proprio) where is_true_iris;
create index if not exists idx_iris_cible_logsoc on public.iris (part_logements_sociaux) where is_true_iris;
create index if not exists idx_iris_cible_fam_mono on public.iris (part_familles_monoparentales) where is_true_iris;
create index if not exists idx_iris_cible_couples_enf on public.iris (part_couples_avec_enfants) where is_true_iris;
create index if not exists idx_iris_cible_densite on public.iris (densite_pop) where is_true_iris;
create index if not exists idx_iris_cible_ind_jeunesse on public.iris (indice_jeunesse) where is_true_iris;
create index if not exists idx_iris_cible_diplome_sup on public.iris (taux_diplome_sup) where is_true_iris;
create index if not exists idx_iris_cible_transp_commun on public.iris (part_actifs_transport_commun) where is_true_iris;

-- ── 4. RPC seuil : preview (count) ou sélection (codes bornés) ──────────────
create or replace function public.get_indicator_threshold_selection(
  p_indicator_code text,
  p_operator text,
  p_threshold numeric,
  p_preview boolean default true
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  reg record;
  v_expr text;
  v_table text;
  v_code_col text;
  v_where_extra text := '';
  v_order text;
  result jsonb;
begin
  if p_operator not in ('>=','<=') then
    raise exception 'operateur non autorise %', p_operator;
  end if;
  select * into reg from cible_indicator_registry
   where indicator_code = p_indicator_code and active;
  if not found then
    raise exception 'indicateur inconnu ou inactif %', p_indicator_code;
  end if;

  -- Expression de la valeur, TOUJOURS derivee du registre (jamais du client).
  if reg.data_source = 'iris_column' then
    v_table := 'iris'; v_code_col := 'code_iris';
    v_where_extra := ' and is_true_iris';
    if reg.normalize = 'pct_of_population' then
      v_expr := format('(%I::float / nullif(population,0) * 100)', reg.data_column);
    else
      v_expr := format('%I', reg.data_column);
    end if;
  elsif reg.data_source = 'abstention' then
    v_table := 'dataset_abstention_2022'; v_code_col := 'code_postal';
    v_expr := format('%I', reg.data_column);
  elsif reg.data_source = 'pollen' then
    v_table := 'pollen_map_daily'; v_code_col := 'code_postal';
    v_expr := format('%I', reg.data_column);
    v_where_extra := ' and date_ech = (select max(date_ech) from pollen_map_daily)';
  else -- atmo
    v_table := 'atmo_map_daily'; v_code_col := 'code_postal';
    v_expr := format('%I', reg.data_column);
    v_where_extra := ' and date_ech = (select max(date_ech) from atmo_map_daily)';
  end if;

  if p_preview then
    if reg.data_source = 'iris_column' then
      execute format(
        'select jsonb_build_object(''count'', count(*), ''population'', coalesce(sum(population),0)::bigint, ''scale'', %L)
           from %I where %s %s %s is not null and %s',
        reg.scale, v_table, v_expr, p_operator, v_expr,
        format('%s %s %L::numeric %s', v_expr, p_operator, p_threshold, v_where_extra)
      ) into result;
    else
      execute format(
        'select jsonb_build_object(''count'', count(*), ''population'', null, ''scale'', %L)
           from %I where %s is not null and %s %s %L::numeric %s',
        reg.scale, v_table, v_expr, v_expr, p_operator, p_threshold, v_where_extra
      ) into result;
    end if;
    return result;
  end if;

  v_order := case when p_operator = '>=' then 'desc' else 'asc' end;
  execute format(
    'with sel as (
       select %s as code, %s as val from %I
        where %s is not null and %s %s %L::numeric %s
        order by val %s limit 10001
     )
     select jsonb_build_object(
       ''codes'', (select coalesce(jsonb_agg(code), ''[]''::jsonb) from (select code from sel limit 10000) t),
       ''count'', (select least(count(*), 10000) from sel),
       ''truncated'', (select count(*) > 10000 from sel),
       ''scale'', %L)',
    v_code_col, v_expr, v_table, v_expr, v_expr, p_operator, p_threshold, v_where_extra, v_order, reg.scale
  ) into result;
  return result;
end $$;

revoke all on function public.get_indicator_threshold_selection(text, text, numeric, boolean) from public, anon, authenticated;
grant execute on function public.get_indicator_threshold_selection(text, text, numeric, boolean) to service_role;

-- ── 5. RPC composite : union des geometries de zones membres ────────────────
create or replace function public.get_composite_zone_geometry(p_zone_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  n int;
  geom geometry;
begin
  n := coalesce(array_length(p_zone_ids, 1), 0);
  if n < 2 or n > 20 then
    raise exception 'composite: 2 a 20 zones membres requises (recu %)', n;
  end if;
  select ST_Multi(ST_Union(geometry)) into geom
    from custom_geo_zones where id = any(p_zone_ids);
  if geom is null then
    raise exception 'composite: aucune geometrie trouvee';
  end if;
  return jsonb_build_object('geometry', ST_AsGeoJSON(geom)::jsonb);
end $$;

revoke all on function public.get_composite_zone_geometry(uuid[]) from public, anon, authenticated;
grant execute on function public.get_composite_zone_geometry(uuid[]) to service_role;
```

NB : si la table réelle des zones custom ne s'appelle pas `custom_geo_zones`, vérifier avec `select table_name from information_schema.tables where table_name like 'custom_geo%'` et adapter (la RPC `create_custom_geo_zone` existante donne le nom exact — la lire via `select prosrc from pg_proc where proname='create_custom_geo_zone'`).

- [ ] **Step 2: Appliquer via MCP**

Charger l'outil (`ToolSearch` query `select:mcp__claude_ai_Supabase__apply_migration,mcp__claude_ai_Supabase__execute_sql`), puis `apply_migration` (project_id `vkkdbygwbrxyogqosten`, name `cibles_registry_and_rpcs`, query = contenu du fichier). Expected: `{"success":true}`. Si erreur sur le nom de table des zones : appliquer la note du Step 1 et corriger fichier + migration.

- [ ] **Step 3: Vérifier par exécution réelle (via `execute_sql`)**

```sql
select public.get_indicator_threshold_selection('part_pop_moins_18', '>=', 25, true);
```
Expected: `{"count": <1..16000>, "population": <int>, "scale": "iris"}`.

```sql
select public.get_indicator_threshold_selection('abstention_pres_2022', '>=', 30, true);
select public.get_indicator_threshold_selection('pollen_indice', '>=', 3, true);
select jsonb_array_length(public.get_indicator_threshold_selection('part_pop_moins_18', '>=', 25, false)->'codes');
```
Expected: counts > 0 (pollen peut être 0 selon saison — vérifier juste l'absence d'erreur) ; la sélection retourne ≤ 10000 codes.

```sql
explain analyze select count(*) from iris where part_pop_moins_18 >= 25 and is_true_iris;
```
Expected: `Index Only Scan` ou `Bitmap Index Scan` sur `idx_iris_cible_part_moins_18` (PAS de Seq Scan). Copier le plan en commentaire de fin de `sql/100_cibles_registry_and_rpcs.sql`.

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/zones-cibles
git add sql/100_cibles_registry_and_rpcs.sql
git commit -m "feat: registre cibles + RPC seuil/composite (migration 100, EXPLAIN index scan)"
```

---

### Task 2: Lib naming (TDD) + routes catalogue/preview/source

**Files:**
- Create: `lib/cibles/naming.ts`
- Create: `tests/unit/cibles/naming.test.ts`
- Create: `app/api/cibles/indicators/route.ts`
- Create: `app/api/cibles/preview/route.ts`
- Create: `app/api/custom-geo/source/indicator-threshold/route.ts`
- Create: `app/api/custom-geo/source/composite/route.ts`

**Interfaces:**
- Consomme (Task 1) : RPC `get_indicator_threshold_selection`, `get_composite_zone_geometry`, table `cible_indicator_registry`. Existant : `get_iris_selection_geometry(p_iris_codes text[])`, `get_admin_filter_geometry` (signature à lire dans `app/api/custom-geo/source/meteo/route.ts` — même appel, scale `cp`), pattern route source (`app/api/custom-geo/source/iris/route.ts`).
- Produit (consommé par Task 3/4) :
  - `type CibleIndicator = { indicator_code: string; label: string; famille: 'audience'|'comportement'|'contexte'; unit: string; slider_min: number; slider_max: number; slider_step: number; default_operator: '>='|'<='; scale: 'iris'|'cp'; dynamic: boolean }`
  - `buildCibleName(label: string, operator: '>='|'<=', threshold: number, unit: string, now: Date): string` → `"Part des 15-29 ans ≥ 22 % — juil. 2026"`
  - `buildCibleMetadata(ind: CibleIndicator, operator, threshold, now): Record<string, unknown>` → `{ kind:'indicator_threshold', indicator, operator, threshold, unit, scale, materialized_at }`
  - `GET /api/cibles/indicators` → `{ indicators: CibleIndicator[] }` (active=true, tri famille puis label)
  - `GET /api/cibles/preview?indicator=&operator=&threshold=` → `{ count, population, scale }`
  - `POST /api/custom-geo/source/indicator-threshold` body `{ indicator_code, operator, threshold }` → `{ geometry, count, truncated, scale }` (le client sauvegarde ensuite via `/api/custom-geo/save` avec `source_type:'indicator_threshold'`)
  - `POST /api/custom-geo/source/composite` body `{ zone_ids: string[] (2..20) }` → `{ geometry }`

- [ ] **Step 1: Tests naming (RED)**

Créer `tests/unit/cibles/naming.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { buildCibleName, buildCibleMetadata } from '@/lib/cibles/naming';
import type { CibleIndicator } from '@/lib/cibles/naming';

const IND: CibleIndicator = {
  indicator_code: 'part_15_29', label: 'Part des 15-29 ans', famille: 'audience',
  unit: '%', slider_min: 0, slider_max: 60, slider_step: 0.5,
  default_operator: '>=', scale: 'iris', dynamic: false,
};

describe('buildCibleName', () => {
  it('format lisible avec opérateur, seuil, unité et mois', () => {
    const name = buildCibleName(IND.label, '>=', 22, '%', new Date('2026-07-07'));
    expect(name).toBe('Part des 15-29 ans ≥ 22 % — juil. 2026');
  });
  it('opérateur ≤ et unité € sans espace superflu', () => {
    const name = buildCibleName('Revenu médian', '<=', 18000, '€', new Date('2026-01-15'));
    expect(name).toBe('Revenu médian ≤ 18000 € — janv. 2026');
  });
});

describe('buildCibleMetadata', () => {
  it('porte la définition complète + date ISO', () => {
    const meta = buildCibleMetadata(IND, '>=', 22, new Date('2026-07-07T10:00:00Z'));
    expect(meta).toEqual({
      kind: 'indicator_threshold',
      indicator: 'part_15_29',
      operator: '>=',
      threshold: 22,
      unit: '%',
      scale: 'iris',
      materialized_at: '2026-07-07T10:00:00.000Z',
    });
  });
});
```

- [ ] **Step 2: RED**

Run: `npx vitest run tests/unit/cibles/naming.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter la lib**

Créer `lib/cibles/naming.ts` :

```ts
/**
 * Zones cibles — nommage auto + métadonnées de définition.
 * La définition (indicateur + opérateur + seuil) reste attachée à la zone
 * (source_metadata) : c'est elle que l'agent IA relira en cours de vague (V2).
 */
export interface CibleIndicator {
  indicator_code: string;
  label: string;
  famille: 'audience' | 'comportement' | 'contexte';
  unit: string;
  slider_min: number;
  slider_max: number;
  slider_step: number;
  default_operator: '>=' | '<=';
  scale: 'iris' | 'cp';
  dynamic: boolean;
}

const OP_SYMBOL: Record<'>=' | '<=', string> = { '>=': '≥', '<=': '≤' };

export function buildCibleName(
  label: string, operator: '>=' | '<=', threshold: number, unit: string, now: Date,
): string {
  const month = now.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  return `${label} ${OP_SYMBOL[operator]} ${threshold} ${unit} — ${month}`;
}

export function buildCibleMetadata(
  ind: CibleIndicator, operator: '>=' | '<=', threshold: number, now: Date,
): Record<string, unknown> {
  return {
    kind: 'indicator_threshold',
    indicator: ind.indicator_code,
    operator,
    threshold,
    unit: ind.unit,
    scale: ind.scale,
    materialized_at: now.toISOString(),
  };
}
```

- [ ] **Step 4: GREEN**

Run: `npx vitest run tests/unit/cibles/naming.test.ts`
Expected: PASS (3 tests). Si le libellé du mois diffère (`juil.` vs `juil`), ajuster le test à la sortie RÉELLE de Node (la vérité est `toLocaleDateString`), pas l'inverse.

- [ ] **Step 5: Route catalogue**

Créer `app/api/cibles/indicators/route.ts` :

```ts
/**
 * GET /api/cibles/indicators — catalogue des indicateurs ciblables (registre).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('cible_indicator_registry')
    .select('indicator_code, label, famille, unit, slider_min, slider_max, slider_step, default_operator, scale, dynamic')
    .eq('active', true)
    .order('famille')
    .order('label');
  if (error) {
    console.error('[cibles/indicators]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  return NextResponse.json({ indicators: data ?? [] });
}
```

- [ ] **Step 6: Route preview**

Créer `app/api/cibles/preview/route.ts` :

```ts
/**
 * GET /api/cibles/preview?indicator=&operator=&threshold=
 * Aperçu count/population d'un seuil — COUNT indexé, jamais de géométrie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  indicator: z.string().min(1).max(100),
  operator: z.enum(['>=', '<=']),
  threshold: z.coerce.number().finite(),
});

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const sp = new URL(request.url).searchParams;
  const parsed = QuerySchema.safeParse({
    indicator: sp.get('indicator'), operator: sp.get('operator'), threshold: sp.get('threshold'),
  });
  if (!parsed.success) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_indicator_threshold_selection', {
    p_indicator_code: parsed.data.indicator,
    p_operator: parsed.data.operator,
    p_threshold: parsed.data.threshold,
    p_preview: true,
  });
  if (error) {
    console.error('[cibles/preview]', error.message);
    return NextResponse.json({ error: 'preview_failed' }, { status: 400 });
  }
  const result = typeof data === 'string' ? JSON.parse(data) : data;
  return NextResponse.json(result);
}
```

- [ ] **Step 7: Route source indicator-threshold**

Lire d'abord la signature exacte de la RPC géométrie CP dans `app/api/custom-geo/source/meteo/route.ts` (appel `get_admin_filter_geometry` — reprendre les MÊMES noms de paramètres). Créer `app/api/custom-geo/source/indicator-threshold/route.ts` :

```ts
/**
 * POST /api/custom-geo/source/indicator-threshold
 * Résout les codes passant le seuil (RPC registre) puis matérialise la
 * géométrie via les RPC existantes (IRIS ou CP). Le client sauvegarde ensuite
 * via /api/custom-geo/save (source_type 'indicator_threshold' + définition).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const BodySchema = z.object({
  indicator_code: z.string().min(1).max(100),
  operator: z.enum(['>=', '<=']),
  threshold: z.number().finite(),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  const supabase = createAdminClient();
  const { data: selRaw, error: selError } = await supabase.rpc('get_indicator_threshold_selection', {
    p_indicator_code: parsed.data.indicator_code,
    p_operator: parsed.data.operator,
    p_threshold: parsed.data.threshold,
    p_preview: false,
  });
  if (selError) {
    console.error('[source/indicator-threshold] selection:', selError.message);
    return NextResponse.json({ error: 'selection_failed' }, { status: 400 });
  }
  const sel = (typeof selRaw === 'string' ? JSON.parse(selRaw) : selRaw) as {
    codes: string[]; count: number; truncated: boolean; scale: 'iris' | 'cp';
  };
  if (!sel.codes.length) return NextResponse.json({ error: 'empty_selection' }, { status: 400 });
  if (sel.truncated) return NextResponse.json({ error: 'selection_too_large', count: sel.count }, { status: 400 });

  let geometry: unknown;
  if (sel.scale === 'iris') {
    const { data, error } = await supabase.rpc('get_iris_selection_geometry', { p_iris_codes: sel.codes });
    if (error) {
      console.error('[source/indicator-threshold] geom iris:', error.message);
      return NextResponse.json({ error: 'geometry_failed' }, { status: 400 });
    }
    geometry = data;
  } else {
    // CP : même RPC que la source météo (voir source/meteo/route.ts pour la
    // signature exacte de get_admin_filter_geometry — scale 'cp').
    const { data, error } = await supabase.rpc('get_admin_filter_geometry', {
      p_scale: 'cp', p_codes: sel.codes,
    });
    if (error) {
      console.error('[source/indicator-threshold] geom cp:', error.message);
      return NextResponse.json({ error: 'geometry_failed' }, { status: 400 });
    }
    geometry = data;
  }
  return NextResponse.json({ geometry, count: sel.count, truncated: sel.truncated, scale: sel.scale });
}
```

(Si `get_admin_filter_geometry` a d'autres noms de paramètres dans la route météo, utiliser CES noms.)

- [ ] **Step 8: Route source composite**

Créer `app/api/custom-geo/source/composite/route.ts` :

```ts
/**
 * POST /api/custom-geo/source/composite — union des géométries de 2..20 zones
 * custom membres. Le client sauvegarde ensuite via /api/custom-geo/save
 * (source_type 'composite', metadata { kind, member_zone_ids }).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const BodySchema = z.object({
  zone_ids: z.array(z.string().uuid()).min(2).max(20),
});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_composite_zone_geometry', {
    p_zone_ids: parsed.data.zone_ids,
  });
  if (error) {
    console.error('[source/composite]', error.message);
    return NextResponse.json({ error: 'composite_failed' }, { status: 400 });
  }
  const result = typeof data === 'string' ? JSON.parse(data) : data;
  return NextResponse.json(result);
}
```

- [ ] **Step 9: Vérifier compilation + tests**

Run: `npx tsc --noEmit && npx vitest run tests/unit/cibles/naming.test.ts`
Expected: exit 0, 3 tests PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/cibles/naming.ts tests/unit/cibles/naming.test.ts app/api/cibles "app/api/custom-geo/source/indicator-threshold/route.ts" "app/api/custom-geo/source/composite/route.ts"
git commit -m "feat: routes cibles (catalogue, preview, source seuil, composite) + naming"
```

---

### Task 3: Refonte de l'étape Cible (catalogue + slider + aperçu + panier)

**Files:**
- Modify: `app/campaigns/[id]/_components/steps/types.ts`
- Rewrite: `app/campaigns/[id]/_components/steps/StepCible.tsx`
- Test: `tests/unit/cibles/draft.test.ts` (logique pure extraite dans `lib/cibles/draft.ts`)
- Create: `lib/cibles/draft.ts`

**Interfaces:**
- Consomme (Task 2) : `GET /api/cibles/indicators`, `GET /api/cibles/preview`, `POST /api/custom-geo/source/indicator-threshold`, `POST /api/custom-geo/save` (existante — body `{name, source_type, source_metadata, geometry, org_id}`), `GET /api/custom-geo/list?org_id=` (existante), `buildCibleName`/`buildCibleMetadata`/`CibleIndicator` de `@/lib/cibles/naming`.
- Produit (consommé par Task 4) :
  - `types.ts` : `ProgDraft.cibles: CibleZoneRef[]` (`{ id: string; name: string; sourceType: string }`), suppression de `scopeType`/`zoneId`/`zoneName` du draft (le `zone_id` final se calcule au Lancement). `DEFAULT_PROG_DRAFT.cibles = []`.
  - `lib/cibles/draft.ts` : `addCible(list, ref)` (dédoublonne par id), `removeCible(list, id)`, `cibleScope(list): { scope_type: 'national'|'custom_zone' }` (national si vide).
  - `StepCible` : props inchangées (`StepProps & { campaignId: string; onNext }`) — le composant charge l'org owner comme l'ancien StepZones (`/api/admin/campaigns/${campaignId}/organizations` → `owner_organization_id`).

- [ ] **Step 1: Tests draft (RED)**

Créer `tests/unit/cibles/draft.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { addCible, removeCible, cibleScope } from '@/lib/cibles/draft';

const A = { id: 'a1', name: 'Zone A', sourceType: 'indicator_threshold' };
const B = { id: 'b2', name: 'Zone B', sourceType: 'isochrone' };

describe('draft cibles', () => {
  it('addCible dédoublonne par id', () => {
    expect(addCible(addCible([A], B), A)).toEqual([A, B]);
  });
  it('removeCible retire par id', () => {
    expect(removeCible([A, B], 'a1')).toEqual([B]);
  });
  it('cibleScope : vide = national, sinon custom_zone', () => {
    expect(cibleScope([])).toEqual({ scope_type: 'national' });
    expect(cibleScope([A])).toEqual({ scope_type: 'custom_zone' });
  });
});
```

- [ ] **Step 2: RED puis implémenter `lib/cibles/draft.ts`**

Run: `npx vitest run tests/unit/cibles/draft.test.ts` → FAIL. Puis créer :

```ts
/** Zones cibles — manipulation pure du panier de cibles du brouillon wizard. */
export interface CibleZoneRef { id: string; name: string; sourceType: string }

export function addCible(list: CibleZoneRef[], ref: CibleZoneRef): CibleZoneRef[] {
  return list.some((c) => c.id === ref.id) ? list : [...list, ref];
}
export function removeCible(list: CibleZoneRef[], id: string): CibleZoneRef[] {
  return list.filter((c) => c.id !== id);
}
export function cibleScope(list: CibleZoneRef[]): { scope_type: 'national' | 'custom_zone' } {
  return { scope_type: list.length ? 'custom_zone' : 'national' };
}
```

Run à nouveau → PASS (3 tests).

- [ ] **Step 3: Adapter `types.ts`**

Dans `app/campaigns/[id]/_components/steps/types.ts` : supprimer `scopeType`, `zoneId`, `zoneName` de `ProgDraft` et de `DEFAULT_PROG_DRAFT` ; ajouter :

```ts
import type { CibleZoneRef } from '@/lib/cibles/draft';
// … dans ProgDraft :
  /** Panier de zones cibles (vide = national). Le zone_id final (directe ou composite) se calcule au Lancement. */
  cibles: CibleZoneRef[];
// … dans DEFAULT_PROG_DRAFT :
  cibles: [],
```

`ScopeType` reste exporté (utilisé au Lancement). Ne pas retirer `Intensity`/`INTENSITY_CURVES` (l'intensité reste dans l'étape Cible).

- [ ] **Step 4: Réécrire `StepCible.tsx`**

Structure du composant (réutiliser `StepShell`, `FieldBlock`, `Lead`, `OptionRow`, `OptsList`, `StandardFooter`, `B` de `./ui` — lire `ui.tsx` avant pour les props exactes) :

```tsx
'use client';

/**
 * Étape 1/4 — Cible : le « où » et le « qui ». Catalogue d'indicateurs
 * (Audience/Comportement/Contexte) + seuil dans l'unité de l'indicateur +
 * aperçu count, OU zones de la galerie (Mes zones). Panier multi-cibles.
 * Vide = national. L'intensité de sur-pondération reste ici.
 * La fusion en composite se fait au Lancement (pas ici).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { buildCibleMetadata, buildCibleName, type CibleIndicator } from '@/lib/cibles/naming';
import { addCible, removeCible, type CibleZoneRef } from '@/lib/cibles/draft';
import type { Intensity, StepProps } from './types';
import { INTENSITY_META } from './types';
import { B, FieldBlock, Lead, OptionRow, OptsList, StandardFooter, StepShell } from './ui';

const INTENSITIES: Intensity[] = ['doux', 'marque', 'fort'];
const FAMILLES: Array<{ key: CibleIndicator['famille']; label: string }> = [
  { key: 'audience', label: 'Audience' },
  { key: 'comportement', label: 'Comportement' },
  { key: 'contexte', label: 'Contexte' },
];

interface GalleryZone { id: string; name: string; source_type: string }
interface Preview { count: number; population: number | null; scale: 'iris' | 'cp' }

export function StepCible({
  draft, setDraft, campaignId, onNext,
}: StepProps & { campaignId: string; onNext: () => void }) {
  const [indicators, setIndicators] = useState<CibleIndicator[] | null>(null);
  const [gallery, setGallery] = useState<GalleryZone[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [famille, setFamille] = useState<CibleIndicator['famille'] | 'zones'>('audience');
  const [selected, setSelected] = useState<CibleIndicator | null>(null);
  const [operator, setOperator] = useState<'>=' | '<='>('>=');
  const [threshold, setThreshold] = useState<number>(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Catalogue + org owner + galerie (une fois)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await adminFetch('/api/cibles/indicators', { cache: 'no-store' });
        const d = r.ok ? await r.json() : { indicators: [] };
        if (!cancelled) setIndicators(d.indicators ?? []);
      } catch { if (!cancelled) setIndicators([]); }
    })();
    (async () => {
      try {
        const orgRes = await adminFetch(`/api/admin/campaigns/${campaignId}/organizations`, { cache: 'no-store' });
        const orgData = orgRes.ok ? await orgRes.json() : {};
        const org = (orgData.owner_organization_id as string | undefined) ?? null;
        if (cancelled) return;
        setOrgId(org);
        if (!org) { setGallery([]); return; }
        const res = await adminFetch(`/api/custom-geo/list?org_id=${org}`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : { zones: [] };
        if (!cancelled) setGallery((data.zones ?? []) as GalleryZone[]);
      } catch { if (!cancelled) setGallery([]); }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  // Sélection d'un indicateur → seuil par défaut au milieu du slider
  const pickIndicator = (ind: CibleIndicator) => {
    setSelected(ind);
    setOperator(ind.default_operator);
    setThreshold((ind.slider_min + ind.slider_max) / 2);
    setPreview(null);
  };

  // Aperçu debounced (400 ms) — 1 requête COUNT par mouvement stabilisé
  useEffect(() => {
    if (!selected) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreviewLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await adminFetch(
          `/api/cibles/preview?indicator=${encodeURIComponent(selected.indicator_code)}&operator=${encodeURIComponent(operator)}&threshold=${threshold}`,
          { cache: 'no-store' },
        );
        setPreview(res.ok ? await res.json() : null);
      } catch { setPreview(null); }
      setPreviewLoading(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [selected, operator, threshold]);

  // Matérialiser : géométrie (route source) puis save (zone custom) puis panier
  const materialize = useCallback(async () => {
    if (!selected || !orgId || materializing) return;
    setMaterializing(true);
    setError(null);
    try {
      const geoRes = await adminFetch('/api/custom-geo/source/indicator-threshold', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indicator_code: selected.indicator_code, operator, threshold }),
      });
      if (!geoRes.ok) {
        const j = await geoRes.json().catch(() => ({}));
        throw new Error(j.error === 'selection_too_large'
          ? 'Seuil trop large : resserre le curseur.'
          : j.error === 'empty_selection' ? 'Aucune zone ne passe ce seuil.' : `Erreur (${geoRes.status})`);
      }
      const geo = await geoRes.json();
      const name = buildCibleName(selected.label, operator, threshold, selected.unit, new Date());
      const saveRes = await adminFetch('/api/custom-geo/save', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          source_type: 'indicator_threshold',
          source_metadata: buildCibleMetadata(selected, operator, threshold, new Date()),
          geometry: geo.geometry,
          org_id: orgId,
        }),
      });
      if (!saveRes.ok && saveRes.status !== 207) throw new Error('Sauvegarde de la zone échouée');
      const saved = await saveRes.json();
      setDraft((prev) => ({
        ...prev,
        cibles: addCible(prev.cibles, { id: saved.zone_id, name, sourceType: 'indicator_threshold' }),
      }));
      setSelected(null);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMaterializing(false);
    }
  }, [selected, orgId, operator, threshold, materializing, setDraft]);

  const familyIndicators = indicators?.filter((i) => i.famille === famille) ?? [];

  return (
    <StepShell
      title="Cible"
      stepNumber={1}
      totalSteps={4}
      memo={{
        paragraphs: [
          <>Une cible = une <B>zone</B> + un <B>curseur</B> : « les zones où l&apos;indicateur dépasse (ou reste sous) le seuil que TU fixes ».</>,
          <>Tu peux en empiler plusieurs — elles fusionnent en une zone de diffusion au lancement. Panier vide = national.</>,
        ],
        tip: 'Les cibles Contexte (pollen, air) bougent chaque jour : posées en début de vague, révisables en cours de route.',
        mini: [1, 2, 3],
      }}
      footer={<StandardFooter onPrev={() => {}} isFirst nextLabel="Continuer →" onNext={onNext} />}
    >
      <Lead>
        Le <B>« où »</B> : construis ta cible depuis les données, ou pioche dans tes zones. MAGELIAN
        concentre la diffusion dessus.
      </Lead>

      {/* Panier */}
      <FieldBlock label={`Ma cible (${draft.cibles.length || 'national'})`}>
        {draft.cibles.length === 0 ? (
          <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-tertiary)' }}>
            Aucune zone cible — diffusion nationale (métropole + DROM).
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {draft.cibles.map((c) => (
              <span key={c.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px',
                borderRadius: 4, background: 'var(--brand-teal-10)', border: '0.5px solid var(--brand-teal-30)',
                fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11, color: 'var(--brand-teal)',
              }}>
                {c.name}
                <button
                  onClick={() => setDraft((prev) => ({ ...prev, cibles: removeCible(prev.cibles, c.id) }))}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1 }}
                  aria-label={`Retirer ${c.name}`}
                >×</button>
              </span>
            ))}
          </div>
        )}
      </FieldBlock>

      {/* Familles */}
      <FieldBlock label="Construire une cible">
        <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid var(--border-subtle)', marginBottom: 10 }}>
          {[...FAMILLES, { key: 'zones' as const, label: 'Mes zones' }].map((f) => (
            <button key={f.key} onClick={() => { setFamille(f.key); setSelected(null); }}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: famille === f.key ? '2px solid var(--brand-teal)' : '2px solid transparent',
                padding: '8px 12px', fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, fontWeight: 500,
                color: famille === f.key ? 'var(--text-primary)' : 'var(--text-tertiary)', cursor: 'pointer',
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {famille === 'zones' ? (
          <OptsList>
            {gallery === null && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Chargement…</div>}
            {gallery?.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Aucune zone dans la galerie — crée-les depuis la carte.</div>}
            {gallery?.map((z) => (
              <OptionRow
                key={z.id}
                selected={draft.cibles.some((c) => c.id === z.id)}
                onClick={() => setDraft((prev) => ({ ...prev, cibles: addCible(prev.cibles, { id: z.id, name: z.name, sourceType: z.source_type }) }))}
                title={z.name}
                sub={z.source_type}
                value="+ ajouter"
              />
            ))}
          </OptsList>
        ) : (
          <OptsList>
            {indicators === null && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Chargement…</div>}
            {familyIndicators.map((ind) => (
              <OptionRow
                key={ind.indicator_code}
                selected={selected?.indicator_code === ind.indicator_code}
                onClick={() => pickIndicator(ind)}
                title={ind.label}
                sub={`${ind.scale === 'iris' ? 'IRIS' : 'Code postal'} · ${ind.unit}${ind.dynamic ? ' · dynamique' : ''}`}
                value={selected?.indicator_code === ind.indicator_code ? '▼' : '▶'}
              />
            ))}
          </OptsList>
        )}
      </FieldBlock>

      {/* Seuil + aperçu + matérialiser */}
      {selected && famille !== 'zones' && (
        <FieldBlock label={`Seuil — ${selected.label}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <select value={operator} onChange={(e) => setOperator(e.target.value as '>=' | '<=')}
              style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '6px 10px', fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-primary)' }}>
              <option value=">=">Au-dessus de (sur-représenté)</option>
              <option value="<=">En-dessous de (sous-représenté)</option>
            </select>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--text-primary)' }}>
              {threshold} {selected.unit}
            </span>
          </div>
          <input
            type="range"
            min={selected.slider_min} max={selected.slider_max} step={selected.slider_step}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--brand-teal)' }}
            aria-label={`Seuil ${selected.label}`}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--text-secondary)', minWidth: 220 }}>
              {previewLoading ? 'Calcul…' : preview
                ? `${preview.count.toLocaleString('fr-FR')} ${preview.scale === 'iris' ? 'IRIS' : 'CP'}${preview.population ? ` · ${Math.round(preview.population / 1000).toLocaleString('fr-FR')} k hab.` : ''}`
                : '—'}
            </span>
            <button
              onClick={() => { void materialize(); }}
              disabled={materializing || !preview || preview.count === 0 || !orgId}
              style={{
                background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)',
                borderRadius: 6, padding: '8px 16px', fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, fontWeight: 500,
                cursor: materializing || !preview || preview.count === 0 ? 'not-allowed' : 'pointer',
                opacity: materializing || !preview || preview.count === 0 ? 0.5 : 1,
              }}
            >
              {materializing ? 'Matérialisation…' : 'Ajouter à ma cible'}
            </button>
          </div>
          {error && <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--danger)' }}>{error}</div>}
        </FieldBlock>
      )}

      {/* Intensité (inchangé) */}
      <FieldBlock label="Intensité du ciblage">
        <OptsList>
          {INTENSITIES.map((i) => (
            <OptionRow
              key={i}
              selected={draft.intensity === i}
              onClick={() => setDraft((prev) => ({ ...prev, intensity: i }))}
              title={INTENSITY_META[i].title}
              sub={INTENSITY_META[i].sub}
              value={INTENSITY_META[i].value}
            />
          ))}
        </OptsList>
      </FieldBlock>
    </StepShell>
  );
}
```

Avant d'écrire : lire `ui.tsx` et `types.ts` réels — si `INTENSITY_META` a d'autres champs que `title/sub/value`, reprendre l'usage EXACT de l'ancien StepCible (fin du fichier actuel). Si `StepShell`/`memo` ont d'autres props, s'aligner.

- [ ] **Step 5: Vérifier**

Run: `npx tsc --noEmit`
Expected: erreurs UNIQUEMENT dans les fichiers qui consomment encore `draft.scopeType`/`draft.zoneId` (`StepZones.tsx`, `StepLancement.tsx`, `CampaignCockpit.tsx`) — c'est attendu, Task 4 les traite. Aucune erreur dans StepCible/types/lib.

- [ ] **Step 6: Commit**

```bash
git add lib/cibles/draft.ts tests/unit/cibles/draft.test.ts "app/campaigns/[id]/_components/steps/types.ts" "app/campaigns/[id]/_components/steps/StepCible.tsx"
git commit -m "feat: étape Cible refondue (catalogue, seuil, aperçu, panier de cibles)"
```

---

### Task 4: Wizard 4 étapes — retrait StepZones, Lancement avec composite

**Files:**
- Delete: `app/campaigns/[id]/_components/steps/StepZones.tsx`
- Modify: `app/campaigns/[id]/_components/steps/StepLancement.tsx`
- Modify: `components/campaign/CampaignCockpit.tsx`

**Interfaces:**
- Consomme (Tasks 2-3) : `draft.cibles`, `cibleScope` (`@/lib/cibles/draft`), `POST /api/custom-geo/source/composite`, `POST /api/custom-geo/save`.
- Produit : wizard Cible → Budget → Stratégie → Lancement ; au Lancement, `zone_id` final = zone unique (n=1), composite créée (n>1, `source_type:'composite'`, metadata `{kind:'composite', member_zone_ids}`) ou null (national).

- [ ] **Step 1: Lire `StepLancement.tsx` en entier**

Repérer : où `draft.scopeType`/`draft.zoneId` alimentent le POST `/api/bidding/strategies`, le récap affiché, et `existingStrategyId` (PATCH). C'est le seul endroit qui persiste.

- [ ] **Step 2: Adapter StepLancement**

Ajouter en tête du fichier :

```tsx
import { cibleScope } from '@/lib/cibles/draft';
import { adminFetch } from '@/lib/admin-fetch'; // déjà importé probablement
```

Ajouter une fonction locale de résolution du zone_id final (AVANT le POST stratégie, dans le handler de lancement existant) :

```tsx
  /** n=0 → national ; n=1 → zone directe ; n>1 → crée la composite (géométrie union + save). */
  async function resolveFinalZone(
    cibles: { id: string; name: string }[],
    orgId: string,
  ): Promise<{ scope_type: 'national' | 'custom_zone'; zone_id: string | null }> {
    if (cibles.length === 0) return { scope_type: 'national', zone_id: null };
    if (cibles.length === 1) return { scope_type: 'custom_zone', zone_id: cibles[0].id };
    const geoRes = await adminFetch('/api/custom-geo/source/composite', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone_ids: cibles.map((c) => c.id) }),
    });
    if (!geoRes.ok) throw new Error('Fusion des zones cibles échouée');
    const geo = await geoRes.json();
    const saveRes = await adminFetch('/api/custom-geo/save', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Cible composite (${cibles.length} zones) — ${new Date().toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}`,
        source_type: 'composite',
        source_metadata: { kind: 'composite', member_zone_ids: cibles.map((c) => c.id) },
        geometry: geo.geometry,
        org_id: orgId,
      }),
    });
    if (!saveRes.ok && saveRes.status !== 207) throw new Error('Sauvegarde de la zone composite échouée');
    const saved = await saveRes.json();
    return { scope_type: 'custom_zone', zone_id: saved.zone_id };
  }
```

Dans le handler de lancement, remplacer l'usage de `draft.scopeType`/`draft.zoneId` par :

```tsx
      const { scope_type, zone_id } = await resolveFinalZone(draft.cibles, ownerOrgId);
```

(`ownerOrgId` : StepLancement charge déjà ou peut charger l'org owner comme StepCible — via `/api/admin/campaigns/${campaignId}/organizations`. Si le fichier l'a déjà, réutiliser ; sinon ajouter le fetch au montage, en le stockant dans un state `ownerOrgId`.)

Adapter le récap affiché : là où l'ancien code montrait « National » ou le nom de la zone, afficher `draft.cibles.length === 0 ? 'National (métropole + DROM)' : draft.cibles.map(c => c.name).join(' + ')`.

- [ ] **Step 3: Adapter CampaignCockpit**

Dans `components/campaign/CampaignCockpit.tsx` :

a) `COCKPIT_STEPS` : retirer `{ key: 'zones', label: 'Zones' }` → 4 étapes. `PROG_STEP_ORDER` : `['cible', 'budget', 'strategie', 'lancement']`, type `ProgStepKey` sans `'zones'`.

b) Supprimer l'import et le rendu de `StepZones` (bloc `{progStep === 'zones' && …}`).

c) `StepCible` reçoit maintenant `campaignId` : `<StepCible draft={draft} setDraft={setDraft} campaignId={id} onNext={goProgNext} />`.

d) Préremplissage depuis stratégie existante (le `useEffect` `strategyPrefillRef`) : remplacer les lignes `scopeType`/`zoneId` par :

```tsx
          cibles: s.zone_id ? [{ id: s.zone_id, name: s.zone_name ?? 'Zone de la stratégie', sourceType: 'custom' }] : [],
```

(si l'API stratégie ne renvoie pas `zone_name`, garder le libellé générique — le nom réel s'affichera après rechargement de la galerie).

e) Préremplissage des dates depuis la campagne : inchangé.

- [ ] **Step 4: Supprimer StepZones et vérifier**

```bash
git rm "app/campaigns/[id]/_components/steps/StepZones.tsx"
npx tsc --noEmit
```
Expected: exit 0. Puis :
```bash
grep -rn "StepZones\|scopeType\|draft.zoneId" app components lib --include="*.tsx" --include="*.ts" | grep -v "ScopeType"
```
Expected: aucune occurrence vivante (le type `ScopeType` de types.ts peut rester, utilisé par resolveFinalZone/le POST).

- [ ] **Step 5: Garde-fou suppression (spec §6) — zone référencée = 409**

Lire `app/api/custom-geo/[id]/route.ts` (handler DELETE). Juste avant la suppression effective, ajouter :

```ts
  // Garde-fou : interdit de supprimer une zone référencée par une stratégie
  // non archivée, ou membre d'une zone composite existante.
  const [stratRes, compRes] = await Promise.all([
    supabase.from('bidding_strategies').select('id').eq('zone_id', id).limit(1),
    supabase.from('custom_geo_zones')
      .select('id')
      .contains('source_metadata', { member_zone_ids: [id] })
      .limit(1),
  ]);
  if ((stratRes.data ?? []).length > 0) {
    return NextResponse.json({ error: 'zone_referenced_by_strategy' }, { status: 409 });
  }
  if ((compRes.data ?? []).length > 0) {
    return NextResponse.json({ error: 'zone_member_of_composite' }, { status: 409 });
  }
```

(Si le nom réel de la table des zones diffère de `custom_geo_zones`, reprendre celui constaté en Task 1. Si le DELETE de la galerie passe par une RPC plutôt que la table, poser le garde AVANT l'appel RPC — même logique.)

Vérifier : `npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Tests + lint**

Run: `npm test -- --run && npm run lint`
Expected: tous les tests passent (dont les 6 nouveaux cibles), pas de nouvelle warning.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wizard 4 étapes — Zones fusionnée dans Cible, composite au lancement"
```

---

### Task 5: Vérification bout en bout

**Files:** aucun nouveau (fixes éventuels uniquement).

**Interfaces:** consomme tout ce qui précède.

- [ ] **Step 1: Suite complète**

Run: `npx tsc --noEmit && npm test -- --run && npm run lint`
Expected: tout vert.

- [ ] **Step 2: Zéro hex nu dans les fichiers touchés**

Run: `grep -rn "#[0-9a-fA-F]\{3,6\}" lib/cibles app/api/cibles "app/api/custom-geo/source/indicator-threshold" "app/api/custom-geo/source/composite" "app/campaigns/[id]/_components/steps/StepCible.tsx"`
Expected: aucune occurrence.

- [ ] **Step 3: Parcours navigateur (dev server, login admin@geoprompt.com / G3oPrompt_Admin#2026)**

`npm run dev` en arrière-plan, puis via Playwright MCP :
1. `/campaigns` → overlay MAGELIAN → onglet Création : fil d'Ariane à **4 étapes** (Cible/Budget/Stratégie/Lancement).
2. Étape Cible : catalogue Audience visible (≥ 15 indicateurs), clic « Part des 15-29 ans » → slider % → l'aperçu affiche « N IRIS · X k hab. » et change quand on bouge le slider.
3. « Ajouter à ma cible » → chip dans le panier, nommée « Part des 15-29 ans ≥ … % — juil. 2026 ».
4. Onglet Contexte : indice pollen visible avec badge dynamique. Onglet Mes zones : zones de la galerie listées, ajout par clic.
5. Avec 2 cibles au panier, dérouler Budget → Stratégie → Lancement : le récap liste les 2 noms ; lancer → la stratégie se crée (statut visible), et la galerie `/map/custom-geo` contient la composite.
6. Panier vidé (« × » sur chaque chip) → récap « National ».
7. Zéro erreur console à chaque étape.

- [ ] **Step 4: Build prod**

Run: `npm run build` (arrêter le dev server avant ; si EPERM sur `.next`, tuer les process `next` restants puis `rm -rf .next`).
Expected: build OK.

- [ ] **Step 5: Commit final si fixes**

```bash
git add -A && git commit -m "fix: ajustements vérification zones cibles"
```
(Sauter si rien n'a changé.)
