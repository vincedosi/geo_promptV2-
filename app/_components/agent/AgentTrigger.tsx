'use client';

/**
 * Bouton flottant pour ouvrir GeoAgent. Sticky bottom-right de l'écran.
 * Visible sur toutes les pages (ouvert via AgentProvider context).
 */
import { Sparkles } from 'lucide-react';
import { useAgent } from './AgentProvider';

export function AgentTrigger() {
  const { isOpen, toggle } = useAgent();
  if (isOpen) return null; // déjà ouvert → on cache le trigger
  return (
    <button
      onClick={() => toggle()}
      title="Ouvrir GeoAgent (assistant IA)"
      style={{
        position: 'fixed', right: 18, bottom: 18, zIndex: 55,
        width: 44, height: 44, borderRadius: 22,
        background: 'var(--brand-teal)', color: '#050505',
        border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 20px rgba(78,205,196,0.35)',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <Sparkles size={18} strokeWidth={2} />
    </button>
  );
}
