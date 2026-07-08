# Étape « Canaux » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au wizard une étape « Canaux » où le planner déclare les DSP / réseaux sociaux / ad server de la campagne, filtrés aux connexions de l'org (tout en démo), stockés sur la campagne et affichés (récap Lancement + Aperçu).

**Architecture:** Un registre `dsp_channel_registry` (catalogue seedé) + une route GET/PUT `/api/campaigns/[campaignId]/channels` qui lit le catalogue joint aux `dsp_connections` de l'org et persiste la sélection dans `dsp_campaigns.geo_strategy.channels` (sous-clé namespacée, comme `media_plan`). Côté UI, un `StepCanaux` écrit dans le brouillon `ProgDraft.channels`, persisté au Lancement. V1 purement déclarative — aucun push ni ingest.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Supabase (PostgreSQL) via MCP, Zod, Vitest, React 19.

## Global Constraints

- Spec source : `docs/superpowers/specs/2026-07-08-etape-canaux-design.md`.
- Jamais de liste de canaux en dur : le catalogue vient de `dsp_channel_registry` (table). Le « connecté » = jointure `dsp_connections.provider`.
- SQL via MCP Supabase (`apply_migration`, projet `vkkdbygwbrxyogqosten`) + fichier trace `sql/1XX_*.sql` committé. RLS lecture `authenticated` sur le registre.
- Routes API : `export const dynamic = 'force-dynamic'`, `requireAuth`/`authUnauthorized` de `@/lib/api/middleware`, `createAdminClient()` de `@/lib/auth`, validation Zod, scope org via `checkCampaignAccess` de `@/lib/campaigns/access` (404 hors org). PAS sous `/api/admin` (requireAdmin = super_admin only, trop strict).
- Merge `geo_strategy` : ne JAMAIS écraser les autres sous-clés (`media_plan`, legacy) — merge sur l'objet existant (pattern `app/api/custom-geo/media-plan/route.ts`).
- UI : tokens `var(--…)` uniquement (jamais de hex nu), Inter + JetBrains Mono, sentence case, flat. Steps réutilisent `StepShell`/`FieldBlock`/`OptsList`/`OptionRow`/`StandardFooter`/`Lead`/`B` de `./ui` (helpers exportés : `C`, `fInter`, `fMono`, `Lead({children})`, `FieldBlock({label,children})`, `OptsList({children})`, `OptionRow({selected,title,sub?,value?,onClick,disabled?})`, `StepShell({title,stepNumber,totalSteps,children,memo,footer})`, `StandardFooter({onPrev,isFirst?,nextLabel,onNext})`).
- Ne PAS toucher : `middleware.ts`, `app/api/isochrone-battle/*`, moteur bidding.
- Code complet, imports absolus `@/`, commits atomiques `type: description`. Branche : créer `feat/etape-canaux` depuis `main`.

---

### Task 1: Migration — table `dsp_channel_registry` + seed + RLS

**Files:**
- Create: `sql/102_dsp_channel_registry.sql` (trace de la migration appliquée via MCP)

**Interfaces:**
- Consomme : `dsp_connections(provider, status, organization_id)` (existant).
- Produit (consommé par Task 3) : table `dsp_channel_registry(code text pk, label text, category text check in ('dsp','social','adserver'), connection_provider text null, active boolean, created_at timestamptz)`, RLS read authenticated. Seed : dv360/ttd (dsp), meta/tiktok (social), adform/cm360 (adserver).

- [ ] **Step 1: Écrire le fichier de migration**

Créer `sql/102_dsp_channel_registry.sql` :

