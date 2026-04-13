'use client';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString('fr-FR');
}

interface KpiSummaryProps {
  totalImpressions: number;
  totalPop: number;
  ratioMoyen: number;
  couverturePct: number;
  concentrationTop10: number;
  metric?: 'impressions' | 'unique';
  frequency?: number | null;
}

export function KpiSummary({ totalImpressions, totalPop, ratioMoyen, couverturePct, concentrationTop10, metric = 'impressions', frequency = null }: KpiSummaryProps) {
  const impLabel = metric === 'unique' ? 'Imp. uniques' : 'Impressions';
  const kpis: { label: string; value: string; color: string }[] = [
    { label: impLabel, value: fmt(totalImpressions), color: '#4ecdc4' },
    { label: 'Pop. cible', value: fmt(totalPop), color: '#f0f0f0' },
    { label: 'Ratio moy.', value: ratioMoyen.toFixed(1), color: '#f0f0f0' },
    { label: 'Couverture', value: couverturePct.toFixed(0) + '%', color: couverturePct > 80 ? '#3dffa0' : couverturePct > 50 ? '#f7b731' : '#ff5757' },
    { label: 'Top 10% CP =', value: concentrationTop10.toFixed(0) + '% imp.', color: concentrationTop10 > 60 ? '#ff5757' : '#3dffa0' },
  ];
  if (frequency !== null && frequency > 0 && Number.isFinite(frequency)) {
    kpis.push({ label: 'Fréquence moy.', value: frequency.toFixed(1) + 'x', color: '#f0f0f0' });
  }

  return (
    <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
      {kpis.map((k, i) => (
        <div key={k.label} style={{
          flex: 1, padding: '8px 10px', background: '#0a0a0a', border: '0.5px solid #1a1a1a', borderRadius: 0,
          display: 'flex', flexDirection: 'column', gap: 4,
          ...(i === 0 ? { borderTop: '2px solid #4ecdc4' } : {}),
        }}>
          <div style={{ fontFamily: fMono, fontSize: i === 0 ? 20 : 14, fontWeight: 600, color: k.color }}>{k.value}</div>
          <div style={{ fontFamily: fInter, fontSize: 10, color: '#8a8a8a' }}>{k.label}</div>
        </div>
      ))}
    </div>
  );
}
