# New Magelian UX Phase 1 — shell 2-piliers + home portfolio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser la nouvelle IA du produit (switch de piliers Carte|Campagnes + home portfolio `/campaigns`) et **remplacer proprement l'ancienne UI campagne** (`/admin/campaigns*`) sans perte de feature ni code orphelin.

**Architecture:** On relocalise le détail campagne sous `/campaigns/[id]`, on extrait l'import en composant réutilisable, on crée la home portfolio, on retire l'ancienne page liste en re-logeant ses fonctions admin, puis on pose le shell (PillarSwitch + nav 2-piliers + redirect). Backend `/api/admin/campaigns/*` inchangé.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, React client components, design system MAGELIAN (var() tokens), lib/campaigns/status.ts (statut pur), adminFetch.

## Global Constraints

- **Design System** : couleurs via `var(--token)` UNIQUEMENT (jamais de hex), accent `var(--brand-teal)`, statut via `STATUS_META[status].colorVar` de `@/lib/campaigns/status`, fonts `Inter`/`JetBrains Mono`, sentence case, flat. Réutiliser `CampaignStatusBadge`.
- **Supabase Nano** : la home consomme `GET /api/admin/campaigns` (1 appel, déjà borné). AUCUN appel pacing/RPC par campagne. Backend inchangé.
- **TypeScript strict**, imports absolus `@/`. `npx tsc --noEmit` = 0 à chaque tâche.
- **Anti-dette (impératif)** : à la fin, `grep -rn "/admin/campaigns" app/ components/ lib/` ne doit renvoyer que des chemins `/api/admin/campaigns/*` (backend). Zéro lien UI mort. Namespace UI unifié `/campaigns/*`.
- **Réutiliser sans réécrire** : le détail et l'import sont **déplacés/extraits** depuis l'existant, pas réécrits (le cockpit = Phase 2).
- Spec : `docs/superpowers/specs/2026-07-06-ux-phase1-shell-portfolio-design.md`. Branche `feat/ux-phase1-shell-portfolio`.

---

### Task 1: Relocaliser le détail campagne → `/campaigns/[id]`

**Files:**
- Move: `app/admin/campaigns/[id]/page.tsx` → `app/campaigns/[id]/page.tsx`
- (les sous-dossiers `app/admin/campaigns/[id]/*` autres que `page.tsx` — ex. routes API — NE bougent PAS)

**Interfaces:**
- Produces : route page `/campaigns/[id]` (détail campagne, contenu inchangé).

- [ ] **Step 1: Déplacer le fichier**

```bash
mkdir -p "app/campaigns/[id]"
git mv "app/admin/campaigns/[id]/page.tsx" "app/campaigns/[id]/page.tsx"
```

- [ ] **Step 2: Corriger les back-links internes**

