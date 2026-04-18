'use client';
import { useState, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';

interface Org { id: string; name: string }

interface Props {
  open: boolean;
  onClose: () => void;
  categorie: string;
  minutes: number;
  mode: string;
  zoneType?: string | null;
  nbZones: number;
  onSaved?: (setId: string) => void;
}

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', 'Fira Code', monospace";

export function SaveGeographyModal({
  open, onClose, categorie, minutes, mode, zoneType = null, nbZones, onSaved,
}: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setName(`Battle ${categorie} ${minutes}min ${mode}`);
    setDescription('');

    adminFetch('/api/user/organizations').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return;
      setIsSuperAdmin(!!d.is_super_admin);
      setOrgs(Array.isArray(d.organizations) ? d.organizations : []);
      setOrgId(d.active_org_id ?? '');
    }).catch(() => {});
  }, [open, categorie, minutes, mode]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Nom requis', 'Entrez un nom'); return; }
    setSaving(true);
    try {
      const res = await adminFetch('/api/geographies', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          organization_id: orgId || null,
          source_type: 'battle',
          zone_type: zoneType, // null → auto-detect serveur (v2 > full > v1)
          categorie,
          minutes,
          mode,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Erreur', body?.error || 'Echec sauvegarde');
        return;
      }
      toast.success('Geographie sauvegardee', `${body.nb_zones} zones`);
      onSaved?.(body.set_id);
      onClose();
    } catch (e: unknown) {
      toast.error('Erreur', e instanceof Error ? e.message : 'Erreur reseau');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-level-2)',
    border: '0.5px solid var(--border-subtle)',
    borderRadius: 6,
    padding: '9px 12px',
    fontFamily: fInter,
    fontSize: 13,
    color: 'var(--text-primary)',
    outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: fInter,
    fontSize: 11,
    color: 'var(--text-tertiary)',
    display: 'block',
    marginBottom: 5,
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
      }}
    >
      <div style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-subtle)',
        borderRadius: 10,
        padding: 24,
        width: 440,
        maxWidth: '92vw',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', display: 'inline-block' }} />
          <h2 style={{ fontFamily: fInter, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
            Sauvegarder comme geographie
          </h2>
        </div>
        <p style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 18px 14px' }}>
          Reutiliser ces zones dans le module Digital
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Nom *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 52 }}
              placeholder="Optionnel"
            />
          </div>

          <div>
            <label style={labelStyle}>Organisation</label>
            {isSuperAdmin ? (
              <select
                value={orgId}
                onChange={e => setOrgId(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">Globale (toutes orgs)</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) : (
              <input
                value={orgs.find(o => o.id === orgId)?.name ?? 'Aucune organisation'}
                disabled
                style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }}
              />
            )}
          </div>

          <div style={{
            background: 'var(--bg-level-2)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 6,
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--brand-teal)', fontWeight: 500 }}>{nbZones}</span> zones detectees
            </span>
            <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
              {categorie} · {minutes}min · {mode}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 22 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '9px 18px',
              fontFamily: fInter,
              fontSize: 13,
              cursor: saving ? 'not-allowed' : 'pointer',
              background: 'transparent',
              border: '0.5px solid var(--border-default)',
              borderRadius: 6,
              color: 'var(--text-secondary)',
            }}
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            style={{
              padding: '9px 18px',
              fontFamily: fInter,
              fontSize: 13,
              fontWeight: 500,
              cursor: saving ? 'wait' : 'pointer',
              background: 'transparent',
              border: '0.5px solid var(--brand-teal)',
              borderRadius: 6,
              color: 'var(--brand-teal)',
              opacity: saving || !name.trim() ? 0.5 : 1,
            }}
          >
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
}
