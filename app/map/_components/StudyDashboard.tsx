'use client';

import { useState, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, ReferenceLine,
} from 'recharts';

// ── Types ───────────────────────────────────────────────────────────────────────

interface KPIs {
  score_moyen: number;
  score_max: number;
  top_tier_count: number;
  top_tier_pct: number;
  total?: number;
}

interface Tier {
  tier: string;
  range: string;
  count: number;
  color: string;
}

interface HistogramBucket {
  range: string;
  count: number;
}

interface ScatterPoint {
  id: string;
  score: number;
  distance_lycee: number | null;
  nom: string;
}

interface RadarPoint {
  critere: string;
  top20: number;
  moyenne: number;
}

interface TopPanneau {
  id: string;
  nom: string;
  score: number;
  lat: number;
  lng: number;
  type_panneau: string | null;
  regie: string | null;
  distance_lycee: number | null;
  lycee_proche: string | null;
  scoring_results: Record<string, { score: number; poids: number }> | null;
}

interface DashboardData {
  ville: string;
  total: number;
  scored_at: string | null;
  profile_nom: string | null;
  kpis: KPIs;
  tiers: Tier[];
  histogram: HistogramBucket[];
  scatter: ScatterPoint[];
  radar: RadarPoint[];
  top_panneaux: TopPanneau[];
}

interface Props {
  ville: string | null;
  onPanneauClick: (lat: number, lng: number, id: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return '#3dffa0';
  if (score >= 50) return '#a855f7';
  return '#ef4444';
}

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: '#1a1a2e', borderRadius: 2 }}>
        <div style={{
          width: `${Math.min(100, (value / max) * 100)}%`,
          height: '100%',
          background: scoreColor(value),
          borderRadius: 2,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: scoreColor(value), minWidth: 28, textAlign: 'right' }}>
        {Math.round(value)}
      </span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────────