Dans `app/campaigns/[id]/page.tsx`, remplacer les 3 navigations vers l'ancienne liste. Chercher chaque occurrence de `router.push('/admin/campaigns')` et la remplacer par `router.push('/campaigns')` (il y en a 3 : après suppression, après erreur de chargement, et le bouton retour). Ne rien changer d'autre (le contenu du détail est conservé tel quel — refonte en cockpit = Phase 2). Les appels `adminFetch('/api/admin/campaigns/${id}...')` restent inchangés (backend).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur. (Note : `app/admin/campaigns/page.tsx` link vers `/admin/campaigns/${id}` devient un lien vers une route supprimée — SERA repointé en Task 5 ; d'ici là il pointe vers l'ancien chemin désormais absent, mais tsc ne le détecte pas car c'est une string. Ne pas s'en inquiéter à cette étape.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ux): relocaliser le détail campagne /admin/campaigns/[id] -> /campaigns/[id]"
```

---

### Task 2: Extraire l'import en `CampaignImportDialog`

**Files:**
- Create: `app/campaigns/_components/CampaignImportDialog.tsx`
- Read (source à extraire) : `app/admin/campaigns/page.tsx`

**Interfaces:**
- Produces : `CampaignImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void })` — modal shadcn `Dialog` multi-étapes (upload → preview → importing → done), logique **verbatim** de l'existant.

- [ ] **Step 1: Lire la source et identifier le bloc import**

Lire `app/admin/campaigns/page.tsx`. Le sous-système d'import y est autonome : state machine `step: 'upload' | 'preview' | 'importing' | 'done'`, interface `PreviewData`, constante `DB_FIELDS`, handlers `handlePreview` (POST `/api/admin/campaigns/preview`, FormData `file`+`dsp_source`), `handleImport` (POST `/api/admin/campaigns/import`, lecture SSE via `res.body.getReader()` + `TextDecoder`, events `progress|complete|error`), le sélecteur d'org (`selectedOrg`), la zone drag&drop, et le rendu dans un `<Dialog>` (`@/components/ui/dialog`).

- [ ] **Step 2: Créer le composant en déplaçant ce bloc verbatim**

Créer `app/campaigns/_components/CampaignImportDialog.tsx` (`'use client'`). Y **couper-coller** depuis la page liste : le state d'import (step, previewData, customMapping, file, dsp_source, selectedOrg, progress, logs…), `PreviewData`, `DB_FIELDS`, `handlePreview`, `handleImport`, la zone drag&drop et tout le JSX du `<Dialog>`. Le composant :
- reçoit `{ open, onClose, onImported }` ;
- rend le `<Dialog open={open} onOpenChange={(o) => !o && onClose()}>` avec les 4 étapes ;
- à l'event SSE `complete` : appelle `onImported()` (le portfolio rafraîchira la liste) puis laisse l'utilisateur fermer ;
- garde les imports `adminFetch`, `useToast`, `Dialog`… inchangés.
Aucune logique n'est réécrite — c'est un déplacement. Les orgs disponibles : si le composant a besoin de la liste d'orgs (`orgs`), la charger via `adminFetch('/api/admin/organizations')` au montage (comme l'ancienne page), ou accepter une prop `orgs` — au choix de l'implémenteur, en restant iso-fonctionnel.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur. (L'ancienne page liste garde encore SA copie de la logique import à ce stade — c'est temporaire, elle est supprimée en Task 5. Pas de conflit : le nouveau composant est autonome.)

- [ ] **Step 4: Commit**

```bash
git add app/campaigns/_components/CampaignImportDialog.tsx
git commit -m "refactor(ux): extraire l'import DSP en CampaignImportDialog réutilisable"
```

---

### Task 3: Home portfolio `/campaigns`

**Files:**
- Create: `app/campaigns/page.tsx`
- Create: `app/campaigns/_components/CampaignPortfolioCard.tsx`
- Create: `app/campaigns/_components/PortfolioToolbar.tsx`

**Interfaces:**
- Consumes : `GET /api/admin/campaigns` (via `adminFetch`) ; `effectiveCampaignStatus`, `campaignNeedsAttention`, `STATUS_META`, `type CampaignStatus` de `@/lib/campaigns/status` ; `CampaignStatusBadge` ; `CampaignImportDialog` (Task 2).
- Produces : route `/campaigns` (home portfolio).

- [ ] **Step 1: `CampaignPortfolioCard`**

Créer `app/campaigns/_components/CampaignPortfolioCard.tsx` :

```tsx
'use client';
import Link from 'next/link';
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge';
import type { CampaignStatus } from '@/lib/campaigns/status';