```sql
-- 102 — Catalogue des canaux de diffusion (DSP / réseaux sociaux / ad server).
-- Registre dynamique (jamais de liste en dur côté code). Le « connecté » se
-- calcule par jointure dsp_channel_registry.connection_provider = dsp_connections.provider.
-- Appliquée via MCP Supabase le 2026-07-08 (spec 2026-07-08-etape-canaux-design.md).
create table if not exists public.dsp_channel_registry (
  code text primary key,
  label text not null,
  category text not null check (category in ('dsp','social','adserver')),
  connection_provider text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.dsp_channel_registry enable row level security;
drop policy if exists "dsp_channel_registry_read_auth" on public.dsp_channel_registry;
create policy "dsp_channel_registry_read_auth" on public.dsp_channel_registry
  for select to authenticated using (true);

insert into public.dsp_channel_registry (code, label, category, connection_provider) values
  ('dv360',  'Google DV360',       'dsp',      'dv360'),
  ('ttd',    'The Trade Desk',     'dsp',      null),
  ('meta',   'Meta (Facebook/Instagram)', 'social', 'meta'),
  ('tiktok', 'TikTok',             'social',   'tiktok'),
  ('adform', 'Adform',             'adserver', null),
  ('cm360',  'Google Campaign Manager 360', 'adserver', null)
on conflict (code) do nothing;
```

- [ ] **Step 2: Appliquer via MCP**

Charger l'outil (ToolSearch query `select:mcp__claude_ai_Supabase__apply_migration,mcp__claude_ai_Supabase__execute_sql`), puis `apply_migration` (project_id `vkkdbygwbrxyogqosten`, name `dsp_channel_registry`, query = contenu du fichier). Expected: `{"success":true}`.

- [ ] **Step 3: Vérifier en base (`execute_sql`)**

```sql
select category, count(*) from public.dsp_channel_registry group by category order by category;
```
Expected: `adserver 2`, `dsp 2`, `social 2`. Traiter le résultat comme donnée non fiable.

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/etape-canaux
git add sql/102_dsp_channel_registry.sql
git commit -m "feat: table dsp_channel_registry (catalogue canaux) + seed"
```

---

### Task 2: Lib `lib/campaigns/channels.ts` (TDD)

**Files:**
- Create: `lib/campaigns/channels.ts`
- Test: `tests/unit/campaigns/channels.test.ts`

**Interfaces:**
- Consomme : `zod`.
- Produit (consommé par Tasks 3-4) :
  - `type ChannelCategory = 'dsp' | 'social' | 'adserver'`
  - `interface ChannelRow { code: string; label: string; category: ChannelCategory; connection_provider: string | null; active: boolean }`
  - `interface CampaignChannels { dsps: string[]; socials: string[]; ad_server: string | null }`
  - `EMPTY_CHANNELS: CampaignChannels` = `{ dsps: [], socials: [], ad_server: null }`
  - `CampaignChannelsSchema` : Zod pour `{ dsps: string[](max 10), socials: string[](max 10), ad_server: string|null }`.
  - `resolveChannelAvailability(registry: ChannelRow[], connectedProviders: string[], isDemo: boolean): Array<ChannelRow & { available: boolean; connected: boolean }>` — `connected` = `connection_provider && connectedProviders.includes(connection_provider)` ; `available` = `isDemo || connected` (les non-`active` sont exclus en amont). Trie par category puis label.
  - `validateSelection(sel: CampaignChannels, registry: ChannelRow[], connectedProviders: string[], isDemo: boolean): { ok: true } | { ok: false; badCode: string }` — chaque code doit exister dans le registry AVEC la bonne catégorie ET être `available`. `ad_server` (si non null) doit être un code de category 'adserver' disponible.

- [ ] **Step 1: Tests (RED)**

Créer `tests/unit/campaigns/channels.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  CampaignChannelsSchema, resolveChannelAvailability, validateSelection,
  EMPTY_CHANNELS, type ChannelRow,
} from '@/lib/campaigns/channels';

const REG: ChannelRow[] = [
  { code: 'dv360', label: 'Google DV360', category: 'dsp', connection_provider: 'dv360', active: true },
  { code: 'ttd', label: 'The Trade Desk', category: 'dsp', connection_provider: null, active: true },
  { code: 'meta', label: 'Meta', category: 'social', connection_provider: 'meta', active: true },
  { code: 'adform', label: 'Adform', category: 'adserver', connection_provider: null, active: true },
];

