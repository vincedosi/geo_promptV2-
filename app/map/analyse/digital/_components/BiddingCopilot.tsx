'use client';

import { adminFetch } from '@/lib/admin-fetch';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';

const fInter = "'Inter', sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface BreakdownRow {
  code: string;
  nom: string;
  impressions: number;
  pop_value: number;
  pct_imp: number;
  pct_pop: number;
  ecart: number;
}

interface CoefficientRow {
  code: string;
  nom: string;
  coeff: number;
  ecart_avant: number;
  ratio_apres_estime?: number;
}

interface SimulationRow {
  code: string;
  nom: string;
  ratio_avant: number;
  ratio_apres: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface BiddingCopilotProps {
  campaignId: string;
  campaignName?: string;
  indicator: string;
  breakdown: BreakdownRow[];
  metric: 'impressions' | 'unique';
  aggregation: 'region' | 'dept' | 'cp';
}

export function BiddingCopilot({ campaignId, campaignName, indicator, breakdown, metric, aggregation }: BiddingCopilotProps) {
  const initialPrompt = useMemo(() => {
    if (!breakdown.length) return null;
    const surServis = [...breakdown].filter(z => z.ecart > 0).sort((a, b) => b.ecart - a.ecart).slice(0, 3);
    const sousServis = [...breakdown].filter(z => z.ecart < 0).sort((a, b) => a.ecart - b.ecart).slice(0, 3);
    const surLine = surServis.length > 0
      ? `**Sur-servis :** ${surServis.map(z => `${z.nom} (+${z.ecart.toFixed(1)})`).join(', ')}`
      : '';
    const sousLine = sousServis.length > 0
      ? `**Sous-servis :** ${sousServis.map(z => `${z.nom} (${z.ecart.toFixed(1)})`).join(', ')}`
      : '';
    return `D'apres l'analyse de votre campagne, la distribution geographique montre :\n\n${surLine}\n${sousLine}\n\nQue souhaitez-vous optimiser ?`;
  }, [breakdown]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coefficients, setCoefficients] = useState<CoefficientRow[] | null>(null);
  const [codeDv360, setCodeDv360] = useState<string | null>(null);
  const [codeAdform, setCodeAdform] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SimulationRow[] | null>(null);
  const [codeTab, setCodeTab] = useState<'dv360' | 'adform'>('dv360');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(initialPrompt ? [{ role: 'assistant', content: initialPrompt }] : []);
    setCoefficients(null);
    setCodeDv360(null);
    setCodeAdform(null);
    setSimulation(null);
    setError(null);
  }, [campaignId, initialPrompt]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await adminFetch(`/api/digital/${campaignId}/bidding-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages,
          context: {
            campaign_name: campaignName,
            indicator,
            breakdown,
            metric,
            aggregation,
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? '' }]);
      if (data.coefficients) setCoefficients(data.coefficients);
      if (data.code_dv360) setCodeDv360(data.code_dv360);
      if (data.code_adform) setCodeAdform(data.code_adform);
      if (data.simulation) setSimulation(data.simulation);
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [campaignId, campaignName, indicator, breakdown, metric, aggregation, messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const suggestions = useMemo(() => {
    const sorted = [...breakdown];
    const topSurServi = sorted.filter(z => z.ecart > 0).sort((a, b) => b.ecart - a.ecart)[0];
    const topSousServi = sorted.filter(z => z.ecart < 0).sort((a, b) => a.ecart - b.ecart)[0];
    const list: string[] = ['Uniformiser la distribution'];
    if (topSousServi) list.push(`Renforcer ${topSousServi.nom}`);
    if (topSurServi) list.push(`Reduire la pression en ${topSurServi.nom}`);
    if (aggregation === 'region') list.push('Optimiser par departement');
    return list;
  }, [breakdown, aggregation]);

  const showSuggestions = messages.length <= 1 && !loading;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const downloadCode = (text: string, filename: string) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeCode = codeTab === 'dv360' ? codeDv360 : codeAdform;
  const activeFilename = codeTab === 'dv360' ? 'bidding_dv360.py' : 'bidding_adform.json';

  if (!breakdown.length) return null;

  return (
    <div style={{ background: '#111111', border: '0.5px solid #1a1a1a', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ecdc4' }} />
        <span style={{ fontFamily: fInter, fontSize: 13, fontWeight: 600, color: '#f0f0f0' }}>Copilote bidding</span>
        <span style={{ fontFamily: fInter, fontSize: 10, color: '#666666', marginLeft: 6 }}>
          chat Gemini + generation de code
        </span>
      </div>

      {/* Chat messages */}
      <div style={{ maxHeight: 360, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {msg.role === 'assistant' ? (
              <div style={{ display: 'flex', gap: 10, maxWidth: '90%' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 4, background: 'rgba(78,205,196,0.1)',
                  border: '0.5px solid rgba(78,205,196,0.3)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0, fontFamily: fMono, fontSize: 10, color: '#4ecdc4', fontWeight: 600,
                }}>G</div>
                <div style={{ fontFamily: fInter, fontSize: 12, lineHeight: 1.6, color: '#d0d0d0', whiteSpace: 'pre-wrap' }}>
                  {msg.content.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                    part.startsWith('**') && part.endsWith('**')
                      ? <strong key={j} style={{ color: '#4ecdc4', fontWeight: 600 }}>{part.slice(2, -2)}</strong>
                      : <span key={j}>{part}</span>
                  )}
                </div>
              </div>
            ) : (
              <div style={{
                background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 12px',
                fontFamily: fInter, fontSize: 12, color: '#f0f0f0', maxWidth: '85%', lineHeight: 1.5,
              }}>{msg.content}</div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontFamily: fInter, fontSize: 11, color: '#4ecdc4' }}>
            <span style={{
              display: 'inline-block', width: 10, height: 10,
              border: '1.5px solid #4ecdc4', borderTopColor: 'transparent',
              borderRadius: '50%', animation: 'bc-spin 0.8s linear infinite',
            }} />
            Gemini reflechit...
          </div>
        )}
        {error && (
          <div style={{ fontFamily: fInter, fontSize: 11, color: '#ff5757', padding: '6px 10px', background: 'rgba(255,87,87,0.08)', borderRadius: 4 }}>
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions pills */}
      {showSuggestions && (
        <div style={{ padding: '0 20px 12px 20px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                padding: '5px 10px', fontFamily: fInter, fontSize: 10, cursor: 'pointer',
                background: 'rgba(78,205,196,0.06)', border: '0.5px solid rgba(78,205,196,0.3)',
                borderRadius: 12, color: '#4ecdc4',
              }}
            >{s}</button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '0.5px solid #1a1a1a', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Decrivez votre objectif d'optimisation..."
          rows={1}
          style={{
            flex: 1, background: '#0a0a0a', border: '0.5px solid rgba(255,255,255,0.1)',
            borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 12, color: '#f0f0f0',
            outline: 'none', resize: 'none', minHeight: 34, maxHeight: 120,
          }}
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            padding: '8px 16px', fontFamily: fInter, fontSize: 11, fontWeight: 500,
            cursor: (loading || !input.trim()) ? 'default' : 'pointer',
            background: (loading || !input.trim()) ? 'rgba(78,205,196,0.04)' : 'rgba(78,205,196,0.1)',
            border: '0.5px solid #4ecdc4', borderRadius: 6,
            color: (loading || !input.trim()) ? 'rgba(78,205,196,0.4)' : '#4ecdc4',
          }}
        >Envoyer</button>
      </div>

      {/* Coefficients recap */}
      {coefficients && coefficients.length > 0 && (
        <div style={{ borderTop: '0.5px solid #1a1a1a', padding: '12px 16px' }}>
          <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: '#4ecdc4', marginBottom: 8 }}>
            Coefficients proposes
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {coefficients.map(c => (
              <div key={c.code} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                padding: '4px 8px', background: '#0a0a0a', borderRadius: 4, border: '0.5px solid #1a1a1a',
              }}>
                <span style={{ fontFamily: fInter, fontSize: 10, color: '#a0a0a0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.nom}
                </span>
                <span style={{
                  fontFamily: fMono, fontSize: 11, fontWeight: 700,
                  color: c.coeff > 1.05 ? '#3dffa0' : c.coeff < 0.95 ? '#ff5757' : '#8a8a8a',
                }}>{c.coeff.toFixed(2)}x</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Code tabs */}
      {(codeDv360 || codeAdform) && (
        <div style={{ borderTop: '0.5px solid #1a1a1a' }}>
          <div style={{ display: 'flex', borderBottom: '0.5px solid #1a1a1a' }}>
            {([['dv360', 'DV360'], ['adform', 'Adform']] as const).map(([id, label]) => {
              const disabled = (id === 'dv360' && !codeDv360) || (id === 'adform' && !codeAdform);
              return (
                <button
                  key={id}
                  onClick={() => !disabled && setCodeTab(id)}
                  disabled={disabled}
                  style={{
                    padding: '8px 16px', fontFamily: fInter, fontSize: 11, cursor: disabled ? 'default' : 'pointer',
                    background: codeTab === id ? '#0a0a0a' : 'transparent',
                    border: 'none',
                    borderBottom: codeTab === id ? '2px solid #4ecdc4' : '2px solid transparent',
                    color: disabled ? '#333333' : codeTab === id ? '#4ecdc4' : '#666666',
                    opacity: disabled ? 0.5 : 1,
                  }}
                >{label}</button>
              );
            })}
            <div style={{ flex: 1 }} />
            {activeCode && (
              <div style={{ display: 'flex', gap: 4, padding: '6px 10px' }}>
                <button
                  onClick={() => copyToClipboard(activeCode)}
                  style={{
                    padding: '4px 10px', fontFamily: fInter, fontSize: 10, cursor: 'pointer',
                    background: 'transparent', border: '0.5px solid #262626', borderRadius: 4, color: '#a0a0a0',
                  }}
                >Copier</button>
                <button
                  onClick={() => downloadCode(activeCode, activeFilename)}
                  style={{
                    padding: '4px 10px', fontFamily: fInter, fontSize: 10, cursor: 'pointer',
                    background: 'transparent', border: '0.5px solid #262626', borderRadius: 4, color: '#a0a0a0',
                  }}
                >Telecharger</button>
              </div>
            )}
          </div>
          <pre style={{
            margin: 0, padding: '14px 16px', background: '#0d0d14', fontFamily: fMono, fontSize: 11,
            lineHeight: 1.5, color: '#d0d0d0', overflowX: 'auto', maxHeight: 260,
          }}>{activeCode ?? '(pas de code disponible pour cette regie)'}</pre>
        </div>
      )}

      {/* Simulation avant / apres */}
      {simulation && simulation.length > 0 && (
        <div style={{ borderTop: '0.5px solid #1a1a1a', padding: '12px 16px' }}>
          <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: '#4ecdc4', marginBottom: 8 }}>
            Simulation avant / apres
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Zone', 'Ratio avant', 'Ratio apres', 'Δ'].map(h => (
                    <th key={h} style={{
                      textAlign: h === 'Zone' ? 'left' : 'right', padding: '5px 8px',
                      fontFamily: fInter, fontSize: 9, fontWeight: 500, color: '#666666',
                      borderBottom: '0.5px solid #1a1a1a',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {simulation.map(s => {
                  const delta = s.ratio_avant > 0 ? (s.ratio_apres - s.ratio_avant) / s.ratio_avant * 100 : 0;
                  const improving = Math.abs(s.ratio_apres - 1) < Math.abs(s.ratio_avant - 1);
                  return (
                    <tr key={s.code} style={{ borderBottom: '0.5px solid #111111' }}>
                      <td style={{ padding: '4px 8px', fontFamily: fInter, fontSize: 10, color: '#a0a0a0' }}>
                        <span style={{ color: '#8a8a8a', marginRight: 4 }}>{s.code}</span>{s.nom}
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 10, color: '#a0a0a0' }}>
                        {s.ratio_avant.toFixed(2)}
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 10, color: '#f0f0f0', fontWeight: 500 }}>
                        {s.ratio_apres.toFixed(2)}
                      </td>
                      <td style={{
                        padding: '4px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 10, fontWeight: 600,
                        color: improving ? '#3dffa0' : '#ff5757',
                      }}>
                        {delta >= 0 ? '+' : ''}{delta.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`@keyframes bc-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
