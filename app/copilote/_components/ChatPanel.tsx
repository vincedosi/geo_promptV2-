import { FormEvent, useState, useEffect } from 'react';
import Link from 'next/link';
import type { UIMessage } from 'ai';
import type { ZoneData, SavedMap } from '@/types/spatial';
import { ZoneCard } from './ZoneCard';
import { CoverageCard } from './CoverageCard';
import { SynergyResults } from './SynergyResults';
import { TypingDots } from './TypingDots';
import { PromptsPanel } from './PromptsPanel';
import { ChatMarkdown } from './ChatMarkdown';
import { DataGouvCard } from './DataGouvCard';
import type { Provider, ProviderStatus } from '../_hooks/useProviderSelector';

interface ChatPanelProps {
  containerStyle?: React.CSSProperties;
  hideHeader?: boolean;
  messages: UIMessage[];
  isLoading: boolean;
  input: string;
  setInput: (v: string) => void;
  handleSubmit: (e: FormEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  sendMessage: (text: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  rateLimitCooldown: number;
  cancelCooldown: () => void;
  error: string | null;
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
  zoneData: ZoneData | null;
  provider: Provider;
  setProvider: (p: Provider) => void;
  providerStatus: ProviderStatus;
  statusLoading: boolean;
  refreshProviderStatus: () => void;
  sessionTokens?: { input: number; output: number; total: number };
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:           '#060608',
  bgSurface:    '#0a0a0e',
  bgElevated:   '#0f0f15',
  border:       '#261a35',
  borderLight:  'rgba(168,85,247,0.15)',
  accent:       '#a855f7',
  accentDim:    'rgba(168,85,247,0.12)',
  accentGlow:   'rgba(168,85,247,0.35)',
  green:        '#3dffa0',
  greenDim:     'rgba(61,255,160,0.12)',
  orange:       '#fbbf24',
  red:          '#f87171',
  text:         '#f1f1f4',
  textSec:      '#9090b8',
  textDim:      '#6b6b9a',
};

const fontOrbitron = "'Orbitron', sans-serif";
const fontMichroma = "'Michroma', sans-serif";
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', sans-serif";

// ─── Tool labels ──────────────────────────────────────────────────────────────
const runningToolLabels: Record<string, string> = {
  'tool-analyser_zone_pois':          'Recherche des établissements…',
  'tool-analyser_panneaux':           'Recherche des panneaux OOH…',
  'tool-voronoi_analysis':            'Calcul du Voronoï…',
  'tool-afficher_carreaux':           'Chargement des carreaux…',
  'tool-isochrone_battle':            'Calcul Bataille d\'Isochrones (~1-2 min)…',
  'tool-calculate_audience_coverage': 'Calcul de couverture audience…',
  'tool-analyze_poi_synergy':         'Analyse synergies POI × démographie…',
  'tool-search_datasets':             'Recherche sur data.gouv.fr…',
  'tool-get_dataset_info':            'Récupération fiche dataset…',
  'tool-list_dataset_resources':      'Liste des ressources…',
  'tool-query_resource_data':         'Interrogation des données…',
  'tool-search_dataservices':         'Recherche API data.gouv.fr…',
  'tool-get_metrics':                 'Métriques data.gouv.fr…',
};

// ─── ProviderBadge ────────────────────────────────────────────────────────────
function ProviderBadge({ status, provider }: { status: ProviderStatus; provider: Provider }) {
  if (provider === 'mistral') {
    const m = status.mistral;
    if (!m) return <span style={{ fontSize: 9, color: C.textDim }}>…</span>;
    const pct = m.limit > 0 ? m.remaining / m.limit : 0;
    const color = pct > 0.1 ? C.green : pct > 0.02 ? C.orange : C.red;
    const label = m.remaining <= 0 ? 'Quota épuisé' : `${m.remaining.toLocaleString('fr-FR')} tok`;
    return <span style={{ fontSize: 9, color, fontFamily: fontMono, letterSpacing: '0.04em' }}>{label}</span>;
  }
  const g = status.gemini;
  if (!g) return <span style={{ fontSize: 9, color: C.textDim }}>…</span>;
  const geminiLabel = !g.keyPresent ? 'Clé manquante' : 'Clé OK · billing requis';
  const geminiColor = !g.keyPresent ? C.red : C.orange;
  return <span style={{ fontSize: 9, color: geminiColor, fontFamily: fontMono }}>{geminiLabel}</span>;
}

// ─── ChatPanel ────────────────────────────────────────────────────────────────
export function ChatPanel({
  containerStyle,
  hideHeader,
  messages, isLoading, input, setInput, handleSubmit, handleKeyDown, sendMessage,
  messagesEndRef, rateLimitCooldown, cancelCooldown, error,
  showSavePanel, showLoadPanel, setShowSavePanel, setShowLoadPanel,
  saveName, setSaveName, saveLoading, saveError, setSaveError,
  savedMaps, saveCurrentMap, loadSavedMaps, loadMap, deleteMap,
  provider, setProvider, providerStatus, statusLoading, refreshProviderStatus,
  sessionTokens,
}: ChatPanelProps) {
  const [showPromptsPanel, setShowPromptsPanel] = useState(false);

  const providerName  = provider === 'mistral' ? 'Mistral' : 'Gemini';
  const providerModel = provider === 'mistral' ? 'mistral-small' : 'gemini-2.5-flash';

  // ── Icon bouton utilitaire
  const iconBtn = (active = false) => ({
    background: active ? C.accentDim : 'rgba(255,255,255,0.04)',
    border: `1px solid ${active ? C.borderLight : C.border}`,
    borderRadius: 2,
    padding: '5px 9px',
    color: active ? C.accent : C.textSec,
    cursor: 'pointer' as const,
    fontSize: 12,
    lineHeight: 1,
    transition: 'all 0.15s',
    fontFamily: fontInter,
  });

  return (
    <div style={{ width: 400, minWidth: 360, display: 'flex', flexDirection: 'column', background: C.bg, borderRight: `1px solid ${C.border}`, ...containerStyle }}>

      {/* ── Header ── */}
      {!hideHeader ? (
        <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${C.border}`, position: 'relative' }}>
          {/* Accent line */}
          <div style={{ position: 'absolute', bottom: 0, left: 16, width: 40, height: 1, background: C.accent, boxShadow: `0 0 8px ${C.accentGlow}` }} />

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Link href="/map" style={{ color: C.textDim, textDecoration: 'none', fontSize: 16, lineHeight: 1, marginTop: 2, fontWeight: 300, transition: 'color 0.15s' }}>←</Link>

            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontFamily: fontOrbitron, fontWeight: 700, color: C.text, letterSpacing: '0.14em' }}>
                  <span style={{ color: C.textDim }}>geo</span><span style={{ color: C.accent }}>.</span><span style={{ color: C.text }}>prompt</span>
                </span>
                <span style={{ fontSize: 8, fontFamily: fontMono, background: C.accentDim, color: C.accent, padding: '2px 5px', border: `1px solid ${C.borderLight}`, borderRadius: 2, letterSpacing: '0.1em' }}>
                  BETA
                </span>
                {isLoading && (
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, boxShadow: `0 0 8px ${C.green}`, animation: 'pulseDot 1.2s ease-in-out infinite', display: 'inline-block' }} />
                )}
              </div>
              <div style={{ fontSize: 9, color: C.textDim, fontFamily: fontMono, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{providerModel} · function calling</span>
                {sessionTokens && (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <span style={{ color: 'rgba(168,85,247,0.7)' }}>↑{sessionTokens.input.toLocaleString('fr-FR')}</span>
                    <span style={{ color: 'rgba(61,255,160,0.6)' }}>↓{sessionTokens.output.toLocaleString('fr-FR')}</span>
                    <span style={{ color: C.textDim }}>tok</span>
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 5 }}>
              <button onClick={() => { setShowPromptsPanel(v => !v); setShowSavePanel(false); setShowLoadPanel(false); }} title="Prompts disponibles" style={iconBtn(showPromptsPanel)}>?</button>
              <button onClick={() => { setShowSavePanel(v => !v); setShowLoadPanel(false); setShowPromptsPanel(false); setSaveError(null); }} title="Sauvegarder" style={iconBtn(showSavePanel)}>sv</button>
              <button onClick={() => { setShowLoadPanel(v => !v); setShowSavePanel(false); setShowPromptsPanel(false); if (!showLoadPanel) loadSavedMaps(); }} title="Charger" style={iconBtn(showLoadPanel)}>ld</button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: '6px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {isLoading && <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, boxShadow: `0 0 8px ${C.green}`, animation: 'pulseDot 1.2s ease-in-out infinite', display: 'inline-block', flexShrink: 0 }} />}
          <div style={{ flex: 1 }} />
          <button onClick={() => { setShowPromptsPanel(v => !v); setShowSavePanel(false); setShowLoadPanel(false); }} title="Prompts" style={iconBtn(showPromptsPanel)}>?</button>
          <button onClick={() => { setShowSavePanel(v => !v); setShowLoadPanel(false); setShowPromptsPanel(false); setSaveError(null); }} title="Sauvegarder" style={iconBtn(showSavePanel)}>sv</button>
          <button onClick={() => { setShowLoadPanel(v => !v); setShowSavePanel(false); setShowPromptsPanel(false); if (!showLoadPanel) loadSavedMaps(); }} title="Charger" style={iconBtn(showLoadPanel)}>ld</button>
          {sessionTokens && sessionTokens.total > 0 && (
            <span style={{ fontSize: 8, fontFamily: fontMono, color: C.textSec, marginLeft: 4 }}>
              <span style={{ color: 'rgba(168,85,247,0.8)' }}>↑{sessionTokens.input.toLocaleString('fr-FR')}</span>
              {' '}<span style={{ color: 'rgba(61,255,160,0.7)' }}>↓{sessionTokens.output.toLocaleString('fr-FR')}</span>
            </span>
          )}
        </div>
      )}

      {/* ── Provider selector ── */}
      <div style={{ padding: '8px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgSurface, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9, color: C.textDim, fontFamily: fontMichroma, letterSpacing: '0.14em', textTransform: 'uppercase', flexShrink: 0 }}>IA :</span>
        {([
          { id: 'mistral', label: 'Mistral', color: C.orange,  bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.35)' },
          { id: 'claude',  label: 'Claude',  color: '#818cf8', bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.35)' },
          { id: 'gemini',  label: 'Gemini',  color: C.green,   bg: 'rgba(61,255,160,0.1)',  border: 'rgba(61,255,160,0.3)' },
        ] as Array<{ id: Provider; label: string; color: string; bg: string; border: string }>).map(p => {
          const active = provider === p.id;
          return (
            <button key={p.id} onClick={() => setProvider(p.id)} style={{
              background: active ? p.bg : 'transparent',
              border: `1px solid ${active ? p.border : C.border}`,
              borderRadius: 2,
              padding: '4px 10px',
              color: active ? p.color : C.textSec,
              cursor: 'pointer',
              fontSize: 9,
              fontFamily: fontInter,
              fontWeight: active ? 600 : 300,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              transition: 'all 0.15s',
            }}>{p.label}</button>
          );
        })}
        <div style={{ flex: 1 }} />
        <ProviderBadge status={providerStatus} provider={provider} />
        <button onClick={refreshProviderStatus} disabled={statusLoading} title="Rafraîchir" style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 11, padding: 2, opacity: statusLoading ? 0.4 : 1 }}>↻</button>
      </div>

      {/* ── Panel Prompts ── */}
      {showPromptsPanel && <PromptsPanel sendMessage={sendMessage} onClose={() => setShowPromptsPanel(false)} />}

      {/* ── Panel Sauvegarder ── */}
      {showSavePanel && (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.accentDim }}>
          <div style={{ fontSize: 9, fontFamily: fontMichroma, color: C.accent, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>Sauvegarder cette carte</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveCurrentMap()}
              placeholder="Nom de la carte…"
              style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 2, padding: '8px 10px', color: C.text, fontSize: 12, outline: 'none', fontFamily: fontInter }}
            />
            <button onClick={saveCurrentMap} disabled={saveLoading || !saveName.trim()} style={{ background: saveName.trim() && !saveLoading ? C.accent : 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 2, padding: '8px 14px', color: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 600, fontFamily: fontInter, letterSpacing: '0.1em', textTransform: 'uppercase', boxShadow: saveName.trim() ? `0 0 16px ${C.accentGlow}` : 'none' }}>
              {saveLoading ? '…' : 'Sauver'}
            </button>
          </div>
          {saveError && <div style={{ fontSize: 10, color: C.red, marginTop: 6, fontFamily: fontMono }}>! {saveError}</div>}
        </div>
      )}

      {/* ── Panel Charger ── */}
      {showLoadPanel && (
        <div style={{ borderBottom: `1px solid ${C.border}`, background: C.bgSurface, maxHeight: 240, overflowY: 'auto' }}>
          <div style={{ padding: '10px 16px', fontSize: 9, fontFamily: fontMichroma, color: C.accent, letterSpacing: '0.14em', textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>
            Cartes sauvegardées ({savedMaps.length})
          </div>
          {savedMaps.length === 0 ? (
            <div style={{ padding: 16, fontSize: 11, color: C.textSec, textAlign: 'center', fontFamily: fontMono }}>// Aucune carte sauvegardée</div>
          ) : savedMaps.map(m => (
            <div key={m.id} style={{ padding: '8px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: fontInter }}>{m.name}</div>
                <div style={{ fontSize: 9, color: C.textSec, marginTop: 2, fontFamily: fontMono }}>
                  {m.ville && `${m.ville} · `}{m.nb_pois > 0 && `${m.nb_pois} POI · `}
                  {new Date(m.created_at).toLocaleDateString('fr-FR')}
                </div>
              </div>
              <button onClick={() => loadMap(m.id)} style={{ background: C.accentDim, border: `1px solid ${C.borderLight}`, borderRadius: 2, padding: '4px 10px', color: C.accent, cursor: 'pointer', fontSize: 9, fontFamily: fontInter, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Charger</button>
              <button onClick={() => deleteMap(m.id)} title="Supprimer" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 2, padding: '4px 7px', color: C.red, cursor: 'pointer', fontSize: 11 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Messages ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Empty state */}
        {messages.length === 0 && (
          <div style={{ padding: '40px 8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {[
                { text: 'Lycées et CIRFA à Brest' },
                { text: 'Lycées à Brest + où vivent les 18-24 ans' },
                { text: 'Isochrone 5 min à pied autour des lycées à Brest' },
                { text: 'Zone 15 min voiture autour des CIRFA de Lyon' },
              ].map(({ text }) => (
                <button key={text} onClick={() => sendMessage(text)} style={{
                  background: 'transparent',
                  border: `1px solid ${C.border}`,
                  borderRadius: 2,
                  padding: '9px 14px',
                  color: '#c4c4d4',
                  cursor: 'pointer',
                  fontSize: 11,
                  textAlign: 'left',
                  transition: 'border-color 0.15s, color 0.15s',
                  fontFamily: fontInter,
                  fontWeight: 300,
                  letterSpacing: '0.03em',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(168,85,247,0.4)'; e.currentTarget.style.color = '#e2e2f0'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = '#c4c4d4'; }}
                >{text}</button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => {
          const textContent = msg.parts.filter(p => p.type === 'text').map(p => (p as any).text as string).join('');

          const zonePart = msg.role === 'assistant'
            ? (msg.parts as any[]).find(p => (p.type === 'tool-analyser_zone_pois' || p.type === 'tool-analyser_panneaux') && p.state === 'output-available' && p.output?.coordonnees)
            : null;

          const coveragePart = msg.role === 'assistant'
            ? (msg.parts as any[]).find(p => p.type === 'tool-calculate_audience_coverage' && p.state === 'output-available' && p.output?.coverage_count !== undefined && !p.output?.error)
            : null;

          const synergyPart = msg.role === 'assistant'
            ? (msg.parts as any[]).find(p => p.type === 'tool-analyze_poi_synergy' && p.state === 'output-available' && p.output?._synergy)
            : null;

          const datagouvParts = msg.role === 'assistant'
            ? (msg.parts as any[]).filter(p => ['tool-search_datasets','tool-get_dataset_info','tool-list_dataset_resources','tool-query_resource_data','tool-search_dataservices','tool-get_metrics'].includes(p.type) && p.state === 'output-available' && p.output && !p.output?.error)
            : [];

          const runningTool = msg.role === 'assistant'
            ? (msg.parts as any[]).find(p => p.type?.startsWith('tool-') && (p.state === 'input-streaming' || p.state === 'input-available'))
            : null;

          return (
            <div key={msg.id}>
              {/* User message */}
              {msg.role === 'user' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ maxWidth: '82%', background: C.accent, color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '10px 14px', fontSize: 13, lineHeight: 1.55, fontFamily: fontInter, fontWeight: 300, boxShadow: `0 2px 12px ${C.accentGlow}` }}>
                    {textContent}
                  </div>
                </div>
              )}

              {/* Assistant message */}
              {msg.role === 'assistant' && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {/* Avatar */}
                  <div style={{ width: 26, height: 26, borderRadius: 2, background: C.accentDim, border: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Running tool indicator */}
                    {runningTool && (
                      <div style={{ background: C.accentDim, border: `1px solid ${C.borderLight}`, borderRadius: 2, padding: '8px 12px', fontSize: 10, color: C.accent, marginBottom: 6, fontFamily: fontMono, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ animation: 'pulseDot 1s infinite', display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: C.accent }} />
                        {runningToolLabels[runningTool.type] ?? 'Outil en cours…'}
                      </div>
                    )}

                    {zonePart      && <ZoneCard zone={zonePart.output as ZoneData} />}
                    {synergyPart   && <SynergyResults zoneData={synergyPart.output as ZoneData} />}
                    {datagouvParts.length > 0 && <DataGouvCard parts={datagouvParts as any} />}
                    {coveragePart  && (
                      <CoverageCard
                        locationName={coveragePart.output.location_name}
                        travelTimeMinutes={coveragePart.output.travel_time_minutes}
                        targetLabel={coveragePart.output.target_label}
                        coverageCount={coveragePart.output.coverage_count}
                        mode={coveragePart.output.mode}
                      />
                    )}

                    {textContent && (() => {
                      const isRawMcpOutput = datagouvParts.length > 0 && (
                        textContent.startsWith('Found ') ||
                        (textContent.includes('ID:') && textContent.includes('Organization:') && textContent.includes('URL: https://www.data.gouv.fr'))
                      );
                      if (isRawMcpOutput) return null;
                      return (
                        <div style={{ marginTop: (zonePart || synergyPart || coveragePart || datagouvParts.length > 0) ? 10 : 0, background: C.bgElevated, border: `1px solid ${C.border}`, borderRadius: '2px 12px 12px 12px', padding: '10px 14px', fontSize: 13, color: 'rgba(241,241,244,0.88)', lineHeight: 1.65, fontFamily: fontInter, fontWeight: 300 }}>
                          <ChatMarkdown text={textContent} />
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Loading indicator */}
        {isLoading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 26, height: 26, borderRadius: 2, background: C.accentDim, border: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <TypingDots />
          </div>
        )}

        {/* Rate limit */}
        {rateLimitCooldown > 0 && (
          <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 2, padding: '10px 14px', fontSize: 10, color: C.orange, fontFamily: fontMono, display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '0.04em' }}>
            <span style={{ animation: 'pulseDot 1s infinite', display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: C.orange }} />
            Limite {providerName} — réessaie dans {rateLimitCooldown}s
            <button onClick={cancelCooldown} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.orange, cursor: 'pointer', fontSize: 9, opacity: 0.6, fontFamily: fontInter, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ignorer</button>
          </div>
        )}

        {/* Error */}
        {error && rateLimitCooldown === 0 && (
          <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 2, padding: '10px 14px', fontSize: 10, color: C.red, fontFamily: fontMono, letterSpacing: '0.04em' }}>
            ! {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}` }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Décrivez votre cible : ville, type d'établissement, rayon…"
            rows={2}
            className="gp-input"
            style={{ flex: 1, background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: '10px 14px', color: C.text, fontSize: 13, lineHeight: 1.5, resize: 'none', outline: 'none', fontFamily: fontInter, fontWeight: 300, transition: 'border-color 0.2s, box-shadow 0.2s' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(168,85,247,0.5)'; e.currentTarget.style.boxShadow = `0 0 0 2px rgba(168,85,247,0.08), 0 0 16px rgba(168,85,247,0.1)`; }}
            onBlur={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = 'none'; }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            style={{
              background: input.trim() && !isLoading ? C.accent : 'rgba(255,255,255,0.04)',
              border: `1px solid ${input.trim() && !isLoading ? 'rgba(168,85,247,0.5)' : C.border}`,
              borderRadius: 2,
              padding: '10px 14px',
              color: input.trim() && !isLoading ? '#fff' : C.textDim,
              cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed',
              fontSize: 16,
              lineHeight: 1,
              transition: 'all 0.2s',
              flexShrink: 0,
              boxShadow: input.trim() && !isLoading ? `0 0 20px ${C.accentGlow}` : 'none',
            }}
          >↑</button>
        </form>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontSize: 9, color: C.textDim, fontFamily: fontInter, fontWeight: 200, letterSpacing: '0.06em' }}>
            Entrée pour envoyer · Shift+Entrée pour saut de ligne
          </span>
          <span style={{ fontSize: 9, fontFamily: fontMono, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: C.textDim }}>session</span>
            <span style={{ color: 'rgba(168,85,247,0.7)' }}>↑{(sessionTokens?.input ?? 0).toLocaleString('fr-FR')}</span>
            <span style={{ color: 'rgba(61,255,160,0.6)' }}>↓{(sessionTokens?.output ?? 0).toLocaleString('fr-FR')}</span>
            <span style={{ color: C.textDim }}>tok</span>
          </span>
        </div>
      </div>

      <style>{`
        @keyframes pulseDot { 0%,100%{opacity:1;box-shadow:0 0 8px currentColor} 50%{opacity:0.4;box-shadow:none} }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        .gp-input::placeholder { color: #6b6b9a !important; }
      `}</style>
    </div>
  );
}
