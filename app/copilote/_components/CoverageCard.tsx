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
      background:    'rgba(78,205,196,0.06)',
      border:        '0.5px solid rgba(78,205,196,0.2)',
      borderRadius:  2,
      padding:       '14px 16px',
      marginTop:     6,
      display:       'flex',
      flexDirection: 'column',
      gap:           10,
    }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'var(--brand-teal)', letterSpacing: '0.14em' }}>
        COUVERTURE_AUDIENCE
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label="ZONE">{travelTimeMinutes} min {modeLabel} · <strong>{locationName}</strong></Row>
        <Row label="CIBLE">{targetLabel}</Row>
      </div>

      <div style={{
        background:  'rgba(78,205,196,0.08)',
        border:      '0.5px solid rgba(78,205,196,0.2)',
        borderRadius: 2,
        padding:     '10px 14px',
      }}>
        <div style={{
          fontSize:   24,
          fontWeight: 800,
          color:      'var(--brand-teal)',
          fontFamily: "'JetBrains Mono', monospace",
          lineHeight: 1,
        }}>
          {formatted}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
          personnes estimées (prorata spatial)
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: 'var(--text-tertiary)', width: 44, flexShrink: 0, letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif" }}>{children}</span>
    </div>
  );
}
