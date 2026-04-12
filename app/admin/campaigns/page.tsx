'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CampaignListItem, CampaignImportEvent, CampaignImportReport, DspCampaignData } from '@/types/campaign';
import type { ParsedCampaignRow } from '@/lib/campaigns/parser';

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: '#050505', card: '#0a0a0a', elevated: '#111111',
  border: '#1a1a1a', borderDefault: '#262626',
  teal: '#4ecdc4', tealDim: 'rgba(78,205,196,0.1)',
  green: '#3dffa0', greenDim: 'rgba(61,255,160,0.1)',
  red: '#ff5757', redDim: 'rgba(255,87,87,0.08)',
  warn: '#f7b731', warnDim: 'rgba(247,183,49,0.1)',
  text: '#f0f0f0', textSec: '#a0a0a0', textDim: '#666666',
};
const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const DSP_SOURCES = ['adform', 'dv360', 'ttd', 'xandr', 'amazon_dsp', 'other'] as const;

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fmtNum(n: number) {
  return n.toLocaleString('fr-FR');
}
function SH({ label }: { label: string }) {
  return (
    <div style={{ background: C.elevated, borderTop: `1px solid ${C.border}`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
      <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: C.text }}>{label}</span>
    </div>
  );
}

// ── Preview types ─────────────────────────────────────────────────────────────
interface PreviewData {
  file_name: string;
  dsp_source: string;
  column_mapping: { source_column: string; db_field: string }[];
  file_headers: string[];
  total_rows: number;
  campaign_name: string;
  countries: string[];
  date_start: string | null;
  date_end: string | null;
  total_tracked_ads: number;
  errors: string[];
  sample_rows: ParsedCampaignRow[];
  detected_columns?: string[];
}

const DB_FIELDS = [
  { value: '', label: '— ignorer —' },
  { value: 'campaign_name', label: 'Campagne' },
  { value: 'date', label: 'Date' },
  { value: 'city', label: 'Ville' },
  { value: 'country', label: 'Pays' },
  { value: 'postal_code', label: 'Code postal' },
  { value: 'region', label: 'Région' },
  { value: 'dma_region', label: 'DMA région' },
  { value: 'tracked_ads', label: 'Impressions' },
  { value: 'media', label: 'Régie / Media' },
] as const;

// ── Preview panel for existing campaigns ────────────────────────────────────
const PREVIEW_COLS: { label: string; key: keyof DspCampaignData; color?: string }[] = [
  { label: 'date', key: 'date' },
  { label: 'city', key: 'city' },
  { label: 'country', key: 'country' },
  { label: 'postal_code', key: 'postal_code' },
  { label: 'region', key: 'region' },
  { label: 'tracked_ads', key: 'tracked_ads', color: C.text },
  { label: 'code_iris', key: 'code_iris', color: C.green },
  { label: 'code_commune', key: 'code_commune', color: C.teal },
];

