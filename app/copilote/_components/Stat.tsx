export function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '7px 10px' }}>
      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontWeight: 700, fontSize: 14 }}>{value}</div>
    </div>
  );
}
