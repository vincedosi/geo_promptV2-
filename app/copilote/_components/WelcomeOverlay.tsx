'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';

const SUGGESTIONS = [
  "Affiche la densité des 18-24 ans en France",
  "Panneaux d'affichage à Brest et population jeune autour",
  "Zone accessible en 15 min en voiture depuis le CIRFA de Lyon",
];

interface WelcomeOverlayProps {
  sendMessage: (text: string) => void;
}

export function WelcomeOverlay({ sendMessage }: WelcomeOverlayProps) {
  const [visible, setVisible]   = useState(true);
  const [fading,  setFading]    = useState(false);
  const [input,   setInput]     = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 120);
  }, []);

  const dismiss = (text?: string) => {
    setFading(true);
    setTimeout(() => {
      setVisible(false);
      if (text?.trim()) sendMessage(text.trim());
    }, 200);
  };

  const handleSubmit = () => {
    if (input.trim()) dismiss(input);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!visible) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
      style={{
        position: 'fixed',
        left: 320,
        top: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: 60,
        zIndex: 10000,
        pointerEvents: fading ? 'none' : 'auto',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      <div style={{
        position: 'relative',
        maxWidth: 520,
        width: 'calc(100% - 32px)',
        background: '#0a0a0a',
        border: '0.5px solid #1a1a1a',
        borderRadius: 12,
        padding: '20px 20px 16px',
      }}>

        {/* Close button */}
        <button
          onClick={() => dismiss()}
          aria-label="Fermer"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#666666',
            fontSize: 18,
            lineHeight: 1,
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = '#181818';
            (e.currentTarget as HTMLButtonElement).style.color = '#f0f0f0';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = '#666666';
          }}
        >
          ✕
        </button>

        {/* Title */}
        <div style={{ marginBottom: 16, paddingRight: 32 }}>
          <div style={{
            fontSize: 20,
            fontWeight: 500,
            fontFamily: "'Inter', system-ui, sans-serif",
            color: '#f0f0f0',
            marginBottom: 6,
            lineHeight: 1.25,
          }}>
            Que voulez-vous analyser ?
          </div>
          <div style={{
            fontSize: 14,
            color: '#666666',
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 400,
            lineHeight: 1.5,
          }}>
            Posez votre question, je m'occupe du reste
          </div>
        </div>

        {/* Input row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ex: Affiche la densité des 18-24 ans en France"
            rows={2}
            style={{
              flex: 1,
              background: '#111111',
              border: '0.5px solid #1a1a1a',
              borderRadius: 8,
              padding: '10px 12px',
              color: '#f0f0f0',
              fontSize: 13,
              fontFamily: "'Inter', system-ui, sans-serif",
              resize: 'none',
              outline: 'none',
              lineHeight: 1.5,
              transition: 'border-color 0.15s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#1a1a1a'; }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: input.trim() ? '#4ecdc4' : '#1a1a1a',
              border: 'none',
              cursor: input.trim() ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: input.trim() ? '#050505' : '#444444',
              fontSize: 16,
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            ↑
          </button>
        </div>

        {/* Suggestion pills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => dismiss(s)}
              style={{
                background: '#111111',
                border: '0.5px solid #1a1a1a',
                borderRadius: 6,
                padding: '9px 14px',
                color: '#a0a0a0',
                fontSize: 13,
                fontFamily: "'Inter', system-ui, sans-serif",
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 0.15s, background 0.15s',
                lineHeight: 1.4,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(78,205,196,0.3)';
                (e.currentTarget as HTMLButtonElement).style.background = '#151515';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#1a1a1a';
                (e.currentTarget as HTMLButtonElement).style.background = '#111111';
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
