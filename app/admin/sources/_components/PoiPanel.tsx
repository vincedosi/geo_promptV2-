/**
 * MAGELIAN — panneau « POI » du back-office Data Sources.
 *
 * Repartition des POI par categorie, echantillons pagines, modale de
 * creation/edition et suppressions (unitaire et en masse).
 *
 * Tout l'etat POI vient du hook usePoiAdmin, appele par le PARENT (voir la
 * note d'I/O dans ce hook) et transmis en une seule prop.
 *
 * Extrait de app/admin/sources/page.tsx (refactor du 31/08/2026).
 */
import type { SourcesStats } from '../_lib/types';
import type { PoiAdmin } from '../_hooks/usePoiAdmin';
import { C, fontMono, fontInter } from '../_lib/theme';
import { Spinner } from './ui';

interface PoiPanelProps {
  poi: PoiAdmin;
  sourcesStats: SourcesStats | null;
  sourcesStatsLoading: boolean;
}

export function PoiPanel({ poi, sourcesStats, sourcesStatsLoading }: PoiPanelProps) {
  // Destructure a plat : le corps conserve les noms de variables de
  // page.tsx avant extraction, aucune reference reecrite.
  const {
    selectedPoiCat, setSelectedPoiCat,
    poiSamples, setPoiSamples, poiSamplesTotal, poiSamplesOffset, setPoiSamplesOffset,
    poiSamplesLoading, fetchPoiSamples,
    poiModal, setPoiModal, poiModalSaving, poiModalError, emptyForm,
    openCreatePoi, openEditPoi, savePoi,
    confirmDeleteCat, setConfirmDeleteCat, bulkDeleting, deletePoi, deletePoisBulk,
  } = poi;

      const teal = 'var(--brand-teal)';
      const tealDim = 'var(--brand-teal-10)';
      const tealBorder = 'rgba(78,205,196,0.25)';
      const ss = sourcesStats;
      if (!ss) return (
        <div style={{ padding: '40px 0', textAlign: 'center', color: C.textDim, fontFamily: fontInter, fontSize: 13 }}>
          {sourcesStatsLoading ? <><Spinner size={18} /> Chargement...</> : 'Aucune donnée.'}
        </div>
      );
      // ── Mapping couleur/label pour catégories connues ──────────────────
      const POI_META: Record<string, { label: string; description: string; color: string; dim: string; border: string }> = {
        lycee:      { label: 'Lycées',          description: 'Établissements scolaires du second degré',                    color: C.warn,  dim: C.warnDim,                    border: `${C.warn}44` },
        cirfa:      { label: 'CIRFA',            description: 'Centres d\'information et de recrutement des forces armées',  color: C.red,   dim: C.redDim,                     border: `${C.red}44` },
        bmw:        { label: 'BMW Concessions',  description: 'Points de vente BMW',                                        color: '#3b82f6', dim: 'rgba(59,130,246,0.10)',     border: 'rgba(59,130,246,0.35)' },
        concession: { label: 'Concessions',      description: 'Points de vente automobiles',                                color: '#3b82f6', dim: 'rgba(59,130,246,0.10)',     border: 'rgba(59,130,246,0.35)' },
        pharmacie:  { label: 'Pharmacies',       description: 'Pharmacies et parapharmacies',                               color: C.green, dim: C.greenDim,                   border: `${C.green}44` },
        supermarche: { label: 'Supermarchés',    description: 'Grande distribution',                                        color: '#06b6d4', dim: 'rgba(6,182,212,0.10)',      border: 'rgba(6,182,212,0.35)' },
      };
      const PALETTE = [teal, '#06b6d4', C.green, '#f59e0b', '#ec4899', '#64748b', '#a0a0a0', '#34d399'];
      const getCatMeta = (cat: string, idx: number) => {
        if (POI_META[cat]) return POI_META[cat];
        const col = PALETTE[idx % PALETTE.length];
        return { label: cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' '), description: `Catégorie : ${cat}`, color: col, dim: `${col}18`, border: `${col}44` };
      };

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'srcFadeIn 0.3s ease-out' }}>
          <div style={{ background: tealDim, border: `0.5px solid ${tealBorder}`, borderRadius: 2, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: teal, letterSpacing: 1, marginBottom: 6 }}>Points d&apos;intérêt (hors transport)</div>
              <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 2 }}>
                <span style={{ color: C.textSec }}>Catégories: </span>{ss.poi.by_category.map((c) => c.categorie).join(', ') || '—'}<br />
                <span style={{ color: C.textSec }}>Table: </span><span style={{ color: C.accent }}>poi_france</span>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: teal, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                {ss.poi.total.toLocaleString('fr-FR')}
              </div>
              <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>points d&apos;intérêt</div>
            </div>
          </div>
          {/* ── Confirmation suppression bulk ─────────────────────────────── */}
          {confirmDeleteCat && (
            <div style={{ background: C.redDim, border: `0.5px solid ${C.red}44`, borderRadius: 2, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontFamily: fontInter, fontSize: 12, color: C.text, flex: 1 }}>
                Supprimer <strong style={{ color: C.red }}>TOUS</strong> les POI de catégorie <span style={{ fontFamily: fontMono, color: C.red }}>{confirmDeleteCat}</span> ? Cette action est irréversible.
              </span>
              <button
                onClick={() => deletePoisBulk(confirmDeleteCat)}
                disabled={bulkDeleting}
                style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: C.red, color: '#fff', border: 'none', borderRadius: 2, padding: '6px 14px', cursor: 'pointer', opacity: bulkDeleting ? 0.5 : 1 }}
              >
                {bulkDeleting ? 'Suppression...' : 'Confirmer'}
              </button>
              <button
                onClick={() => setConfirmDeleteCat(null)}
                style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'none', color: C.textDim, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '6px 14px', cursor: 'pointer' }}
              >
                Annuler
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {ss.poi.by_category.map(({ categorie: cat, nb }, idx) => {
              const meta = getCatMeta(cat, idx);
              const pct  = ss.poi.total > 0 ? Math.round(nb / ss.poi.total * 100) : 0;
              const isSelected = selectedPoiCat === cat;
              return (
                <div
                  key={cat}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = meta.border; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = isSelected ? meta.border : C.border; }}
                  style={{
                    background: isSelected ? meta.dim : C.bgElevated,
                    border: `0.5px solid ${isSelected ? meta.border : C.border}`,
                    borderRadius: 2,
                    padding: '16px',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    animation: `srcScaleIn 0.4s ease-out ${0.06 * idx}s both`,
                  }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: meta.color, marginBottom: 4 }}>POI</div>
                      <div style={{ fontFamily: fontInter, fontSize: 11, fontWeight: 700, color: isSelected ? meta.color : C.text, letterSpacing: 0.5 }}>{meta.label}</div>
                    </div>
                    <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: meta.color, background: meta.dim, border: `0.5px solid ${meta.border}`, padding: '2px 6px', borderRadius: 2 }}>
                      {pct}%
                    </span>
                  </div>

                  {/* Count */}
                  <div style={{ fontFamily: fontMono, fontSize: 32, fontWeight: 700, color: meta.color, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                    {nb.toLocaleString('fr-FR')}
                    <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginLeft: 8 }}>POI</span>
                  </div>

                  {/* Progress bar */}
                  <div style={{ height: 3, background: C.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: meta.color, borderRadius: 2, transition: 'width 0.3s ease', animation: 'srcBarGrow 0.6s ease-out' }} />
                  </div>

                  {/* Meta */}
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, lineHeight: 1.8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <div style={{ color: C.textSec, marginBottom: 2 }}>{meta.description}</div>
                    <div><span style={{ color: C.muted }}>cat: </span><span style={{ color: C.accent }}>{cat}</span></div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                    <button
                      onClick={() => { const next = isSelected ? null : cat; setSelectedPoiCat(next); if (next) { setPoiSamplesOffset(0); fetchPoiSamples(next, 0); } else setPoiSamples([]); }}
                      style={{ flex: 1, fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: isSelected ? meta.dim : 'transparent', color: isSelected ? meta.color : C.muted, border: `0.5px solid ${isSelected ? meta.border : C.border}`, borderRadius: 2, padding: '5px 8px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    >
                      {isSelected ? '✕ fermer' : '+ voir'}
                    </button>
                    <button
                      onClick={() => openCreatePoi(cat)}
                      style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'transparent', color: C.green, border: `0.5px solid ${C.green}44`, borderRadius: 2, padding: '5px 10px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    >
                      + nouveau
                    </button>
                    <button
                      onClick={() => setConfirmDeleteCat(cat)}
                      style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'transparent', color: C.red, border: `0.5px solid ${C.red}44`, borderRadius: 2, padding: '5px 10px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    >
                      ✕ purger
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Samples panel */}
          {selectedPoiCat && (
            <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgSurface, display: 'flex', alignItems: 'center', gap: 8, borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
                <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: teal }}>
                  {selectedPoiCat} — {poiSamples.length} / {poiSamplesTotal.toLocaleString('fr-FR')} POI
                </span>
                {poiSamplesLoading && <Spinner size={12} />}
                <button
                  onClick={() => openCreatePoi(selectedPoiCat)}
                  style={{ marginLeft: 'auto', fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: C.greenDim, color: C.green, border: `0.5px solid ${C.green}44`, borderRadius: 2, padding: '4px 10px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                >
                  + nouveau POI
                </button>
                <button onClick={() => { setSelectedPoiCat(null); setPoiSamples([]); }} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 13, lineHeight: 1, marginLeft: 4 }}>✕</button>
              </div>

              {/* Table */}
              {poiSamples.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontMono, fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: C.bgSurface }}>
                        {['Nom', 'Ville', 'Adresse', 'Sous-cat', 'Lat', 'Lng', 'Source', ''].map((h) => (
                          <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontFamily: fontInter, fontSize: 9, fontWeight: 400, color: C.textDim, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {poiSamples.map((p, i) => (
                        <tr
                          key={p.id}
                          style={{ borderBottom: `1px solid ${C.bgSurface}`, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', transition: 'background 0.2s ease', animation: `srcFadeIn 0.3s ease-out ${Math.min(i, 20) * 0.02}s both` }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-level-2)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
                        >
                          <td style={{ padding: '5px 12px', color: C.text, fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nom ?? '—'}</td>
                          <td style={{ padding: '5px 12px', color: C.textDim, whiteSpace: 'nowrap' }}>{p.ville ?? '—'}</td>
                          <td style={{ padding: '5px 12px', color: C.textSec, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.adresse ?? '—'}</td>
                          <td style={{ padding: '5px 12px', color: C.textDim }}>{p.sous_categorie ?? '—'}</td>
                          <td style={{ padding: '5px 12px', color: C.muted }}>{p.lat?.toFixed(4)}</td>
                          <td style={{ padding: '5px 12px', color: C.muted }}>{p.lng?.toFixed(4)}</td>
                          <td style={{ padding: '5px 12px', color: C.muted, fontSize: 10 }}>{p.source ?? '—'}</td>
                          <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                            <button
                              onClick={() => openEditPoi(p)}
                              style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'transparent', color: C.accent, border: `0.5px solid ${C.borderLight}`, borderRadius: 2, padding: '3px 7px', cursor: 'pointer', marginRight: 4 }}
                            >
                              éditer
                            </button>
                            <button
                              onClick={() => deletePoi(p.id)}
                              style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'transparent', color: C.red, border: `0.5px solid ${C.red}44`, borderRadius: 2, padding: '3px 7px', cursor: 'pointer' }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Load more */}
              {poiSamples.length < poiSamplesTotal && (
                <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => fetchPoiSamples(selectedPoiCat, poiSamplesOffset)}
                    disabled={poiSamplesLoading}
                    style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: C.accentDim, color: C.accent, border: `0.5px solid ${C.borderLight}`, borderRadius: 2, padding: '5px 14px', cursor: 'pointer', opacity: poiSamplesLoading ? 0.5 : 1 }}
                  >
                    {poiSamplesLoading ? 'Chargement...' : `Charger + (${poiSamplesTotal - poiSamples.length} restants)`}
                  </button>
                </div>
              )}

              {!poiSamplesLoading && poiSamples.length === 0 && (
                <div style={{ padding: '16px', color: C.textDim, fontFamily: fontInter, fontSize: 12 }}>Aucun résultat.</div>
              )}
            </div>
          )}

          {/* ── Modal ajouter / éditer POI ──────────────────────────────────── */}
          {poiModal.open && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: 24, width: 520, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
                <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 700, color: teal, letterSpacing: 1, marginBottom: 20 }}>
                  {poiModal.mode === 'create' ? '+ Nouveau POI' : 'Éditer POI'}
                </div>

                {poiModalError && (
                  <div style={{ background: C.redDim, border: `0.5px solid ${C.red}44`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red, marginBottom: 14 }}>
                    {poiModalError}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {([
                    { field: 'nom',           label: 'Nom',          span: 2 },
                    { field: 'categorie',      label: 'Catégorie *',  span: 1 },
                    { field: 'sous_categorie', label: 'Sous-catégorie', span: 1 },
                    { field: 'lat',            label: 'Latitude *',   span: 1 },
                    { field: 'lng',            label: 'Longitude *',  span: 1 },
                    { field: 'adresse',        label: 'Adresse',      span: 2 },
                    { field: 'ville',          label: 'Ville',        span: 1 },
                    { field: 'departement',    label: 'Département',  span: 1 },
                    { field: 'code_postal',    label: 'Code postal',  span: 1 },
                    { field: 'source',         label: 'Source',       span: 1 },
                  ] as { field: keyof typeof emptyForm; label: string; span: number }[]).map(({ field, label, span }) => (
                    <div key={field} style={{ gridColumn: span === 2 ? '1 / -1' : 'auto' }}>
                      <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 4 }}>{label}</div>
                      <input
                        value={poiModal.data[field]}
                        onChange={(e) => setPoiModal((m) => ({ ...m, data: { ...m.data, [field]: e.target.value } }))}
                        style={{ width: '100%', background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '7px 10px', fontFamily: fontMono, fontSize: 11, color: C.text, outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.3s ease' }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)')}
                        onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                  <button
                    onClick={() => setPoiModal({ open: false, mode: 'create', data: emptyForm })}
                    style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: 'none', color: C.textDim, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '7px 16px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  >
                    Annuler
                  </button>
                  <button
                    onClick={savePoi}
                    disabled={poiModalSaving}
                    style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, background: teal, color: '#fff', border: 'none', borderRadius: 2, padding: '7px 20px', cursor: 'pointer', opacity: poiModalSaving ? 0.6 : 1, transition: 'all 0.2s ease' }}
                  >
                    {poiModalSaving ? 'Enregistrement...' : poiModal.mode === 'create' ? 'Créer' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
}
