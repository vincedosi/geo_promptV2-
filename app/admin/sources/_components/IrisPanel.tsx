/**
 * MAGELIAN — panneau « IRIS » du back-office Data Sources.
 *
 * Stats du referentiel IRIS, millesime, regeneration des PMTiles, zone de
 * suppression et rapport de synchronisation schema DB <-> code.
 *
 * Tout l'etat vient du hook useIrisAdmin, appele par le PARENT (voir la note
 * d'I/O dans ce hook) et transmis ici en une seule prop.
 *
 * Extrait de app/admin/sources/page.tsx (refactor du 31/08/2026).
 */
import type { IrisAdmin } from '../_hooks/useIrisAdmin';
import { C, fontMono, fontInter } from '../_lib/theme';
import { Spinner } from './ui';

interface IrisPanelProps {
  iris: IrisAdmin;
}

export function IrisPanel({ iris }: IrisPanelProps) {
  // Destructure a plat : le corps du panneau garde les memes noms de
  // variables que dans page.tsx avant extraction, aucune reference reecrite.
  const {
    irisStats, irisDepts, irisSource, irisLoading,
    irisAnnee, setIrisAnnee, irisAnneeSaving, irisAnneeSaved, saveIrisAnnee,
    irisPmtilesLoading, irisPmtilesMsg, triggerIrisPmtiles,
    irisDeleteConfirm, setIrisDeleteConfirm, irisDeleteLoading, irisDeleteMsg, deleteAllIris,
    irisSyncReport, irisSyncLoading, irisSyncError, runIrisSync,
  } = iris;

      const cyan = '#06b6d4';
      const cyanDim = 'rgba(6,182,212,0.10)';
      const cyanBorder = 'rgba(6,182,212,0.25)';
      return (
        <div>
          {irisLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '40px 0', color: C.textDim, fontFamily: fontMono, fontSize: 12 }}>
              <Spinner size={18} /> Chargement des statistiques IRIS...
            </div>
          )}
          {!irisLoading && irisStats && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'srcFadeIn 0.3s ease-out' }}>

              {/* Source info banner */}
              <div style={{ background: cyanDim, border: `0.5px solid ${cyanBorder}`, borderRadius: 2, padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: fontInter, fontSize: 13, fontWeight: 700, color: cyan, letterSpacing: 1, marginBottom: 4 }}>
                    {irisSource?.name ?? 'CONTOURS-IRIS-PE — IGN 2025'}
                  </div>
                  <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 1.8 }}>
                    <span style={{ color: C.textSec }}>Fournisseur: </span>{irisSource?.provider}<br />
                    <span style={{ color: C.textSec }}>Licence: </span>{irisSource?.license}<br />
                    <span style={{ color: C.textSec }}>Format: </span>{irisSource?.format}<br />
                    <span style={{ color: C.textSec }}>Couverture: </span>{irisSource?.coverage}<br />
                    <span style={{ color: C.textSec }}>Importé le: </span>
                    <span style={{ color: C.green }}>{irisSource?.imported_at}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: fontMono, fontSize: 36, fontWeight: 700, color: cyan, lineHeight: 1, animation: 'srcCountUp 0.5s ease-out' }}>
                    {irisStats.total.toLocaleString('fr-FR')}
                  </div>
                  <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginTop: 4 }}>
                    zones IRIS
                  </div>
                </div>
              </div>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { label: 'Départements',  value: irisStats.nb_depts.toLocaleString('fr-FR'),    color: cyan },
                  { label: 'Communes',      value: irisStats.nb_communes.toLocaleString('fr-FR'), color: C.accent },
                  { label: 'Avec géométrie',value: irisStats.with_geom.toLocaleString('fr-FR'),   color: C.green },
                  { label: 'Taille table',  value: irisStats.table_size,                          color: C.warn },
                ].map(({ label, value, color }, idx) => (
                  <div key={label} style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '12px 14px', transition: 'all 0.2s ease', animation: `srcFadeIn 0.4s ease-out ${0.05 * idx}s both` }}>
                    <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>{label}</div>
                    <div style={{ fontFamily: fontMono, fontSize: 20, fontWeight: 700, color, animation: 'srcCountUp 0.5s ease-out' }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                {/* Types IRIS */}
                <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                  <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: cyan, marginBottom: 12, background: C.bgSurface, margin: '-14px -16px 12px -16px', padding: '10px 16px', borderBottom: `1px solid ${C.border}`, borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
                    Répartition par type
                  </div>
                  {[
                    { code: 'Z', label: 'Zone d\'activité économique', value: irisStats.type_z, color: C.warn },
                    { code: 'H', label: 'Habitation',                  value: irisStats.type_h, color: C.accent },
                    { code: 'A', label: 'Activité',                    value: irisStats.type_a, color: C.green },
                    { code: 'D', label: 'Divers',                      value: irisStats.type_d, color: C.textDim },
                  ].map(({ code, label, value, color }) => {
                    const pct = Math.round((value / irisStats.total) * 100);
                    return (
                      <div key={code} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontFamily: fontInter, fontSize: 9, color: C.textDim, background: C.bgSurface, border: `0.5px solid ${C.border}`, padding: '1px 5px', borderRadius: 1 }}>{code}</span>
                            <span style={{ fontFamily: fontInter, fontSize: 11, color: C.textSec }}>{label}</span>
                          </div>
                          <span style={{ fontFamily: fontMono, fontSize: 11, color, fontWeight: 700 }}>{value.toLocaleString('fr-FR')} <span style={{ color: C.muted, fontSize: 9 }}>({pct}%)</span></span>
                        </div>
                        <div style={{ height: 4, background: C.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.3s ease', animation: 'srcBarGrow 0.6s ease-out' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Top départements */}
                <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                  <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: cyan, marginBottom: 12, background: C.bgSurface, margin: '-14px -16px 12px -16px', padding: '10px 16px', borderBottom: `1px solid ${C.border}`, borderLeft: '2px solid rgba(78,205,196,0.25)' }}>
                    Top 15 départements
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {irisDepts.map(({ code, nom, nb }, i) => {
                      const max = irisDepts[0]?.nb ?? 1;
                      const pct = Math.round((nb / max) * 100);
                      return (
                        <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: i < irisDepts.length - 1 ? `1px solid ${C.bgSurface}` : 'none' }}>
                          <span style={{ fontFamily: fontMono, fontSize: 9, color: C.muted, width: 20, textAlign: 'right', flexShrink: 0 }}>{code}</span>
                          <span style={{ fontFamily: fontInter, fontSize: 11, color: C.textSec, width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{nom}</span>
                          <div style={{ flex: 1, height: 3, background: C.bgSurface, borderRadius: 1 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: i === 0 ? cyan : `${cyan}66`, borderRadius: 1 }} />
                          </div>
                          <span style={{ fontFamily: fontMono, fontSize: 10, color: i === 0 ? cyan : C.textDim, fontWeight: i === 0 ? 700 : 400, width: 40, textAlign: 'right', flexShrink: 0 }}>{nb}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Schema */}
              <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '14px 16px' }}>
                <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: cyan, marginBottom: 10 }}>
                  Schéma de la table <span style={{ color: C.accent }}>public.iris</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { col: 'code_iris',     type: 'TEXT',        note: 'code unique à 9 chiffres' },
                    { col: 'nom_iris',      type: 'TEXT',        note: 'libellé IRIS' },
                    { col: 'code_commune',  type: 'TEXT',        note: 'code INSEE commune' },
                    { col: 'nom_commune',   type: 'TEXT',        note: 'nom commune' },
                    { col: 'code_dept',     type: 'TEXT',        note: 'code département (2 ou 3 car.)' },
                    { col: 'type_iris',     type: 'TEXT',        note: 'H / A / D / Z' },
                    { col: 'geom',          type: 'GEOMETRY',    note: 'MultiPolygon — EPSG:4326' },
                  ].map(({ col, type, note }) => (
                    <div key={col} style={{ background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: fontMono, fontSize: 11, color: C.text, fontWeight: 600 }}>{col}</span>
                      <span style={{ fontFamily: fontInter, fontSize: 9, color: type === 'GEOMETRY' ? C.green : C.accent, background: type === 'GEOMETRY' ? C.greenDim : C.accentDim, border: `0.5px solid ${type === 'GEOMETRY' ? `${C.green}44` : C.borderLight}`, padding: '1px 5px', borderRadius: 1, fontWeight: 500 }}>{type}</span>
                      <span style={{ fontFamily: fontInter, fontSize: 10, color: C.muted }}>{note}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontFamily: fontMono, fontSize: 10, color: C.muted }}>
                  Index: <span style={{ color: C.textDim }}>PRIMARY KEY (code_iris)</span> · <span style={{ color: C.green }}>GIST (geom)</span> · Taille index: {irisStats.index_size}
                </div>
              </div>

              {/* Usage note */}
              <div style={{ background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '12px 16px', fontFamily: fontMono, fontSize: 11, color: C.textDim, lineHeight: 1.8 }}>
                <span style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textSec, display: 'block', marginBottom: 6 }}>{'// utilisation'}</span>
                Utilisé pour les analyses de <span style={{ color: C.accent }}>bassins de population</span> Filosofi.<br />
                Jointure spatiale avec <span style={{ color: C.green }}>public.carreaux_filosofi</span> via <span style={{ color: cyan }}>ST_Intersects(iris.geom, carreaux.geom)</span>.<br />
                Requête type: <span style={{ color: C.text }}>SELECT code_iris, SUM(ind) FROM iris JOIN carreaux_filosofi ON ST_Intersects(...)</span>
              </div>

              {/* ── Année du millésime ── */}
              <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '16px 18px' }}>
                <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: '#06b6d4', marginBottom: 10 }}>
                  Millésime / Année
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="number"
                    min={2000}
                    max={2099}
                    value={irisAnnee}
                    onChange={e => setIrisAnnee(e.target.value)}
                    style={{
                      width: 90, padding: '6px 10px', borderRadius: 2,
                      background: C.bgSurface, border: `0.5px solid ${C.border}`,
                      color: C.text, fontFamily: fontMono, fontSize: 14,
                      outline: 'none', transition: 'border-color 0.3s ease',
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                  />
                  <button
                    onClick={() => saveIrisAnnee(irisAnnee)}
                    disabled={irisAnneeSaving}
                    style={{
                      padding: '6px 14px', borderRadius: 2,
                      background: C.accentDim, border: `0.5px solid ${C.borderLight}`,
                      color: C.accent, fontFamily: fontInter, fontSize: 9,
                      cursor: 'pointer',
                    }}
                  >
                    {irisAnneeSaving ? 'Enregistrement…' : irisAnneeSaved ? '✓ Sauvegardé' : 'Sauvegarder'}
                  </button>
                  <span style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
                    Millésime CONTOURS-IRIS (ex: 2025 = édition IGN 2025)
                  </span>
                </div>
              </div>

              {/* ── Régénérer PMTiles ── */}
              <div style={{ background: C.bgElevated, border: `0.5px solid ${cyanBorder}`, borderRadius: 2, padding: '16px 18px' }}>
                <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: cyan, marginBottom: 8 }}>
                  Carte choroplèthe — PMTiles
                </div>
                <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, marginBottom: 12, lineHeight: 1.7 }}>
                  Déclenche le workflow GitHub Actions <span style={{ color: C.text }}>generate-iris-pmtiles</span> : export NDJSON → tippecanoe → upload GitHub Releases.<br />
                  À faire après chaque import de nouvelles données démographiques (diplômes, revenus, CSP…).
                </div>
                {irisPmtilesMsg && (
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: irisPmtilesMsg.startsWith('✓') ? C.green : C.red, marginBottom: 10, lineHeight: 1.6, wordBreak: 'break-all' }}>
                    {irisPmtilesMsg}
                  </div>
                )}
                <button
                  onClick={triggerIrisPmtiles}
                  disabled={irisPmtilesLoading}
                  style={{
                    padding: '7px 18px', borderRadius: 2,
                    background: cyanDim, border: `0.5px solid ${cyanBorder}`,
                    color: cyan, fontFamily: fontInter, fontSize: 9,
                    cursor: irisPmtilesLoading ? 'not-allowed' : 'pointer',
                    opacity: irisPmtilesLoading ? 0.6 : 1,
                  }}
                >
                  {irisPmtilesLoading ? 'Déclenchement…' : 'Régénérer PMTiles IRIS'}
                </button>
              </div>

              {/* ── Zone danger : supprimer les IRIS ── */}
              <div style={{ background: C.redDim, border: `0.5px solid ${C.red}44`, borderRadius: 2, padding: '16px 18px' }}>
                <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.red, marginBottom: 8 }}>
                  Zone Danger — Suppression
                </div>
                <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, marginBottom: 12 }}>
                  Supprime toutes les zones IRIS de la base (TRUNCATE). À utiliser avant un ré-import avec un nouveau millésime.
                </div>
                {irisDeleteMsg && (
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: irisDeleteMsg.startsWith('✓') ? C.green : C.red, marginBottom: 10 }}>
                    {irisDeleteMsg}
                  </div>
                )}
                {!irisDeleteConfirm ? (
                  <button
                    onClick={() => setIrisDeleteConfirm(true)}
                    style={{
                      padding: '7px 16px', borderRadius: 2,
                      background: 'transparent', border: `0.5px solid ${C.red}66`,
                      color: C.red, fontFamily: fontInter, fontSize: 9,
                      cursor: 'pointer',
                    }}
                  >
                    Supprimer tous les IRIS
                  </button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: C.warn }}>
                      ! Confirmer la suppression de {irisStats?.total.toLocaleString('fr-FR')} IRIS ?
                    </span>
                    <button
                      onClick={deleteAllIris}
                      disabled={irisDeleteLoading}
                      style={{
                        padding: '6px 14px', borderRadius: 2,
                        background: `${C.red}22`, border: `0.5px solid ${C.red}`,
                        color: C.red, fontFamily: fontInter, fontSize: 9,
                        cursor: 'pointer',
                      }}
                    >
                      {irisDeleteLoading ? 'Suppression…' : 'Oui, supprimer'}
                    </button>
                    <button
                      onClick={() => setIrisDeleteConfirm(false)}
                      style={{
                        padding: '6px 14px', borderRadius: 2,
                        background: 'transparent', border: `0.5px solid ${C.border}`,
                        color: C.textDim, fontFamily: fontInter, fontSize: 9,
                        cursor: 'pointer',
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </div>

              {/* ── Synchronisation IRIS ── */}
              <div style={{ background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: cyan, marginBottom: 3 }}>
                      Synchronisation IRIS
                    </div>
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
                      Vérifie que les colonnes en base sont alignées avec{' '}
                      <span style={{ color: C.accent }}>IRIS_DB_COLUMNS</span> (db-columns.ts)
                    </div>
                  </div>
                  <button
                    onClick={runIrisSync}
                    disabled={irisSyncLoading}
                    style={{
                      flexShrink: 0, padding: '6px 16px', borderRadius: 2,
                      background: irisSyncLoading ? C.accentDim : C.accentDim,
                      border: `0.5px solid ${C.borderLight}`,
                      color: C.accent, fontFamily: fontInter, fontSize: 9,
                      cursor: irisSyncLoading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {irisSyncLoading ? <><Spinner size={10} /> Vérification…</> : 'Vérifier'}
                  </button>
                </div>

                {irisSyncError && (
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: C.red, padding: '6px 8px', background: C.redDim, borderRadius: 2, marginBottom: 10 }}>
                    ! {irisSyncError}
                  </div>
                )}

                {irisSyncReport && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                    {/* Status banner */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', borderRadius: 2,
                      background: irisSyncReport.synced ? 'rgba(61,255,160,0.06)' : C.warnDim,
                      border: `0.5px solid ${irisSyncReport.synced ? `${C.green}44` : `${C.warn}44`}`,
                    }}>
                      <span style={{ fontFamily: fontMono, fontSize: 16, color: irisSyncReport.synced ? C.green : C.warn }}>
                        {irisSyncReport.synced ? '✓' : '!'}
                      </span>
                      <div>
                        <div style={{ fontFamily: fontInter, fontSize: 9, color: irisSyncReport.synced ? C.green : C.warn }}>
                          {irisSyncReport.synced ? 'Synchronisé' : 'Désynchronisation détectée'}
                        </div>
                        <div style={{ fontFamily: fontMono, fontSize: 9, color: C.textDim, marginTop: 2 }}>
                          {irisSyncReport.db_columns.length} colonnes en base ·{' '}
                          {irisSyncReport.code_columns.length} dans IRIS_DB_COLUMNS
                        </div>
                      </div>
                    </div>

                    {/* Actions manuelles */}
                    {irisSyncReport.manual_actions_needed.length > 0 && (
                      <div style={{ background: C.warnDim, border: `0.5px solid ${C.warn}44`, borderRadius: 2, padding: '10px 12px' }}>
                        <div style={{ fontFamily: fontInter, fontSize: 9, color: C.warn, marginBottom: 6 }}>
                          Actions requises
                        </div>
                        {irisSyncReport.manual_actions_needed.map((action, i) => (
                          <div key={i} style={{ fontFamily: fontMono, fontSize: 10, color: C.text, marginBottom: 3 }}>
                            › {action}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* RPC status */}
                    <div style={{ background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '8px 12px' }}>
                      <div style={{ fontFamily: fontInter, fontSize: 9, color: C.textDim, marginBottom: 6 }}>
                        Statut RPCs
                      </div>
                      {Object.entries(irisSyncReport.rpc_status).map(([rpc, status]) => (
                        <div key={rpc} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fontMono, fontSize: 9, marginBottom: 3 }}>
                          <span style={{ color: C.accent }}>{rpc}</span>
                          <span style={{ color: C.green }}>{status}</span>
                        </div>
                      ))}
                    </div>

                    {/* Fill status table */}
                    <div style={{ background: C.bgSurface, border: `0.5px solid ${C.border}`, borderRadius: 2, padding: '8px 12px' }}>
                      <div style={{ fontFamily: fontInter, fontSize: 9, color: C.textDim, marginBottom: 8 }}>
                        Remplissage par colonne
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                        {Object.entries(irisSyncReport.fill_status)
                          .sort((a, b) => b[1] - a[1])
                          .map(([col, count]) => {
                            const total = irisSyncReport.fill_status['population'] || 1;
                            const pct   = Math.round((count / total) * 100);
                            const color = pct >= 80 ? C.green : pct >= 30 ? C.warn : C.red;
                            const inCode = irisSyncReport.code_columns.includes(col);
                            return (
                              <div key={col} style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '4px 6px',
                                background: C.bgElevated,
                                border: `0.5px solid ${inCode ? C.border : `${C.warn}44`}`,
                                borderRadius: 2,
                              }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontFamily: fontMono, fontSize: 9, color: inCode ? C.text : C.warn, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {col}
                                  </div>
                                  <div style={{ height: 2, background: C.border, borderRadius: 1, marginTop: 3 }}>
                                    <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 1 }} />
                                  </div>
                                </div>
                                <span style={{ fontFamily: fontMono, fontSize: 9, color, flexShrink: 0 }}>
                                  {count.toLocaleString('fr')}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </div>

                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      );
}