export interface PortfolioCampaign {
  id: string;
  name: string;
  dsp_source: string | null;
  date_start: string | null;
  date_end: string | null;
  is_demo?: boolean;
  organization_name?: string | null;
  total_rows?: number;
  france_rows?: number;
  matched_iris?: number;
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

export function CampaignPortfolioCard(
  { campaign, status, attention }: { campaign: PortfolioCampaign; status: CampaignStatus; attention: boolean },
) {
  const pct = campaign.france_rows && campaign.france_rows > 0
    ? Math.round(((campaign.matched_iris ?? 0) / campaign.france_rows) * 100) : null;
  return (
    <Link href={`/campaigns/${campaign.id}`}
      style={{ display: 'block', background: 'var(--card)', border: '0.5px solid var(--border-subtle)', borderRadius: 8, padding: '14px 16px', textDecoration: 'none' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--brand-teal)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ flex: 1, fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 14, color: 'var(--text-primary)' }}>{campaign.name}</span>
        {attention && (
          <span title="Données en retard" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0 }} />
        )}
        <CampaignStatusBadge status={status} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {campaign.organization_name && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{campaign.organization_name}</span>
        )}
        {campaign.dsp_source && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '1px 6px' }}>{campaign.dsp_source}</span>
        )}
        {campaign.is_demo && (
          <span style={{ fontSize: 10, color: 'var(--brand-teal)', border: '0.5px solid var(--brand-teal)', borderRadius: 4, padding: '1px 6px' }}>démo</span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
        <span>{fmtDate(campaign.date_start)} → {fmtDate(campaign.date_end)}</span>
        <span>{(campaign.total_rows ?? 0).toLocaleString('fr-FR')} lignes{pct !== null ? ` · ${pct}% IRIS` : ''}</span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: `PortfolioToolbar`**

Créer `app/campaigns/_components/PortfolioToolbar.tsx` (recherche + filtre statut + tri + CTA Créer + menu ⋯ admin). Reçoit les états contrôlés et callbacks depuis la page :

```tsx
'use client';
import type { CampaignStatus } from '@/lib/campaigns/status';
import { STATUS_META } from '@/lib/campaigns/status';

const STATUSES: CampaignStatus[] = ['a_venir', 'en_cours', 'en_pause', 'terminee', 'archivee'];

export function PortfolioToolbar({
  query, onQuery, statusFilter, onStatusFilter, sort, onSort, onCreate, onBulk,
}: {
  query: string; onQuery: (v: string) => void;
  statusFilter: CampaignStatus | 'all'; onStatusFilter: (s: CampaignStatus | 'all') => void;
  sort: 'recent' | 'name' | 'status'; onSort: (s: 'recent' | 'name' | 'status') => void;
  onCreate: () => void; onBulk: (action: 'populate-postal' | 'match-iris') => void;
}) {
  const chip = (active: boolean) => ({
    fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
    border: `0.5px solid ${active ? 'var(--brand-teal)' : 'var(--border-default)'}`,
    color: active ? 'var(--brand-teal)' : 'var(--text-secondary)', background: 'transparent',
  } as const);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Rechercher une campagne…"
        style={{ flex: '1 1 220px', background: 'var(--elevated)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={chip(statusFilter === 'all')} onClick={() => onStatusFilter('all')}>Tous</button>
        {STATUSES.map((s) => (
          <button key={s} style={chip(statusFilter === s)} onClick={() => onStatusFilter(s)}>{STATUS_META[s].label}</button>
        ))}
      </div>
      <select value={sort} onChange={(e) => onSort(e.target.value as 'recent' | 'name' | 'status')}
        style={{ background: 'var(--elevated)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: 'var(--text-primary)' }}>
        <option value="recent">Plus récent</option>
        <option value="name">Nom</option>
        <option value="status">Statut</option>
      </select>
      <button onClick={onCreate}
        style={{ background: 'var(--text-primary)', color: 'var(--background)', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
        Créer une campagne
      </button>
      <details style={{ position: 'relative' }}>
        <summary style={{ listStyle: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '4px 8px', fontSize: 16 }}>⋯</summary>
        <div style={{ position: 'absolute', right: 0, top: '100%', background: 'var(--card)', border: '0.5px solid var(--border-default)', borderRadius: 6, padding: 4, zIndex: 10, minWidth: 200 }}>
          <button onClick={() => onBulk('populate-postal')} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 12, padding: '8px 10px', cursor: 'pointer' }}>Peupler réf. La Poste</button>
          <button onClick={() => onBulk('match-iris')} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 12, padding: '8px 10px', cursor: 'pointer' }}>Relancer matching IRIS (toutes)</button>
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 3: La page `/campaigns`**

Créer `app/campaigns/page.tsx` :

```tsx
'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { effectiveCampaignStatus, campaignNeedsAttention, type CampaignStatus, type StatusOverride } from '@/lib/campaigns/status';
import { CampaignPortfolioCard, type PortfolioCampaign } from './_components/CampaignPortfolioCard';
import { PortfolioToolbar } from './_components/PortfolioToolbar';
import { CampaignImportDialog } from './_components/CampaignImportDialog';

type Row = PortfolioCampaign & { status_override: StatusOverride | null; last_data_date: string | null; created_at: string };

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function CampaignsPortfolioPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all');
  const [sort, setSort] = useState<'recent' | 'name' | 'status'>('recent');
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await adminFetch('/api/admin/campaigns');
      if (!res.ok) throw new Error('load_failed');
      setRows(await res.json());
    } catch { setError('Impossible de charger les campagnes'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const enriched = useMemo(() => {
    const t = todayISO();
    return rows.map((c) => {
      const status = effectiveCampaignStatus({ date_start: c.date_start, date_end: c.date_end, status_override: c.status_override }, t);
      const attention = campaignNeedsAttention({ status, last_data_date: c.last_data_date }, t);
      return { c, status, attention };
    });
  }, [rows]);

  const visible = useMemo(() => {
    let list = enriched;
    if (query.trim()) list = list.filter((x) => x.c.name.toLowerCase().includes(query.toLowerCase()));
    if (statusFilter !== 'all') list = list.filter((x) => x.status === statusFilter);
    const sorted = [...list];
    if (sort === 'name') sorted.sort((a, b) => a.c.name.localeCompare(b.c.name));
    else if (sort === 'status') sorted.sort((a, b) => a.status.localeCompare(b.status));
    else sorted.sort((a, b) => (b.c.created_at ?? '').localeCompare(a.c.created_at ?? ''));
    return sorted;
  }, [enriched, query, statusFilter, sort]);

  const onBulk = useCallback(async (action: 'populate-postal' | 'match-iris') => {
    try {
      if (action === 'populate-postal') {
        const res = await adminFetch('/api/admin/campaigns/populate-postal', { method: 'POST' });
        toast.success(res.ok ? 'Référentiel La Poste peuplé' : 'Échec', undefined);
      } else {
        for (const { c } of enriched) {
          await adminFetch(`/api/admin/campaigns/${c.id}/match-iris`, { method: 'POST' });
        }
        toast.success('Matching IRIS relancé', undefined);
        load();
      }
    } catch { toast.error('Erreur', undefined); }
  }, [enriched, toast, load]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 20, color: 'var(--text-primary)' }}>Campagnes</h1>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{visible.length} campagne{visible.length > 1 ? 's' : ''}</span>
      </div>
      <PortfolioToolbar query={query} onQuery={setQuery} statusFilter={statusFilter} onStatusFilter={setStatusFilter}
        sort={sort} onSort={setSort} onCreate={() => setImportOpen(true)} onBulk={onBulk} />

      {loading && <div style={{ padding: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>Chargement…</div>}
      {error && <div style={{ padding: 40, color: 'var(--danger)', fontSize: 13 }}>{error} — <button onClick={load} style={{ color: 'var(--brand-teal)', background: 'none', border: 'none', cursor: 'pointer' }}>réessayer</button></div>}
      {!loading && !error && visible.length === 0 && (
        <div style={{ padding: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>
          Aucune campagne. <button onClick={() => setImportOpen(true)} style={{ color: 'var(--brand-teal)', background: 'none', border: 'none', cursor: 'pointer' }}>Importer un export DSP</button>.
        </div>
      )}
      {!loading && !error && visible.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {visible.map(({ c, status, attention }) => (
            <CampaignPortfolioCard key={c.id} campaign={c} status={status} attention={attention} />
          ))}
        </div>
      )}

      <CampaignImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={load} />
    </div>
  );
}
```

> Note : les noms de champs (`status_override`, `last_data_date`, `created_at`, `date_start/end`, `total_rows`, `france_rows`, `matched_iris`, `is_demo`, `dsp_source`, `organization_name`) proviennent tels quels de la réponse `GET /api/admin/campaigns` (cf. route). Adapter si un nom diffère à la lecture réelle.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 5: Commit**

```bash
git add app/campaigns/page.tsx app/campaigns/_components/CampaignPortfolioCard.tsx app/campaigns/_components/PortfolioToolbar.tsx
git commit -m "feat(ux): home portfolio /campaigns (cartes statut/attention, filtres, import)"
```

---

### Task 4: Déplacer la liaison orgs dans le détail relocalisé

**Files:**
- Modify: `app/campaigns/[id]/page.tsx`
- Read (source) : `app/admin/campaigns/page.tsx` (bloc org-linking)

**Interfaces:**
- Consumes : `GET/POST /api/admin/campaigns/[id]/organizations`, `DELETE /api/admin/campaigns/[id]/organizations/[orgId]`.

- [ ] **Step 1: Extraire le bloc org-linking**

Dans `app/admin/campaigns/page.tsx`, repérer le bloc de liaison org↔campagne (chargement des orgs liées, boutons ajouter/retirer via `/api/admin/campaigns/${id}/organizations` et `/organizations/${orgId}`). Le **déplacer** dans `app/campaigns/[id]/page.tsx` en une section « Organisations » (composant local ou inline), utilisant le `campaignId` du détail. Réutiliser le pattern de section header (`SH`) déjà présent dans le détail. Logique iso-fonctionnelle (déplacement, pas réécriture).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add "app/campaigns/[id]/page.tsx"
git commit -m "refactor(ux): liaison orgs déplacée dans le détail campagne relocalisé"
```

---

### Task 5: Supprimer l'ancienne page liste + repointer tous les liens

**Files:**
- Delete: `app/admin/campaigns/page.tsx`
- Modify: `app/admin/sources/page.tsx` (Link détail campagne)
- Modify: `components/map/overlays/SettingsOverlay.tsx` (nav)
- Modify: `lib/dsp-mapping/loader.ts` (commentaire)

**Interfaces:** aucune (nettoyage).

- [ ] **Step 1: Supprimer l'ancienne page liste**

```bash
git rm "app/admin/campaigns/page.tsx"
```
(L'import, les ops bulk et la liaison orgs ont été re-logés Tasks 2/3/4 ; le détail a été déplacé Task 1. Cette page n'a plus de fonction propre.)

- [ ] **Step 2: Repointer les liens UI**

- `app/admin/sources/page.tsx` : remplacer le `Link href={\`/admin/campaigns/${c.id}\`}` par `href={\`/campaigns/${c.id}\`}`.
- `components/map/overlays/SettingsOverlay.tsx` : l'entrée `{ href: '/admin/campaigns', label: 'Campagnes DSP', ... }` → `href: '/campaigns'`, label `'Campagnes'`.
- `lib/dsp-mapping/loader.ts` : le commentaire mentionnant `/admin/campaigns modal d'import` → mentionner `app/campaigns (CampaignImportDialog)`.

- [ ] **Step 3: Vérif anti-dette**

Run: `grep -rn "/admin/campaigns" app/ components/ lib/`
Expected: **uniquement** des chemins `'/api/admin/campaigns...'` (backend) — aucun lien/nav UI vers `/admin/campaigns` ou `/admin/campaigns/[id]`. Si un lien UI subsiste, le repointer vers `/campaigns[...]`.

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit` → 0 erreur.
```bash
git add -A
git commit -m "chore(ux): supprimer l'ancienne page liste campagnes + repointer les liens (anti-dette)"
```

---

### Task 6: Shell — PillarSwitch + nav 2-piliers + redirect

**Files:**
- Create: `components/layout/PillarSwitch.tsx`
- Modify: `components/layout/TopRightChrome.tsx`
- Modify: `components/AppSidebar.tsx`
- Modify: `app/page.tsx`
- Modify: `middleware.ts`

**Interfaces:**
- Produces : switch de piliers global + nav refondue + `/` → `/campaigns`.

- [ ] **Step 1: `PillarSwitch`**

Créer `components/layout/PillarSwitch.tsx` :

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function PillarSwitch() {
  const pathname = usePathname() ?? '';
  const onMap = pathname.startsWith('/map');
  const seg = (active: boolean) => ({
    padding: '5px 12px', fontSize: 12, fontWeight: 500, textDecoration: 'none', borderRadius: 5,
    color: active ? 'var(--background)' : 'var(--text-secondary)',
    background: active ? 'var(--brand-teal)' : 'transparent',
  } as const);
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 7, background: 'var(--elevated)', border: '0.5px solid var(--border-subtle)' }}>
      <Link href="/campaigns" style={seg(!onMap)}>Campagnes</Link>
      <Link href="/map" style={seg(onMap)}>Carte</Link>
    </div>
  );
}
```

- [ ] **Step 2: Monter le switch dans `TopRightChrome` (visible AUSSI sur /map)**

Remplacer le contenu de `components/layout/TopRightChrome.tsx` :

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { SessionBadge } from '@/components/SessionBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PillarSwitch } from '@/components/layout/PillarSwitch';

export function TopRightChrome() {
  const pathname = usePathname();
  const onMap = pathname?.startsWith('/map');
  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
      }}
    >
      <PillarSwitch />
      {!onMap && <ThemeToggle />}
      {!onMap && <SessionBadge />}
    </div>
  );
}
```

(Le switch est désormais rendu partout, y compris sur `/map` — l'utilisateur peut toujours revenir aux Campagnes. Theme+Session restent masqués sur /map comme avant.)

- [ ] **Step 3: `AppSidebar` — nav 2-piliers**

Dans `components/AppSidebar.tsx`, remplacer le tableau `navItems` par la structure 2-piliers (garder le reste du composant, les icônes lucide déjà importées ; ajouter `LayoutGrid`/`Map` si besoin depuis lucide-react) :

```tsx
const navItems: NavSection[] = [
  {
    section: 'Campagnes',
    items: [
      { href: '/campaigns', label: 'Portfolio', icon: Target },
    ],
  },
  {
    section: 'Carte',
    items: [
      { href: '/map', label: 'Explorer', icon: MapPin },
      { href: '/map/custom-geo', label: 'Zones custom', icon: Layers },
    ],
  },
  {
    section: 'Administration',
    items: [
      { href: '/admin/carreaux-import', label: 'Import Shapefile', icon: Upload, badge: 'Admin' },
      { href: '/admin/import', label: 'Import POI', icon: FileUp, badge: 'Admin' },
      { href: '/admin/ooh-import', label: 'Import OOH', icon: Monitor, badge: 'Admin' },
      { href: '/dashboard/iris-crawler', label: 'IRIS Crawler', icon: Layers, badge: 'Admin' },
      { href: '/admin/radio', label: 'Radio FM/DAB+', icon: Radio, badge: 'Admin' },
      { href: '/admin/api', label: 'Connexions API', icon: Plug, badge: 'Admin' },
    ],
  },
  {
    section: 'Systeme',
    items: [
      { href: '/admin/sources', label: 'Sources', icon: Database },
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/organizations', label: 'Organisations', icon: Users },
      { href: '/admin/imports', label: 'Imports', icon: Upload },
      { href: '/admin/health', label: 'Health check', icon: Activity, badge: 'Sys' },
    ],
  },
];
```

(Retrait des entrées obsolètes « geo.prompt », « Digital », « Campagnes DSP → /admin/campaigns », « Connexion → /login ». Le comportement de masquage sur `/map` reste inchangé — la sidebar disparaît sur la carte, le PillarSwitch du chrome prend le relais.)

- [ ] **Step 4: `/` redirige vers `/campaigns`**

Remplacer `app/page.tsx` :

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/campaigns');
}
```

