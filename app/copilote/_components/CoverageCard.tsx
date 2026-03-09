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
  const formatted = coverageCount.toLocaleString('fr-FR');
  const modeLabel = MODE_LABELS[mode] ?? mode;

  return (
    <div style={{
      background:    'rgba(168,85,247,0.07)',
      border:        '1px solid rgba(168,85,247,0.2)',
      borderRadius:  2,
      padding:       '14px 16px',
      marginTop:     6,
      display:       'flex',
      flexDirection: 'column',
      gap:           10,
    }}>
      <div style={{ fontFamily: "'Michroma','Orbitron',sans-serif", fontSize: 9, color: '#a855f7', letterSpacing: '0.14em' }}>
        COUVERTURE_AUDIENCE
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label="ZONE">{travelTimeMinutes} min {modeLabel} · <strong>{locationName}</strong></Row>
        <Row label="CIBLE">{targetLabel}</Row>
      </div>

      <div style={{
        background:  'rgba(168,85,247,0.1)',
        border:      '1px solid rgba(168,85,247,0.2)',
        borderRadius: 2,
        padding:     '10px 14px',
      }}>
        <div style={{
          fontSize:   24,
          fontWeight: 800,
          color:      '#c4b5fd',
          fontFamily: "'JetBrains Mono', monospace",
          lineHeight: 1,
        }}>
          {formatted}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
          personnes estimées (prorata spatial)
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <span style={{ fontFamily: "'Michroma','Orbitron',sans-serif", fontSize: 8, color: 'rgba(255,255,255,0.35)', width: 44, flexShrink: 0, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: "'Inter',system-ui,sans-serif" }}>{children}</span>
    </div>
  );
}
