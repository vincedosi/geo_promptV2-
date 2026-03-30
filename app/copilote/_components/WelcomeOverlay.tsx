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

  const [sendHover, setSendHover] = useState(false);

  if (!visible) return null;

  return (
    <>
    <style>{`
      @keyframes welcomeCardIn {
        from { opacity: 0; transform: scale(0.96) translateY(12px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      @keyframes welcomeTitleReveal {
        from { clip-path: inset(0 100% 0 0); opacity: 0; }
        to { clip-path: inset(0 0% 0 0); opacity: 1; }
      }
      @keyframes welcomeFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes welcomePillIn {
        from { opacity: 0; transform: translateX(-8px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes welcomeSendPulse {
        0%, 100% { outline: 2px solid transparent; outline-offset: 0px; }
        50% { outline: 2px solid rgba(78,205,196,0.15); outline-offset: 3px; }
      }
      @media (prefers-reduced-motion: reduce) {
        * { animation-duration: 0.01ms !important; animation-delay: 0s !important; transition-duration: 0.01ms !important; }
      }
    `}</style>
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
        background: 'rgba(5,5,5,0.92)',
      }}
    >
      <div style={{
        position: 'relative',
        maxWidth: 520,
        width: 'calc(100% - 32px)',
        background: '#0a0a0a',
        border: '0.5px solid #1a1a1a',
        borderLeft: '2px solid rgba(78,205,196,0.2)',
        borderRadius: 12,
        padding: '20px 20px 16px',
        animation: 'welcomeCardIn 0.3s ease-out',
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
            transition: 'all 0.2s ease',
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
            letterSpacing: '-0.02em',
            animation: 'welcomeTitleReveal 0.5s ease-out 0.15s both',
          }}>
            Que voulez-vous analyser ?
          </div>
          <div style={{
            fontSize: 14,
            color: '#666666',
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 400,
            lineHeight: 1.5,
            animation: 'welcomeFadeIn 0.4s ease-out 0.3s both',
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
              transition: 'border-color 0.3s ease',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#1a1a1a'; }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            onMouseEnter={() => setSendHover(true)}
            onMouseLeave={() => setSendHover(false)}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: input.trim() ? (sendHover ? '#3dbdb5' : '#4ecdc4') : '#1a1a1a',
              border: 'none',
              cursor: input.trim() ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: input.trim() ? '#050505' : '#444444',
              fontSize: 16,
              transition: 'background 0.15s, color 0.15s',
              animation: !input.trim() ? 'welcomeSendPulse 3s ease-in-out infinite' : 'none',
            }}
          >
            ↑
          </button>
        </div>

        {/* Suggestion pills */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SUGGESTIONS.map((s, index) => (
            <button
              key={s}
              onClick={() => dismiss(s)}
              style={{
                animation: `welcomePillIn 0.35s ease-out ${0.35 + index * 0.08}s both`,
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
    </>
  );
}
