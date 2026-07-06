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
  const { toast } = useToast();
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
        if (res.ok) toast.success('Référentiel La Poste peuplé', undefined);
        else toast.error('Échec', undefined);
      } else {
        const targets = enriched.filter(({ c }) => (c.france_rows ?? 0) > 0 && (c.matched_iris ?? 0) === 0);
        if (targets.length === 0) {
          toast.success('Rien à matcher', undefined);
        } else {
          let done = 0;
          for (const { c } of targets) {
            await adminFetch(`/api/admin/campaigns/${c.id}/match-iris`, { method: 'POST' });
            done += 1;
            if (done % 3 === 0 || done === targets.length) {
              toast.success(`Matching IRIS ${done}/${targets.length}`, undefined);
            }
          }
          load();
        }
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