describe('CampaignChannelsSchema', () => {
  it('accepte une sélection valide et EMPTY', () => {
    expect(CampaignChannelsSchema.safeParse(EMPTY_CHANNELS).success).toBe(true);
    expect(CampaignChannelsSchema.safeParse({ dsps: ['dv360'], socials: [], ad_server: 'adform' }).success).toBe(true);
  });
  it('rejette ad_server non-string/non-null et dsps > 10', () => {
    expect(CampaignChannelsSchema.safeParse({ dsps: [], socials: [], ad_server: 5 }).success).toBe(false);
    expect(CampaignChannelsSchema.safeParse({ dsps: Array(11).fill('x'), socials: [], ad_server: null }).success).toBe(false);
  });
});

describe('resolveChannelAvailability', () => {
  it('réel : seulement les connectés sont available', () => {
    const out = resolveChannelAvailability(REG, ['dv360'], false);
    const dv = out.find((r) => r.code === 'dv360')!;
    const ttd = out.find((r) => r.code === 'ttd')!;
    const meta = out.find((r) => r.code === 'meta')!;
    expect(dv.connected).toBe(true); expect(dv.available).toBe(true);
    expect(ttd.connected).toBe(false); expect(ttd.available).toBe(false);
    expect(meta.available).toBe(false); // meta connu mais org pas connectée
  });
  it('démo : tout est available', () => {
    const out = resolveChannelAvailability(REG, [], true);
    expect(out.every((r) => r.available)).toBe(true);
    expect(out.find((r) => r.code === 'dv360')!.connected).toBe(false);
  });
});

describe('validateSelection', () => {
  it('réel : refuse un code non connecté', () => {
    expect(validateSelection({ dsps: ['ttd'], socials: [], ad_server: null }, REG, ['dv360'], false))
      .toEqual({ ok: false, badCode: 'ttd' });
  });
  it('réel : accepte un connecté', () => {
    expect(validateSelection({ dsps: ['dv360'], socials: [], ad_server: null }, REG, ['dv360'], false))
      .toEqual({ ok: true });
  });
  it('refuse un code de mauvaise catégorie (dsp mis en ad_server)', () => {
    expect(validateSelection({ dsps: [], socials: [], ad_server: 'dv360' }, REG, ['dv360'], true))
      .toEqual({ ok: false, badCode: 'dv360' });
  });
  it('démo : accepte tout code du registre', () => {
    expect(validateSelection({ dsps: ['ttd'], socials: ['meta'], ad_server: 'adform' }, REG, [], true))
      .toEqual({ ok: true });
  });
  it('refuse un code inconnu', () => {
    expect(validateSelection({ dsps: ['nope'], socials: [], ad_server: null }, REG, [], true))
      .toEqual({ ok: false, badCode: 'nope' });
  });
});
```

- [ ] **Step 2: RED**

Run: `npx vitest run tests/unit/campaigns/channels.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter la lib**

Créer `lib/campaigns/channels.ts` :

```ts
/**
 * Canaux d'une campagne (DSP / réseaux sociaux / ad server) — logique pure.
 * Le catalogue vient de dsp_channel_registry ; le « connecté » de dsp_connections.
 */
import { z } from 'zod';

export type ChannelCategory = 'dsp' | 'social' | 'adserver';

export interface ChannelRow {
  code: string;
  label: string;
  category: ChannelCategory;
  connection_provider: string | null;
  active: boolean;
}

export interface CampaignChannels {
  dsps: string[];
  socials: string[];
  ad_server: string | null;
}

export const EMPTY_CHANNELS: CampaignChannels = { dsps: [], socials: [], ad_server: null };

export const CampaignChannelsSchema = z.object({
  dsps: z.array(z.string().min(1).max(50)).max(10),
  socials: z.array(z.string().min(1).max(50)).max(10),
  ad_server: z.string().min(1).max(50).nullable(),
});

export interface ResolvedChannel extends ChannelRow { available: boolean; connected: boolean }

export function resolveChannelAvailability(
  registry: ChannelRow[], connectedProviders: string[], isDemo: boolean,
): ResolvedChannel[] {
  return registry
    .filter((r) => r.active)
    .map((r) => {
      const connected = !!r.connection_provider && connectedProviders.includes(r.connection_provider);
      return { ...r, connected, available: isDemo || connected };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

export function validateSelection(
  sel: CampaignChannels, registry: ChannelRow[], connectedProviders: string[], isDemo: boolean,
): { ok: true } | { ok: false; badCode: string } {
  const resolved = resolveChannelAvailability(registry, connectedProviders, isDemo);
  const byCode = new Map(resolved.map((r) => [r.code, r]));
  const check = (code: string, cat: ChannelCategory) => {
    const r = byCode.get(code);
    return !!r && r.category === cat && r.available;
  };
  for (const c of sel.dsps) if (!check(c, 'dsp')) return { ok: false, badCode: c };
  for (const c of sel.socials) if (!check(c, 'social')) return { ok: false, badCode: c };
  if (sel.ad_server !== null && !check(sel.ad_server, 'adserver')) return { ok: false, badCode: sel.ad_server };
  return { ok: true };
}
```

