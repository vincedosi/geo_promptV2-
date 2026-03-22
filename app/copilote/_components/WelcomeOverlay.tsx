'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';

const SUGGESTIONS = [
  "Affiche la densité des 18-24 ans en France",
  "Panneaux d'affichage à Brest et population jeune autour",
  "Zone accessible en 15 min en voiture depuis le CIRFA de Lyon",
];

const fontOrbitron = "'Orbitron', sans-serif";
const fontInter    = "'Inter', sans-serif";

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
        maxWidth: 520,
        width: 'calc(100% - 32px)',
        background: 'rgba(12, 12, 20, 0.85)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '0.5px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 12,
        padding: '16px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
      }}>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            fontFamily: fontOrbitron,
            color: '#f1f1f4',
            letterSpacing: '0.08em',
            marginBottom: 6,
          }}>
            Que voulez-vous analyser ?
          </div>
          <div style={{
            fontSize: 12,
            color: 'rgba(255, 255, 255, 0.45)',
            fontFamily: fontInter,
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
              background: 'rgba(255, 255, 255, 0.06)',
              border: '0.5px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 8,
              padding: '10px 12px',
              color: '#f1f1f4',
              fontSize: 13,
              fontFamily: fontInter,
              resize: 'none',
              outline: 'none',
              lineHeight: 1.5,
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: input.trim() ? '#7F77DD' : 'rgba(127, 119, 221, 0.3)',
              border: 'none',
              cursor: input.trim() ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: '#fff',
              fontSize: 16,
              transition: 'background 0.15s',
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
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(127, 119, 221, 0.22)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(127, 119, 221, 0.12)'; }}
              style={{
                background: 'rgba(127, 119, 221, 0.12)',
                border: '0.5px solid rgba(127, 119, 221, 0.25)',
                borderRadius: 6,
                padding: '9px 14px',
                color: '#AFA9EC',
                fontSize: 12,
                fontFamily: fontInter,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s',
                lineHeight: 1.4,
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
