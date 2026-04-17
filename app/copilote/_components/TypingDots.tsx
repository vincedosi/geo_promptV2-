export function TypingDots() {
  return (
    <div style={{
      display: 'flex', gap: 5, padding: '10px 14px',
      borderLeft: '2px solid #4ecdc4',
    }}>
      {[0, 0.15, 0.3].map((d, i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: 'var(--brand-teal)',
          display: 'inline-block',
          animation: `bounce 1s ${d}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  );
}
