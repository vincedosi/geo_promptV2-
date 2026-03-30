export function TypingDots() {
  return (
    <div style={{
      display: 'flex', gap: 5, padding: '10px 14px',
      background: '#111111',
      border: '0.5px solid #1a1a1a',
      borderRadius: '4px 12px 12px 12px',
    }}>
      {[0, 0.2, 0.4].map((d, i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: '#444444',
          display: 'inline-block',
          animation: `bounce 1s ${d}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  );
}
