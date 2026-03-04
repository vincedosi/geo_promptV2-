const MODE_LABELS: Record<string, string> = {
  drive: 'en voiture',
  walk:  'à pied',
  bike:  'à vélo',
};

interface CoverageCardProps {
  locationName:      string;
  travelTimeMinutes: number;
  targetLabel:       string;
  coverageCount:     number;
  mode?:             string;
}

export function CoverageCard({
  locationName,
  travelTimeMinutes,
  targetLabel,
  coverageCount,
  mode = 'drive',
}: CoverageCardProps) {
  const formatted  = coverageCount.toLocaleString('fr-FR');
  const modeLabel  = MODE_LABELS[mode] ?? mode;

  return (
    <div style={{
      background:   'rgba(99,102,241,0.08)',
      border:       '1px solid rgba(99,102,241,0.25)',
      borderRadius: 12,
      padding:      '14px 16px',
      marginTop:    6,
      display:      'flex',
      flexDirection:'column',
      gap:          10,
    }}>
      {/* Header */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        🎯 Analyse de couverture
      </div>

      {/* Zone + Cible */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label="📍 Zone">{travelTimeMinutes} min {modeLabel} · <strong>{locationName}</strong></Row>
        <Row label="👥 Cible">{targetLabel}</Row>
      </div>

      {/* Résultat */}
      <div style={{
        background:   'rgba(99,102,241,0.15)',
        borderRadius: 8,
        padding:      '10px 14px',
        display:      'flex',
        alignItems:   'center',
        gap:          12,
      }}>
        <span style={{ fontSize: 22 }}>📊</span>
        <div>
          <div style={{
            fontSize:   22,
            fontWeight: 800,
            color:      '#c4b5fd',
            fontFamily: 'JetBrains Mono, monospace',
            lineHeight: 1,
          }}>
            {formatted}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
            personnes estimées (prorata spatial)
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', width: 68, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{children}</span>
    </div>
  );
}
