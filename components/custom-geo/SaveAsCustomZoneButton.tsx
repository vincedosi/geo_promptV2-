'use client';

import { useState, useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

export interface SaveAsCustomZoneButtonProps {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  sourceType: string;
  metadata?: Record<string, unknown>;
  defaultName?: string;
  defaultDescription?: string;
  orgId: string;
  onSaved?: (result: { zoneId: string; countIris: number; countCp: number }) => void;
  className?: string;
  label?: string;
  disabled?: boolean;
}

const fInter = "'Inter', system-ui, sans-serif";

export function SaveAsCustomZoneButton({
  geometry,
  sourceType,
  metadata = {},
  defaultName = '',
  defaultDescription = '',
  orgId,
  onSaved,
  label = 'Sauvegarder comme zone',
  disabled = false,
}: SaveAsCustomZoneButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ countIris: number; countCp: number } | null>(null);

  const handleOpen = useCallback(() => {
    setName(defaultName);
    setDescription(defaultDescription);
    setError(null);
    setSuccess(null);
    setOpen(true);
  }, [defaultName, defaultDescription]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setError('Le nom est obligatoire'); return; }
    if (!geometry?.coordinates?.length) { setError('Geometrie invalide'); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch('/api/custom-geo/save', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          source_type: sourceType,
          source_metadata: metadata,
          geometry,
          org_id: orgId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Erreur de sauvegarde');
        return;
      }

      setSuccess({ countIris: data.count_iris ?? 0, countCp: data.count_cp ?? 0 });
      onSaved?.({ zoneId: data.zone_id, countIris: data.count_iris ?? 0, countCp: data.count_cp ?? 0 });

      setTimeout(() => setOpen(false), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur reseau');
    } finally {
      setSaving(false);
    }
  }, [name, description, geometry, sourceType, metadata, orgId, onSaved]);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        style={{
          fontFamily: fInter, fontSize: 12, fontWeight: 500,
          padding: '8px 16px', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
          background: 'transparent', border: '0.5px solid var(--brand-teal)',
          color: 'var(--brand-teal)', opacity: disabled ? 0.5 : 1,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        {label}
      </button>

      {open && (
        <div
          onClick={() => !saving && setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-level-2)', border: '0.5px solid var(--border-default)',
              borderRadius: 10, width: '100%', maxWidth: 480,
              fontFamily: fInter, color: 'var(--text-primary)',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '14px 20px', borderBottom: '0.5px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>Sauvegarder la zone</span>
              <button
                onClick={() => setOpen(false)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 18 }}
              >x</button>
            </div>

            {/* Body */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>Nom de la zone</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ex: Zone couverture NRJ Paris"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)',
                    color: 'var(--text-primary)', fontFamily: fInter, fontSize: 13, outline: 'none',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                  autoFocus
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>Description (optionnel)</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Notes sur cette zone..."
                  rows={3}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6, resize: 'vertical',
                    background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)',
                    color: 'var(--text-primary)', fontFamily: fInter, fontSize: 13, outline: 'none',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                />
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                Source : <span style={{ color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>{sourceType}</span>
              </div>

              {error && (
                <div style={{
                  padding: '8px 12px', borderRadius: 6, fontSize: 12,
                  background: 'rgba(255,87,87,0.1)', border: '0.5px solid rgba(255,87,87,0.2)', color: '#ff5757',
                }}>
                  {error}
                </div>
              )}

              {success && (
                <div style={{
                  padding: '8px 12px', borderRadius: 6, fontSize: 12,
                  background: 'rgba(61,255,160,0.1)', border: '0.5px solid rgba(61,255,160,0.2)', color: '#3dffa0',
                }}>
                  Zone sauvegardee — {success.countIris} IRIS, {success.countCp} CP resolus
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '14px 20px', borderTop: '0.5px solid var(--border-subtle)',
              display: 'flex', justifyContent: 'flex-end', gap: 8,
            }}>
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                style={{
                  padding: '8px 16px', borderRadius: 6, fontSize: 12, fontFamily: fInter,
                  background: 'transparent', border: '0.5px solid var(--border-default)',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !name.trim() || !!success}
                style={{
                  padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 500, fontFamily: fInter,
                  background: saving ? 'rgba(78,205,196,0.1)' : 'var(--brand-teal)',
                  border: 'none', color: saving ? 'var(--brand-teal)' : '#050505',
                  cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
                  opacity: !name.trim() ? 0.5 : 1,
                }}
              >
                {saving ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
