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
        style={{ flex: '1 1 220px', background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={chip(statusFilter === 'all')} onClick={() => onStatusFilter('all')}>Tous</button>
        {STATUSES.map((s) => (
          <button key={s} style={chip(statusFilter === s)} onClick={() => onStatusFilter(s)}>{STATUS_META[s].label}</button>
        ))}
      </div>
      <select value={sort} onChange={(e) => onSort(e.target.value as 'recent' | 'name' | 'status')}
        style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: 'var(--text-primary)' }}>
        <option value="recent">Plus récent</option>
        <option value="name">Nom</option>
        <option value="status">Statut</option>
      </select>
      <button onClick={onCreate}
        style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
        Créer une campagne
      </button>
      <details style={{ position: 'relative' }}>
        <summary style={{ listStyle: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '4px 8px', fontSize: 16 }}>⋯</summary>
        <div style={{ position: 'absolute', right: 0, top: '100%', background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderRadius: 6, padding: 4, zIndex: 10, minWidth: 200 }}>
          <button onClick={() => onBulk('populate-postal')} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 12, padding: '8px 10px', cursor: 'pointer' }}>Peupler réf. La Poste</button>
          <button onClick={() => onBulk('match-iris')} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 12, padding: '8px 10px', cursor: 'pointer' }}>Relancer matching IRIS (toutes)</button>
        </div>
      </details>
    </div>
  );
}
