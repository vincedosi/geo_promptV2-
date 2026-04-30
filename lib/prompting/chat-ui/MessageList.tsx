'use client';

/**
 * Pattern 5 — Composant MessageList partagé pour les UIs de chat LLM.
 * Extrait du rendu chat de BiddingCopilot, généralisé.
 */
import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

export interface MessageListProps {
  messages: ChatMessage[];
  loading?: boolean;
  error?: string | null;
  /** Lettre/initiale dans le badge "assistant" (ex. 'G' pour Gemini, 'A' pour Agent). */
  assistantLabel?: string;
  /** Hauteur max du conteneur scrollable. */
  maxHeight?: number;
}

export function MessageList({
  messages, loading, error, assistantLabel = 'A', maxHeight = 360,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  return (
    <div style={{ maxHeight, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {messages.map((msg, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
          {msg.role === 'assistant' ? (
            <div style={{ display: 'flex', gap: 10, maxWidth: '90%' }}>
              <div style={{
                width: 22, height: 22, borderRadius: 4,
                background: 'rgba(78,205,196,0.1)', border: '0.5px solid rgba(78,205,196,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, fontFamily: fMono, fontSize: 10, color: 'var(--brand-teal)', fontWeight: 600,
              }}>{assistantLabel}</div>
              <div style={{ fontFamily: fInter, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                {renderMarkdownLite(msg.content)}
              </div>
            </div>
          ) : (
            <div style={{
              background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)',
              borderRadius: 8, padding: '8px 12px',
              fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)', maxWidth: '85%', lineHeight: 1.5,
            }}>{msg.content}</div>
          )}
        </div>
      ))}
      {loading && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontFamily: fInter, fontSize: 11, color: 'var(--brand-teal)' }}>
          <span style={{
            display: 'inline-block', width: 10, height: 10,
            border: '1.5px solid var(--brand-teal)', borderTopColor: 'transparent',
            borderRadius: '50%', animation: 'mlspin 0.8s linear infinite',
          }} />
          {assistantLabel} réfléchit…
        </div>
      )}
      {error && (
        <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--danger)', padding: '6px 10px', background: 'rgba(255,87,87,0.08)', borderRadius: 4 }}>
          {error}
        </div>
      )}
      <div ref={endRef} />
      <style>{`@keyframes mlspin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/** Rend `**bold**` en `<strong>`. Volontairement minimaliste (pas de markdown lib). */
function renderMarkdownLite(content: string) {
  return content.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={j} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{part.slice(2, -2)}</strong>
      : <span key={j}>{part}</span>
  );
}
