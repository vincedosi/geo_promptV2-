import { FormEvent, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Send } from 'lucide-react';
import type { UIMessage } from 'ai';
import type { ZoneData, SavedMap } from '@/types/spatial';
import GeoBot, { type GeoBotStatus } from '@/components/ui/GeoBot';
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
  onFlyTo?: (lat: number, lng: number, zoom: number) => void;
  onHighlightIris?: (codeIris: string | null) => void;
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:        'var(--bg-surface)',
  bgSurface: 'var(--bg-surface)',
  bgElevated:'var(--bg-level-2)',
  border:    'var(--border-subtle)',
  text:      'var(--text-primary)',
  textSec:   'var(--text-secondary)',
  textDim:   'var(--text-tertiary)',
  green:     'var(--success)',
  teal:      'var(--brand-teal)',
  warning:   'var(--warning)',
  red:       'var(--danger)',
};

const fontOrbitron = "'Inter', system-ui, sans-serif";
const fontMichroma = "'Inter', system-ui, sans-serif";
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

// ─── Tool labels ──────────────────────────────────────────────────────────────
const runningToolLabels: Record<string, string> = {
  'tool-analyser_zone_pois':          'Recherche des établissements…',
  'tool-analyser_panneaux':           'Recherche des panneaux OOH…',
  'tool-voronoi_analysis':            'Calcul du Voronoï…',
  'tool-afficher_carreaux':           'Chargement des carreaux…',
  'tool-isochrone_battle':            'Calcul Bataille d\'Isochrones (~1-2 min)…',
  'tool-calculate_audience_coverage': 'Calcul de couverture audience…',
  'tool-analyze_poi_synergy':         'Analyse synergies POI × démographie…',
  'tool-analyse_correlation':         'Calcul corrélation IRIS × POI…',
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
  poi_clustering:   'var(--brand-teal)',
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
    if (!m) return <span style={{ fontSize: 11, color: C.textDim, fontFamily: fontMono }}>…</span>;
    const pct = m.limit > 0 ? m.remaining / m.limit : 0;
    const color = pct > 0.1 ? C.green : pct > 0.02 ? C.warning : C.red;
    const label = m.remaining <= 0 ? 'Quota épuisé' : `${m.remaining.toLocaleString('fr-FR')} tok`;
    return <span style={{ fontSize: 11, color, fontFamily: fontMono }}>{label}</span>;
  }
  const g = status.gemini;
  if (!g) return <span style={{ fontSize: 11, color: C.textDim, fontFamily: fontMono }}>…</span>;
  if (!g.keyPresent) return <span style={{ fontSize: 11, color: C.red, fontFamily: fontMono }}>Clé manquante</span>;
  return (
    <span style={{ fontSize: 11, fontFamily: fontMono }}>
      <span style={{ color: C.green }}>Clé OK</span>
      <span style={{ color: C.textDim }}> · </span>
      <span style={{ color: C.warning }}>billing requis</span>
    </span>
  );
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
  onFlyTo,
  onHighlightIris,
}: ChatPanelProps) {
  const [showPromptsPanel, setShowPromptsPanel] = useState(false);

  // ── Scroll-to-top ───────────────────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollToTop = () => scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

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
    background: active ? 'var(--text-primary)' : 'transparent',
    border: '0.5px solid var(--border-default)',
    borderRadius: 4,
    padding: '4px 9px',
    color: active ? 'var(--bg-primary)' : C.textSec,
    cursor: 'pointer' as const,
    fontSize: 12,
    lineHeight: 1,
    height: 28,
    transition: 'all 0.2s ease',
    fontFamily: fontInter,
  });

  const isDisabled = isLoading || smartPrompt.loading;

  // ── GeoBot status derived from chat state ─────────────────────────────────
  const [geoBotDone, setGeoBotDone] = useState(false);
  const prevLoadingRef = useRef(false);

  useEffect(() => {
    // Detect transition from loading → not loading (response complete)
    if (prevLoadingRef.current && !isLoading && !smartPrompt.loading) {
      setGeoBotDone(true);
      const timer = setTimeout(() => setGeoBotDone(false), 2000);
      return () => clearTimeout(timer);
    }
    prevLoadingRef.current = isLoading || smartPrompt.loading;
  }, [isLoading, smartPrompt.loading]);

  const geoBotStatus: GeoBotStatus = geoBotDone ? 'done'
    : (isLoading && messages.length > 0 && messages[messages.length - 1].role === 'assistant') ? 'speaking'
    : isLoading || smartPrompt.loading ? 'thinking'
    : 'idle';

  const geoBotStatusLabel = geoBotStatus === 'thinking' ? 'Analyse...'
    : geoBotStatus === 'speaking' ? 'Réponse en cours'
    : geoBotStatus === 'done' ? 'Terminé'
    : null;

  return (
    <div style={{ width: 400, minWidth: 300, minHeight: 0, display: 'flex', flexDirection: 'column', background: C.bg, borderRight: `0.5px solid ${C.border}`, position: 'relative', ...containerStyle }}>

      {/* ── Header ── */}
      {!hideHeader ? (
        <div style={{ padding: '14px 16px 12px', borderBottom: `0.5px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Link href="/map" style={{ color: C.textDim, textDecoration: 'none', fontSize: 16, lineHeight: 1, marginTop: 2, fontWeight: 300, transition: 'color 0.2s ease' }}>←</Link>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <GeoBot status={geoBotStatus} size={24} />
                <span style={{ fontSize: 14, fontFamily: fontMono, fontWeight: 500, color: C.teal }}>
                  geo.prompt
                </span>
                <span style={{ fontSize: 10, fontFamily: fontMono, background: 'var(--bg-level-3)', color: C.textSec, padding: '2px 5px', border: '0.5px solid var(--border-default)', borderRadius: 3 }}>BETA</span>
                {geoBotStatusLabel && (
                  <span style={{ fontSize: 10, fontFamily: fontMono, color: geoBotStatus === 'done' ? 'var(--success)' : C.teal }}>
                    {geoBotStatusLabel}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.textDim, fontFamily: fontMono, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{providerModel} · function calling</span>
                {sessionTokens && (
                  <span style={{ display: 'flex', gap: 4, color: C.textDim }}>
                    <span>↑{sessionTokens.input.toLocaleString('fr-FR')}</span>
                    <span>↓{sessionTokens.output.toLocaleString('fr-FR')}</span>
                    <span>tok</span>
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => { setShowPromptsPanel(v => !v); setShowSavePanel(false); setShowLoadPanel(false); }} title="Prompts disponibles" style={iconBtn(showPromptsPanel)}
                onMouseEnter={e => { if (!showPromptsPanel) { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = 'var(--bg-level-2)'; } }}
                onMouseLeave={e => { if (!showPromptsPanel) { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'transparent'; } }}
              >?</button>
              <button onClick={() => { setShowSavePanel(v => !v); setShowLoadPanel(false); setShowPromptsPanel(false); setSaveError(null); }} title="Sauvegarder" style={iconBtn(showSavePanel)}
                onMouseEnter={e => { if (!showSavePanel) { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = 'var(--bg-level-2)'; } }}
                onMouseLeave={e => { if (!showSavePanel) { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'transparent'; } }}
              >sv</button>
              <button onClick={() => { setShowLoadPanel(v => !v); setShowSavePanel(false); setShowPromptsPanel(false); if (!showLoadPanel) loadSavedMaps(); }} title="Charger" style={iconBtn(showLoadPanel)}
                onMouseEnter={e => { if (!showLoadPanel) { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = 'var(--bg-level-2)'; } }}
                onMouseLeave={e => { if (!showLoadPanel) { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'transparent'; } }}
              >ld</button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: '6px 12px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <GeoBot status={geoBotStatus} size={20} />
          {geoBotStatusLabel && (
            <span style={{ fontSize: 9, fontFamily: fontMono, color: geoBotStatus === 'done' ? 'var(--success)' : C.teal }}>
              {geoBotStatusLabel}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={() => { setShowPromptsPanel(v => !v); setShowSavePanel(false); setShowLoadPanel(false); }} title="Prompts" style={iconBtn(showPromptsPanel)}
            onMouseEnter={e => { if (!showPromptsPanel) { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = 'var(--bg-level-2)'; } }}
            onMouseLeave={e => { if (!showPromptsPanel) { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'transparent'; } }}
          >?</button>
          <button onClick={() => { setShowSavePanel(v => !v); setShowLoadPanel(false); setShowPromptsPanel(false); setSaveError(null); }} title="Sauvegarder" style={iconBtn(showSavePanel)}
            onMouseEnter={e => { if (!showSavePanel) { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = 'var(--bg-level-2)'; } }}
            onMouseLeave={e => { if (!showSavePanel) { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'transparent'; } }}
          >sv</button>
          <button onClick={() => { setShowLoadPanel(v => !v); setShowSavePanel(false); setShowPromptsPanel(false); if (!showLoadPanel) loadSavedMaps(); }} title="Charger" style={iconBtn(showLoadPanel)}
            onMouseEnter={e => { if (!showLoadPanel) { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = 'var(--bg-level-2)'; } }}
            onMouseLeave={e => { if (!showLoadPanel) { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'transparent'; } }}
          >ld</button>
          {sessionTokens && sessionTokens.total > 0 && (
            <span style={{ fontSize: 10, fontFamily: fontMono, color: C.textDim, marginLeft: 4 }}>
              ↑{sessionTokens.input.toLocaleString('fr-FR')} ↓{sessionTokens.output.toLocaleString('fr-FR')} tok
            </span>
          )}
        </div>
      )}

      {/* ── Provider selector + Smart toggle ── */}
      <div style={{ borderBottom: `0.5px solid ${C.border}`, background: C.bgSurface }}>
        {/* Ligne 1 : boutons IA + smart */}
        <div style={{ padding: '8px 16px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: C.textDim, fontFamily: fontInter, letterSpacing: '0.08em', textTransform: 'uppercase' as const, flexShrink: 0 }}>IA :</span>
          {([
            { id: 'mistral', label: 'Mistral' },
            { id: 'gemini',  label: 'Gemini'  },
          ] as Array<{ id: Provider; label: string }>).map(p => {
            const active = provider === p.id;
            return (
              <button key={p.id} onClick={() => setProvider(p.id)} style={{
                background: active ? 'rgba(78,205,196,0.08)' : 'transparent',
                border: `0.5px solid ${active ? C.teal : 'var(--border-default)'}`,
                borderRadius: 4, padding: '4px 10px',
                color: active ? C.teal : C.textSec,
                cursor: 'pointer', fontSize: 11, fontFamily: fontInter,
                fontWeight: active ? 500 : 400, transition: 'all 0.2s ease',
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
              background: smartMode === 'smart' ? 'rgba(78,205,196,0.08)' : 'transparent',
              border: `0.5px solid ${smartMode === 'smart' ? 'rgba(78,205,196,0.35)' : 'var(--border-default)'}`,
              borderRadius: 4, padding: '4px 8px',
              color: smartMode === 'smart' ? C.teal : C.textSec,
              cursor: 'pointer', fontSize: 11, fontFamily: fontInter,
              fontWeight: smartMode === 'smart' ? 500 : 400, transition: 'all 0.2s ease',
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
        <div style={{ padding: '12px 16px', borderBottom: `0.5px solid ${C.border}`, background: C.bg }}>
          <div style={{ fontSize: 10, fontFamily: fontInter, color: C.textSec, letterSpacing: '0.04em', marginBottom: 10 }}>Sauvegarder cette carte</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveCurrentMap()}
              placeholder="Nom de la carte…"
              style={{ flex: 1, background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 4, padding: '8px 10px', color: C.text, fontSize: 12, outline: 'none', fontFamily: fontInter }}
            />
            <button onClick={saveCurrentMap} disabled={saveLoading || !saveName.trim()} style={{ background: saveName.trim() && !saveLoading ? 'var(--text-primary)' : 'var(--border-subtle)', border: 'none', borderRadius: 4, padding: '8px 14px', color: saveName.trim() && !saveLoading ? 'var(--bg-primary)' : C.textDim, cursor: saveName.trim() && !saveLoading ? 'pointer' : 'default', fontSize: 11, fontWeight: 500, fontFamily: fontInter, transition: 'all 0.2s ease' }}>
              {saveLoading ? '…' : 'Sauver'}
            </button>
          </div>
          {saveError && <div style={{ fontSize: 10, color: C.red, marginTop: 6, fontFamily: fontMono }}>! {saveError}</div>}
        </div>
      )}

      {/* ── Panel Charger ── */}
      {showLoadPanel && (
        <div style={{ borderBottom: `0.5px solid ${C.border}`, background: C.bgSurface, maxHeight: 240, overflowY: 'auto' }}>
          <div style={{ padding: '10px 16px', fontSize: 10, fontFamily: fontInter, color: C.textSec, borderBottom: `0.5px solid ${C.border}` }}>
            Cartes sauvegardées ({savedMaps.length})
          </div>
          {savedMaps.length === 0 ? (
            <div style={{ padding: 16, fontSize: 11, color: C.textDim, textAlign: 'center', fontFamily: fontMono }}>// Aucune carte sauvegardée</div>
          ) : savedMaps.map(m => (
            <div key={m.id} style={{ padding: '8px 16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: fontInter }}>{m.name}</div>
                <div style={{ fontSize: 9, color: C.textSec, marginTop: 2, fontFamily: fontMono }}>
                  {m.ville && `${m.ville} · `}{m.nb_pois > 0 && `${m.nb_pois} POI · `}
                  {new Date(m.created_at).toLocaleDateString('fr-FR')}
                </div>
              </div>
              <button onClick={() => loadMap(m.id)} style={{ background: 'var(--border-subtle)', border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '4px 10px', color: C.textSec, cursor: 'pointer', fontSize: 11, fontFamily: fontInter, transition: 'all 0.2s ease' }}>Charger</button>
              <button onClick={() => deleteMap(m.id)} title="Supprimer" style={{ background: 'rgba(248,113,113,0.08)', border: '0.5px solid rgba(248,113,113,0.2)', borderRadius: 4, padding: '4px 7px', color: C.red, cursor: 'pointer', fontSize: 11 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Messages (flux unifié chat + smart) ── */}
      <div
        ref={scrollContainerRef}
        className="chat-messages"
        style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}
      >

        {/* Empty state supprimé — l'overlay AI affiche directement le chat
            sans landing screen. Les suggestions peuvent être ajoutées plus
            tard comme chips compacts sous l'input (non sous forme de cards). */}

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
                    <div style={{ maxWidth: '82%', background: 'var(--text-primary)', color: 'var(--bg-primary)', borderRadius: '12px 12px 2px 12px', padding: '10px 14px', fontSize: 13, lineHeight: 1.55, fontFamily: fontInter, fontWeight: 400 }}>
                      {textContent}
                    </div>
                  </div>
                )}
                {msg.role === 'assistant' && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flexShrink: 0, marginTop: 2 }}>
                      <GeoBot size={28} status={msg.id === messages[messages.length - 1]?.id ? geoBotStatus : 'idle'} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {runningTool && (
                        <div style={{ background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 4, padding: '8px 12px', fontSize: 10, color: C.textDim, marginBottom: 6, fontFamily: fontMono, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ animation: 'pulseDot 1s infinite', display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: C.green }} />
                          {runningToolLabels[(runningTool as { type: string }).type] ?? 'Outil en cours…'}
                        </div>
                      )}
                      {analysePart && <AnalyseCard output={analysePart.output} onFlyTo={onFlyTo} onHighlightIris={onHighlightIris} />}
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
                          <div style={{ marginTop: (zonePart || synergyPart || coveragePart || datagouvParts.length > 0) ? 10 : 0, borderLeft: '2px solid var(--brand-teal)', paddingLeft: 12, padding: '8px 14px 8px 12px', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.65, fontFamily: fontInter, fontWeight: 400 }}>
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
                <div style={{ maxWidth: '82%', background: 'var(--text-primary)', color: 'var(--bg-primary)', borderRadius: '12px 12px 2px 12px', padding: '10px 14px', fontSize: 13, lineHeight: 1.55, fontFamily: fontInter, fontWeight: 400 }}>
                  <span style={{ fontSize: 8, fontFamily: fontMichroma, color: C.teal, letterSpacing: 1.5, marginRight: 6 }}>⚡ SMART</span>
                  {sm.content}
                </div>
              </div>
            );
          }

          if (sm.type === 'smart_result') {
            return (
              <div key={item.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {/* Avatar Smart */}
                <div style={{ width: 26, height: 26, borderRadius: 2, background: 'rgba(78,205,196,0.1)', border: '1px solid rgba(78,205,196,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2, fontSize: 10 }}>
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
            <div style={{ flexShrink: 0 }}>
              <GeoBot size={28} status="thinking" />
            </div>
            <TypingDots />
          </div>
        )}

        {/* Loader Smart Prompt */}
        {smartPrompt.loading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 26, height: 26, borderRadius: 2, background: 'rgba(78,205,196,0.1)', border: '1px solid rgba(78,205,196,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10 }}>
              ⚡
            </div>
            <div style={{ background: 'rgba(78,205,196,0.06)', border: '1px solid rgba(78,205,196,0.2)', borderRadius: '2px 12px 12px 12px', padding: '10px 14px', fontSize: 12, color: C.teal, fontFamily: fontMono, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ animation: 'pulseDot 1s infinite', display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: C.teal }} />
              Routage intelligent en cours…
            </div>
          </div>
        )}

        {/* Rate limit */}
        {rateLimitCooldown > 0 && (
          <div style={{ background: 'rgba(247,183,49,0.08)', border: '0.5px solid rgba(247,183,49,0.25)', borderRadius: 4, padding: '10px 14px', fontSize: 10, color: C.warning, fontFamily: fontMono, display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '0.04em' }}>
            <span style={{ animation: 'pulseDot 1s infinite', display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: C.warning }} />
            Limite {providerName} — réessaie dans {rateLimitCooldown}s
            <button onClick={cancelCooldown} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.warning, cursor: 'pointer', fontSize: 9, opacity: 0.6, fontFamily: fontInter, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>Ignorer</button>
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

      {/* ── Barre scroll ── */}
      {(messages.length > 0 || smartMessages.length > 0) && (
        <div style={{
          flexShrink: 0, height: 22,
          borderTop: `1px solid ${C.border}`,
          borderBottom: `1px solid ${C.border}`,
          background: C.bgSurface,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 10px',
        }}>
          <button
            onClick={scrollToTop}
            title="Remonter en haut"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: C.textSec, fontSize: 11, fontFamily: fontMono,
              letterSpacing: '0.08em', padding: '0 4px', lineHeight: 1,
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            ↑ <span style={{ color: C.textDim, fontSize: 9 }}>haut</span>
          </button>
          <button
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            title="Descendre en bas"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: C.textDim, fontSize: 11, fontFamily: fontMono,
              letterSpacing: '0.08em', padding: '0 4px', lineHeight: 1,
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span style={{ fontSize: 9 }}>bas</span> ↓
          </button>
        </div>
      )}

      {/* ── Input ── */}
      <div style={{ padding: '12px 16px', borderTop: `0.5px solid ${C.border}` }}>
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
            style={{ flex: 1, background: C.bgElevated, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, lineHeight: 1.5, resize: 'none', outline: 'none', fontFamily: fontInter, fontWeight: 300, transition: 'border-color 0.3s ease' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
          />
          <button
            type="submit"
            disabled={isDisabled || !input.trim()}
            onMouseEnter={e => {
              if (input.trim() && !isDisabled) {
                e.currentTarget.style.background = 'var(--brand-teal-hover)';
                e.currentTarget.style.transform = 'scale(1.08)';
              }
            }}
            onMouseLeave={e => {
              if (input.trim() && !isDisabled) {
                e.currentTarget.style.background = C.teal;
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
            style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: input.trim() && !isDisabled ? C.teal : 'var(--border-subtle)',
              border: 'none',
              color: input.trim() && !isDisabled ? 'var(--bg-primary)' : C.textDim,
              cursor: input.trim() && !isDisabled ? 'pointer' : 'default',
              transition: 'all 0.15s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          ><Send size={16} strokeWidth={2} /></button>
        </form>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontSize: 9, color: smartMode === 'smart' ? C.teal : C.textDim, fontFamily: fontInter, fontWeight: 400, letterSpacing: '0.04em', transition: 'color 0.2s' }}>
            {smartMode === 'smart' ? '⚡ SMART — routeur multi-agents' :
             smartMode === 'auto'  ? '⚡ AUTO — détection par mots-clés' :
                                    'Entrée pour envoyer · Shift+Entrée pour saut de ligne'}
          </span>
          <span style={{ fontSize: 9, fontFamily: fontMono, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: C.textDim }}>↑{(sessionTokens?.input ?? 0).toLocaleString('fr-FR')}</span>
            <span style={{ color: C.textDim }}>↓{(sessionTokens?.output ?? 0).toLocaleString('fr-FR')}</span>
            <span style={{ color: C.textDim }}>tok</span>
          </span>
        </div>
      </div>

      {/* Chat animations defined in globals.css (pulseDot, bounce, slideUp) */}
    </div>
  );
}
