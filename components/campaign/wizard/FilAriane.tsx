'use client';

import type { CSSProperties } from 'react';

// ── Design tokens (DESIGN_SYSTEM.md — jamais de hex en dur) ─────────────────────
const C = {
  surface: 'var(--bg-surface)',
  elevated: 'var(--bg-level-2)',
  border: 'var(--border-subtle)',
  borderDefault: 'var(--border-default)',
  borderHover: 'var(--border-hover)',
  teal: 'var(--brand-teal)',
  tealDim: 'var(--brand-teal-10)',
  teal30: 'var(--brand-teal-30)',
  text: 'var(--text-primary)',
  textSec: 'var(--text-secondary)',
  textDim: 'var(--text-tertiary)',
  bgPrimary: 'var(--bg-primary)',
};
// Pas de token --brand-teal-06 dans globals.css : la maquette applique un glow
// à 7% autour du node actif (--teal06), plus léger que --brand-teal-10 (10%).
// rgba autorisé par la consigne quand aucun tint précis n'existe (jamais de hex nu).
const TEAL_GLOW_07 = 'rgba(78,205,196,0.07)';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

export interface FilArianeStep {
  key: string;
  label: string;
}

interface FilArianeProps {
  /** Étapes "programmer" de la campagne, dans l'ordre (Cible/Budget/Stratégie/Lancement). */
  steps: FilArianeStep[];
  /** Phases "piloter" optionnelles — plus utilisées par le cockpit, conservées pour compat. */
  phases?: FilArianeStep[];
  /** Clé de l'étape/phase actuellement sélectionnée. */
  activeKey: string;
  /** Index dans `steps` de l'étape la plus avancée déjà atteinte (pour le style done/active). */
  currentStepIndex: number;
  /** Si faux, les phases piloter s'affichent verrouillées (🔒) et ne sont pas cliquables. */
  unlockedPiloter?: boolean;
  onSelect: (key: string) => void;
}

type NodeState = 'done' | 'active' | 'upcoming' | 'locked';
type NodeKind = 'step' | 'phase';

interface NodeSpec {
  key: string;
  label: string;
  eyebrow?: string;
  state: NodeState;
  display: string;
  reachable: boolean;
  kind: NodeKind;
}