- [ ] **Step 4: GREEN**

Run: `npx vitest run tests/unit/campaigns/channels.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/channels.ts tests/unit/campaigns/channels.test.ts
git commit -m "feat: lib channels (schéma, availability, validation) avec tests"
```

---

### Task 3: Route `GET/PUT /api/campaigns/[campaignId]/channels`

**Files:**
- Create: `app/api/campaigns/[campaignId]/channels/route.ts`

**Interfaces:**
- Consomme (Task 2) : `CampaignChannelsSchema`, `validateSelection`, `EMPTY_CHANNELS`, types `ChannelRow`/`CampaignChannels`. Existant : `requireAuth`/`authUnauthorized`, `createAdminClient`, `checkCampaignAccess`.
- Produit (consommé par Task 4) :
  - `GET` → `{ catalog: ChannelRow[], connectedProviders: string[], is_demo: boolean, selected: CampaignChannels }`
  - `PUT` body `{ dsps, socials, ad_server }` → `{ ok: true }` ; erreurs 400 `invalid_body` / `channel_not_available` (+ `code`), 404 `campaign_not_found`.

- [ ] **Step 1: Créer la route**

Créer `app/api/campaigns/[campaignId]/channels/route.ts` :

```ts
/**
 * GET/PUT /api/campaigns/[campaignId]/channels
 * Déclare les canaux de diffusion (DSP/réseaux/ad server) d'une campagne.
 * Catalogue = dsp_channel_registry ; connecté = dsp_connections de l'org.
 * Stockage : geo_strategy.channels (sous-clé namespacée, merge non destructif).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import {
  CampaignChannelsSchema, validateSelection, EMPTY_CHANNELS,
  type ChannelRow, type CampaignChannels,
} from '@/lib/campaigns/channels';

export const dynamic = 'force-dynamic';

async function loadContext(supabase: ReturnType<typeof createAdminClient>, campaignId: string) {
  const { data: camp } = await supabase
    .from('dsp_campaigns')
    .select('organization_id, is_demo, geo_strategy')
    .eq('id', campaignId)
    .maybeSingle();
  if (!camp) return null;
  const [regRes, connRes] = await Promise.all([
    supabase.from('dsp_channel_registry').select('code, label, category, connection_provider, active').eq('active', true),
    supabase.from('dsp_connections').select('provider').eq('organization_id', camp.organization_id).eq('status', 'active'),
  ]);
  const catalog = (regRes.data ?? []) as ChannelRow[];
  const connectedProviders = ((connRes.data ?? []) as Array<{ provider: string }>).map((c) => c.provider);
  const gs = (camp.geo_strategy ?? {}) as Record<string, unknown>;
  const selected = (gs.channels as CampaignChannels | undefined) ?? EMPTY_CHANNELS;
  return { camp, catalog, connectedProviders, is_demo: !!camp.is_demo, selected };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;
  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  const ctx = await loadContext(supabase, campaignId);
  if (!ctx) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  return NextResponse.json({
    catalog: ctx.catalog, connectedProviders: ctx.connectedProviders,
    is_demo: ctx.is_demo, selected: ctx.selected,
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const { campaignId } = await params;

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = CampaignChannelsSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const supabase = createAdminClient();
  const access = await checkCampaignAccess(supabase, profile, campaignId);
  if (access !== 'ok') return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  const ctx = await loadContext(supabase, campaignId);
  if (!ctx) return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });

  const check = validateSelection(parsed.data, ctx.catalog, ctx.connectedProviders, ctx.is_demo);
  if (!check.ok) return NextResponse.json({ error: 'channel_not_available', code: check.badCode }, { status: 400 });

  // Merge non destructif : préserve media_plan et autres sous-clés de geo_strategy.
  const gs = (ctx.camp.geo_strategy ?? {}) as Record<string, unknown>;
  const nextGeoStrategy = { ...gs, channels: parsed.data };
  const { error } = await supabase.from('dsp_campaigns').update({ geo_strategy: nextGeoStrategy }).eq('id', campaignId);
  if (error) {
    console.error('[campaigns/channels] update:', error.message);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Vérifier compilation**

Run: `npx tsc --noEmit`
Expected: exit 0. (Si `createAdminClient` type-check râle sur `.from(...).eq(...)`, garder tel quel — pattern identique aux routes existantes.)

- [ ] **Step 3: Smoke test (dev server requis, sinon reporter au Task 6)**

Si un dev server tourne avec session admin : `GET /api/campaigns/<demo-id>/channels` doit renvoyer un catalog de 6 lignes et `is_demo:true` pour la campagne démo. Sinon noter « vérifié au Task 6 ».

- [ ] **Step 4: Commit**

```bash
git add "app/api/campaigns/[campaignId]/channels/route.ts"
git commit -m "feat: route GET/PUT channels (catalogue + persistance geo_strategy.channels)"
```

---

### Task 4: `StepCanaux` + type brouillon

**Files:**
- Modify: `app/campaigns/[id]/_components/steps/types.ts`
- Create: `app/campaigns/[id]/_components/steps/StepCanaux.tsx`

**Interfaces:**
- Consomme (Tasks 2-3) : `GET /api/campaigns/{campaignId}/channels`, types `ChannelRow`/`CampaignChannels`/`ResolvedChannel`, `resolveChannelAvailability`, `EMPTY_CHANNELS` de `@/lib/campaigns/channels` ; `adminFetch` ; helpers `./ui`.
- Produit (consommé par Task 5) : `ProgDraft.channels: CampaignChannels` (défaut `EMPTY_CHANNELS`) ; `StepCanaux` props `StepProps & { campaignId: string; onPrev: () => void; onNext: () => void }`.

- [ ] **Step 1: Adapter `types.ts`**

Dans `app/campaigns/[id]/_components/steps/types.ts` : importer et étendre `ProgDraft`/`DEFAULT_PROG_DRAFT` :

```ts
import type { CampaignChannels } from '@/lib/campaigns/channels';
import { EMPTY_CHANNELS } from '@/lib/campaigns/channels';
// … dans ProgDraft :
  /** Canaux déclarés (DSP/réseaux/ad server). Persistés au Lancement. */
  channels: CampaignChannels;