function CampaignPreviewPanel({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<DspCampaignData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminFetch(`/api/admin/campaigns/${campaignId}?page=1`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setRows(data.data?.rows ?? []);
          setTotal(data.data?.total ?? 0);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  if (loading) return <div style={{ padding: 16, fontFamily: fMono, fontSize: 11, color: C.textDim }}>Chargement…</div>;

  return (
    <div style={{ padding: '8px 0 12px' }}>
      <div style={{ overflowX: 'auto', padding: '0 4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fMono, fontSize: 10 }}>
          <thead>
            <tr>
              {PREVIEW_COLS.map((col) => (
                <th key={col.key} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500, fontSize: 9, color: col.color ?? C.textDim, borderBottom: `0.5px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: `0.5px solid ${C.border}` }}>
                {PREVIEW_COLS.map((col) => {
                  const val = row[col.key];
                  const empty = val == null || val === '';
                  return (
                    <td key={col.key} style={{ padding: '3px 8px', whiteSpace: 'nowrap', color: empty ? '#333' : (col.color ?? C.textSec), fontSize: 10 }}>
                      {empty ? '—' : col.key === 'tracked_ads' ? fmtNum(val as number) : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '8px 16px 0', fontFamily: fMono, fontSize: 10, color: C.textDim }}>
        {rows.length} / {fmtNum(total)} lignes
        {' · '}
        <Link href={`/admin/campaigns/${campaignId}`} style={{ color: C.teal, textDecoration: 'none' }}>Voir tout →</Link>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function CampaignsPage() {
  const { toast: toastApi } = useToast();
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Modal step: 'upload' → 'preview' → 'importing' → 'done'
  type ModalStep = 'upload' | 'preview' | 'importing' | 'done';
  const [step, setStep] = useState<ModalStep>('upload');

  // Upload state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [dspSource, setDspSource] = useState<string>('adform');
  const [campaignName, setCampaignName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview state
  const [previewing, setPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  // Editable column mapping: file_header → db_field (or '' to ignore)
  const [customMapping, setCustomMapping] = useState<Record<string, string>>({});

  // Import state
  const [importEvents, setImportEvents] = useState<CampaignImportEvent[]>([]);
  const [importReport, setImportReport] = useState<CampaignImportReport | null>(null);

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // IRIS matching
  const [postalLoading, setPostalLoading] = useState(false);
  const [postalMsg, setPostalMsg] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await adminFetch('/api/admin/campaigns');
      console.log('[campaigns] fetch status:', res.status);
      if (res.ok) {
        const data = await res.json();
        console.log('[campaigns] data:', data);
        setCampaigns(data);
      } else {
        const err = await res.text();
        console.error('[campaigns] error:', res.status, err);
        setFetchError(`HTTP ${res.status} : ${err}`);
      }
    } catch (e) {
      console.error('[campaigns] fetch error:', e);
      setFetchError(String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  // ── Preview handler ───────────────────────────────────────────────────────
  const handlePreview = async () => {
    if (!importFile) return;
    setPreviewing(true);

    const form = new FormData();
    form.append('file', importFile);
    form.append('dsp_source', dspSource);

    try {
      const res = await adminFetch('/api/admin/campaigns/preview', { method: 'POST', body: form });
      if (res.ok) {
        const data: PreviewData = await res.json();
        setPreviewData(data);
        // Initialize editable mapping from auto-detected
        const initMapping: Record<string, string> = {};
        for (const h of data.file_headers ?? []) {
          const autoMatch = data.column_mapping.find(m => m.source_column.toLowerCase() === h.toLowerCase());
          initMapping[h] = autoMatch?.db_field ?? '';
        }
        setCustomMapping(initMapping);
        if (!campaignName.trim()) setCampaignName(data.campaign_name);
        setStep('preview');
      } else {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        toastApi.error('Erreur preview', err.error ?? 'Erreur inconnue');
      }
    } catch (err) {
      toastApi.error('Erreur réseau', String(err));
    }
    setPreviewing(false);
  };

  // ── Import handler (after preview validation) ─────────────────────────────
  const handleImport = async () => {
    if (!importFile) return;
    setStep('importing');
    setImportEvents([]);
    setImportReport(null);

    const form = new FormData();
    form.append('file', importFile);
    form.append('dsp_source', dspSource);
    if (campaignName.trim()) form.append('campaign_name', campaignName.trim());
    // Pass custom column mapping as JSON
    const activeMapping: Record<string, string> = {};
    for (const [header, field] of Object.entries(customMapping)) {
      if (field) activeMapping[header] = field;
    }
    form.append('column_mapping', JSON.stringify(activeMapping));

    try {
      const res = await adminFetch('/api/admin/campaigns/import', { method: 'POST', body: form });
      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '');
        toastApi.error('Import échoué', errBody || `HTTP ${res.status}`);
        setStep('preview');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const evt: CampaignImportEvent = JSON.parse(trimmed.slice(6));
            setImportEvents((prev) => [...prev, evt]);
            if (evt.type === 'complete') {
              setImportReport(evt.report);
              setStep('done');
              toastApi.success('Import terminé', `${evt.report.total_rows} lignes`);
              fetchCampaigns();
            }
            if (evt.type === 'error') toastApi.error('Erreur', evt.message);
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      toastApi.error('Erreur réseau', String(err));
      setStep('preview');
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${id}`, { method: 'DELETE' });
      if (res.ok) { toastApi.success('Campagne supprimée'); fetchCampaigns(); }
      else toastApi.error('Erreur', 'Suppression échouée');
    } catch { /* ignore */ }
    setDeleting(false);
    setDeleteConfirm(null);
  };

  // ── Populate postal + re-match IRIS ────────────────────────────────────
  const handlePopulateAndMatch = async () => {
    setPostalLoading(true);
    setPostalMsg('Téléchargement table postale La Poste…');
    try {
      const res = await adminFetch('/api/admin/campaigns/populate-postal', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        setPostalMsg(`Erreur: ${data.error}`);
        setPostalLoading(false);
        return;
      }
      setPostalMsg(`${fmtNum(data.inserted)} codes postaux importés. Matching IRIS en cours…`);

      // Re-match IRIS for each campaign
      for (const c of campaigns) {
        if (c.france_rows > 0 && c.matched_iris === 0) {
          await adminFetch(`/api/admin/campaigns/${c.id}/match-iris`, { method: 'POST' });
        }
      }
      setPostalMsg('Matching IRIS terminé');
      toastApi.success('Matching IRIS terminé');
      fetchCampaigns();
    } catch (err) {
      setPostalMsg(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
    }
    setPostalLoading(false);
  };

  const resetModal = () => {
    setImportFile(null); setCampaignName(''); setDspSource('adform');
    setPreviewData(null); setImportEvents([]); setImportReport(null);
    setStep('upload'); setPreviewing(false);
  };

  const lastProgress = importEvents.filter((e) => e.type === 'progress').at(-1);
  const progressPct = lastProgress?.type === 'progress' && lastProgress.total > 0
    ? Math.round((lastProgress.processed / lastProgress.total) * 100) : 0;

  const isImporting = step === 'importing';

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: fInter, fontSize: 20, fontWeight: 500, color: C.text, margin: 0 }}>Campagnes DSP</h1>
          <p style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, marginTop: 4 }}>Import et suivi des campagnes publicitaires digitales</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handlePopulateAndMatch} disabled={postalLoading}
            style={{ background: 'transparent', border: `0.5px solid ${C.teal}`, borderRadius: 6, padding: '10px 16px', fontFamily: fInter, fontWeight: 500, fontSize: 12, color: C.teal, cursor: postalLoading ? 'not-allowed' : 'pointer', opacity: postalLoading ? 0.6 : 1 }}>
            {postalLoading ? 'Matching…' : 'Peupler codes postaux + matcher IRIS'}
          </button>
          <button onClick={() => { resetModal(); setModalOpen(true); }}
            style={{ background: C.text, color: C.bg, border: 'none', borderRadius: 6, padding: '10px 16px', fontFamily: fInter, fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
            Importer une campagne
          </button>
        </div>
      </div>

      {postalMsg && (
        <div style={{
          fontFamily: fMono, fontSize: 11, padding: '8px 14px', marginBottom: 12, borderRadius: 4,
          background: postalMsg.startsWith('Erreur') ? C.redDim : C.tealDim,
          border: `0.5px solid ${postalMsg.startsWith('Erreur') ? 'rgba(255,87,87,0.2)' : 'rgba(78,205,196,0.2)'}`,
          color: postalMsg.startsWith('Erreur') ? C.red : C.teal,
        }}>
          {postalMsg}
        </div>
      )}

      {fetchError && (
        <div style={{
          fontFamily: fMono, fontSize: 11, padding: '10px 14px', marginBottom: 12, borderRadius: 4,
          background: C.redDim, border: `0.5px solid rgba(255,87,87,0.2)`, color: C.red,
        }}>
          Erreur chargement : {fetchError}
        </div>
      )}

      <SH label="Campagnes" />

      {/* Debug state */}
      <div style={{ fontFamily: fMono, fontSize: 10, color: C.warn, padding: '4px 14px', marginBottom: 8, background: C.warnDim, borderRadius: 4 }}>
        DEBUG — loading: {String(loading)} | campaigns: {campaigns.length} | error: {fetchError ?? 'none'}
      </div>

      {/* Campaign list */}
      {loading ? (
        <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim, padding: 20 }}>Chargement…</div>
      ) : campaigns.length === 0 ? (
        <div style={{ fontFamily: fInter, fontSize: 13, color: C.textDim, padding: 40, textAlign: 'center', background: C.card, borderRadius: 6, border: `0.5px solid ${C.border}` }}>
          Aucune campagne importée
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {campaigns.map((c) => {
            const isExp = expandedId === c.id;
            const pctIris = c.france_rows > 0 ? Math.round((c.matched_iris / c.france_rows) * 100) : 0;
            return (
              <div key={c.id} style={{ background: C.card, border: `0.5px solid ${isExp ? C.teal + '44' : C.border}`, borderRadius: 6, overflow: 'hidden', transition: 'border-color 0.15s' }}>
                <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={() => setExpandedId(isExp ? null : c.id)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: isExp ? C.teal : C.textDim, fontSize: 14, fontFamily: fMono, transition: 'transform 0.2s', transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                    ▶
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Link href={`/admin/campaigns/${c.id}`} style={{ fontFamily: fInter, fontWeight: 500, fontSize: 14, color: C.text, textDecoration: 'none' }}>{c.name}</Link>
                      <span style={{ background: C.warnDim, border: `0.5px solid ${C.warn}44`, borderRadius: 4, padding: '1px 6px', fontSize: 9, color: C.warn, fontFamily: fInter, fontWeight: 500 }}>{c.dsp_source}</span>
                    </div>
                    <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim, display: 'flex', gap: 12 }}>
                      <span>{fmtDate(c.date_start)} → {fmtDate(c.date_end)}</span>
                      <span>{c.countries?.length ?? 0} pays</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
                    {[
                      { v: fmtNum(c.total_tracked_ads), l: 'tracked ads', col: C.text },
                      { v: fmtNum(c.total_rows), l: 'lignes', col: C.textSec },
                      { v: fmtNum(c.france_rows), l: 'France', col: C.textSec },
                      { v: `${fmtNum(c.matched_iris)}${pctIris > 0 ? ` (${pctIris}%)` : ''}`, l: 'IRIS', col: c.matched_iris > 0 ? C.green : C.textDim },
                    ].map((kpi) => (
                      <div key={kpi.l} style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: fMono, fontSize: 14, fontWeight: 500, color: kpi.col }}>{kpi.v}</div>
                        <div style={{ fontFamily: fInter, fontSize: 9, color: C.textDim }}>{kpi.l}</div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setDeleteConfirm(c.id)}
                    style={{ background: C.redDim, border: `0.5px solid rgba(255,87,87,0.2)`, borderRadius: 4, padding: '4px 10px', fontFamily: fInter, fontSize: 10, color: C.red, cursor: 'pointer', flexShrink: 0 }}>
                    Supprimer
                  </button>
                </div>
                {isExp && (
                  <div style={{ borderTop: `0.5px solid ${C.border}`, background: C.bg }}>
                    <CampaignPreviewPanel campaignId={c.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ Import modal — multi-step ═══════════════════════════════════════ */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!isImporting) setModalOpen(open); }}>
        <DialogContent style={{ background: C.card, border: `0.5px solid ${C.border}`, maxWidth: step === 'upload' ? 520 : 720 }}>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: fInter, fontWeight: 500, fontSize: 16, color: C.text }}>
              {step === 'upload' && 'Importer une campagne'}
              {step === 'preview' && 'Preview du mapping'}
              {step === 'importing' && 'Import en cours…'}
              {step === 'done' && 'Import terminé'}
            </DialogTitle>
          </DialogHeader>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>

            {/* ── Step 1: Upload ──────────────────────────────────────────── */}
            {step === 'upload' && (
              <>
                <div>
                  <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, display: 'block', marginBottom: 6 }}>Fichier (CSV ou XLSX)</label>
                  <div onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setImportFile(f); }}
                    style={{ background: C.elevated, border: `0.5px dashed ${C.borderDefault}`, borderRadius: 6, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.15s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.teal; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderDefault; }}>
                    <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
                      onChange={(e) => { if (e.target.files?.[0]) setImportFile(e.target.files[0]); }} />
                    {importFile
                      ? <span style={{ fontFamily: fMono, fontSize: 12, color: C.teal }}>{importFile.name}</span>
                      : <span style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Glisser-déposer ou cliquer</span>}
                  </div>
                </div>
                <div>
                  <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, display: 'block', marginBottom: 6 }}>Source DSP</label>
                  <select value={dspSource} onChange={(e) => setDspSource(e.target.value)}
                    style={{ width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: C.text, outline: 'none' }}>
                    {DSP_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, display: 'block', marginBottom: 6 }}>Nom (optionnel)</label>
                  <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="Auto-détecté depuis le fichier"
                    style={{ width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: C.text, outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModalOpen(false)}
                    style={{ background: 'transparent', border: `0.5px solid ${C.borderDefault}`, borderRadius: 6, padding: '10px 16px', fontFamily: fInter, fontSize: 13, color: C.textSec, cursor: 'pointer' }}>
                    Annuler
                  </button>
                  <button onClick={handlePreview} disabled={!importFile || previewing}
                    style={{ background: !importFile || previewing ? C.borderDefault : C.text, color: C.bg, border: 'none', borderRadius: 6, padding: '10px 16px', fontFamily: fInter, fontWeight: 500, fontSize: 13, cursor: !importFile || previewing ? 'not-allowed' : 'pointer' }}>
                    {previewing ? 'Analyse…' : 'Analyser le fichier'}
                  </button>
                </div>
              </>
            )}

            {/* ── Step 2: Preview mapping ─────────────────────────────────── */}
            {step === 'preview' && previewData && (
              <>
                {/* Summary */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                  {[
                    { l: 'Lignes', v: fmtNum(previewData.total_rows) },
                    { l: 'Campagne', v: previewData.campaign_name },
                    { l: 'Pays', v: `${previewData.countries.length} pays` },
                    ...(previewData.date_start ? [{ l: 'Période', v: `${fmtDate(previewData.date_start)} → ${fmtDate(previewData.date_end)}` }] : []),
                    { l: 'Tracked ads', v: fmtNum(previewData.total_tracked_ads) },
                  ].map((kpi) => (
                    <div key={kpi.l} style={{ background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 4, padding: '8px 10px' }}>
                      <div style={{ fontFamily: fInter, fontSize: 9, color: C.textDim, marginBottom: 3 }}>{kpi.l}</div>
                      <div style={{ fontFamily: fMono, fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kpi.v}</div>
                    </div>
                  ))}
                </div>

                {/* Column mapping — editable dropdowns */}
                <div>
                  <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
                    Mapping des colonnes
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(previewData.file_headers ?? []).map((header) => (
                      <div key={header} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '4px 8px', borderRadius: 4,
                        background: customMapping[header] ? C.elevated : 'transparent',
                        border: `0.5px solid ${customMapping[header] ? C.border : 'transparent'}`,
                      }}>
                        <span style={{ fontFamily: fMono, fontSize: 11, color: C.warn, minWidth: 120 }}>{header}</span>
                        <span style={{ color: C.textDim, fontSize: 10 }}>→</span>
                        <select
                          value={customMapping[header] ?? ''}
                          onChange={(e) => setCustomMapping(prev => ({ ...prev, [header]: e.target.value }))}
                          style={{
                            flex: 1, background: C.bg, border: `0.5px solid ${C.border}`, borderRadius: 4,
                            padding: '3px 6px', fontFamily: fMono, fontSize: 11,
                            color: customMapping[header] ? C.teal : C.textDim,
                            outline: 'none', cursor: 'pointer',
                          }}
                        >
                          {DB_FIELDS.map(f => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Errors */}
                {previewData.errors.length > 0 && (
                  <div style={{ background: C.redDim, border: `0.5px solid rgba(255,87,87,0.2)`, borderRadius: 4, padding: '8px 12px' }}>
                    <div style={{ fontFamily: fInter, fontSize: 11, color: C.red, fontWeight: 500, marginBottom: 4 }}>
                      {previewData.errors.length} erreur(s) de parsing
                    </div>
                    {previewData.errors.map((e, i) => (
                      <div key={i} style={{ fontFamily: fMono, fontSize: 10, color: C.red, opacity: 0.8 }}>{e}</div>
                    ))}
                  </div>
                )}

                {/* Sample data table */}
                <div>
                  <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
                    Aperçu des données mappées ({previewData.sample_rows.length} / {fmtNum(previewData.total_rows)} lignes)
                  </div>
                  <div style={{ overflowX: 'auto', maxHeight: 280 }}>
                    {(() => {
                      const allCols = ['date', 'city', 'country', 'postal_code', 'region', 'dma_region', 'tracked_ads', 'media'] as const;
                      const detected = previewData.detected_columns ?? allCols as unknown as string[];
                      // Map target names to display — show only detected columns + always show tracked_ads
                      const visibleCols = allCols.filter(c => c === 'tracked_ads' || detected.includes(c));
                      return (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fMono, fontSize: 10 }}>
                          <thead>
                            <tr>
                              {visibleCols.map((h) => (
                                <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500, fontSize: 9, color: C.teal, borderBottom: `0.5px solid ${C.border}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: C.card }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {previewData.sample_rows.map((row, i) => (
                              <tr key={i} style={{ borderBottom: `0.5px solid ${C.border}` }}>
                                {visibleCols.map((col) => (
                                  <td key={col} style={{ padding: '3px 8px', whiteSpace: 'nowrap', color: col === 'tracked_ads' ? C.text : C.textSec, fontWeight: col === 'tracked_ads' ? 500 : 400 }}>
                                    {col === 'tracked_ads' ? fmtNum(row[col]) : (row[col as keyof typeof row] as string) ?? '—'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                </div>

                {/* Campaign name override */}
                <div>
                  <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, display: 'block', marginBottom: 6 }}>Nom de la campagne</label>
                  <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
                    style={{ width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: C.text, outline: 'none' }} />
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setStep('upload')}
                    style={{ background: 'transparent', border: `0.5px solid ${C.borderDefault}`, borderRadius: 6, padding: '10px 16px', fontFamily: fInter, fontSize: 13, color: C.textSec, cursor: 'pointer' }}>
                    ← Retour
                  </button>
                  <button onClick={handleImport}
                    style={{ background: C.text, color: C.bg, border: 'none', borderRadius: 6, padding: '10px 16px', fontFamily: fInter, fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
                    Lancer l&apos;import ({fmtNum(previewData.total_rows)} lignes)
                  </button>
                </div>
              </>
            )}

            {/* ── Step 3: Importing ───────────────────────────────────────── */}
            {step === 'importing' && (
              <div style={{ background: C.bg, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: 12, maxHeight: 300, overflowY: 'auto' }}>
                {progressPct > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ width: '100%', height: 4, background: C.border, borderRadius: 2 }}>
                      <div style={{ width: `${progressPct}%`, height: 4, background: C.teal, borderRadius: 2, transition: 'width 0.3s ease' }} />
                    </div>
                    <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim, marginTop: 4, textAlign: 'right' }}>{progressPct}%</div>
                  </div>
                )}
                {importEvents.map((evt, i) => (
                  <div key={i} style={{ fontFamily: fMono, fontSize: 11, padding: '2px 0', color: evt.type === 'error' ? C.red : evt.type === 'complete' ? C.green : C.textSec }}>
                    {evt.type === 'complete' ? `✓ ${evt.report.total_rows} lignes, ${evt.report.matched_iris} IRIS (${evt.report.pct_matched}%)` : evt.message}
                  </div>
                ))}
              </div>
            )}

            {/* ── Step 4: Done ────────────────────────────────────────────── */}
            {step === 'done' && importReport && (
              <>
                <div style={{ background: C.greenDim, border: `0.5px solid rgba(61,255,160,0.2)`, borderRadius: 6, padding: 12 }}>
                  <div style={{ fontFamily: fInter, fontSize: 12, color: C.green, fontWeight: 500, marginBottom: 6 }}>Import réussi</div>
                  <div style={{ fontFamily: fMono, fontSize: 11, color: C.textSec, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <span>Lignes</span><span style={{ color: C.text }}>{fmtNum(importReport.total_rows)}</span>
                    <span>Pays</span><span style={{ color: C.text }}>{importReport.countries.join(', ')}</span>
                    <span>France</span><span style={{ color: C.text }}>{fmtNum(importReport.total_france)}</span>
                    <span>IRIS</span><span style={{ color: C.green }}>{fmtNum(importReport.matched_iris)} ({importReport.pct_matched}%)</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModalOpen(false)}
                    style={{ background: C.text, color: C.bg, border: 'none', borderRadius: 6, padding: '10px 16px', fontFamily: fInter, fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
                    Fermer
                  </button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => { if (deleteConfirm) handleDelete(deleteConfirm); }}
        title="Supprimer cette campagne DSP"
        message="La campagne et toutes ses données seront définitivement supprimées."
        confirmLabel={deleting ? 'Suppression…' : 'Supprimer'}
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
