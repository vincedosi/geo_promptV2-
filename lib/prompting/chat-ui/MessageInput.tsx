'use client';

/**
 * Pattern 5 — Composant input partagé.
 * Textarea auto-grow + Enter envoie, Shift+Enter nouvelle ligne.
 */
import { useState, type KeyboardEvent } from 'react';

const fInter = "'Inter', system-ui, sans-serif";

export interface MessageInputProps {
  onSend: (text: string) => void;
  loading?: boolean;
  placeholder?: string;
  initialValue?: string;
}

export function MessageInput({
  onSend, loading, placeholder = 'Votre message…', initialValue = '',
}: MessageInputProps) {
  const [text, setText] = useState(initialValue);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setText('');
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const disabled = loading || !text.trim();

  return (
    <div style={{
      padding: '10px 14px', borderTop: '0.5px solid rgba(255,255,255,0.08)',
      display: 'flex', gap: 8, alignItems: 'flex-end',
    }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        rows={1}
        disabled={loading}
        style={{
          flex: 1, background: 'rgba(255,255,255,0.03)',
          border: '0.5px solid rgba(255,255,255,0.08)',
          borderRadius: 6, padding: '8px 12px',
          fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)',
          outline: 'none', resize: 'none', minHeight: 34, maxHeight: 120,
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--brand-teal)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
      />
      <button
        onClick={handleSend}
        disabled={disabled}
        style={{
          padding: '8px 14px', fontFamily: fInter, fontSize: 11, fontWeight: 500,
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: disabled ? 'rgba(78,205,196,0.04)' : 'rgba(78,205,196,0.12)',
          border: '0.5px solid var(--brand-teal)', borderRadius: 6,
          color: disabled ? 'rgba(78,205,196,0.4)' : 'var(--brand-teal)',
        }}
      >Envoyer</button>
    </div>
  );
}