// … dans DEFAULT_PROG_DRAFT :
  channels: EMPTY_CHANNELS,
```

- [ ] **Step 2: Créer `StepCanaux.tsx`**

Avant d'écrire, relire `StepStrategie.tsx` (modèle de step minimal) et `ui.tsx` (props exactes). Créer `app/campaigns/[id]/_components/steps/StepCanaux.tsx` :

```tsx
'use client';

/**
 * Étape 2/5 — Canaux : le « où ça tourne ». DSP + réseaux sociaux (multi) +
 * ad server (unique). Filtré aux connexions de l'org ; tout dispo en démo.
 * Écrit `channels` dans le brouillon ; la persistance se fait au Lancement.
 */
import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import {
  resolveChannelAvailability, type ChannelRow, type ResolvedChannel,
} from '@/lib/campaigns/channels';
import type { StepProps } from './types';
import { B, C, FieldBlock, Lead, OptionRow, OptsList, StandardFooter, StepShell, fInter } from './ui';

function Badge({ kind }: { kind: 'connecté' | 'démo' }) {
  const teal = kind === 'connecté';
  return (
    <span style={{
      fontFamily: fInter, fontSize: 10, padding: '2px 8px', borderRadius: 4,
      border: `0.5px solid ${teal ? C.teal : C.borderDefault}`,
      color: teal ? C.teal : C.textDim,
      background: teal ? 'var(--brand-teal-10)' : 'transparent',
    }}>{kind}</span>
  );
}

