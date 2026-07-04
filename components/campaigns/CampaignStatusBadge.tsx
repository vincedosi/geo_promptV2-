import { STATUS_META, type CampaignStatus } from '@/lib/campaigns/status';

interface Props { status: CampaignStatus; attention?: boolean; }

export function CampaignStatusBadge({ status, attention = false }: Props) {
  const meta = STATUS_META[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: "'Inter', system-ui, sans-serif", fontSize: 11, fontWeight: 500,
      color: meta.colorVar,
      border: `0.5px solid ${meta.colorVar}`, borderRadius: 4, padding: '2px 8px',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.colorVar }} />
      {meta.label}
      {attention && (
        <span title="En cours mais aucune donnée récente" style={{
          width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)', marginLeft: 2,
        }} />
      )}
    </span>
  );
}