- [ ] **Step 5: Protéger `/campaigns` au middleware**

Dans `middleware.ts`, ajouter `/campaigns` à `PROTECTED_PAGE_PREFIXES` (après `/dashboard`) et `'/campaigns/:path*'` au `matcher`. (Le détail `/campaigns/[id]` appelle des routes admin → l'utilisateur doit être authentifié.)

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` → 0 erreur.
```bash
git add -A
git commit -m "feat(ux): shell 2-piliers (PillarSwitch + nav refondue) + / -> /campaigns"
```

---

## Vérification finale (contrôleur, après Tasks 1-6)

1. `npx tsc --noEmit` → 0 · `npm run build` → succès (34+ pages, dont `/campaigns` et `/campaigns/[id]`).
2. `grep -rn "/admin/campaigns" app/ components/ lib/` → **uniquement** `/api/admin/campaigns*` (anti-dette validé).
3. Vérif navigateur (Playwright authentifié) :
   - `/` redirige vers `/campaigns` ; le portfolio liste les campagnes avec badges de statut + dots d'attention.
   - Recherche / filtres statut / tri fonctionnent.
   - « Créer une campagne » ouvre `CampaignImportDialog`.
   - Une carte ouvre `/campaigns/[id]` (détail relocalisé, section Organisations présente).
   - `PillarSwitch` bascule vers `/map` et revient (visible même sur la carte).
   - `/admin/campaigns` (ancienne URL) n'existe plus (404) — aucun lien de l'app n'y mène.
   - Console 0 erreur.