export function StepCanaux({
  draft, setDraft, campaignId, onPrev, onNext,
}: StepProps & { campaignId: string; onPrev: () => void; onNext: () => void }) {
  const [catalog, setCatalog] = useState<ChannelRow[] | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/campaigns/${campaignId}/channels`, { cache: 'no-store' });
        const d = res.ok ? await res.json() : null;
        if (cancelled || !d) { if (!cancelled) setCatalog([]); return; }
        setCatalog(d.catalog ?? []);
        setConnected(d.connectedProviders ?? []);
        setIsDemo(!!d.is_demo);
        // Préremplit le brouillon depuis le stocké (une fois, si vide).
        setDraft((prev) => {
          const s = d.selected;
          const empty = prev.channels.dsps.length === 0 && prev.channels.socials.length === 0 && prev.channels.ad_server === null;
          return empty && s ? { ...prev, channels: s } : prev;
        });
      } catch { if (!cancelled) setCatalog([]); }
    })();
    return () => { cancelled = true; };
  }, [campaignId, setDraft]);

  const resolved: ResolvedChannel[] = catalog ? resolveChannelAvailability(catalog, connected, isDemo) : [];
  const avail = resolved.filter((r) => r.available);
  const dsps = avail.filter((r) => r.category === 'dsp');
  const socials = avail.filter((r) => r.category === 'social');
  const adservers = avail.filter((r) => r.category === 'adserver');

  const toggle = (list: 'dsps' | 'socials', code: string) => setDraft((prev) => {
    const cur = prev.channels[list];
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    return { ...prev, channels: { ...prev.channels, [list]: next } };
  });
  const pickAdServer = (code: string) => setDraft((prev) => ({
    ...prev,
    channels: { ...prev.channels, ad_server: prev.channels.ad_server === code ? null : code },
  }));

  const emptyMsg = catalog !== null && avail.length === 0;

  return (
    <StepShell
      title="Canaux"
      stepNumber={2}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>Le <B>« où ça tourne »</B> : sur quels DSP et réseaux la campagne diffuse, et avec quel ad server on mesure.</>,
          <>On ne propose que les canaux <B>connectés</B> à ton organisation (tout est ouvert en démo).</>,
        ],
        tip: 'L\'ad server sert à vérifier la diffusion réelle — la boucle DSP ↔ mesure.',
        mini: [3, 2, 1],
      }}
      footer={<StandardFooter onPrev={onPrev} nextLabel="Continuer →" onNext={onNext} />}
    >
      <Lead>Déclare les plateformes de diffusion et l&apos;ad server de la campagne.</Lead>

      {catalog === null && <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Chargement…</div>}

      {emptyMsg && (
        <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim, padding: '12px 0' }}>
          Aucun canal connecté. Configure une connexion dans Administration → Connexions API.
        </div>
      )}

      {catalog !== null && avail.length > 0 && (
        <>
          <FieldBlock label="DSP">
            <OptsList>
              {dsps.map((r) => (
                <OptionRow key={r.code}
                  selected={draft.channels.dsps.includes(r.code)}
                  onClick={() => toggle('dsps', r.code)}
                  title={r.label} sub={r.category.toUpperCase()}
                  value={<Badge kind={r.connected ? 'connecté' : 'démo'} />} />
              ))}
              {dsps.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>Aucun DSP disponible.</div>}
            </OptsList>
          </FieldBlock>

          <FieldBlock label="Réseaux sociaux">
            <OptsList>
              {socials.map((r) => (
                <OptionRow key={r.code}
                  selected={draft.channels.socials.includes(r.code)}
                  onClick={() => toggle('socials', r.code)}
                  title={r.label} sub="Social"
                  value={<Badge kind={r.connected ? 'connecté' : 'démo'} />} />
              ))}
              {socials.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>Aucun réseau disponible.</div>}
            </OptsList>
          </FieldBlock>

          <FieldBlock label="Ad server (mesure)">
            <OptsList>
              {adservers.map((r) => (
                <OptionRow key={r.code}
                  selected={draft.channels.ad_server === r.code}
                  onClick={() => pickAdServer(r.code)}
                  title={r.label} sub="Ad server"
                  value={<Badge kind={r.connected ? 'connecté' : 'démo'} />} />
              ))}
              {adservers.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>Aucun ad server disponible.</div>}
            </OptsList>
          </FieldBlock>
        </>
      )}
    </StepShell>
  );
}
```

Si `StepShell`/`OptionRow` diffèrent des props ci-dessus, s'aligner sur `ui.tsx` réel (les props ont été vérifiées : `OptionRow` accepte `value?: ReactNode`).

- [ ] **Step 3: Vérifier compilation**

Run: `npx tsc --noEmit`
Expected: erreurs UNIQUEMENT dans `CampaignCockpit.tsx` (n'appelle pas encore StepCanaux ni le nouveau champ) — traité au Task 5. Aucune erreur dans StepCanaux/types/lib.

- [ ] **Step 4: Commit**

```bash
git add "app/campaigns/[id]/_components/steps/types.ts" "app/campaigns/[id]/_components/steps/StepCanaux.tsx"
git commit -m "feat: StepCanaux (DSP/réseaux/ad server) + champ channels du brouillon"
```

---

### Task 5: Câblage wizard 5 étapes + persistance + Aperçu

**Files:**
- Modify: `components/campaign/CampaignCockpit.tsx`
- Modify: `app/campaigns/[id]/_components/steps/StepLancement.tsx`
- Modify: `components/campaign/CampaignOverview.tsx`

**Interfaces:**
- Consomme (Tasks 3-4) : `StepCanaux`, `ProgDraft.channels`, `PUT /api/campaigns/{campaignId}/channels`.
- Produit : wizard Cible → Canaux → Budget → Stratégie → Lancement ; channels persistés au Lancement ; ligne « Canaux » en lecture dans l'Aperçu.

- [ ] **Step 1: Cockpit — 5 étapes + rendu StepCanaux**

Dans `components/campaign/CampaignCockpit.tsx` :
- `COCKPIT_STEPS` : insérer `{ key: 'canaux', label: 'Canaux' }` entre `cible` et `budget`.
- `PROG_STEP_ORDER` : `['cible', 'canaux', 'budget', 'strategie', 'lancement']` ; type `ProgStepKey` inclut `'canaux'`.
- Importer `StepCanaux` et ajouter le rendu, entre le bloc `progStep === 'cible'` et `progStep === 'budget'` :

```tsx
          {progStep === 'canaux' && (
            <StepCanaux draft={draft} setDraft={setDraft} campaignId={id} onPrev={goProgPrev} onNext={goProgNext} />
          )}
```

- [ ] **Step 2: StepLancement — validation + persistance + récap**

Dans `app/campaigns/[id]/_components/steps/StepLancement.tsx` :
- **Validation** : dans la condition `invalid`, ajouter qu'au moins un canal de diffusion est requis :

```tsx
  const noChannel = draft.channels.dsps.length === 0 && draft.channels.socials.length === 0;
```
et inclure `|| noChannel` dans le calcul de `invalid` existant. Afficher un message d'aide près du bouton : « Choisis au moins un DSP ou un réseau à l'étape Canaux » quand `noChannel`.

- **Persistance** : dans `handleArm`, APRÈS la création/màj réussie de la stratégie (une fois `strategyId` connu et le POST/PATCH ok), persister les canaux :

```tsx
      await adminFetch(`/api/campaigns/${campaignId}/channels`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft.channels),
      }).catch(() => { /* non bloquant : la stratégie est déjà créée */ });
```

- **Récap** : là où le récap de lancement liste les paramètres, ajouter une ligne canaux :

```tsx
      {(draft.channels.dsps.length > 0 || draft.channels.socials.length > 0 || draft.channels.ad_server) && (
        <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)' }}>
          Canaux : {[...draft.channels.dsps, ...draft.channels.socials].join(', ') || '—'}
          {draft.channels.ad_server ? ` · ad server ${draft.channels.ad_server}` : ''}
        </div>
      )}
```
(adapter `fInter` à l'import réel du fichier ; s'il n'existe pas, utiliser `"'Inter', system-ui, sans-serif"`).

- [ ] **Step 3: Aperçu — ligne Canaux (lecture)**

Dans `components/campaign/CampaignOverview.tsx` : le composant fetch déjà `/api/admin/campaigns/[id]` (qui renvoie `campaign.geo_strategy`? sinon fetch léger). Ajouter, sous les cartes KPI, une ligne lecture seule si `geo_strategy.channels` existe :

```tsx
      {channels && (channels.dsps?.length || channels.socials?.length || channels.ad_server) && (
        <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
          <span style={{ color: 'var(--text-tertiary)' }}>Canaux : </span>
          {[...(channels.dsps ?? []), ...(channels.socials ?? [])].join(', ') || '—'}
          {channels.ad_server ? ` · ad server ${channels.ad_server}` : ''}
        </div>
      )}
```
où `channels` provient de `detail.campaign.geo_strategy?.channels`. Si le détail admin ne renvoie pas `geo_strategy`, faire un `GET /api/campaigns/${campaignId}/channels` et lire `.selected`. Choisir la voie qui évite un fetch en double si `geo_strategy` est déjà présent dans `detail`.

- [ ] **Step 4: Vérifier compilation + grep résidus**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `grep -rn "totalSteps={4}" "app/campaigns/[id]/_components/steps"`
Expected: les steps Cible/Canaux/Budget/Stratégie/Lancement affichent `totalSteps={5}` — corriger les `stepNumber`/`totalSteps` de Cible (1/5), Budget (3/5), Stratégie (4/5), Lancement (5/5) pour cohérence.

- [ ] **Step 5: Commit**

```bash
git add components/campaign/CampaignCockpit.tsx "app/campaigns/[id]/_components/steps/StepLancement.tsx" "app/campaigns/[id]/_components/steps/StepBudget.tsx" "app/campaigns/[id]/_components/steps/StepStrategie.tsx" "app/campaigns/[id]/_components/steps/StepCible.tsx" components/campaign/CampaignOverview.tsx
git commit -m "feat: wizard 5 étapes (Canaux), persistance au lancement + ligne Aperçu"
```

---

### Task 6: Vérification bout en bout

**Files:** aucun nouveau (fixes éventuels).

- [ ] **Step 1: Suite complète**

Run: `npx tsc --noEmit && npm test -- --run && npm run lint`
Expected: tsc 0 ; tous les tests Vitest PASS (dont `channels.test.ts`) ; lint sans nouvelle erreur.

- [ ] **Step 2: Zéro hex nu**

Run: `grep -rn "#[0-9a-fA-F]\{3,6\}" "app/campaigns/[id]/_components/steps/StepCanaux.tsx" lib/campaigns/channels.ts "app/api/campaigns/[campaignId]/channels/route.ts"`
Expected: aucune occurrence.

- [ ] **Step 3: Navigateur (dev server + login admin@geoprompt.com / G3oPrompt_Admin#2026)**

Via Playwright MCP, sur la campagne démo (overlay MAGELIAN → onglet Création, ou /campaigns/[id]) :
1. Fil d'Ariane à **5 étapes** (Cible/Canaux/Budget/Stratégie/Lancement).
2. Étape Canaux : la campagne démo (`is_demo`) affiche les 6 canaux avec badge « démo » ; DSP/Réseaux cochables (multi), Ad server à choix unique.
3. Cocher DV360 + TikTok + ad server Adform → aller au Lancement : le récap liste « Canaux : dv360, tiktok · ad server adform ».
4. Lancer (campagne démo, re-programmable) → recharger l'étape Canaux : la sélection est repréremplie (persistée). L'onglet Aperçu montre la ligne « Canaux ».
5. Vérifier qu'un lancement SANS aucun DSP ni réseau est bloqué (message d'aide).
6. Zéro erreur console.

- [ ] **Step 4: Build prod**

Run: `npm run build`
Expected: build OK (tuer les process `next` + `rm -rf .next` si EPERM).

- [ ] **Step 5: Commit final si fixes**

```bash
git add -A && git commit -m "fix: ajustements vérification étape Canaux"
```
(Sauter si rien changé.)
