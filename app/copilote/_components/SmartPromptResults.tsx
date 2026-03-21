'use client';

/**
 * app/copilote/_components/SmartPromptResults.tsx
 * Panneau d'affichage des résultats du routeur multi-agents.
 * Design GEO.PROMPT Terminal Dark — inline styles uniquement.
 */

import React, { useState, useRef } from 'react';
import type { SmartPromptResponse } from '@/lib/smart-prompt/types';
import { useSmartPrompt }           from '../_hooks/useSmartPrompt';

// ── Tokens design system ──────────────────────────────────────────────────────
const C = {
  bg:       '#050505',
  bgCard:   '#0c0c0f',
  bgInput:  '#0f0f14',
  border:   '#261a35',
  accent:   '#a855f7',
  accentDim:'#7c3aed',
  green:    '#3dffa0',
  amber:    '#f59e0b',
  red:      '#ef4444',
  text:     '#e2e8f0',
  textDim:  '#64748b',
  textMid:  '#94a3b8',
  font:     'JetBrains Mono, monospace',
};

// Badge couleur par agent
const AGENT_COLOR: Record<string, string> = {
  demographie:      C.green,
  poi_clustering:   C.accent,
  panneaux:         C.amber,
  isochrone_battle: '#38bdf8',
  benchmark:        '#f472b6',
  unknown:          C.red,
};

const AGENT_LABEL: Record<string, string> = {
  demographie:      'DEMOGRAPHIE',
  poi_clustering:   'CLUSTERING',
  panneaux:         'PANNEAUX OOH',
  isochrone_battle: 'ISOCHRONES',
  benchmark:        'BENCHMARK',
  unknown:          'INCONNU',
};

// ── Rendu markdown simplifié (pas de dépendance externe) ──────────────────────
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split('\n');
  const nodes: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  const flushTable = (key: string) => {
    if (tableRows.length === 0) return;
    const [header, , ...body] = tableRows;
    nodes.push(
      <table key={key} style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 8 }}>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} style={{ border: `1px solid ${C.border}`, padding: '4px 8px', color: C.accent, fontSize: 11, textAlign: 'left', background: '#13091f' }}>
                {h.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ border: `1px solid ${C.border}`, padding: '4px 8px', fontSize: 12, color: C.text }}>
                  {cell.trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
    tableRows = [];
    inTable   = false;
  };

  lines.forEach((line, idx) => {
    const key = `line-${idx}`;

    // Table rows
    if (line.startsWith('|')) {
      inTable = true;
      tableRows.push(line.split('|').slice(1, -1));
      return;
    }
    if (inTable) flushTable(`table-${idx}`);

    // H2
    if (line.startsWith('## ')) {
      nodes.push(<div key={key} style={{ color: C.accent, fontFamily: 'Orbitron, sans-serif', fontSize: 13, fontWeight: 700, marginBottom: 6, marginTop: 12, letterSpacing: 1 }}>{line.slice(3)}</div>);
      return;
    }
    // H3
    if (line.startsWith('### ')) {
      nodes.push(<div key={key} style={{ color: C.textMid, fontFamily: 'Michroma, sans-serif', fontSize: 10, fontWeight: 600, marginBottom: 4, marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 }}>{line.slice(4)}</div>);
      return;
    }
    // Bullet
    if (line.startsWith('- ')) {
      const content = line.slice(2);
      nodes.push(
        <div key={key} style={{ display: 'flex', gap: 6, marginBottom: 3, fontSize: 12, color: C.textMid }}>
          <span style={{ color: C.accent, flexShrink: 0 }}>•</span>
          <span dangerouslySetInnerHTML={{ __html: content.replace(/\*\*(.*?)\*\*/g, `<strong style="color:${C.text}">$1</strong>`).replace(/\*(.*?)\*/g, `<em style="color:${C.textMid}">$1</em>`) }} />
        </div>
      );
      return;
    }
    // Bold text block
    if (line.trim() === '') {
      nodes.push(<div key={key} style={{ height: 4 }} />);
      return;
    }
    // Default text
    nodes.push(
      <div key={key} style={{ fontSize: 12, color: C.textMid, marginBottom: 2, lineHeight: 1.6 }}
        dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, `<strong style="color:${C.text}">$1</strong>`).replace(/\*(.*?)\*/g, `<em style="color:${C.textMid}">$1</em>`) }}
      />
    );
  });

  if (inTable) flushTable('table-final');
  return nodes;
}

