/**
 * MAGELIAN — panneau « DSP » du back-office Data Sources.
 *
 * Liste des campagnes DSP, modale d'import SSE avec journal d'evenements et
 * rapport final, suppression avec confirmation.
 *
 * Tout l'etat vient du hook useDspImport, appele par le PARENT et transmis en
 * une seule prop.
 *
 * Extrait de app/admin/sources/page.tsx (refactor du 31/08/2026).
 */
import Link from 'next/link';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import type { DspImport } from '../_hooks/useDspImport';
import { C, fontMono, fontInter } from '../_lib/theme';
import { Spinner } from './ui';

interface DspPanelProps {
  dsp: DspImport;
}

export function DspPanel({ dsp }: DspPanelProps) {
  // Destructure a plat : le corps du JSX garde les noms d origine.
  const {
    dspCampaigns, dspLoading,
    dspImportOpen, setDspImportOpen, dspImporting,
    dspFile, setDspFile, dspSource, setDspSource,
    dspCampaignName, setDspCampaignName, dspFileRef,
    dspEvents, dspReport, handleDspImport, resetDspModal,
    dspDeleteConfirm, setDspDeleteConfirm, dspDeleting, handleDspDelete,
  } = dsp;

      const DSP_SOURCES = ['adform', 'dv360', 'ttd', 'xandr', 'amazon_dsp', 'other'];
      const fmtD = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
      const fmtN = (n: number) => n.toLocaleString('fr-FR');
      const lastProg = dspEvents.filter((e) => e.type === 'progress').at(-1);
      const pPct = lastProg?.type === 'progress' && lastProg.total > 0 ? Math.round((lastProg.processed / lastProg.total) * 100) : 0;
      const cardSt = { background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2 };
      return (
        <div style={{ animation: 'srcFadeIn 0.3s ease-out' }}>
          {/* Header + import button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: C.text }}>Campagnes DSP importées</span>
            <button
              onClick={() => { resetDspModal(); setDspImportOpen(true); }}
              style={{ background: C.text, color: C.bg, border: 'none', borderRadius: 6, padding: '8px 14px', fontFamily: fontInter, fontWeight: 500, fontSize: 12, cursor: 'pointer' }}
            >
              Importer une campagne
            </button>
          </div>

          {/* Campaign list */}
          {dspLoading ? (
            <div style={{ ...cardSt, textAlign: 'center', padding: 40, color: C.textDim }}>
              <Spinner size={20} /> Chargement…
            </div>
          ) : dspCampaigns.length === 0 ? (
            <div style={{ ...cardSt, textAlign: 'center', padding: 40, color: C.textDim, fontFamily: fontInter, fontSize: 13 }}>
              Aucune campagne DSP importée
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dspCampaigns.map((c) => (
                <div key={c.id} style={{ ...cardSt, padding: '12px 16px', transition: 'border-color 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.borderLight; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <Link href={`/map?campaign=${c.id}&tab=apercu`} style={{ fontWeight: 500, fontSize: 14, color: C.accent, textDecoration: 'none', flex: 1, fontFamily: fontInter }}>
                      {c.name}
                    </Link>
                    <span style={{ fontSize: 10, padding: '2px 8px', background: C.warnDim, border: `0.5px solid ${C.warn}44`, borderRadius: 4, color: C.warn, fontFamily: fontInter, fontWeight: 500 }}>
                      {c.dsp_source}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDspDeleteConfirm(c.id); }}
                      style={{ background: C.redDim, border: `0.5px solid rgba(255,87,87,0.2)`, borderRadius: 4, padding: '3px 10px', fontFamily: fontInter, fontSize: 10, color: C.red, cursor: 'pointer' }}
                    >
                      Supprimer
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: fontMono, color: C.textDim, flexWrap: 'wrap' }}>
                    <span>{fmtD(c.date_start)} → {fmtD(c.date_end)}</span>
                    <span>{fmtN(c.total_tracked_ads)} tracked ads</span>
                    <span>{fmtN(c.total_rows)} lignes</span>
                    <span>{c.countries?.join(', ') ?? '—'}</span>
                    {c.france_rows > 0 && (
                      <span style={{ color: c.matched_iris > 0 ? C.green : C.textDim }}>
                        {fmtN(c.matched_iris)} IRIS ({Math.round((c.matched_iris / c.france_rows) * 100)}%)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Import modal ── */}
          <Dialog open={dspImportOpen} onOpenChange={(open) => { if (!dspImporting) setDspImportOpen(open); }}>
            <DialogContent style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, maxWidth: 520 }}>
              <DialogHeader>
                <DialogTitle style={{ fontFamily: fontInter, fontWeight: 500, fontSize: 16, color: C.text }}>
                  Importer une campagne DSP
                </DialogTitle>
              </DialogHeader>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
                {/* File drop zone */}
                <div>
                  <label style={{ fontFamily: fontInter, fontSize: 12, color: C.textSec, display: 'block', marginBottom: 6 }}>Fichier (CSV ou XLSX)</label>
                  <div
                    onClick={() => dspFileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setDspFile(f); }}
                    style={{ background: C.bgSurface, border: `0.5px dashed ${C.borderLight}`, borderRadius: 6, padding: '20px 16px', textAlign: 'center', cursor: 'pointer' }}
                  >
                    <input ref={dspFileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.[0]) setDspFile(e.target.files[0]); }} />
                    {dspFile
                      ? <span style={{ fontFamily: fontMono, fontSize: 12, color: C.accent }}>{dspFile.name}</span>
                      : <span style={{ fontFamily: fontInter, fontSize: 12, color: C.textSec }}>Glisser-déposer ou cliquer pour sélectionner</span>
                    }
                  </div>
                </div>
                {/* DSP source */}
                <div>
                  <label style={{ fontFamily: fontInter, fontSize: 12, color: C.textSec, display: 'block', marginBottom: 6 }}>Source DSP</label>
                  <select value={dspSource} onChange={(e) => setDspSource(e.target.value)} disabled={dspImporting}
                    style={{ width: '100%', background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: fontInter, fontSize: 13, color: C.text, outline: 'none' }}>
                    {DSP_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {/* Campaign name */}
                <div>
                  <label style={{ fontFamily: fontInter, fontSize: 12, color: C.textSec, display: 'block', marginBottom: 6 }}>Nom (optionnel, auto-détecté sinon)</label>
                  <input type="text" value={dspCampaignName} onChange={(e) => setDspCampaignName(e.target.value)} disabled={dspImporting}
                    placeholder="Ex: Adform Q1 2026"
                    style={{ width: '100%', background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: fontInter, fontSize: 13, color: C.text, outline: 'none' }} />
                </div>
                {/* Progress */}
                {dspEvents.length > 0 && (
                  <div style={{ background: C.bg, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: 12, maxHeight: 200, overflowY: 'auto' }}>
                    {dspImporting && pPct > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ width: '100%', height: 4, background: C.border, borderRadius: 2 }}>
                          <div style={{ width: `${pPct}%`, height: 4, background: C.accent, borderRadius: 2, transition: 'width 0.3s ease' }} />
                        </div>
                        <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textSec, marginTop: 4, textAlign: 'right' }}>{pPct}%</div>
                      </div>
                    )}
                    {dspEvents.map((evt, i) => (
                      <div key={i} style={{ fontFamily: fontMono, fontSize: 11, padding: '2px 0', color: evt.type === 'error' ? C.red : evt.type === 'complete' ? C.green : C.textDim }}>
                        {evt.type === 'complete' ? `✓ ${evt.report.total_rows} lignes, ${evt.report.matched_iris} IRIS (${evt.report.pct_matched}%)` : evt.message}
                      </div>
                    ))}
                  </div>
                )}
                {/* Report */}
                {dspReport && (
                  <div style={{ background: C.greenDim, border: `0.5px solid rgba(61,255,160,0.2)`, borderRadius: 6, padding: 12 }}>
                    <div style={{ fontFamily: fontInter, fontSize: 12, color: C.green, fontWeight: 500, marginBottom: 6 }}>Import réussi</div>
                    <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      <span>Lignes</span><span style={{ color: C.text }}>{fmtN(dspReport.total_rows)}</span>
                      <span>Pays</span><span style={{ color: C.text }}>{dspReport.countries.join(', ')}</span>
                      <span>France</span><span style={{ color: C.text }}>{fmtN(dspReport.total_france)}</span>
                      <span>IRIS</span><span style={{ color: C.green }}>{fmtN(dspReport.matched_iris)} ({dspReport.pct_matched}%)</span>
                    </div>
                  </div>
                )}
                {/* Buttons */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  {dspReport ? (
                    <button onClick={() => setDspImportOpen(false)}
                      style={{ background: C.text, color: C.bg, border: 'none', borderRadius: 6, padding: '10px 16px', fontFamily: fontInter, fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
                      Fermer
                    </button>
                  ) : (
                    <>
                      <button onClick={() => setDspImportOpen(false)} disabled={dspImporting}
                        style={{ background: 'transparent', border: `0.5px solid ${C.borderLight}`, borderRadius: 6, padding: '10px 16px', fontFamily: fontInter, fontSize: 13, color: C.textDim, cursor: dspImporting ? 'not-allowed' : 'pointer' }}>
                        Annuler
                      </button>
                      <button onClick={handleDspImport} disabled={!dspFile || dspImporting}
                        style={{ background: !dspFile || dspImporting ? C.borderLight : C.text, color: C.bg, border: 'none', borderRadius: 6, padding: '10px 16px', fontFamily: fontInter, fontWeight: 500, fontSize: 13, cursor: !dspFile || dspImporting ? 'not-allowed' : 'pointer' }}>
                        {dspImporting ? 'Import en cours…' : 'Lancer l\'import'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Delete confirmation */}
          <ConfirmModal
            open={!!dspDeleteConfirm}
            onClose={() => setDspDeleteConfirm(null)}
            onConfirm={() => { if (dspDeleteConfirm) handleDspDelete(dspDeleteConfirm); }}
            title="Supprimer cette campagne DSP"
            message="La campagne et toutes ses données seront définitivement supprimées."
            confirmLabel={dspDeleting ? 'Suppression…' : 'Supprimer'}
            variant="danger"
            loading={dspDeleting}
          />
        </div>
      );
}
