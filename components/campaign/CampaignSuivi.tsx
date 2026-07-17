'use client';

/**
 * CampaignSuivi — onglet « Suivi campagne » de l'overlay MAGELIAN.
 * Gauche : bilan (FinalReport si stratégie terminée, sinon KPI + état d'attente).
 * Droite : chat IA streaming sur les données de la campagne (historique éphémère,
 * envoyé au serveur à chaque tour — rien n'est persisté).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { FinalReport } from '@/app/custom-bidding/[strategyId]/_components/FinalReport';
import { parseAdjustProposal, type AdjustProposal } from '@/lib/campaigns/suivi-chat';
import type { SuiviPayload } from '@/lib/campaigns/suivi-metrics';
import { SuiviCockpit } from './suivi/SuiviCockpit';
import { SuiviCharts } from './suivi/SuiviCharts';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface Msg { role: 'user' | 'assistant'; content: string; pending?: boolean; proposal?: AdjustProposal | null }

const SUGGESTIONS = [
  'Quelles zones ont le mieux performé ?',
  'Résume les décisions de pilotage',
  'Où le budget a-t-il été le plus efficace ?',
  'Quelles zones sous-performent par rapport à leur population ?',
];

export function CampaignSuivi({ campaignId }: { campaignId: string }) {
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [strategyStatus, setStrategyStatus] = useState<string | null>(null);
  const [strategyLoaded, setStrategyLoaded] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cockpit de suivi en vol : payload agrégé serveur (rollups), un seul fetch.
  const [suivi, setSuivi] = useState<SuiviPayload | null>(null);
  const [suiviError, setSuiviError] = useState(false);
  const suiviFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!strategyId || strategyStatus === 'completed') return;
    if (suiviFetchedRef.current === campaignId) return;
    suiviFetchedRef.current = campaignId;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/digital/${campaignId}/suivi`, { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setSuiviError(true); return; }
        const d = (await res.json()) as SuiviPayload;
        if (!cancelled) setSuivi(d);
      } catch { if (!cancelled) setSuiviError(true); }
    })();
    return () => { cancelled = true; };
  }, [campaignId, strategyId, strategyStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await adminFetch('/api/bidding/strategies', { cache: 'no-store' });
        const d = r.ok ? await r.json() : { strategies: [] };
        const match = (d.strategies ?? []).find(
          (s: { campaign_id: string; status?: string }) => s.campaign_id === campaignId,
        );
        if (!cancelled) {
          setStrategyId(match?.id ?? null);
          setStrategyStatus(match?.status ?? null);
        }
      } catch { /* ignore */ }
      if (!cancelled) setStrategyLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = useCallback(async (text?: string) => {
    const txt = (text ?? input).trim();
    if (!txt || sending) return;
    setSending(true);
    setChatError(null);
    setInput('');
    // Historique éphémère : les tours précédents partent dans le body.
    // Bornes du endpoint (Zod) : max 40 tours, content ≤ 4000 chars.
    // Le serveur ne garde que les 20 derniers tours — inutile d'envoyer plus.
    const priorHistory = messages
      .filter((m) => !m.pending && m.content)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
      .slice(-20);
    setMessages((m) => [...m, { role: 'user', content: txt }, { role: 'assistant', content: '', pending: true }]);
    try {
      const res = await adminFetch(`/api/digital/${campaignId}/campaign-chat`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: txt, history: priorHistory }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: acc, pending: false };
          return copy;
        });
      }
      const tail = decoder.decode();
      if (tail) {
        acc += tail;
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: acc, pending: false };
          return copy;
        });
      }
      const { clean, proposal } = parseAdjustProposal(acc);
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: clean, pending: false, proposal };
        return copy;
      });
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
      setMessages((m) => m.filter((x) => !x.pending));
    } finally {
      setSending(false);
    }
  }, [campaignId, input, messages, sending]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
        {/* ── Colonne bilan ── */}
        <div style={{ flex: '1 1 380px', minWidth: 320 }}>
          <div style={{
            background: 'var(--bg-level-2)', borderTop: '1px solid var(--border-subtle)',
            padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
            <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: 'var(--text-primary)' }}>
              {strategyId && strategyStatus === 'completed' ? 'Bilan' : 'Suivi'}
            </span>
          </div>

          {!strategyLoaded ? (
            <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>Chargement…</div>
          ) : strategyId && strategyStatus === 'completed' ? (
            <FinalReport strategyId={strategyId} />
          ) : strategyId && suivi ? (
            <>
              <SuiviCockpit payload={suivi} />
              <SuiviCharts payload={suivi} />
            </>
          ) : strategyId && !suiviError ? (
            <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>
              Calcul du suivi…
            </div>
          ) : (
            <div style={{
              background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)',
              borderRadius: 8, padding: '20px 18px',
            }}>
              <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                {strategyId
                  ? 'Suivi indisponible pour le moment — réessaie en rouvrant l’onglet.'
                  : 'Aucune stratégie de bidding rattachée — le suivi en vol et le bilan sont disponibles pour les campagnes pilotées.'}
                {' '}En attendant, interroge la campagne via le chat ci-contre.
              </div>
            </div>
          )}
        </div>

        {/* ── Colonne chat ── */}
        <div style={{ flex: '1 1 380px', minWidth: 320, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            background: 'var(--bg-level-2)', borderTop: '1px solid var(--border-subtle)',
            padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)', flexShrink: 0 }} />
            <span style={{ fontFamily: fInter, fontWeight: 500, fontSize: 12, color: 'var(--text-primary)' }}>Interroger la campagne</span>
          </div>

          <div
            ref={scrollRef}
            style={{
              flex: 1, minHeight: 260, maxHeight: 420, overflowY: 'auto', padding: 12,
              background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)', borderRadius: 8,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
                <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 2 }}>
                  Pose une question sur ce qu&apos;il s&apos;est passé dans cette campagne :
                </div>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { void send(s); }}
                    disabled={sending}
                    style={{
                      textAlign: 'left', background: 'var(--bg-surface)',
                      border: '0.5px solid var(--border-subtle)', borderRadius: 8,
                      padding: '10px 12px', fontFamily: fInter, fontSize: 12,
                      color: 'var(--text-secondary)', cursor: sending ? 'not-allowed' : 'pointer',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--brand-teal-30)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: m.role === 'user' ? 'row' : 'column',
                  justifyContent: m.role === 'user' ? 'flex-end' : undefined,
                  alignItems: m.role === 'user' ? undefined : 'flex-start',
                }}
              >
                <div style={{
                  maxWidth: '85%', padding: '8px 12px', borderRadius: 8,
                  background: m.role === 'user' ? 'var(--brand-teal)' : 'var(--bg-surface)',
                  color: m.role === 'user' ? 'var(--bg-primary)' : 'var(--text-primary)',
                  border: m.role === 'user' ? 'none' : '0.5px solid var(--border-subtle)',
                  fontFamily: fInter, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                }}>
                  {m.content || (m.pending ? '…' : '')}
                </div>
                {m.role === 'assistant' && m.proposal && strategyId && strategyStatus === 'active' && (
                  <div style={{
                    marginTop: 6, border: '0.5px solid var(--brand-teal-30)', borderRadius: 8,
                    padding: '10px 12px', background: 'var(--bg-surface)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                      Proposition : {m.proposal.reason}
                    </span>
                    <button
                      type="button"
                      onClick={() => window.location.assign(`/map?campaign=${campaignId}&tab=creation`)}
                      style={{
                        background: 'transparent', border: '0.5px solid var(--brand-teal)', borderRadius: 6,
                        padding: '6px 12px', fontFamily: fInter, fontSize: 12, color: 'var(--brand-teal)', cursor: 'pointer',
                      }}
                    >
                      Modifier dans Programmer
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {chatError && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--danger)' }}>{chatError}</span>
              <button
                type="button"
                onClick={() => setChatError(null)}
                style={{
                  background: 'transparent', border: '0.5px solid var(--border-default)', borderRadius: 4,
                  padding: '2px 8px', fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', cursor: 'pointer',
                }}
              >
                ok
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              type="text"
              name="campaign-suivi-message"
              autoComplete="off"
              spellCheck={false}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              disabled={sending}
              placeholder="Pose une question sur la campagne…"
              style={{
                flex: 1, padding: '8px 12px', fontFamily: fInter, fontSize: 13,
                background: 'var(--bg-level-2)', color: 'var(--text-primary)',
                border: '0.5px solid var(--border-subtle)', borderRadius: 6, outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--brand-teal-50)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
            />
            <button
              type="button"
              onClick={() => { void send(); }}
              disabled={sending || !input.trim()}
              aria-label="Envoyer"
              style={{
                width: 36, height: 36, borderRadius: '50%', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: sending || !input.trim() ? 'var(--bg-level-2)' : 'var(--brand-teal)',
                color: sending || !input.trim() ? 'var(--text-tertiary)' : 'var(--bg-primary)',
                cursor: sending || !input.trim() ? 'not-allowed' : 'pointer', flexShrink: 0,
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
