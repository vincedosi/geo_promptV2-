'use client';

/**
 * AgentAutoPilot — toggle activation auto-pilot + sliders bornes (le media
 * planner choisit ces seuils). Persiste via PUT /autonomy.
 */
import { useEffect, useState } from 'react';
import { Bot, Save } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Settings {
  autonomy_enabled: boolean;
  autonomy_level: number;
  autonomy_max_curve_delta_pct: number;
  autonomy_max_budget_delta_pct: number;
  autonomy_max_actions_per_day: number;
}

const DEFAULTS: Settings = {
  autonomy_enabled: false,
  autonomy_level: 2,
  autonomy_max_curve_delta_pct: 20,
  autonomy_max_budget_delta_pct: 30,
  autonomy_max_actions_per_day: 5,
};

interface Props {
  strategyId: string;
}

export function AgentAutoPilot({ strategyId }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/bidding/strategies/${strategyId}/autonomy`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setSettings({ ...DEFAULTS, ...data });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [strategyId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/autonomy`, {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setInfo('Réglages sauvegardés.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 12, fontSize: 11, fontFamily: fMono, color: 'var(--text-tertiary)' }}>Chargement…</div>;
  }

  return (
    <div style={{ padding: 12, fontFamily: fInter, color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Bot size={12} strokeWidth={1.8} color="var(--brand-teal)" />
        <span style={{ fontSize: 11, fontWeight: 500 }}>Auto-pilot</span>
        <span style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
          (cron Inngest 06h00 quotidien)
        </span>
      </div>

      <div style={{
        padding: '10px 12px',
        background: 'var(--bg-level-2)',
        border: `0.5px solid ${settings.autonomy_enabled ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
        borderLeft: `2px solid ${settings.autonomy_enabled ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
        borderRadius: 6,
        marginBottom: 12,
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.autonomy_enabled}
            onChange={(e) => setSettings(s => ({ ...s, autonomy_enabled: e.target.checked }))}
            style={{ accentColor: 'var(--brand-teal)' }}
          />
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
              {settings.autonomy_enabled ? 'Auto-pilot activé' : 'Auto-pilot désactivé'}
            </div>
            <div style={{ fontSize: 10, fontFamily: fMono, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {settings.autonomy_enabled
                ? "L'agent applique automatiquement les recommandations dans les bornes définies."
                : "L'agent propose uniquement, aucune action n'est appliquée sans validation."}
            </div>
          </div>
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Slider
          label="Variation max courbe / jour"
          value={settings.autonomy_max_curve_delta_pct}
          unit="%"
          min={0} max={100} step={5}
          onChange={(v) => setSettings(s => ({ ...s, autonomy_max_curve_delta_pct: v }))}
          help="Limite l'écart relatif que l'agent peut appliquer sur les multiplicateurs de la courbe."
        />
        <Slider
          label="Variation max budget / zone"
          value={settings.autonomy_max_budget_delta_pct}
          unit="%"
          min={0} max={100} step={5}
          onChange={(v) => setSettings(s => ({ ...s, autonomy_max_budget_delta_pct: v }))}
          help="Limite l'écart de budget alloué par zone par rapport à la baseline."
        />
        <Slider
          label="Actions max par jour"
          value={settings.autonomy_max_actions_per_day}
          unit=""
          min={0} max={20} step={1}
          onChange={(v) => setSettings(s => ({ ...s, autonomy_max_actions_per_day: v }))}
          help="Au-delà, l'auto-pilot freeze automatiquement et envoie une notification."
        />
        <Slider
          label="Niveau d'autonomie (0-4)"
          value={settings.autonomy_level}
          unit=""
          min={0} max={4} step={1}
          onChange={(v) => setSettings(s => ({ ...s, autonomy_level: v }))}
          help="0 = monitor only, 4 = autonomie totale dans les bornes."
        />
      </div>

      {error && (
        <div style={{
          marginTop: 10, padding: '6px 10px',
          background: 'var(--bg-level-2)', border: '0.5px solid var(--danger)',
          borderRadius: 5, fontSize: 11, fontFamily: fMono, color: 'var(--danger)',
        }}>{error}</div>
      )}
      {info && (
        <div style={{
          marginTop: 10, padding: '6px 10px',
          background: 'var(--bg-level-2)', border: '0.5px solid var(--brand-teal)',
          borderRadius: 5, fontSize: 11, fontFamily: fMono, color: 'var(--brand-teal)',
        }}>{info}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          type="button"
          onClick={() => { void save(); }}
          disabled={saving}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '6px 14px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
            background: saving ? 'var(--bg-level-2)' : 'var(--brand-teal)',
            color: saving ? 'var(--text-tertiary)' : 'var(--bg-level-0)',
            border: '0.5px solid var(--brand-teal)',
            borderRadius: 5, cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          <Save size={11} /> {saving ? 'Sauvegarde…' : 'Sauvegarder'}
        </button>
      </div>
    </div>
  );
}

function Slider({
  label, value, unit, min, max, step, onChange, help,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  help?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontFamily: fInter, color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontFamily: fMono, color: 'var(--brand-teal)', fontWeight: 600 }}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--brand-teal)' }}
      />
      {help && (
        <div style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.4 }}>
          {help}
        </div>
      )}
    </div>
  );
}
