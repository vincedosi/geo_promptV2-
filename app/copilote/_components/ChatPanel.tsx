import { FormEvent, useState } from 'react';
import Link from 'next/link';
import type { UIMessage } from 'ai';
import type { ZoneData, SavedMap } from '@/types/spatial';
import { ZoneCard } from './ZoneCard';
import { CoverageCard } from './CoverageCard';
import { TypingDots } from './TypingDots';
import { PromptsPanel } from './PromptsPanel';

interface ChatPanelProps {
  // Chat
  messages: UIMessage[];
  isLoading: boolean;
  input: string;
  setInput: (v: string) => void;
  handleSubmit: (e: FormEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  sendMessage: (text: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  // Rate limit
  rateLimitCooldown: number;
  cancelCooldown: () => void;
  // Error
  error: string | null;
  // Save/Load
  showSavePanel: boolean;
  showLoadPanel: boolean;
  setShowSavePanel: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowLoadPanel: (v: boolean | ((prev: boolean) => boolean)) => void;
  saveName: string;
  setSaveName: (v: string) => void;
  saveLoading: boolean;
  saveError: string | null;
  setSaveError: (v: string | null) => void;
  savedMaps: SavedMap[];
  saveCurrentMap: () => Promise<void>;
  loadSavedMaps: () => Promise<void>;
  loadMap: (id: string) => Promise<void>;
  deleteMap: (id: string) => Promise<void>;
  // Zone (for ZoneCard display)
  zoneData: ZoneData | null;
}

const runningToolLabels: Record<string, string> = {
  'tool-analyser_zone_pois':          '🔍 Recherche des établissements…',
  'tool-analyser_panneaux':           '📡 Recherche des panneaux OOH…',
  'tool-voronoi_analysis':            '⚡ Calcul du Voronoï…',
  'tool-afficher_carreaux':           '📊 Chargement des carreaux…',
  'tool-isochrone_battle':            '⚔️ Calcul Bataille d\'Isochrones (~1-2 min)…',
  'tool-calculate_audience_coverage': '🎯 Calcul de couverture audience…',
};

export function ChatPanel({
  messages, isLoading, input, setInput, handleSubmit, handleKeyDown, sendMessage,
  messagesEndRef, rateLimitCooldown, cancelCooldown, error,
  showSavePanel, showLoadPanel, setShowSavePanel, setShowLoadPanel,
  saveName, setSaveName, saveLoading, saveError, setSaveError,
  savedMaps, saveCurrentMap, loadSavedMaps, loadMap, deleteMap,
}: ChatPanelProps) {
  const [showPromptsPanel, setShowPromptsPanel] = useState(false);
  return (
    <div style={{ width: 400, minWidth: 360, display: 'flex', flexDirection: 'column', background: '#0f0f23', borderRight: '1px solid rgba(255,255,255,0.08)' }}>

      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link href="/map" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 20, lineHeight: 1, fontWeight: 300 }}>←</Link>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Copilote Media</span>
            <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', background: 'rgba(124,58,237,0.3)', color: '#a78bfa', padding: '2px 6px', borderRadius: 4 }}>BETA</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Mistral · function calling · poi_france</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => { setShowPromptsPanel(v => !v); setShowSavePanel(false); setShowLoadPanel(false); }}
            title="Prompts disponibles"
            style={{ background: showPromptsPanel ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.06)', border: `1px solid ${showPromptsPanel ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 7, padding: '5px 8px', color: showPromptsPanel ? '#a78bfa' : 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13, lineHeight: 1, fontWeight: 700 }}
          >?</button>
          <button
            onClick={() => { setShowSavePanel(v => !v); setShowLoadPanel(false); setShowPromptsPanel(false); setSaveError(null); }}
            title="Sauvegarder la carte actuelle"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '5px 8px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >💾</button>
          <button
            onClick={() => { setShowLoadPanel(v => !v); setShowSavePanel(false); setShowPromptsPanel(false); if (!showLoadPanel) loadSavedMaps(); }}
            title="Charger une carte sauvegardée"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '5px 8px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >📁</button>
        </div>
        {isLoading && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3dffa0', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />}
      </div>

      {/* Panel Prompts */}
      {showPromptsPanel && (
        <PromptsPanel sendMessage={sendMessage} onClose={() => setShowPromptsPanel(false)} />
      )}

      {/* Panel Sauvegarder */}
      {showSavePanel && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(124,58,237,0.08)' }}>
          <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600, marginBottom: 8 }}>💾 Sauvegarder cette carte</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveCurrentMap()}
              placeholder="Nom de la carte…"
              style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '7px 10px', color: '#fff', fontSize: 12, outline: 'none' }}
            />
            <button
              onClick={saveCurrentMap}
              disabled={saveLoading || !saveName.trim()}
              style={{ background: saveName.trim() && !saveLoading ? '#7c3aed' : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 7, padding: '7px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >{saveLoading ? '…' : 'Sauvegarder'}</button>
          </div>
          {saveError && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠ {saveError}</div>}
        </div>
      )}

      {/* Panel Charger */}
      {showLoadPanel && (
        <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)', maxHeight: 240, overflowY: 'auto' }}>
          <div style={{ padding: '10px 16px', fontSize: 12, color: '#a78bfa', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            📁 Cartes sauvegardées ({savedMaps.length})
          </div>
          {savedMaps.length === 0 ? (
            <div style={{ padding: '16px', fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>Aucune carte sauvegardée</div>
          ) : (
            savedMaps.map(m => (
              <div key={m.id} style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {m.ville && `📍 ${m.ville} · `}{m.nb_pois > 0 && `${m.nb_pois} POI · `}
                    {new Date(m.created_at).toLocaleDateString('fr-FR')}
                  </div>
                </div>
                <button onClick={() => loadMap(m.id)} style={{ background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)', borderRadius: 6, padding: '4px 10px', color: '#a78bfa', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>Charger</button>
                <button onClick={() => deleteMap(m.id)} title="Supprimer" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '4px 6px', color: '#f87171', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>🗑</button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 16px' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🗺️</div>
            <div style={{ color: '#fff', fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Décrivez votre cible</div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              Ex : <em>&ldquo;Lycées CSP+ à Lyon dans un rayon de 3km&rdquo;</em>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { icon: '📍', text: 'Lycées et CIRFA à Brest' },
                { icon: '📊', text: 'Lycées à Brest + où vivent les 18-24 ans' },
                { icon: '⏱', text: 'Isochrone 5 min à pied autour des lycées à Brest' },
                { icon: '⏱', text: 'Zone 15 min voiture autour des CIRFA de Lyon' },
              ].map(({ icon, text }) => (
                <button key={text} onClick={() => sendMessage(text)} style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, padding: '9px 12px', color: 'rgba(255,255,255,0.6)',
                  cursor: 'pointer', fontSize: 12, textAlign: 'left', transition: 'background 0.15s',
                }}>
                  {icon} {text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const textContent = msg.parts
            .filter(p => p.type === 'text')
            .map(p => (p as any).text as string)
            .join('');

          const zonePart = msg.role === 'assistant'
            ? (msg.parts as any[]).find(
                p => (p.type === 'tool-analyser_zone_pois' || p.type === 'tool-analyser_panneaux')
                  && p.state === 'output-available' && p.output?.coordonnees
              )
            : null;

          const coveragePart = msg.role === 'assistant'
            ? (msg.parts as any[]).find(
                p => p.type === 'tool-calculate_audience_coverage'
                  && p.state === 'output-available'
                  && p.output?.coverage_count !== undefined
                  && !p.output?.error
              )
            : null;

          const runningTool = msg.role === 'assistant'
            ? (msg.parts as any[]).find(
                p => p.type?.startsWith('tool-') && (p.state === 'input-streaming' || p.state === 'input-available')
              )
            : null;

          return (
            <div key={msg.id}>
              {msg.role === 'user' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ maxWidth: '82%', background: '#7c3aed', color: '#fff', borderRadius: '14px 14px 4px 14px', padding: '10px 14px', fontSize: 13, lineHeight: 1.5 }}>
                    {textContent}
                  </div>
                </div>
              )}

              {msg.role === 'assistant' && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(61,255,160,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, marginTop: 2 }}>🤖</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {runningTool && (
                      <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#a78bfa', marginBottom: 6, fontFamily: 'JetBrains Mono, monospace' }}>
                        {runningToolLabels[runningTool.type] ?? '⏳ Outil en cours…'}
                      </div>
                    )}
                    {zonePart && <ZoneCard zone={zonePart.output as ZoneData} />}
                    {coveragePart && (
                      <CoverageCard
                        locationName={coveragePart.output.location_name}
                        travelTimeMinutes={coveragePart.output.travel_time_minutes}
                        targetLabel={coveragePart.output.target_label}
                        coverageCount={coveragePart.output.coverage_count}
                        mode={coveragePart.output.mode}
                      />
                    )}
                    {textContent && (
                      <div style={{ marginTop: (zonePart || coveragePart) ? 10 : 0, background: 'rgba(255,255,255,0.05)', borderRadius: '4px 14px 14px 14px', padding: '10px 14px', fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 1.6 }}>
                        {textContent}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(61,255,160,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🤖</div>
            <TypingDots />
          </div>
        )}

        {rateLimitCooldown > 0 && (
          <div style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#fbbf24', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ animation: 'pulse 1s infinite' }}>⏱</span>
            Limite Mistral atteinte — retry automatique dans {rateLimitCooldown}s…
            <button
              onClick={cancelCooldown}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', fontSize: 11, opacity: 0.7 }}
            >Annuler</button>
          </div>
        )}

        {error && rateLimitCooldown === 0 && (
          <div style={{ background: 'rgba(255,87,87,0.1)', border: '1px solid rgba(255,87,87,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#ff5757', fontFamily: 'JetBrains Mono, monospace' }}>
            ⚠ Erreur : {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || rateLimitCooldown > 0}
            placeholder="Décrivez votre cible : ville, type d'établissement, rayon…"
            rows={2}
            style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, lineHeight: 1.5, resize: 'none', outline: 'none', fontFamily: 'inherit' }}
          />
          <button
            type="submit"
            disabled={isLoading || rateLimitCooldown > 0 || !input.trim()}
            style={{ background: input.trim() && !isLoading && !rateLimitCooldown ? '#7c3aed' : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10, padding: '10px 16px', color: input.trim() && !isLoading && !rateLimitCooldown ? '#fff' : 'rgba(255,255,255,0.3)', cursor: input.trim() && !isLoading && !rateLimitCooldown ? 'pointer' : 'not-allowed', fontSize: 18, lineHeight: 1, transition: 'background 0.2s', flexShrink: 0 }}
          >↑</button>
        </form>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 8, textAlign: 'center' }}>
          Entrée pour envoyer · Shift+Entrée pour nouvelle ligne
        </div>
      </div>
    </div>
  );
}
