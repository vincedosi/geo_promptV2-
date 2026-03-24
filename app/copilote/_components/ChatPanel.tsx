import { FormEvent, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import type { UIMessage } from 'ai';
import type { ZoneData, SavedMap } from '@/types/spatial';
import { ZoneCard }        from './ZoneCard';
import { CoverageCard }    from './CoverageCard';
import { SynergyResults }  from './SynergyResults';
import { TypingDots }      from './TypingDots';
import { PromptsPanel }    from './PromptsPanel';
import { ChatMarkdown }    from './ChatMarkdown';
import { DataGouvCard }    from './DataGouvCard';
import { AnalyseCard }     from './AnalyseCard';
import { useSmartPrompt }  from '../_hooks/useSmartPrompt';
import type { Provider, ProviderStatus } from '../_hooks/useProviderSelector';
import type { SmartPromptResponse, AgentName } from '@/lib/smart-prompt/types';

// ── SmartMessage : type union des éléments smart dans le flux ──────────────────
interface SmartMessage {
  id:        string;
  type:      'smart_prompt' | 'smart_result';
  content:   string;
  response?: SmartPromptResponse;
  timestamp: number;
}

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

// ─── Agent badges ─────────────────────────────────────────────────────────────
const AGENT_COLOR: Record<AgentName, string> = {
  demographie:      '#3dffa0',
  poi_clustering:   '#a855f7',
  panneaux:         '#fbbf24',
  isochrone_battle: '#38bdf8',
  benchmark:        '#f472b6',
  unknown:          '#f87171',
};

const AGENT_LABEL: Record<AgentName, string> = {
  demographie:      'DEMO',
  poi_clustering:   'CLUSTER',
  panneaux:         'OOH',
  isochrone_battle: 'ISO',
  benchmark:        'BENCH',
  unknown:          '?',
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

// ─── SmartResultCard : rendu inline d'un résultat Smart ──────────────────────
function SmartResultCard({ response }: { response: SmartPromptResponse }) {
  const { decision, result } = response;
  const agentColor = AGENT_COLOR[decision.agent] ?? C.textDim;
  const agentLabel = AGENT_LABEL[decision.agent] ?? decision.agent;

  return (
    <div style={{
      background: C.bgElevated,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${agentColor}`,
      borderRadius: '2px 12px 12px 2px',
      padding: '10px 14px',
      fontSize: 13,
      color: 'rgba(241,241,244,0.88)',
      lineHeight: 1.65,
      fontFamily: fontInter,
      fontWeight: 300,
    }}>
      {/* Badge agent */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          fontFamily: fontMichroma,
          fontSize: 8,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 1.5,
          color: agentColor,
          border: `1px solid ${agentColor}40`,
          borderRadius: 2,
          padding: '1px 5px',
        }}>
          ⚡ {agentLabel}
        </span>
        <span style={{ fontSize: 9, color: C.textDim, fontFamily: fontMono }}>
          {(decision.confidence * 100).toFixed(0)}% conf.
        </span>
        {!result.success && (
          <span style={{ fontSize: 9, color: C.red, marginLeft: 'auto' }}>! erreur</span>
        )}
      </div>

      {/* Contenu */}
      {result.markdown ? (
        <ChatMarkdown text={result.markdown} />
      ) : result.error ? (
        <span style={{ color: C.red, fontSize: 12 }}>! {result.error}</span>
      ) : (
        <span style={{ color: C.textDim, fontSize: 12 }}>Aucun résultat.</span>
      )}

      {/* Source info */}
      <div style={{ marginTop: 8, fontSize: 9, color: C.textDim, fontFamily: fontMono }}>
        {response.registry_used} sources · {decision.explication?.substring(0, 80)}
      </div>
    </div>
  );
}

// ─── Auto-detect Smart mode from keywords (zero LLM cost) ────────────────────
const SMART_KEYWORDS = [
  /\bpopulation\b/i,   /\bhabitants?\b/i,    /\bdémographie\b/i, /\bdemographie\b/i,
  /\brevenu[sx]?\b/i,  /\bsalaire[sx]?\b/i,  /\bménages?\b/i,    /\bmenages?\b/i,
  /\blogements?\b/i,   /\bpauvreté\b/i,       /\bpauvrete\b/i,
  /\bseniors?\b/i,     /\bpropriétaires?\b/i, /\blocataires?\b/i,
  /\bpanneaux?\b/i,    /\baffichage\b/i,      /\booh\b/i,         /\bdooh\b/i,
  /\bbenchmark\b/i,    /\bclustering\b/i,
  /\bstatistiques?\b/i,/\bcombien\b/i,
  /\bnombre (de|d')\b/i, /\bmédiane\b/i,      /\bmediane\b/i,
  /\b\d{1,2}[\s\-–]\d{1,2} ans\b/i,           // "18-24 ans" ou "18 24 ans"
  /\bsurface (moyenne|médiane)\b/i,
  /\b(familles? mono|monoparent)/i,
  // Ranking / classement
  /\bjeunes?\b/i,      /\bclassement\b/i,     /\bclasse[rz]?\b/i,
  /\btop\s*\d/i,       /\bliste[rz]?\b/i,     /\bplus (nombreux|élevé|fort|grand)/i,
  /\bvilles?\b.*\bind[_\s]/i,                  // "villes où ind_..."
  /\brang\b/i,         /\bpalmarès\b/i,
  /\b\d+\s+villes?\b/i,                        // "10 villes", "5 villes"
  /\bvilles?\s+(o[uù])\b/i,                    // "villes où", "villes ou"
  /\bplus de \d/i,                             // "plus de 18", "plus de 100 000"
  /\bles plus\b/i,                             // "les plus nombreux"
];

function detectSmartMode(text: string): boolean {
  return false; // V2 : SMART désactivé — tout passe par CHAT (system prompt v2 + 11 outils function calling)
  // eslint-disable-next-line no-unreachable
  return SMART_KEYWORDS.some(re => re.test(text));
}

type SmartModeState = 'auto' | 'smart' | 'chat';

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

  // ── Smart Prompt state ─────────────────────────────────────────────────────
  const [smartMode, setSmartMode]         = useState<SmartModeState>('auto');
  const [smartMessages, setSmartMessages] = useState<SmartMessage[]>([]);
  const smartIdRef                        = useRef(0);
  const smartPrompt                       = useSmartPrompt();

  const cycleSmartMode = useCallback(() => {
    setSmartMode(v => v === 'auto' ? 'smart' : v === 'smart' ? 'chat' : 'auto');
  }, []);

  // Auto-scroll quand un nouveau smartMessage arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [smartMessages, messagesEndRef]);

  // Handler d'envoi Smart
  const handleSmartSend = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const promptId = `sp-${++smartIdRef.current}`;
    const resultId = `sr-${++smartIdRef.current}`;

    // Bulle utilisateur
    setSmartMessages(prev => [...prev, {
      id:        promptId,
      type:      'smart_prompt',
      content:   text.trim(),
      timestamp: Date.now(),
    }]);

    // Appel routeur
    const response = await smartPrompt.submit(text.trim());

    // Bulle résultat
    setSmartMessages(prev => [...prev, {
      id:        resultId,
      type:      'smart_result',
      content:   response?.result?.markdown ?? response?.result?.error ?? '…',
      response:  response ?? undefined,
      timestamp: Date.now(),
    }]);
  }, [smartPrompt]);

  // Intercepteur de submit — route selon smartMode
  const onFormSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const useSmart = smartMode === 'smart' && false; // V2 : SMART désactivé — tout passe par CHAT (system prompt v2 + 11 outils function calling)

    if (useSmart) {
      handleSmartSend(input);
      setInput('');
    } else {
      handleSubmit(e);
    }
  }, [smartMode, input, handleSmartSend, handleSubmit, setInput]);

  // ── Flux unifié (chat + smart) trié par timestamp ─────────────────────────
  const allItems = useMemo(() => {
    const chatItems = messages.map((msg, i) => ({
      key:         msg.id ?? `chat-${i}`,
      kind:        'chat' as const,
      chatMessage: msg,
      timestamp:   Date.now() - (messages.length - i) * 500,
    }));
    const smartItems = smartMessages.map(sm => ({
      key:          sm.id,
      kind:         'smart' as const,
      smartMessage: sm,
      timestamp:    sm.timestamp,
    }));
    return [...chatItems, ...smartItems].sort((a, b) => a.timestamp - b.timestamp);
  }, [messages, smartMessages]);

  const providerName  = provider === 'mistral' ? 'Mistral' : 'Gemini';
  const providerModel = provider === 'mistral' ? 'mistral-small' : 'gemini-2.5-flash';

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

  const isDisabled = isLoading || smartPrompt.loading;

  return (
    <div style={{ width: 400, minWidth: 360, display: 'flex', flexDirection: 'column', background: C.bg, borderRight: `1px solid ${C.border}`, ...containerStyle }}>

      {/* ── Header ── */}
      {!hideHeader ? (
        <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${C.border}`, position: 'relative' }}>
          <div style={{ position: 'absolute', bottom: 0, left: 16, width: 40, height: 1, background: C.accent, boxShadow: `0 0 8px ${C.accentGlow}` }} />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Link href="/map" style={{ color: C.textDim, textDecoration: 'none', fontSize: 16, lineHeight: 1, marginTop: 2, fontWeight: 300, transition: 'color 0.15s' }}>←</Link>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontFamily: fontOrbitron, fontWeight: 700, color: C.text, letterSpacing: '0.14em' }}>
                  <span style={{ color: C.textDim }}>geo</span><span style={{ color: C.accent }}>.</span><span style={{ color: C.text }}>prompt</span>
                </span>
                <span style={{ fontSize: 8, fontFamily: fontMono, background: C.accentDim, color: C.accent, padding: '2px 5px', border: `1px solid ${C.borderLight}`, borderRadius: 2, letterSpacing: '0.1em' }}>BETA</span>
                {(isLoading || smartPrompt.loading) && (
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
          {(isLoading || smartPrompt.loading) && <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, boxShadow: `0 0 8px ${C.green}`, animation: 'pulseDot 1.2s ease-in-out infinite', display: 'inline-block', flexShrink: 0 }} />}
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

      {/* ── Provider selector + Smart toggle ── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, background: C.bgSurface }}>
        {/* Ligne 1 : boutons IA + smart */}
        <div style={{ padding: '8px 16px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: C.textDim, fontFamily: fontMichroma, letterSpacing: '0.14em', textTransform: 'uppercase', flexShrink: 0 }}>IA :</span>
          {([
            { id: 'mistral', label: 'Mistral', color: C.orange, bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.35)' },
            { id: 'gemini',  label: 'Gemini',  color: C.green,  bg: 'rgba(61,255,160,0.1)',  border: 'rgba(61,255,160,0.3)' },
          ] as Array<{ id: Provider; label: string; color: string; bg: string; border: string }>).map(p => {
            const active = provider === p.id;
            return (
              <button key={p.id} onClick={() => setProvider(p.id)} style={{
                background: active ? p.bg : 'transparent',
                border: `1px solid ${active ? p.border : C.border}`,
                borderRadius: 2, padding: '4px 10px',
                color: active ? p.color : C.textSec,
                cursor: 'pointer', fontSize: 9, fontFamily: fontInter,
                fontWeight: active ? 600 : 300, letterSpacing: '0.08em',
                textTransform: 'uppercase' as const, transition: 'all 0.15s',
              }}>{p.label}</button>
            );
          })}

          {/* Séparateur */}
          <div style={{ width: 1, height: 14, background: C.border, margin: '0 2px' }} />

          {/* Toggle Smart Prompt — cycle AUTO → SMART → CHAT */}
          <button
            onClick={cycleSmartMode}
            title={
              smartMode === 'smart' ? 'SMART forcé — clic → CHAT' :
              smartMode === 'chat'  ? 'CHAT forcé — clic → AUTO' :
                                     'AUTO — détection par mots-clés — clic → SMART'
            }
            style={{
              background:
                smartMode === 'smart' ? 'rgba(61,255,160,0.12)' :
                smartMode === 'auto'  ? 'rgba(168,85,247,0.08)' : 'transparent',
              border: `1px solid ${
                smartMode === 'smart' ? 'rgba(61,255,160,0.4)' :
                smartMode === 'auto'  ? 'rgba(168,85,247,0.3)' : C.border}`,
              borderRadius: 2, padding: '4px 8px',
              color:
                smartMode === 'smart' ? C.green :
                smartMode === 'auto'  ? C.accent : C.textSec,
              cursor: 'pointer', fontSize: 9, fontFamily: fontMichroma,
              fontWeight: smartMode !== 'chat' ? 600 : 300, letterSpacing: '0.12em',
              textTransform: 'uppercase' as const, transition: 'all 0.15s',
            }}
          >
            {smartMode === 'smart' ? '⚡ SMART' : smartMode === 'auto' ? '⚡ AUTO' : '⚡'}
          </button>
        </div>
        {/* Ligne 2 : statut provider */}
        <div style={{ padding: '0 16px 7px', display: 'flex', alignItems: 'center', gap: 4 }}>
          <ProviderBadge status={providerStatus} provider={provider} />
          <button onClick={refreshProviderStatus} disabled={statusLoading} title="Rafraîchir" style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 11, padding: 2, opacity: statusLoading ? 0.4 : 1 }}>↻</button>
        </div>
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

      {/* ── Messages (flux unifié chat + smart) ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Empty state */}
        {messages.length === 0 && smartMessages.length === 0 && (
          <div style={{ padding: '40px 8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {[
                { text: 'Lycées et CIRFA à Brest' },
                { text: 'Lycées à Brest + où vivent les 18-24 ans' },
                { text: "Zone piétonne 5 min autour des lycées à Brest" },
                { text: 'Zone 15 min voiture autour des CIRFA de Lyon' },
              ].map(({ text }) => (
                <button key={text} onClick={() => sendMessage(text)} style={{
                  background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 2,
                  padding: '9px 14px', color: '#c4c4d4', cursor: 'pointer', fontSize: 11,
                  textAlign: 'left', transition: 'border-color 0.15s, color 0.15s',
                  fontFamily: fontInter, fontWeight: 300, letterSpacing: '0.03em',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(168,85,247,0.4)'; e.currentTarget.style.color = '#e2e2f0'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = '#c4c4d4'; }}
                >{text}</button>
              ))}
            </div>
          </div>
        )}

        {/* Flux unifié */}
        {allItems.map(item => {

          // ── Message Chat classique ─────────────────────────────────────────
          if (item.kind === 'chat') {
            const msg = item.chatMessage;
            const textContent = msg.parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('');

            const zonePart = msg.role === 'assistant'
              ? (msg.parts as Array<{ type: string; state?: string; output?: Record<string, unknown> }>).find(p =>
                  (p.type === 'tool-analyser_zone_pois' || p.type === 'tool-analyser_panneaux') &&
                  p.state === 'output-available' && p.output?.coordonnees)
              : null;

            const coveragePart = msg.role === 'assistant'
              ? (msg.parts as Array<{ type: string; state?: string; output?: Record<string, unknown> }>).find(p =>
                  p.type === 'tool-calculate_audience_coverage' &&
                  p.state === 'output-available' &&
                  p.output?.coverage_count !== undefined && !p.output?.error)
              : null;

            const synergyPart = msg.role === 'assistant'
              ? (msg.parts as Array<{ type: string; state?: string; output?: Record<string, unknown> }>).find(p =>
                  p.type === 'tool-analyze_poi_synergy' &&
                  p.state === 'output-available' && p.output?._synergy)
              : null;

            const analysePart = msg.role === 'assistant'
              ? (msg.parts as Array<{ type: string; state?: string; output?: Record<string, unknown> }>).find(p =>
                  p.type === 'tool-analyse_complete' &&
                  p.state === 'output-available' && p.output?.type === 'analyse_complete')
              : null;

            const datagouvParts = msg.role === 'assistant'
              ? (msg.parts as Array<{ type: string; state?: string; output?: Record<string, unknown> }>).filter(p =>
                  ['tool-search_datasets','tool-get_dataset_info','tool-list_dataset_resources','tool-query_resource_data','tool-search_dataservices','tool-get_metrics'].includes(p.type) &&
                  p.state === 'output-available' && p.output && !p.output?.error)
              : [];

            const runningTool = msg.role === 'assistant'
              ? (msg.parts as Array<{ type?: string; state?: string }>).find(p =>
                  p.type?.startsWith('tool-') &&
                  (p.state === 'input-streaming' || p.state === 'input-available'))
              : null;

            return (
              <div key={item.key}>
                {msg.role === 'user' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{ maxWidth: '82%', background: C.accent, color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '10px 14px', fontSize: 13, lineHeight: 1.55, fontFamily: fontInter, fontWeight: 300, boxShadow: `0 2px 12px ${C.accentGlow}` }}>
                      {textContent}
                    </div>
                  </div>
                )}
                {msg.role === 'assistant' && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 2, background: C.accentDim, border: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {runningTool && (
                        <div style={{ background: C.accentDim, border: `1px solid ${C.borderLight}`, borderRadius: 2, padding: '8px 12px', fontSize: 10, color: C.accent, marginBottom: 6, fontFamily: fontMono, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ animation: 'pulseDot 1s infinite', display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: C.accent }} />
                          {runningToolLabels[(runningTool as { type: string }).type] ?? 'Outil en cours…'}
                        </div>
                      )}
                      {analysePart && <AnalyseCard output={analysePart.output} />}
                      {zonePart    && <ZoneCard zone={zonePart.output as unknown as ZoneData} />}
                      {synergyPart && <SynergyResults zoneData={synergyPart.output as unknown as ZoneData} />}
                      {datagouvParts.length > 0 && <DataGouvCard parts={datagouvParts as unknown as Parameters<typeof DataGouvCard>[0]['parts']} />}
                      {coveragePart && (
                        <CoverageCard
                          locationName={String(coveragePart.output?.location_name ?? '')}
                          travelTimeMinutes={Number(coveragePart.output?.travel_time_minutes ?? 0)}
                          targetLabel={String(coveragePart.output?.target_label ?? '')}
                          coverageCount={Number(coveragePart.output?.coverage_count ?? 0)}
                          mode={String(coveragePart.output?.mode ?? 'drive')}
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
          }

          // ── Message Smart ──────────────────────────────────────────────────
          const sm = item.smartMessage;

          if (sm.type === 'smart_prompt') {
            return (
              <div key={item.key} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ maxWidth: '82%', background: 'rgba(61,255,160,0.12)', color: C.text, border: '1px solid rgba(61,255,160,0.25)', borderRadius: '12px 12px 2px 12px', padding: '10px 14px', fontSize: 13, lineHeight: 1.55, fontFamily: fontInter, fontWeight: 300 }}>
                  <span style={{ fontSize: 8, fontFamily: fontMichroma, color: C.green, letterSpacing: 1.5, marginRight: 6 }}>⚡ SMART</span>
                  {sm.content}
                </div>
              </div>
            );
          }

          if (sm.type === 'smart_result') {
            return (
              <div key={item.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {/* Avatar Smart */}
                <div style={{ width: 26, height: 26, borderRadius: 2, background: 'rgba(61,255,160,0.1)', border: '1px solid rgba(61,255,160,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2, fontSize: 10 }}>
                  ⚡
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {sm.response
                    ? <SmartResultCard response={sm.response} />
                    : <div style={{ color: C.red, fontSize: 12, fontFamily: fontMono }}>! Aucune réponse</div>
                  }
                </div>
              </div>
            );
          }

          return null;
        })}

        {/* Loader chat classique */}
        {isLoading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 26, height: 26, borderRadius: 2, background: C.accentDim, border: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <TypingDots />
          </div>
        )}

        {/* Loader Smart Prompt */}
        {smartPrompt.loading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 26, height: 26, borderRadius: 2, background: 'rgba(61,255,160,0.1)', border: '1px solid rgba(61,255,160,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10 }}>
              ⚡
            </div>
            <div style={{ background: 'rgba(61,255,160,0.06)', border: '1px solid rgba(61,255,160,0.2)', borderRadius: '2px 12px 12px 12px', padding: '10px 14px', fontSize: 12, color: C.green, fontFamily: fontMono, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ animation: 'pulseDot 1s infinite', display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: C.green }} />
              Routage intelligent en cours…
            </div>
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

        {/* Erreur chat */}
        {error && rateLimitCooldown === 0 && (
          <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 2, padding: '10px 14px', fontSize: 10, color: C.red, fontFamily: fontMono, letterSpacing: '0.04em' }}>
            ! {error}
          </div>
        )}

        {/* Erreur Smart */}
        {smartPrompt.error && !smartPrompt.loading && (
          <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 2, padding: '10px 14px', fontSize: 10, color: C.red, fontFamily: fontMono, letterSpacing: '0.04em' }}>
            ! Smart Prompt — {smartPrompt.error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${smartMode === 'smart' ? 'rgba(61,255,160,0.3)' : C.border}`, transition: 'border-color 0.2s' }}>
        <form onSubmit={onFormSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              // Enter sans Shift → passe par onFormSubmit (smart routing)
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onFormSubmit(e as unknown as FormEvent);
              } else {
                handleKeyDown(e);
              }
            }}
            disabled={isDisabled}
            placeholder={
              smartMode === 'smart' ? 'Smart Prompt — ex: "Population à Brest", "Seniors en Bretagne"…' :
              smartMode === 'auto'  ? 'AUTO — Smart si données stat, Chat si carte/POI…' :
                                     'Décrivez votre cible : ville, type d\'établissement, rayon…'
            }
            rows={2}
            className="gp-input"
            style={{ flex: 1, background: C.bgSurface, border: `1px solid ${smartMode === 'smart' ? 'rgba(61,255,160,0.2)' : C.border}`, borderRadius: 2, padding: '10px 14px', color: C.text, fontSize: 13, lineHeight: 1.5, resize: 'none', outline: 'none', fontFamily: fontInter, fontWeight: 300, transition: 'border-color 0.2s, box-shadow 0.2s' }}
            onFocus={e => {
              const focusColor = smartMode === 'smart' ? 'rgba(61,255,160,0.5)' : 'rgba(168,85,247,0.5)';
              const focusShadow = smartMode === 'smart'
                ? '0 0 0 2px rgba(61,255,160,0.08), 0 0 16px rgba(61,255,160,0.1)'
                : '0 0 0 2px rgba(168,85,247,0.08), 0 0 16px rgba(168,85,247,0.1)';
              e.currentTarget.style.borderColor = focusColor;
              e.currentTarget.style.boxShadow   = focusShadow;
            }}
            onBlur={e => { e.currentTarget.style.borderColor = smartMode === 'smart' ? 'rgba(61,255,160,0.2)' : C.border; e.currentTarget.style.boxShadow = 'none'; }}
          />
          <button
            type="submit"
            disabled={isDisabled || !input.trim()}
            style={{
              background: input.trim() && !isDisabled
                ? (smartMode === 'smart' ? C.green : C.accent)
                : 'rgba(255,255,255,0.04)',
              border: `1px solid ${input.trim() && !isDisabled
                ? (smartMode === 'smart' ? 'rgba(61,255,160,0.5)' : 'rgba(168,85,247,0.5)')
                : C.border}`,
              borderRadius: 2, padding: '10px 14px',
              color: input.trim() && !isDisabled ? (smartMode === 'smart' ? '#000' : '#fff') : C.textDim,
              cursor: input.trim() && !isDisabled ? 'pointer' : 'not-allowed',
              fontSize: 16, lineHeight: 1, transition: 'all 0.2s', flexShrink: 0,
              boxShadow: input.trim() && !isDisabled
                ? `0 0 20px ${smartMode === 'smart' ? 'rgba(61,255,160,0.35)' : C.accentGlow}`
                : 'none',
            }}
          >↑</button>
        </form>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontSize: 9, color: smartMode === 'smart' ? C.green : smartMode === 'auto' ? C.accent : C.textDim, fontFamily: fontInter, fontWeight: 200, letterSpacing: '0.06em', transition: 'color 0.2s' }}>
            {smartMode === 'smart' ? '⚡ SMART — routeur multi-agents Mistral' :
             smartMode === 'auto'  ? '⚡ AUTO — détection par mots-clés' :
                                    'Entrée pour envoyer · Shift+Entrée pour saut de ligne'}
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