export function StudyDashboard({ ville, onPanneauClick }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI analysis
  const [analysisText, setAnalysisText] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!ville) return;
    setLoading(true);
    setError(null);
    setData(null);
    setAnalysisText('');
    setAnalysisStarted(false);

    fetch(`/api/scoring/dashboard?ville=${encodeURIComponent(ville)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [ville]);

  async function launchAnalysis() {
    if (!data) return;
    setAnalysisLoading(true);
    setAnalysisText('');
    setAnalysisStarted(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ville: data.ville,
          kpis: { ...data.kpis, total: data.total },
          tiers: data.tiers,
          top_panneaux: data.top_panneaux,
          radar: data.radar,
          profile_nom: data.profile_nom,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.body) { setAnalysisText('Erreur: pas de réponse.'); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setAnalysisText(prev => prev + chunk);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setAnalysisText('Erreur analyse: ' + String(e));
    } finally {
      setAnalysisLoading(false);
    }
  }

  // ── Empty states ──

  if (!ville) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16, color: '#4a3a5c',
      }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
          ! aucune ville sélectionnée
        </div>
        <div style={{ fontSize: 12, color: '#3a2a4a' }}>
          Lancez un scoring depuis le panneau OOH pour afficher l'étude
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#a855f7',
      }}>
        <span style={{ animation: 'pulse 1.5s infinite' }}>chargement données {ville}…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 8, color: '#ef4444',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
      }}>
        <div>! {error}</div>
        <div style={{ color: '#4a3a5c', fontSize: 11 }}>
          Assurez-vous d'avoir calculé les scores pour {ville}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const tooltipStyle = {
    background: '#0a0a0a',
    border: '1px solid #261a35',
    borderRadius: 2,
    fontSize: 11,
    fontFamily: 'JetBrains Mono, monospace',
  };

  // ── Full dashboard ──

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '20px 24px 40px',
      display: 'flex', flexDirection: 'column', gap: 24,
      fontFamily: 'Inter, sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{
            fontFamily: 'Orbitron, sans-serif', fontSize: 18, fontWeight: 700,
            color: '#e8e0f0', letterSpacing: 2, textTransform: 'uppercase',
          }}>
            Étude OOH — {data.ville}
          </div>
          <div style={{ fontSize: 11, color: '#4a3a5c', marginTop: 4, fontFamily: 'Michroma, sans-serif', letterSpacing: 1 }}>
            {data.total} panneaux scorés
            {data.profile_nom && <> · profil <span style={{ color: '#a855f7' }}>{data.profile_nom}</span></>}
            {data.scored_at && <> · {new Date(data.scored_at).toLocaleDateString('fr-FR')}</>}
          </div>
        </div>
        <button
          onClick={launchAnalysis}
          disabled={analysisLoading}
          style={{
            padding: '7px 14px', background: analysisLoading ? '#1a1228' : '#0d0820',
            border: '1px solid #a855f7', borderRadius: 2, color: '#a855f7',
            fontFamily: 'Michroma, sans-serif', fontSize: 10, letterSpacing: 1,
            cursor: analysisLoading ? 'not-allowed' : 'pointer',
            textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}
        >
          {analysisLoading ? '▶ analyse en cours…' : '▶ analyse IA'}
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Score moyen', value: data.kpis.score_moyen, suffix: '/100', color: scoreColor(data.kpis.score_moyen) },
          { label: 'Score max', value: data.kpis.score_max, suffix: '/100', color: scoreColor(data.kpis.score_max) },
          { label: 'Panneaux top', value: data.kpis.top_tier_count, suffix: ` (${data.kpis.top_tier_pct}%)`, color: '#3dffa0' },
          { label: 'Total scorés', value: data.total, suffix: '', color: '#e8e0f0' },
        ].map(kpi => (
          <div key={kpi.label} style={{
            background: '#080812', border: '1px solid #261a35', borderRadius: 2,
            padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ fontSize: 9, fontFamily: 'Michroma, sans-serif', color: '#4a3a5c', letterSpacing: 1, textTransform: 'uppercase' }}>
              {kpi.label}
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 22, fontWeight: 700, color: kpi.color }}>
              {typeof kpi.value === 'number' && kpi.label.includes('Score')
                ? kpi.value.toFixed(1)
                : kpi.value}
              <span style={{ fontSize: 11, color: '#4a3a5c', fontWeight: 400 }}>{kpi.suffix}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tiers + Histogram */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16 }}>

        {/* Tiers bar */}
        <div style={{ background: '#080812', border: '1px solid #261a35', borderRadius: 2, padding: '16px 18px' }}>
          <div style={{ fontSize: 9, fontFamily: 'Michroma, sans-serif', color: '#4a3a5c', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Répartition tiers
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={data.tiers} layout="vertical" barSize={14} margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#4a3a5c', fontSize: 9, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis dataKey="tier" type="category" tick={{ fill: '#8a7a9c', fontSize: 10, fontFamily: 'Michroma' }} axisLine={false} tickLine={false} width={42} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#1a1228' }} />
              <Bar dataKey="count" name="Panneaux" fill="#a855f7" radius={[0, 2, 2, 0]}
                label={{ fill: '#8a7a9c', fontSize: 9, position: 'right', fontFamily: 'JetBrains Mono' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Histogram */}
        <div style={{ background: '#080812', border: '1px solid #261a35', borderRadius: 2, padding: '16px 18px' }}>
          <div style={{ fontSize: 9, fontFamily: 'Michroma, sans-serif', color: '#4a3a5c', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Distribution des scores
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={data.histogram} barSize={18} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" vertical={false} />
              <XAxis dataKey="range" tick={{ fill: '#4a3a5c', fontSize: 8, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4a3a5c', fontSize: 9, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#1a1228' }} />
              <Bar dataKey="count" name="Panneaux" fill="#a855f7" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Radar + Scatter */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Radar — top20 vs moyenne */}
        {data.radar.length > 0 && (
          <div style={{ background: '#080812', border: '1px solid #261a35', borderRadius: 2, padding: '16px 18px' }}>
            <div style={{ fontSize: 9, fontFamily: 'Michroma, sans-serif', color: '#4a3a5c', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
              Top 20 vs Moyenne
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={data.radar} margin={{ top: 8, right: 30, bottom: 8, left: 30 }}>
                <PolarGrid stroke="#261a35" />
                <PolarAngleAxis dataKey="critere" tick={{ fill: '#8a7a9c', fontSize: 9, fontFamily: 'Michroma' }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#4a3a5c', fontSize: 8 }} tickCount={4} />
                <Radar name="Top 20" dataKey="top20" stroke="#3dffa0" fill="#3dffa0" fillOpacity={0.15} dot={false} />
                <Radar name="Moyenne" dataKey="moyenne" stroke="#a855f7" fill="#a855f7" fillOpacity={0.1} dot={false} />
                <Legend wrapperStyle={{ fontSize: 9, fontFamily: 'Michroma', color: '#8a7a9c', paddingTop: 8 }} />
                <Tooltip contentStyle={tooltipStyle} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Scatter — score vs distance lycée */}
        <div style={{ background: '#080812', border: '1px solid #261a35', borderRadius: 2, padding: '16px 18px' }}>
          <div style={{ fontSize: 9, fontFamily: 'Michroma, sans-serif', color: '#4a3a5c', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Score vs Distance lycée
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart margin={{ top: 8, right: 8, bottom: 16, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
              <XAxis
                dataKey="distance_lycee" name="Distance (m)" type="number"
                tick={{ fill: '#4a3a5c', fontSize: 9, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false}
                label={{ value: 'm', position: 'insideRight', fill: '#4a3a5c', fontSize: 9 }}
              />
              <YAxis
                dataKey="score" name="Score" type="number" domain={[0, 100]}
                tick={{ fill: '#4a3a5c', fontSize: 9, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false}
              />
              <ReferenceLine y={80} stroke="#3dffa0" strokeDasharray="4 2" strokeOpacity={0.4} />
              <ReferenceLine y={50} stroke="#a855f7" strokeDasharray="4 2" strokeOpacity={0.4} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ stroke: '#261a35' }}
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0].payload as ScatterPoint;
                  return (
                    <div style={{ ...tooltipStyle, padding: '6px 10px' }}>
                      <div style={{ color: '#e8e0f0', marginBottom: 2, fontSize: 10 }}>{d.nom}</div>
                      <div style={{ color: scoreColor(d.score) }}>Score: {d.score}</div>
                      {d.distance_lycee && <div style={{ color: '#8a7a9c' }}>Lycée: {Math.round(d.distance_lycee)}m</div>}
                    </div>
                  );
                }}
              />
              <Scatter
                data={data.scatter.filter(s => s.distance_lycee !== null)}
                fill="#a855f7" fillOpacity={0.7} r={3}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top 5 panneaux */}
      <div style={{ background: '#080812', border: '1px solid #261a35', borderRadius: 2, padding: '16px 18px' }}>
        <div style={{ fontSize: 9, fontFamily: 'Michroma, sans-serif', color: '#4a3a5c', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }}>
          Top 5 panneaux
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.top_panneaux.map((p, i) => (
            <button
              key={p.id}
              onClick={() => onPanneauClick(p.lat, p.lng, p.id)}
              style={{
                display: 'grid', gridTemplateColumns: '24px 1fr auto',
                alignItems: 'center', gap: 12,
                background: 'transparent', border: '1px solid #1a1228',
                borderRadius: 2, padding: '10px 12px',
                cursor: 'pointer', textAlign: 'left',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#a855f7')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a1228')}
            >
              <span style={{
                fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 700,
                color: i === 0 ? '#3dffa0' : '#4a3a5c',
              }}>
                {i + 1}
              </span>
              <div>
                <div style={{ fontSize: 12, color: '#e8e0f0', fontWeight: 500 }}>{p.nom}</div>
                <div style={{ fontSize: 10, color: '#4a3a5c', marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                  {p.type_panneau && <span>{p.type_panneau}</span>}
                  {p.regie && <span> · {p.regie}</span>}
                  {p.distance_lycee && <span> · lycée {Math.round(p.distance_lycee)}m</span>}
                  {p.lycee_proche && <span style={{ color: '#6a5a7c' }}> ({p.lycee_proche})</span>}
                </div>
                {p.scoring_results && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {Object.entries(p.scoring_results).slice(0, 4).map(([key, val]) => (
                      <span key={key} style={{
                        fontSize: 9, fontFamily: 'Michroma, sans-serif',
                        padding: '2px 6px', background: '#0d0820', border: '1px solid #261a35', borderRadius: 2,
                        color: '#8a7a9c', letterSpacing: 0.5,
                      }}>
                        {key}: <span style={{ color: scoreColor(val.score) }}>{Math.round(val.score)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 700,
                  color: scoreColor(p.score),
                }}>
                  {Math.round(p.score)}
                </div>
                <ScoreBar value={p.score} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* AI Analysis block */}
      {analysisStarted && (
        <div style={{ background: '#080812', border: '1px solid #261a35', borderRadius: 2, padding: '16px 18px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 9, fontFamily: 'Michroma, sans-serif', color: '#4a3a5c', letterSpacing: 1, textTransform: 'uppercase' }}>
              Analyse IA — Mistral
              {analysisLoading && (
                <span style={{ marginLeft: 8, color: '#a855f7', animation: 'pulse 1.5s infinite' }}>▶ en cours</span>
              )}
            </div>
            {!analysisLoading && analysisText && (
              <button
                onClick={launchAnalysis}
                style={{
                  padding: '3px 8px', background: 'transparent', border: '1px solid #261a35',
                  borderRadius: 2, color: '#4a3a5c', fontSize: 9,
                  fontFamily: 'Michroma, sans-serif', cursor: 'pointer', letterSpacing: 1,
                }}
              >
                ↺ relancer
              </button>
            )}
          </div>
          {analysisText ? (
            <div style={{
              fontSize: 12, color: '#c8b8e0', lineHeight: 1.7,
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'pre-wrap',
            }}>
              {analysisText}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#4a3a5c', fontFamily: 'JetBrains Mono, monospace' }}>
              {analysisLoading ? 'Génération en cours…' : ''}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