export function FilAriane({ steps, phases = [], activeKey, currentStepIndex, unlockedPiloter = false, onSelect }: FilArianeProps) {
  const programmerNodes: NodeSpec[] = steps.map((s, i) => {
    let state: NodeState = 'upcoming';
    if (i < currentStepIndex) state = 'done';
    else if (i === currentStepIndex || s.key === activeKey) state = 'active';
    return {
      key: s.key,
      label: s.label,
      eyebrow: i === 0 ? 'programmer' : undefined,
      state,
      display: state === 'done' ? '✓' : String(i + 1),
      reachable: true,
      kind: 'step',
    };
  });

  // Phases (Pilotage/Bilan) : ce ne sont PAS des étapes numérotées — cadenas si
  // verrouillées, sinon un simple dot (actif = node plein teal, à venir = petit dot teal).
  const phaseNodes: NodeSpec[] = phases.map((p, i) => {
    const locked = !unlockedPiloter;
    const state: NodeState = locked ? 'locked' : (p.key === activeKey ? 'active' : 'upcoming');
    return {
      key: p.key,
      label: p.label,
      eyebrow: i === 0 ? 'piloter' : undefined,
      state,
      display: locked ? '🔒' : '',
      reachable: !locked,
      kind: 'phase',
    };
  });

  return (
    <div style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '20px 22px' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 'max-content' }}>
          {programmerNodes.map((node, i) => (
            <StepNode key={node.key} node={node} showLine={i > 0} onSelect={onSelect} />
          ))}
          {phaseNodes.length > 0 && (
            <>
              <div
                aria-hidden
                style={{ width: 1, alignSelf: 'stretch', background: C.borderDefault, margin: '0 10px', position: 'relative', top: -2 }}
              />
              {phaseNodes.map((node) => (
                <StepNode key={node.key} node={node} showLine onSelect={onSelect} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StepNode({ node, showLine, onSelect }: { node: NodeSpec; showLine: boolean; onSelect: (key: string) => void }) {
  const { state, reachable } = node;

  const nodeStyle: CSSProperties = {
    width: 32, height: 32, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: fMono, fontSize: 12, fontWeight: 500,
    // Longhand (jamais `border` shorthand) : le hover mute `borderColor` seul,
    // mélanger shorthand/longhand déclenche le warning React "Removing borderColor border".
    borderWidth: 1.5, borderStyle: 'solid', borderColor: C.borderDefault,
    background: C.elevated, color: C.textDim,
    zIndex: 2, position: 'relative',
    transition: 'border-color 0.22s ease, background-color 0.22s ease, color 0.22s ease, box-shadow 0.22s ease',
  };
  let capStyle: CSSProperties = {
    fontSize: 11.5, color: C.textDim, textAlign: 'center', maxWidth: 96,
    transition: 'color 0.22s ease', fontFamily: fInter,
  };

  if (state === 'done') {
    nodeStyle.borderColor = C.teal30;
    nodeStyle.background = C.tealDim;
    nodeStyle.color = C.teal;
    capStyle = { ...capStyle, color: C.textSec };
  } else if (state === 'active') {
    nodeStyle.borderColor = C.teal;
    nodeStyle.background = C.teal;
    nodeStyle.color = C.bgPrimary;
    nodeStyle.boxShadow = `0 0 0 4px ${TEAL_GLOW_07}`;
    capStyle = { ...capStyle, color: C.text, fontWeight: 500 };
  }

  const lineColor = state === 'done' ? C.teal30 : C.borderDefault;

  // Phases (Pilotage/Bilan) : jamais de numéro. Verrouillé → 🔒 (node.display).
  // Actif → node déjà plein teal (rien à afficher dedans). Atteignable non-actif → petit dot teal.
  const content = node.kind === 'phase' && node.reachable && state !== 'active'
    ? <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, display: 'block' }} />
    : node.display;

  return (
    <div
      role="button"
      tabIndex={reachable ? 0 : -1}
      aria-disabled={!reachable}
      aria-current={state === 'active' ? 'step' : undefined}
      onClick={() => { if (reachable) onSelect(node.key); }}
      onKeyDown={(e) => {
        if (!reachable) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(node.key); }
      }}
      onMouseEnter={(e) => {
        if (!reachable || state === 'active') return;
        const el = e.currentTarget.querySelector('[data-node="true"]') as HTMLElement | null;
        if (el) { el.style.borderColor = C.borderHover; el.style.color = C.textSec; }
      }}
      onMouseLeave={(e) => {
        if (!reachable || state === 'active') return;
        const el = e.currentTarget.querySelector('[data-node="true"]') as HTMLElement | null;
        if (el) { el.style.borderColor = C.borderDefault; el.style.color = C.textDim; }
      }}
      style={{
        position: 'relative', flex: '0 0 104px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 9, paddingTop: 16,
        cursor: reachable ? 'pointer' : 'not-allowed',
        opacity: state === 'locked' ? 0.5 : 1,
        outline: 'none',
      }}
    >
      {node.eyebrow && (
        <span style={{
          position: 'absolute', top: 0, fontSize: 9, textTransform: 'uppercase',
          letterSpacing: '0.09em', color: C.textDim, fontFamily: fInter, whiteSpace: 'nowrap',
        }}>
          {node.eyebrow}
        </span>
      )}
      {showLine && (
        <span
          aria-hidden
          style={{
            position: 'absolute', top: 32, left: 'calc(-50% + 16px)', width: 'calc(100% - 32px)',
            height: 1.5, background: lineColor, zIndex: 1,
          }}
        />
      )}
      <span data-node="true" style={nodeStyle}>{content}</span>
      <span style={capStyle}>{node.label}</span>
    </div>
  );
}
