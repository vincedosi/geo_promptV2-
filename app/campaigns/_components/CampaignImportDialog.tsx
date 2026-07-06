'use client';

import { useState, useEffect, useRef } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CampaignImportEvent, CampaignImportReport } from '@/types/campaign';

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: 'var(--bg-primary)', card: 'var(--bg-surface)', elevated: 'var(--bg-level-2)',
  border: 'var(--border-subtle)', borderDefault: 'var(--border-default)',
  teal: 'var(--brand-teal)', tealDim: 'var(--brand-teal-10)',
  green: 'var(--success)', greenDim: 'rgba(61,255,160,0.1)',
  red: 'var(--danger)', redDim: 'rgba(255,87,87,0.08)',
  warn: 'var(--warning)', warnDim: 'rgba(247,183,49,0.1)',
  text: 'var(--text-primary)', textSec: 'var(--text-secondary)', textDim: 'var(--text-tertiary)',
};
const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface DspSourceOption { value: string; label: string; }

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fmtNum(n: number) {
  return n.toLocaleString('fr-FR');
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
  // Le serveur retourne désormais des rows flat (core+metrics+dimensions
  // mergés) ; la table d'aperçu lit row[col] où col = nom du target_field.
  sample_rows: Record<string, unknown>[];
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
  { value: 'unique_impressions', label: 'Impressions uniques' },
  { value: 'media', label: 'Régie / Media' },
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
export function CampaignImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast: toastApi } = useToast();

  // Org selector (super_admin only)
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('');

  // Modal step: 'upload' → 'preview' → 'importing' → 'done'
  type ModalStep = 'upload' | 'preview' | 'importing' | 'done';
  const [step, setStep] = useState<ModalStep>('upload');

  // Upload state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [dspSource, setDspSource] = useState<string>('adform');
  const [dspOptions, setDspOptions] = useState<DspSourceOption[]>([]);
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

  // Load orgs for the org selector (super_admin only)
  useEffect(() => {
    adminFetch('/api/admin/organizations')
      .then(r => r.ok ? r.json() : { organizations: [] })
      .then(d => setOrgs(Array.isArray(d) ? d : (d.organizations ?? [])))
      .catch(() => {});
  }, []);

  // Load DSP sources for the import modal dropdown (driven by dsp_source_mappings)
  useEffect(() => {
    adminFetch('/api/admin/dsp-sources')
      .then(r => r.ok ? r.json() : { sources: [] })
      .then((d: { sources?: DspSourceOption[] }) => {
        const opts = d.sources ?? [];
        setDspOptions(opts);
        if (opts.length > 0 && !opts.some(o => o.value === 'adform')) {
          // Adform absent : pivote vers le premier DSP dispo
          setDspSource(opts[0].value);
        }
      })
      .catch(() => {});
  }, []);

  const resetModal = () => {
    setImportFile(null); setCampaignName(''); setDspSource('adform');
    setPreviewData(null); setImportEvents([]); setImportReport(null);
    setStep('upload'); setPreviewing(false);
  };

  // Reset state each time the dialog is (re)opened
  useEffect(() => {
    if (open) resetModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    } catch (err: unknown) {
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
    if (selectedOrg) form.append('organization_id', selectedOrg);

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
              onImported();
            }
            if (evt.type === 'error') toastApi.error('Erreur', evt.message);
          } catch { /* skip */ }
        }
      }
    } catch (err: unknown) {
      toastApi.error('Erreur réseau', String(err));
      setStep('preview');
    }
  };

  const lastProgress = importEvents.filter((e) => e.type === 'progress').at(-1);
  const progressPct = lastProgress?.type === 'progress' && lastProgress.total > 0
    ? Math.round((lastProgress.processed / lastProgress.total) * 100) : 0;

  const isImporting = step === 'importing';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isImporting && !o) onClose(); }}>
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
                  {dspOptions.length === 0
                    ? <option value="">Aucun DSP configuré</option>
                    : dspOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {orgs.length > 1 && (
              <div>
                <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, display: 'block', marginBottom: 6 }}>Organisation</label>
                <select value={selectedOrg || orgs[0]?.id || ''} onChange={(e) => setSelectedOrg(e.target.value)}
                  style={{ width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: C.text, outline: 'none' }}>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              )}
              <div>
                <label style={{ fontFamily: fInter, fontSize: 12, color: C.textDim, display: 'block', marginBottom: 6 }}>Nom (optionnel)</label>
                <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="Auto-détecté depuis le fichier"
                  style={{ width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: C.text, outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={onClose}
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
                    const allCols = ['date', 'city', 'country', 'postal_code', 'region', 'dma_region', 'tracked_ads', 'unique_impressions', 'media'] as const;
                    const numericCols = new Set(['tracked_ads', 'unique_impressions']);
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
                                <td key={col} style={{ padding: '3px 8px', whiteSpace: 'nowrap', color: numericCols.has(col) ? C.text : C.textSec, fontWeight: numericCols.has(col) ? 500 : 400 }}>
                                  {numericCols.has(col) ? fmtNum(Number(row[col as keyof typeof row] ?? 0)) : (row[col as keyof typeof row] as string) ?? '—'}
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
                <button onClick={onClose}
                  style={{ background: C.text, color: C.bg, border: 'none', borderRadius: 6, padding: '10px 16px', fontFamily: fInter, fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
                  Fermer
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
