'use client';

/**
 * GEOMATIK — Modal de capture custom-geo.
 *
 * Au mount : resolve en parallele les getGeometry() de tous les layers enabled
 * (peut etre sync ou async, ex: appel RPC). Pendant ce resolve, affiche un loader.
 * Erreurs partielles non-bloquantes : les layers OK restent utilisables.
 *
 * Submit : POST /api/custom-geo/capture avec les geometries resolues.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useCustomGeoCaptureContext } from '@/lib/custom-geo/CustomGeoCaptureContext';
import { useSession } from '@/lib/auth-client';
import { adminFetch } from '@/lib/admin-fetch';
import type { CaptureTransformation, ContributedGeometry, ContributedLayer } from '@/types/custom-geo';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Props {
  onClose: () => void;
}

interface CollectedLayer {
  layer: ContributedLayer;
  geometries: GeoJSON.Geometry[];
  error?: string;
}

const TRANSFORMATION_OPTIONS: Array<{ value: CaptureTransformation; label: string; sub: string }> = [
  { value: 'union',       label: 'Union des layers',   sub: 'Forme naturelle dissoute (recommande)' },
  { value: 'convex_hull', label: 'Enveloppe convexe',  sub: 'Forme simplifiee englobante' },
  { value: 'envelope',    label: 'Rectangle englobant', sub: 'Bounding box' },
  { value: 'raw',         label: 'Geometrie brute',    sub: 'Sans transformation' },
];

function flattenGeometry(g: ContributedGeometry): GeoJSON.Geometry[] {
  if (!g) return [];
  return Array.isArray(g) ? g : [g];
}

function computeBbox(geometries: GeoJSON.Geometry[]): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (coord: unknown): void => {
    if (!Array.isArray(coord)) return;
    if (typeof coord[0] === 'number' && typeof coord[1] === 'number') {
      const [x, y] = coord as [number, number];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      return;
    }
    coord.forEach(walk);
  };
  geometries.forEach(g => {
    if ('coordinates' in g) walk(g.coordinates as unknown);
  });
  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

export function CustomGeoCaptureModal({ onClose }: Props) {
  const { getAllEnabledLayers } = useCustomGeoCaptureContext();
  const { session } = useSession();
  const orgId = (session as { org_id?: string } | null)?.org_id ?? '';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [transformation, setTransformation] = useState<CaptureTransformation>('union');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ countIris: number; countCp: number } | null>(null);

  // Resolve async des geometries au mount.
  const [resolving, setResolving] = useState(true);
  const [collected, setCollected] = useState<CollectedLayer[]>([]);
  const resolveLaunchedRef = useRef(false);

  useEffect(() => {
    if (resolveLaunchedRef.current) return;
    resolveLaunchedRef.current = true;
    const layers = getAllEnabledLayers();
    (async () => {
      const results = await Promise.all(
        layers.map(async (layer): Promise<CollectedLayer> => {
          try {
            const g = await Promise.resolve(layer.getGeometry());
            const flat = flattenGeometry(g);
            return { layer, geometries: flat };
          } catch (err: unknown) {
            return {
              layer,
              geometries: [],
              error: err instanceof Error ? err.message : 'Erreur inconnue',
            };
          }
        }),
      );
      setCollected(results);
      setResolving(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validCollected = useMemo(
    () => collected.filter(c => !c.error && c.geometries.length > 0),
    [collected],
  );
  const failedCollected = useMemo(
    () => collected.filter(c => c.error || c.geometries.length === 0),
    [collected],
  );

  const allGeometries = useMemo(
    () => validCollected.flatMap(c => c.geometries),
    [validCollected],
  );
  const bbox = useMemo(() => computeBbox(allGeometries), [allGeometries]);
  const totalVertices = useMemo(() => {
    let n = 0;
    const walk = (c: unknown): void => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === 'number') { n += 1; return; }
      c.forEach(walk);
    };
    allGeometries.forEach(g => { if ('coordinates' in g) walk(g.coordinates as unknown); });
    return n;
  }, [allGeometries]);

  const hasData = allGeometries.length > 0;
  const canSubmit = !!name.trim() && hasData && !!orgId && !saving && !success && !resolving;

  const sourceType = validCollected.length === 1 ? validCollected[0].layer.sourceType : 'composite';

  const handleSave = useCallback(async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const contributingLayers = validCollected.map(c => ({
        id: c.layer.id,
        source_type: c.layer.sourceType,
        label: c.layer.label,
        metadata: c.layer.metadata ?? {},
      }));
      const res = await adminFetch('/api/custom-geo/capture', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          org_id: orgId,
          source_type: sourceType,
          source_metadata: { contributing_layers: contributingLayers },
          geometries: allGeometries,
          transformation,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Erreur de sauvegarde');
        return;
      }
      setSuccess({ countIris: data.count_iris ?? 0, countCp: data.count_cp ?? 0 });
      setTimeout(() => onClose(), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur reseau');
    } finally {
      setSaving(false);
    }
  }, [canSubmit, name, description, orgId, sourceType, allGeometries, transformation, validCollected, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, saving]);

  return (
    <div
      onClick={() => !saving && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111111',
          border: '0.5px solid var(--border-subtle)',
          borderRadius: 10,
          width: '100%', maxWidth: 560, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          fontFamily: fInter, color: 'var(--text-primary)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 20px', borderBottom: '0.5px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Sauvegarder la vue comme zone custom</span>
          <button
            onClick={onClose}
            disabled={saving}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'flex' }}
          ><X size={16} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Resolve loader */}
          {resolving && (
            <div style={{
              padding: 16,
              background: 'var(--bg-level-2)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 4,
              display: 'flex', alignItems: 'center', gap: 10,
              fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)',
            }}>
              <Loader2 size={14} style={{ color: 'var(--brand-teal)', animation: 'spin 1s linear infinite' }} />
              Recuperation des geometries...
            </div>
          )}

          {/* Preview texte */}
          {!resolving && (
            <div style={{
              padding: 12,
              background: 'var(--bg-level-2)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 4,
              fontFamily: fMono, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8,
            }}>
              <div><span style={{ color: 'var(--text-tertiary)' }}>Layers</span> : {validCollected.length} · <span style={{ color: 'var(--text-tertiary)' }}>Vertices</span> : {totalVertices.toLocaleString('fr-FR')}</div>
              <div><span style={{ color: 'var(--text-tertiary)' }}>Transformation</span> : {transformation}</div>
              <div><span style={{ color: 'var(--text-tertiary)' }}>Bbox</span> : {bbox ? `${bbox[0].toFixed(3)}, ${bbox[1].toFixed(3)} → ${bbox[2].toFixed(3)}, ${bbox[3].toFixed(3)}` : '—'}</div>
            </div>
          )}

          {/* Erreurs partielles (layers echoues) */}
          {!resolving && failedCollected.length > 0 && (
            <div style={{
              padding: '8px 12px', borderRadius: 4,
              background: 'rgba(247,183,49,0.1)', border: '0.5px solid rgba(247,183,49,0.25)', color: 'var(--warning)',
              fontFamily: fInter, fontSize: 11, lineHeight: 1.5,
            }}>
              {failedCollected.length} layer{failedCollected.length > 1 ? 's' : ''} non capture{failedCollected.length > 1 ? 's' : ''} :
              <div style={{ marginTop: 4, fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
                {failedCollected.map(c => `${c.layer.label} (${c.error ?? 'pas de geometrie'})`).join(' · ')}
              </div>
            </div>
          )}

          {/* Selecteur transformation */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Transformation
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {TRANSFORMATION_OPTIONS.map(opt => {
                const selected = transformation === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTransformation(opt.value)}
                    disabled={saving}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 4,
                      background: selected ? 'var(--bg-level-2)' : 'transparent',
                      border: `0.5px solid ${selected ? 'var(--brand-teal-30)' : 'var(--border-subtle)'}`,
                      cursor: saving ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      border: `1.5px solid ${selected ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                      background: selected ? 'var(--brand-teal)' : 'transparent',
                      flexShrink: 0,
                    }} />
                    <div>
                      <div style={{ fontSize: 12, color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{opt.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{opt.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Liste layers */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Layers inclus ({validCollected.length})
            </div>
            {!resolving && validCollected.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: 8 }}>Aucun layer contributif exploitable.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {validCollected.map(c => (
                  <div key={c.layer.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 4,
                    background: 'var(--bg-level-2)',
                    fontSize: 12,
                  }}>
                    <span style={{ color: 'var(--text-primary)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.layer.label}
                    </span>
                    <span style={{
                      fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)',
                      padding: '1px 6px', borderRadius: 3,
                      background: 'var(--bg-surface)',
                      border: '0.5px solid var(--border-subtle)',
                    }}>
                      {c.layer.sourceType}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Name */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>
              Nom <span style={{ color: 'var(--brand-teal)' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={saving || !!success}
              placeholder="Ex : zone captee le 20/04"
              autoFocus
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 4,
                background: 'var(--bg-surface)',
                border: '0.5px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontFamily: fInter, fontSize: 13, outline: 'none',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
            />
          </div>

          {/* Description */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={saving || !!success}
              rows={2}
              placeholder="Notes (optionnel)"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 4, resize: 'vertical',
                background: 'var(--bg-surface)',
                border: '0.5px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontFamily: fInter, fontSize: 13, outline: 'none',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
            />
          </div>

          {/* Source (readonly) */}
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            source_type : <span style={{ fontFamily: fMono, color: 'var(--text-secondary)' }}>{sourceType}</span>
          </div>

          {/* Errors / success */}
          {error && (
            <div style={{
              padding: '8px 12px', borderRadius: 4, fontSize: 12,
              background: 'rgba(255,87,87,0.1)', border: '0.5px solid rgba(255,87,87,0.2)', color: 'var(--danger)',
            }}>{error}</div>
          )}
          {success && (
            <div style={{
              padding: '8px 12px', borderRadius: 4, fontSize: 12,
              background: 'rgba(61,255,160,0.1)', border: '0.5px solid rgba(61,255,160,0.2)', color: 'var(--success)',
            }}>
              Zone sauvegardee — {success.countIris} IRIS, {success.countCp} CP resolus
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: '0.5px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '8px 16px', borderRadius: 4, fontSize: 12, fontFamily: fInter,
              background: 'transparent',
              border: '0.5px solid var(--border-default)',
              color: 'var(--text-secondary)',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >Annuler</button>
          <button
            onClick={handleSave}
            disabled={!canSubmit}
            style={{
              padding: '8px 16px', borderRadius: 4, fontSize: 12, fontFamily: fInter, fontWeight: 500,
              background: canSubmit ? 'var(--brand-teal)' : 'rgba(78,205,196,0.3)',
              border: 'none',
              color: canSubmit ? '#050505' : 'var(--text-tertiary)',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'Sauvegarde...' : resolving ? 'Chargement...' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
}
