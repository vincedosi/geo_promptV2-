'use client';

/**
 * GEOMATIK — MeteoGeoPanel
 * Panneau flottant de configuration des zones météo Open-Meteo.
 * Apparaît en overlay quand l'utilisateur sélectionne "Zones Météo" dans le
 * sélecteur de Zones personnalisées. Déclenche le fetch via onApply.
 */
import { useState, useMemo, useEffect, type CSSProperties } from 'react';
import type { MeteoParams, MeteoVariable, MeteoMode, MeteoStats } from '@/lib/meteo/types';
import type { MeteoProgress } from '../_lib/use-digital-data';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

const COLORS = {
  bg: 'var(--bg-surface)',
  bgElevated: 'var(--bg-level-2)',
  border: 'var(--border-subtle)',
  borderHover: 'var(--border-default)',
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textTertiary: 'var(--text-tertiary)',
  accent: 'var(--brand-teal)',
  danger: '#ff5757',
};

const VARIABLES: { id: MeteoVariable; label: string; icon: string }[] = [
  { id: 'precipitation', label: 'Précipitations', icon: '☁' },
  { id: 'temperature_2m', label: 'Température', icon: '🌡' },
  { id: 'windspeed_10m', label: 'Vent', icon: '💨' },
  { id: 'sunshine_duration', label: 'Ensoleillement', icon: '☀' },
];

const MAX_FORECAST_DAYS = 16;
const MAX_HISTORY_DAYS = 90;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

interface Preset {
  label: string;
  computeStart: () => string;
  computeEnd: () => string;
}

const FORECAST_PRESETS: Preset[] = [
  { label: "Aujourd'hui", computeStart: todayStr, computeEnd: todayStr },
  { label: '3 jours', computeStart: todayStr, computeEnd: () => addDays(todayStr(), 3) },
  { label: '7 jours', computeStart: todayStr, computeEnd: () => addDays(todayStr(), 7) },
  { label: '14 jours', computeStart: todayStr, computeEnd: () => addDays(todayStr(), 14) },
];

const HISTORY_PRESETS: Preset[] = [
  { label: 'Hier', computeStart: () => addDays(todayStr(), -1), computeEnd: () => addDays(todayStr(), -1) },
  { label: '7 derniers jours', computeStart: () => addDays(todayStr(), -7), computeEnd: () => addDays(todayStr(), -1) },
  { label: '30 derniers jours', computeStart: () => addDays(todayStr(), -30), computeEnd: () => addDays(todayStr(), -1) },
  { label: '90 derniers jours', computeStart: () => addDays(todayStr(), -90), computeEnd: () => addDays(todayStr(), -1) },
];

export interface MeteoGeoPanelProps {
  onApply: (params: MeteoParams) => void;
  onClose?: () => void;
  initialParams?: MeteoParams | null;
  loading?: boolean;
  progress?: MeteoProgress | null;
  error?: string | null;
  stats?: MeteoStats | null;
}

// Inject spin keyframes once (used by progress spinner + button loading state)
if (typeof document !== 'undefined' && !document.head.querySelector('[data-meteo-style]')) {
  const el = document.createElement('style');
  el.setAttribute('data-meteo-style', '');
  el.textContent = '@keyframes meteo-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(el);
}

