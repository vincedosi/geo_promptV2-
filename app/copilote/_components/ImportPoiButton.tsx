'use client';

import { adminFetch } from '@/lib/admin-fetch';

/**
 * ImportPoiButton — Bouton d'import data.gouv GeoJSON → Supabase (table poi)
 *
 * Flux :
 *  1. Clic → dialogue inline pour confirmer la catégorie
 *  2. Appel streaming sur /api/admin/import-datagouv
 *  3. Affichage progression chunk par chunk
 *  4. Message de succès/erreur final
 */

import { useState, useRef } from 'react';

// ─── Types des événements NDJSON reçus du serveur ───────────────────────────

type StreamEvent =
  | { type: 'status'; message: string }
  | { type: 'warn'; message: string }
  | { type: 'existing'; count: number; categorie: string }
  | { type: 'total'; count: number; original: number; skipped: number }
  | { type: 'progress'; chunk: number; totalChunks: number; inserted: number; errors: number }
  | { type: 'done'; inserted: number; errors: number; total: number }
  | { type: 'error'; message: string };

// ─── Composant principal ─────────────────────────────────────────────────────

interface Props {
  geojsonUrl: string;
  /** Catégorie pré-remplie (ex: "bornes_recharge") */
  defaultCategorie?: string;
}

export function ImportPoiButton({ geojsonUrl, defaultCategorie = '' }: Props) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'loading' | 'done' | 'error'>('idle');
  const [categorie, setCategorie] = useState(defaultCategorie);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<{ chunk: number; total: number; inserted: number } | null>(null);
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const [result, setResult] = useState<{ inserted: number; errors: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // ─── Lancement de l'import ─────────────────────────────────────────────────

  async function startImport() {
    if (!categorie.trim()) return;

    setPhase('loading');
    setProgress(null);
    setExistingCount(null);
    setStatus('Initialisation...');
    setErrorMsg('');

    abortRef.current = new AbortController();

    try {
      const response = await adminFetch('/api/admin/import-datagouv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geojsonUrl, categorie: categorie.trim() }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Erreur serveur: ${response.status}`);
      }

      // Lecture NDJSON en streaming
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event: StreamEvent = JSON.parse(line);
            handleEvent(event);
          } catch {
            // Ligne malformée, on ignore
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      setPhase('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  // ─── Traitement des événements serveur ─────────────────────────────────────

  function handleEvent(event: StreamEvent) {
    switch (event.type) {
      case 'status':
        setStatus(event.message);
        break;
      case 'warn':
        setStatus(event.message);
        break;
      case 'existing':
        setExistingCount(event.count);
        break;
      case 'total':
        setStatus(`${event.count.toLocaleString('fr-FR')} points à importer${event.skipped > 0 ? ` (${event.skipped} non-Points ignorés)` : ''}`);
        break;
      case 'progress':
        setProgress({ chunk: event.chunk, total: event.totalChunks, inserted: event.inserted });
        setStatus(`Lot ${event.chunk}/${event.totalChunks} — ${event.inserted.toLocaleString('fr-FR')} insérés`);
        break;
      case 'done':
        setResult(event);
        setPhase('done');
        break;
      case 'error':
        setErrorMsg(event.message);
        setPhase('error');
        break;
    }
  }

  // ─── Rendu ─────────────────────────────────────────────────────────────────

  if (phase === 'idle') {
    return (
      <button
        onClick={() => setPhase('confirm')}
        style={{
          marginTop: 8,
          padding: '5px 12px',
          background: 'rgba(52,211,153,0.15)',
          border: '1px solid rgba(52,211,153,0.4)',
          borderRadius: 6,
          color: '#34d399',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'JetBrains Mono, monospace',
          letterSpacing: '0.02em',
          transition: 'background 0.2s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(52,211,153,0.25)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(52,211,153,0.15)')}
      >
        💾 Importer dans Supabase pour le Scoring
      </button>
    );
  }

  if (phase === 'confirm') {
    return (
      <div style={{
        marginTop: 8,
        padding: '10px 12px',
        background: 'rgba(52,211,153,0.08)',
        border: '1px solid rgba(52,211,153,0.3)',
        borderRadius: 8,
      }}>
        <div style={{ fontSize: 11, color: '#34d399', fontWeight: 700, marginBottom: 8, fontFamily: 'JetBrains Mono, monospace' }}>
          💾 Importer dans Supabase
        </div>

        {/* Catégorie */}
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>
            Catégorie (identifiant pour le scoring)
          </label>
          <input
            value={categorie}
            onChange={(e) => setCategorie(e.target.value)}
            placeholder="ex: bornes_recharge"
            style={{
              width: '100%',
              padding: '5px 8px',
              background: 'var(--bg-surface)',
              border: '0.5px solid var(--border-default)',
              borderRadius: 5,
              color: 'var(--text-primary)',
              fontSize: 12,
              fontFamily: 'JetBrains Mono, monospace',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>

        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 10, fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
          Source: {geojsonUrl.slice(0, 60)}{geojsonUrl.length > 60 ? '…' : ''}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={startImport}
            disabled={!categorie.trim()}
            style={{
              padding: '5px 14px',
              background: categorie.trim() ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(52,211,153,0.4)',
              borderRadius: 5,
              color: categorie.trim() ? '#34d399' : 'rgba(255,255,255,0.2)',
              fontSize: 11,
              fontWeight: 700,
              cursor: categorie.trim() ? 'pointer' : 'not-allowed',
              fontFamily: 'JetBrains Mono, monospace',
              transition: 'background 0.2s ease, color 0.2s ease',
            }}
          >
            Lancer l&apos;import
          </button>
          <button
            onClick={() => setPhase('idle')}
            style={{
              padding: '5px 10px',
              background: 'transparent',
              border: '0.5px solid var(--border-default)',
              borderRadius: 5,
              color: 'var(--text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
              transition: 'border-color 0.2s ease, color 0.2s ease',
            }}
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'loading') {
    const pct = progress ? Math.round((progress.chunk / progress.total) * 100) : 0;
    return (
      <div style={{
        marginTop: 8,
        padding: '10px 12px',
        background: 'rgba(96,165,250,0.08)',
        border: '1px solid rgba(96,165,250,0.25)',
        borderRadius: 8,
      }}>
        <div style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, marginBottom: 6, fontFamily: 'JetBrains Mono, monospace' }}>
          ⏳ Import en cours…
        </div>

        {existingCount !== null && existingCount > 0 && (
          <div style={{ fontSize: 10, color: '#fbbf24', marginBottom: 6, fontFamily: 'JetBrains Mono, monospace' }}>
            ⚠️ {existingCount.toLocaleString('fr-FR')} POIs &quot;{categorie}&quot; déjà en base (data_gouv)
          </div>
        )}

        {/* Barre de progression */}
        {progress && (
          <div style={{ marginBottom: 6 }}>
            <div style={{
              height: 4,
              background: 'rgba(255,255,255,0.1)',
              borderRadius: 2,
              overflow: 'hidden',
              marginBottom: 4,
            }}>
              <div style={{
                height: '100%',
                width: `${pct}%`,
                background: 'var(--brand-teal)',
                borderRadius: 2,
                transition: 'width 0.2s ease',
              }} />
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>
              Lot {progress.chunk}/{progress.total} — {pct}%
            </div>
          </div>
        )}

        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'JetBrains Mono, monospace' }}>
          {status}
        </div>

        <button
          onClick={() => { abortRef.current?.abort(); setPhase('idle'); }}
          style={{
            marginTop: 8,
            padding: '3px 10px',
            background: 'transparent',
            border: '0.5px solid var(--border-default)',
            borderRadius: 4,
            color: 'var(--text-secondary)',
            fontSize: 10,
            cursor: 'pointer',
            transition: 'border-color 0.2s ease',
          }}
        >
          Annuler
        </button>
      </div>
    );
  }

  if (phase === 'done' && result) {
    return (
      <div style={{
        marginTop: 8,
        padding: '10px 12px',
        background: 'rgba(52,211,153,0.1)',
        border: '1px solid rgba(52,211,153,0.35)',
        borderRadius: 8,
      }}>
        <div style={{ fontSize: 12, color: '#34d399', fontWeight: 700, marginBottom: 4 }}>
          ✅ Import réussi !
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
          <span style={{ color: '#34d399', fontWeight: 700 }}>{result.inserted.toLocaleString('fr-FR')}</span> points sont maintenant disponibles pour le calcul d&apos;isochrones.
          {result.errors > 0 && (
            <span style={{ color: '#fbbf24', marginLeft: 6 }}>({result.errors} erreurs)</span>
          )}
        </div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
          Catégorie : {categorie} · Source : data_gouv
        </div>
        <button
          onClick={() => { setPhase('idle'); setResult(null); }}
          style={{
            marginTop: 8,
            padding: '3px 10px',
            background: 'transparent',
            border: '0.5px solid rgba(52,211,153,0.3)',
            borderRadius: 4,
            color: '#34d399',
            fontSize: 10,
            cursor: 'pointer',
            transition: 'background 0.2s ease',
          }}
        >
          Fermer
        </button>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div style={{
        marginTop: 8,
        padding: '10px 12px',
        background: 'rgba(239,68,68,0.1)',
        border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: 8,
      }}>
        <div style={{ fontSize: 11, color: '#f87171', fontWeight: 700, marginBottom: 4 }}>
          ❌ Erreur d&apos;import
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-word' }}>
          {errorMsg}
        </div>
        <button
          onClick={() => { setPhase('confirm'); setErrorMsg(''); }}
          style={{
            marginTop: 8,
            padding: '3px 10px',
            background: 'transparent',
            border: '0.5px solid rgba(239,68,68,0.3)',
            borderRadius: 4,
            color: '#f87171',
            fontSize: 10,
            cursor: 'pointer',
            transition: 'background 0.2s ease',
          }}
        >
          Réessayer
        </button>
      </div>
    );
  }

  return null;
}
