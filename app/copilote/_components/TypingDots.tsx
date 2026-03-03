export function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 5, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px 14px 14px 14px' }}>
      {[0, 0.2, 0.4].map((d, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.4)', display: 'inline-block', animation: `bounce 1s ${d}s ease-in-out infinite` }} />
      ))}
    </div>
  );
}