export function MeteoGeoPanel({ onApply, onClose, initialParams, loading, progress, error, stats }: MeteoGeoPanelProps) {
  const [variable, setVariable] = useState<MeteoVariable>(initialParams?.variable ?? 'precipitation');
  const [mode, setMode] = useState<MeteoMode>(() => {
    if (!initialParams) return 'forecast';
    return initialParams.endDate >= todayStr() ? 'forecast' : 'history';
  });
  const [startDate, setStartDate] = useState<string>(initialParams?.startDate ?? todayStr());
  const [endDate, setEndDate] = useState<string>(initialParams?.endDate ?? addDays(todayStr(), 7));

  // Si initialParams change (ex: re-selection meteo apres un autre jeu), resync
  useEffect(() => {
    if (!initialParams) return;
    setVariable(initialParams.variable);
    setStartDate(initialParams.startDate);
    setEndDate(initialParams.endDate);
    setMode(initialParams.endDate >= todayStr() ? 'forecast' : 'history');
  }, [initialParams]);

  const validation = useMemo(() => {
    if (startDate > endDate) return 'Date de début postérieure à la date de fin';
    const today = todayStr();
    if (mode === 'forecast') {
      if (endDate < today) return "En mode prévisions, la date de fin doit être aujourd'hui ou plus tard";
      if (daysBetween(today, endDate) > MAX_FORECAST_DAYS) return `Prévisions limitées à ${MAX_FORECAST_DAYS} jours`;
    } else {
      if (endDate >= today) return "En mode historique, la date de fin doit être avant aujourd'hui";
      if (daysBetween(startDate, endDate) > MAX_HISTORY_DAYS) return `Historique limité à ${MAX_HISTORY_DAYS} jours`;
    }
    return null;
  }, [mode, startDate, endDate]);

  const applyPreset = (preset: Preset) => {
    setStartDate(preset.computeStart());
    setEndDate(preset.computeEnd());
  };

  const applyModeChange = (newMode: MeteoMode) => {
    setMode(newMode);
    if (newMode === 'forecast') {
      setStartDate(todayStr());
      setEndDate(addDays(todayStr(), 7));
    } else {
      setStartDate(addDays(todayStr(), -7));
      setEndDate(addDays(todayStr(), -1));
    }
  };

  const handleApply = () => {
    if (validation || loading) return;
    onApply({ variable, startDate, endDate });
  };

  const sectionStyle: CSSProperties = {
    padding: '12px 14px',
    borderTop: `1px solid ${COLORS.border}`,
  };

  const labelStyle: CSSProperties = {
    fontFamily: fInter,
    fontSize: 10,
    fontWeight: 500,
    color: COLORS.textTertiary,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    marginBottom: 8,
    display: 'block',
  };

  const pillButton = (active: boolean): CSSProperties => ({
    padding: '6px 10px',
    borderRadius: 6,
    border: `0.5px solid ${active ? COLORS.accent : COLORS.border}`,
    background: active ? 'rgba(78,205,196,0.1)' : 'transparent',
    color: active ? COLORS.accent : COLORS.textSecondary,
    fontFamily: fInter,
    fontSize: 11,
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  const inputStyle: CSSProperties = {
    background: COLORS.bgElevated,
    border: `0.5px solid ${COLORS.border}`,
    borderRadius: 6,
    padding: '7px 10px',
    color: COLORS.textPrimary,
    fontFamily: fMono,
    fontSize: 11,
    outline: 'none',
    flex: 1,
    colorScheme: 'dark',
  };

  return (
    <div
      style={{
        background: COLORS.bg,
        border: `0.5px solid ${COLORS.border}`,
        borderRadius: 10,
        overflow: 'hidden',
        width: 320,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.bgElevated,
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.accent }} />
        <div style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: COLORS.textPrimary, flex: 1 }}>
          Zones météo
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: COLORS.textTertiary,
              cursor: 'pointer',
              fontSize: 14,
              padding: 0,
              lineHeight: 1,
            }}
            aria-label="Fermer"
          >
            ×
          </button>
        )}
      </div>

      {/* Variable */}
      <div style={sectionStyle}>
        <span style={labelStyle}>Variable</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {VARIABLES.map((v) => (
            <button
              key={v.id}
              type="button"
              style={pillButton(variable === v.id)}
              onClick={() => setVariable(v.id)}
            >
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mode + presets */}
      <div style={sectionStyle}>
        <span style={labelStyle}>Période</span>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button type="button" style={{ ...pillButton(mode === 'forecast'), flex: 1 }} onClick={() => applyModeChange('forecast')}>
            Prévisions
          </button>
          <button type="button" style={{ ...pillButton(mode === 'history'), flex: 1 }} onClick={() => applyModeChange('history')}>
            Historique
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(mode === 'forecast' ? FORECAST_PRESETS : HISTORY_PRESETS).map((preset) => (
            <button key={preset.label} type="button" style={pillButton(false)} onClick={() => applyPreset(preset)}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dates */}
      <div style={sectionStyle}>
        <span style={labelStyle}>Dates</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={inputStyle}
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Validation error */}
      {validation && (
        <div
          style={{
            padding: '8px 14px',
            color: COLORS.danger,
            fontFamily: fInter,
            fontSize: 11,
            background: 'rgba(255,87,87,0.05)',
            borderTop: `1px solid ${COLORS.border}`,
          }}
        >
          {validation}
        </div>
      )}

      {/* Fetch error */}
      {error && !loading && (
        <div
          style={{
            padding: '8px 14px',
            color: COLORS.danger,
            fontFamily: fInter,
            fontSize: 11,
            background: 'rgba(255,87,87,0.05)',
            borderTop: `1px solid ${COLORS.border}`,
          }}
        >
          {error}
        </div>
      )}

      {/* Apply button */}
      <div style={sectionStyle}>
        <button
          type="button"
          disabled={!!validation || !!loading}
          onClick={handleApply}
          style={{
            width: '100%',
            padding: '10px 14px',
            background: validation || loading ? 'transparent' : COLORS.accent,
            border: `0.5px solid ${COLORS.accent}`,
            borderRadius: 6,
            color: validation || loading ? COLORS.accent : 'var(--bg-primary)',
            fontFamily: fInter,
            fontSize: 12,
            fontWeight: 500,
            cursor: validation || loading ? 'not-allowed' : 'pointer',
            opacity: validation || loading ? 0.5 : 1,
            transition: 'all 0.15s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {loading && (
            <div
              style={{
                width: 12,
                height: 12,
                border: `2px solid ${COLORS.border}`,
                borderTopColor: COLORS.accent,
                borderRadius: '50%',
                animation: 'meteo-spin 0.8s linear infinite',
              }}
            />
          )}
          {loading ? 'Chargement…' : 'Appliquer'}
        </button>

        {/* Progress bar — visible uniquement quand le serveur envoie des chunks
            de progression (mode CP, plusieurs batchs). En mode region/departement
            (1 batch) le spinner du bouton suffit. */}
        {loading && progress && progress.total > 1 && (
          <div style={{ marginTop: 10 }}>
            <div
              style={{
                height: 3,
                background: COLORS.border,
                borderRadius: 2,
                overflow: 'hidden',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, (progress.current / progress.total) * 100)}%`,
                  background: COLORS.accent,
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div
              style={{
                fontFamily: fMono,
                fontSize: 10,
                color: COLORS.textTertiary,
                textAlign: 'center',
              }}
            >
              Chargement météo… {progress.current}/{progress.total} requêtes
              {progress.etaMs !== undefined && progress.etaMs > 5000 && (
                <> · ~{Math.ceil(progress.etaMs / 60000)} min restant</>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Stats display (après fetch) */}
      {stats && (
        <div style={sectionStyle}>
          <span style={labelStyle}>Statistiques période</span>
          <div style={{ fontFamily: fMono, fontSize: 11, color: COLORS.textSecondary, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>min <span style={{ color: COLORS.textPrimary }}>{stats.min.toFixed(1)}</span> {stats.unit}</span>
            <span>moy <span style={{ color: COLORS.textPrimary }}>{stats.mean.toFixed(1)}</span> {stats.unit}</span>
            <span>max <span style={{ color: COLORS.textPrimary }}>{stats.max.toFixed(1)}</span> {stats.unit}</span>
          </div>
        </div>
      )}
    </div>
  );
}
