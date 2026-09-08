'use client';

/**
 * FinalReport — bilan exécutif Gemini de fin de campagne, 5 sections :
 *   - Performance / Wins / Limites / Reco prochaine campagne / ROI estimé
 *
 * Déplacé depuis app/custom-bidding/[strategyId]/_components/ le 2026-09-08,
 * lors de la suppression de l'overlay Pilotage ML : seul rescapé de ce dossier,
 * il reste consommé par CampaignSuivi. Contenu inchangé.
 */
import { useEffect, useState } from 'react';
import { FileCheck2, RefreshCw, Trophy, AlertCircle, ArrowRight, Banknote, Sparkles, FileText } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Report {
  performance: string;
  wins: string[];
  limites: string[];
  reco_next: string[];
  roi: {
    estimated_savings_eur: number;
    cpm_market_eur: number;
    cpm_optimized_eur: number;
    explanation: string;
  };
  model: string;
  generated_at: string;
  cached: boolean;
}

interface Props {
  strategyId: string;
}

export function FinalReport({ strategyId }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/final-report`, {
        method: 'POST', cache: 'no-store',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${res.status}`);
      }
      const data = await res.json() as Report;
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void generate(); }, [strategyId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: 12, fontFamily: fInter, color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <FileCheck2 size={12} strokeWidth={1.8} color="var(--brand-teal)" />
        <span style={{ fontSize: 11, fontWeight: 500 }}>Bilan exécutif de campagne</span>
        {report && (
          <span style={{ fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
            ✦ {report.model}{report.cached ? ' (cache)' : ''}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            type="button"
            disabled
            title="Export PDF — bientôt disponible"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '5px 10px', fontSize: 10, fontFamily: fInter, fontWeight: 500,
              background: 'transparent', color: 'var(--text-tertiary)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 5, cursor: 'not-allowed', opacity: 0.6,
            }}
          >
            <FileText size={11} /> Export PDF (bientôt)
          </button>
          <button
            type="button"
            onClick={() => { void generate(); }}
            disabled={loading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', fontSize: 11, fontFamily: fInter, fontWeight: 500,
              background: loading ? 'var(--bg-level-2)' : 'var(--brand-teal)',
              color: loading ? 'var(--text-tertiary)' : 'var(--bg-level-0)',
              border: '0.5px solid var(--brand-teal)',
              borderRadius: 5, cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={11} className={loading ? 'agent-spin' : undefined} />
            {loading ? 'Génération…' : 'Régénérer'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '6px 10px', background: 'var(--bg-level-2)', border: '0.5px solid var(--danger)', borderRadius: 5, fontSize: 11, fontFamily: fMono, color: 'var(--danger)', marginBottom: 8 }}>
          {error}
        </div>
      )}

      {!report && loading && (
        <div style={{ padding: 16, textAlign: 'center', fontSize: 11, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
          MAGELIAN Agent rédige le bilan…
        </div>
      )}

      {report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Performance */}
          <Card icon={Sparkles} color="var(--brand-teal)" title="Performance globale">
            <div style={{ fontSize: 11.5, fontFamily: fInter, color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {report.performance}
            </div>
          </Card>

          {/* Wins */}
          <Card icon={Trophy} color="var(--success)" title="Wins majeurs">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, fontFamily: fInter, color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {report.wins.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
            </ul>
          </Card>

          {/* Limites */}
          <Card icon={AlertCircle} color="var(--warning)" title="Limites & apprentissages">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, fontFamily: fInter, color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {report.limites.map((l, i) => <li key={i} style={{ marginBottom: 4 }}>{l}</li>)}
            </ul>
          </Card>

          {/* Reco prochaine campagne */}
          <Card icon={ArrowRight} color="var(--info, #5b9bd5)" title="Recommandations pour la prochaine campagne">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, fontFamily: fInter, color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {report.reco_next.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
            </ul>
          </Card>

          {/* ROI */}
          <Card icon={Banknote} color="var(--brand-teal)" title="ROI estimé">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
              <Stat label="Économies estimées" value={`${Math.round(report.roi.estimated_savings_eur).toLocaleString('fr-FR')} €`} highlight />
              <Stat label="CPM marché" value={`${report.roi.cpm_market_eur.toFixed(2)} €`} />
              <Stat label="CPM optimisé" value={`${report.roi.cpm_optimized_eur.toFixed(2)} €`} />
            </div>
            <div style={{ fontSize: 10, fontFamily: fInter, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {report.roi.explanation}
            </div>
          </Card>
        </div>
      )}

      <style>{`
        .agent-spin { animation: agentSpin 1s linear infinite; }
        @keyframes agentSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function Card({ icon: Icon, color, title, children }: { icon: typeof Sparkles; color: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--bg-level-2)',
      border: '0.5px solid var(--border-subtle)',
      borderLeft: `2px solid ${color}`,
      borderRadius: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Icon size={12} strokeWidth={1.8} color={color} />
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: '6px 10px',
      background: 'var(--bg-level-1)',
      border: `0.5px solid ${highlight ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
      borderRadius: 4,
    }}>
      <div style={{ fontSize: 9, fontFamily: fMono, color: 'var(--text-tertiary)', textTransform: 'lowercase', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: highlight ? 16 : 13, fontFamily: fMono, color: highlight ? 'var(--brand-teal)' : 'var(--text-primary)', fontWeight: 500 }}>
        {value}
      </div>
    </div>
  );
}
