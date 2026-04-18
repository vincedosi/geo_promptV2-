'use client';

const fInter = "'Inter', sans-serif";

interface HealthBadgeProps {
  concentrationTop10: number;
}

export function HealthBadge({ concentrationTop10 }: HealthBadgeProps) {
  const pct = concentrationTop10;
  let label: string, dotColor: string, bgColor: string, textColor: string;

  if (pct < 40) {
    label = 'Distribution equilibree'; dotColor = 'var(--brand-teal)'; bgColor = 'rgba(78,205,196,0.1)'; textColor = 'var(--brand-teal)';
  } else if (pct < 60) {
    label = 'Moderement concentree'; dotColor = '#ef9f27'; bgColor = 'rgba(239,159,39,0.1)'; textColor = '#ef9f27';
  } else {
    label = 'Tres concentree'; dotColor = '#ef4444'; bgColor = 'rgba(239,68,68,0.1)'; textColor = '#ef4444';
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 20,
      background: bgColor, fontFamily: fInter, fontSize: 11, color: textColor,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      {label}
    </span>
  );
}