// ── Sous-composant : résultat ─────────────────────────────────────────────────
function ResultCard({ response }: { response: SmartPromptResponse }) {
  const { decision, result } = response;
  const agentColor = AGENT_COLOR[decision.agent] ?? C.textDim;

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
      {/* Header agent */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontFamily: 'Michroma, sans-serif', fontSize: 9, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: 1.5,
          color: agentColor, border: `1px solid ${agentColor}`, borderRadius: 2,
          padding: '2px 6px',
        }}>
          {AGENT_LABEL[decision.agent] ?? decision.agent}
        </span>
        <span style={{ fontSize: 10, color: C.textDim, fontFamily: C.font }}>
          conf. {(decision.confidence * 100).toFixed(0)}%
        </span>
        {!result.success && (
          <span style={{ fontSize: 10, color: C.red, marginLeft: 'auto' }}>! erreur</span>
        )}
      </div>

      {/* Explication du routeur */}
      {decision.explication && (
        <div style={{ fontSize: 11, color: C.textDim, fontStyle: 'italic', marginBottom: 10, paddingLeft: 4, borderLeft: `2px solid ${C.border}` }}>
          {decision.explication}
        </div>
      )}

      {/* Contenu markdown */}
      {result.markdown ? (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 2, padding: '10px 12px' }}>
          {renderMarkdown(result.markdown)}
        </div>
      ) : result.error ? (
        <div style={{ background: '#1a0505', border: `1px solid ${C.red}40`, borderRadius: 2, padding: '8px 12px', fontSize: 12, color: C.red }}>
          ! {result.error}
        </div>
      ) : null}

      {/* Footer */}
      <div style={{ marginTop: 6, fontSize: 10, color: C.textDim, fontFamily: C.font }}>
        registry: {response.registry_used} sources
      </div>
    </div>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────
export function SmartPromptResults() {
  const { loading, response, error, submit, reset } = useSmartPrompt();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim()) submit(input.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { reset(); setInput(''); }
  }

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 2,
      padding: 16,
      fontFamily: C.font,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* Titre */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'Michroma, sans-serif', fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: 2 }}>
          smart.prompt / routeur multi-agents
        </div>
        {response && (
          <button
            onClick={() => { reset(); setInput(''); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, fontSize: 11, padding: 0 }}
          >
            ✕ effacer
          </button>
        )}
      </div>

      {/* Champ de saisie */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Revenu médian à Lyon, clustering POI, panneaux Paris…"
          disabled={loading}
          style={{
            flex: 1,
            background: C.bgInput,
            border: `1px solid ${loading ? C.accentDim : C.border}`,
            borderRadius: 2,
            color: C.text,
            fontFamily: C.font,
            fontSize: 12,
            padding: '7px 10px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            background: loading ? C.accentDim : C.accent,
            border: 'none',
            borderRadius: 2,
            color: '#fff',
            fontFamily: 'Michroma, sans-serif',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 1,
            padding: '7px 14px',
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: loading || !input.trim() ? 0.6 : 1,
            textTransform: 'uppercase',
            transition: 'opacity 0.15s',
          }}
        >
          {loading ? '…' : '→ ANALYSER'}
        </button>
      </form>

      {/* Loader */}
      {loading && (
        <div style={{ fontSize: 11, color: C.accent, fontFamily: C.font, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ animation: 'pulse 1s infinite' }}>◈</span>
          Routage en cours via Mistral…
        </div>
      )}

      {/* Erreur */}
      {error && (
        <div style={{ background: '#1a0505', border: `1px solid ${C.red}40`, borderRadius: 2, padding: '8px 12px', fontSize: 12, color: C.red }}>
          ! {error}
        </div>
      )}

      {/* Résultat */}
      {response && !loading && <ResultCard response={response} />}
    </div>
  );
}
