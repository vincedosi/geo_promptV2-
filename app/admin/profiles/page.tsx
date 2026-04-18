'use client';

import { useState, useEffect } from 'react';

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:         'var(--bg-primary)',
  bgSurface:  '#0d0d14',
  bgCard:     '#0a0a12',
  border:     'var(--border-subtle)',
  accent:     'var(--brand-teal)',
  accentDim:  'var(--brand-teal-10)',
  text:       'var(--text-primary)',
  textDim:    'var(--text-secondary)',
  textSec:    'var(--text-tertiary)',
  green:      'var(--success)',
  red:        '#f87171',
};
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ScoringCriterion {
  id: string;
  label: string;
  poids: number;
  type: 'distance' | 'demo_carreaux';
  poi_categorie?: string;
  rayon_max?: number;
  decay_step?: number;
  champ?: string;
  paliers?: Array<{ percentile: number; score: number }>;
  enabled: boolean;
}

interface ScoringProfileData {
  total_max?: number;
  criteres: ScoringCriterion[];
  isochrone?: { enabled: boolean; bonus: Record<string, unknown> };
}

interface ScoringProfile {
  id: string;
  nom: string;
  description?: string;
  is_template: boolean;
  organization_id?: string;
  profil: ScoringProfileData;
  created_at: string;
  updated_at: string;
}

