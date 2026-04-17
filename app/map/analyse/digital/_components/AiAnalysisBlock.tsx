'use client';

import { adminFetch } from '@/lib/admin-fetch';
import { useState } from 'react';

const fInter = "'Inter', sans-serif";

interface AiAnalysisBlockProps {
  campaignId: string;
  indicator: string;
  kpi: { totalImpressions: number; totalPop: number; ratioMoyen: number; couverturePct: number; concentrationTop10: number };
  breakdown: Array<{ code: string; nom: string; impressions: number; pop_value: number; pct_imp: number; pct_pop: number; ecart: number }>;
  onComplete?: () => void;
}

export function AiAnalysisBlock({ campaignId, indicator, kpi, breakdown, onComplete }: AiAnalysisBlockProps) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/digital/${campaignId}/ai-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indicator, kpi, breakdown }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAnalysis(data.analysis);
      onComplete?.();
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: '#111111', border: '0.5px solid #1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid #1a1a1a' }}>
        <span style={{ fontFamily: fInter, fontSize: 13, fontWeight: 600, color: '#f0f0f0' }}>Analyse IA</span>
        <button onClick={handleAnalyze} disabled={loading} style={{
          padding: '6px 14px', fontFamily: fInter, fontSize: 11, cursor: loading ? 'wait' : 'pointer',
          background: loading ? '#1a1a1a' : 'rgba(78,205,196,0.1)',
          border: `0.5px solid ${loading ? '#1a1a1a' : '#4ecdc4'}`,
          borderRadius: 4, color: loading ? '#666666' : '#4ecdc4',
        }}>{loading ? 'Analyse en cours...' : analysis ? 'Relancer' : 'Analyser'}</button>
      </div>

      <div style={{ padding: '16px', minHeight: 80 }}>
        {error && <div style={{ fontFamily: fInter, fontSize: 11, color: '#ff5757' }}>{error}</div>}
        {!analysis && !loading && !error && (
          <div style={{ fontFamily: fInter, fontSize: 12, color: '#666666', fontStyle: 'italic' }}>
            Cliquez sur Analyser pour obtenir une synthese IA de votre campagne
          </div>
        )}
        {loading && (
          <div style={{ fontFamily: fInter, fontSize: 12, color: '#4ecdc4', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #4ecdc4', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            Gemini analyse votre campagne...
          </div>
        )}
        {analysis && (
          <div style={{ fontFamily: fInter, fontSize: 12, lineHeight: 1.7, color: '#e0e0e0', whiteSpace: 'pre-wrap' }}>
            {analysis.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={i} style={{ color: '#4ecdc4', fontWeight: 600 }}>{part.slice(2, -2)}</strong>
                : <span key={i}>{part}</span>
            )}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