// ── ProfileEditor ──────────────────────────────────────────────────────────────
function ProfileEditor({
  profile,
  onChange,
}: {
  profile: ScoringProfile;
  onChange: (p: ScoringProfile) => void;
}) {
  const updateCrit = (idx: number, key: string, val: number | boolean | string) => {
    const newCriteres = [...profile.profil.criteres];
    newCriteres[idx] = { ...newCriteres[idx], [key]: val };
    onChange({ ...profile, profil: { ...profile.profil, criteres: newCriteres } });
  };

  const totalPoids = profile.profil.criteres.filter(c => c.enabled).reduce((s, c) => s + c.poids, 0);

  return (
    <div style={{ fontFamily: fontMono }}>
      {/* Nom */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 10, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
          Nom du profil
        </label>
        <input
          value={profile.nom}
          onChange={e => onChange({ ...profile, nom: e.target.value })}
          style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: '6px 10px', fontSize: 12, borderRadius: 2, fontFamily: fontMono, boxSizing: 'border-box' }}
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 10, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
          Description
        </label>
        <textarea
          value={profile.description ?? ''}
          onChange={e => onChange({ ...profile, description: e.target.value })}
          rows={2}
          style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, color: C.textDim, padding: '6px 10px', fontSize: 11, borderRadius: 2, fontFamily: fontMono, boxSizing: 'border-box', resize: 'none' }}
        />
      </div>

      {/* Total poids */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '4px 8px', background: totalPoids === 100 ? 'rgba(61,255,160,0.06)' : 'rgba(251,191,36,0.06)', border: `1px solid ${totalPoids === 100 ? C.green : '#fbbf24'}`, borderRadius: 2 }}>
        <span style={{ fontSize: 10, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.08em' }}>Total poids (actifs)</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: totalPoids === 100 ? C.green : '#fbbf24' }}>{totalPoids}/100</span>
      </div>

      {/* Critères */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Critères</div>
        {profile.profil.criteres.map((crit, idx) => (
          <div key={crit.id} style={{ background: C.bgCard, border: `1px solid ${crit.enabled ? C.border : 'var(--border-subtle)'}`, borderRadius: 2, padding: 12, marginBottom: 8, opacity: crit.enabled ? 1 : 0.5 }}>
            {/* Header critère */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <input
                type="checkbox" checked={crit.enabled}
                onChange={e => updateCrit(idx, 'enabled', e.target.checked)}
                style={{ accentColor: C.accent, cursor: 'pointer', width: 14, height: 14 }}
              />
              <div style={{ flex: 1 }}>
                <input
                  value={crit.label}
                  onChange={e => updateCrit(idx, 'label', e.target.value)}
                  style={{ background: 'transparent', border: 'none', color: crit.enabled ? C.text : C.textSec, fontSize: 12, fontWeight: 700, fontFamily: fontMono, width: '100%', padding: 0, outline: 'none' }}
                />
                <div style={{ fontSize: 9, color: C.textSec, marginTop: 2 }}>
                  {crit.type === 'distance' ? `POI: ${crit.poi_categorie ?? '—'}` : `Demo: ${crit.champ ?? '—'}`}
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.accent, minWidth: 40, textAlign: 'right' }}>{crit.poids}</div>
            </div>

            {/* Sliders */}
            {crit.enabled && (
              <div>
                {/* Poids */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 9, color: C.textSec, width: 72, flexShrink: 0 }}>Poids (pts)</span>
                  <input type="range" min={0} max={50} step={5} value={crit.poids}
                    onChange={e => updateCrit(idx, 'poids', Number(e.target.value))}
                    style={{ flex: 1, accentColor: C.accent, cursor: 'pointer' }} />
                  <span style={{ fontSize: 10, color: C.text, width: 28, textAlign: 'right' }}>{crit.poids}</span>
                </div>

                {crit.type === 'distance' && (
                  <>
                    {/* Rayon max */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 9, color: C.textSec, width: 72, flexShrink: 0 }}>Rayon (m)</span>
                      <input type="range" min={50} max={5000} step={50} value={crit.rayon_max ?? 300}
                        onChange={e => updateCrit(idx, 'rayon_max', Number(e.target.value))}
                        style={{ flex: 1, accentColor: C.accent, cursor: 'pointer' }} />
                      <span style={{ fontSize: 10, color: C.text, width: 40, textAlign: 'right' }}>{crit.rayon_max ?? 300}m</span>
                    </div>
                    {/* Decay step */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 9, color: C.textSec, width: 72, flexShrink: 0 }}>Décroiss.</span>
                      <input type="range" min={1} max={200} step={1} value={crit.decay_step ?? 10}
                        onChange={e => updateCrit(idx, 'decay_step', Number(e.target.value))}
                        style={{ flex: 1, accentColor: C.accent, cursor: 'pointer' }} />
                      <span style={{ fontSize: 10, color: C.text, width: 40, textAlign: 'right' }}>{crit.decay_step ?? 10}m/pt</span>
                    </div>
                  </>
                )}

                {crit.type === 'demo_carreaux' && crit.paliers && (
                  <div style={{ fontSize: 9, color: C.textSec, marginTop: 4 }}>
                    Paliers : {crit.paliers.map(p => `p${p.percentile}→${p.score}pts`).join(' · ')}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Isochrone toggle */}
      {profile.profil.isochrone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 2 }}>
          <input
            type="checkbox"
            checked={profile.profil.isochrone.enabled}
            onChange={e => onChange({
              ...profile,
              profil: { ...profile.profil, isochrone: { ...profile.profil.isochrone!, enabled: e.target.checked } }
            })}
            style={{ accentColor: C.accent, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 11, color: C.textDim }}>Activer les bonus isochrones (piéton)</span>
        </div>
      )}
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function AdminProfilesPage() {
  const [profiles,   setProfiles]   = useState<ScoringProfile[]>([]);
  const [selected,   setSelected]   = useState<ScoringProfile | null>(null);
  const [editDraft,  setEditDraft]  = useState<ScoringProfile | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [msg,        setMsg]        = useState('');
  const [isNew,      setIsNew]      = useState(false);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/scoring/profiles');
      const data = await res.json();
      setProfiles(data.profiles ?? []);
      if (!selected && data.profiles?.length > 0) {
        setSelected(data.profiles[0]);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { loadProfiles(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (p: ScoringProfile) => {
    setSelected(p);
    setEditDraft(JSON.parse(JSON.stringify(p)) as ScoringProfile);
    setIsNew(false);
    setMsg('');
  };

  const startNew = () => {
    if (!profiles[0]) return;
    // Clone premier template comme base
    const base = JSON.parse(JSON.stringify(profiles[0])) as ScoringProfile;
    const draft: ScoringProfile = {
      ...base,
      id:          '',
      nom:         'Nouveau profil',
      description: '',
      is_template: false,
      created_at:  '',
      updated_at:  '',
    };
    setEditDraft(draft);
    setSelected(null);
    setIsNew(true);
    setMsg('');
  };

  const cancelEdit = () => {
    setEditDraft(null);
    setIsNew(false);
    setMsg('');
  };

  const saveProfile = async () => {
    if (!editDraft) return;
    setSaving(true);
    setMsg('');
    try {
      const isCreate = isNew || !editDraft.id;
      const url  = isCreate ? '/api/scoring/profiles' : `/api/scoring/profiles/${editDraft.id}`;
      const method = isCreate ? 'POST' : 'PUT';

      const body = {
        nom:         editDraft.nom,
        description: editDraft.description,
        profil:      editDraft.profil,
        is_template: editDraft.is_template,
      };

      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Erreur serveur');

      setMsg(isCreate ? 'Profil créé.' : 'Profil mis à jour.');
      await loadProfiles();
      setEditDraft(null);
      setIsNew(false);
      if (data.profile) setSelected(data.profile as ScoringProfile);
    } catch (e: unknown) {
      setMsg(`Erreur : ${e instanceof Error ? e.message : 'inconnue'}`);
    } finally { setSaving(false); }
  };

  const deleteProfile = async (p: ScoringProfile) => {
    if (p.is_template) { setMsg('Impossible de supprimer un template.'); return; }
    if (!confirm(`Supprimer "${p.nom}" ?`)) return;
    try {
      await fetch(`/api/scoring/profiles/${p.id}`, { method: 'DELETE' });
      if (selected?.id === p.id) setSelected(null);
      await loadProfiles();
    } catch { /* ignore */ }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: fontInter }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: fontInter, fontSize: 18, fontWeight: 500, margin: 0 }}>
            Profils de Scoring OOH
          </h1>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={startNew}
          style={{ background: C.accentDim, border: `1px solid ${C.accent}`, color: 'var(--bg-primary)', padding: '8px 16px', borderRadius: 2, cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: fontInter }}>
          + Nouveau profil
        </button>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 65px)' }}>
        {/* ── Sidebar: liste des profils ──────────────────────────── */}
        <div style={{ width: 280, borderRight: `1px solid ${C.border}`, overflowY: 'auto', flexShrink: 0 }}>
          {loading && <div style={{ padding: 24, color: C.textSec, fontSize: 12, textAlign: 'center' }}>Chargement...</div>}

          {/* Templates */}
          {profiles.filter(p => p.is_template).length > 0 && (
            <div>
              <div style={{ padding: '10px 16px 6px', fontSize: 9, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.1em', borderBottom: `1px solid ${C.border}` }}>
                Templates
              </div>
              {profiles.filter(p => p.is_template).map(p => (
                <div key={p.id}
                  onClick={() => startEdit(p)}
                  style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: `1px solid #0d0d14`, background: selected?.id === p.id ? C.accentDim : 'transparent', borderLeft: selected?.id === p.id ? `2px solid ${C.accent}` : '2px solid transparent' }}
                  onMouseEnter={e => { if (selected?.id !== p.id) e.currentTarget.style.background = '#0d0d14'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = selected?.id === p.id ? C.accentDim : 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: C.accent, fontSize: 10, marginTop: 1 }}>★</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nom}</div>
                      {p.description && <div style={{ fontSize: 10, color: C.textSec, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                      <div style={{ fontSize: 9, color: C.textSec, marginTop: 4 }}>
                        {p.profil.criteres.filter(c => c.enabled).length} critères · {p.profil.criteres.filter(c => c.enabled).reduce((s, c) => s + c.poids, 0)}pts
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Profils custom */}
          {profiles.filter(p => !p.is_template).length > 0 && (
            <div>
              <div style={{ padding: '10px 16px 6px', fontSize: 9, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.1em', borderBottom: `1px solid ${C.border}` }}>
                Profils personnalisés
              </div>
              {profiles.filter(p => !p.is_template).map(p => (
                <div key={p.id}
                  onClick={() => startEdit(p)}
                  style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: `1px solid #0d0d14`, background: selected?.id === p.id ? C.accentDim : 'transparent', borderLeft: selected?.id === p.id ? `2px solid ${C.accent}` : '2px solid transparent' }}
                  onMouseEnter={e => { if (selected?.id !== p.id) e.currentTarget.style.background = '#0d0d14'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = selected?.id === p.id ? C.accentDim : 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: C.textSec, fontSize: 10, marginTop: 1 }}>◇</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nom}</div>
                      <div style={{ fontSize: 9, color: C.textSec, marginTop: 4 }}>
                        {p.profil.criteres.filter(c => c.enabled).length} critères · {p.profil.criteres.filter(c => c.enabled).reduce((s, c) => s + c.poids, 0)}pts
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteProfile(p); }}
                      style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                      title="Supprimer">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Zone édition ──────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {/* Message retour */}
          {msg && (
            <div style={{ padding: '8px 12px', background: msg.startsWith('Erreur') ? 'rgba(248,113,113,0.1)' : 'rgba(61,255,160,0.08)', border: `1px solid ${msg.startsWith('Erreur') ? C.red : C.green}`, borderRadius: 2, marginBottom: 16, fontSize: 12, color: msg.startsWith('Erreur') ? C.red : C.green, fontFamily: fontMono }}>
              {msg}
            </div>
          )}

          {!editDraft && !isNew && (
            <div style={{ textAlign: 'center', paddingTop: 80, color: C.textSec, fontSize: 13 }}>
              <div style={{ fontSize: 24, marginBottom: 12, color: '#1a1a2e' }}>★</div>
              Sélectionnez un profil dans la liste<br />ou créez-en un nouveau.
            </div>
          )}

          {editDraft && (
            <div style={{ maxWidth: 600 }}>
              {/* Titre */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div>
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                    {isNew ? 'Nouveau profil' : (editDraft.is_template ? '★ Template (copie)' : '◇ Profil personnalisé')}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{editDraft.nom}</div>
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={cancelEdit}
                  style={{ background: C.bgSurface, border: `1px solid ${C.border}`, color: C.textSec, padding: '6px 14px', borderRadius: 2, cursor: 'pointer', fontSize: 12, fontFamily: fontInter, fontWeight: 500 }}>
                  Annuler
                </button>
                <button onClick={saveProfile} disabled={saving}
                  style={{ background: C.accentDim, border: `1px solid ${C.accent}`, color: 'var(--bg-primary)', padding: '6px 14px', borderRadius: 2, cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: fontInter }}>
                  {saving ? 'Sauvegarde...' : isNew ? 'Créer' : 'Mettre à jour'}
                </button>
              </div>

              <ProfileEditor profile={editDraft} onChange={setEditDraft} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
