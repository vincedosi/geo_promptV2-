'use client';

/**
 * ActorFilter — multi-select des acteurs (DSP/social/régie) en tête du Suivi.
 * Défaut = tous cochés. Décocher recalcule tout le cockpit (le parent refetch).
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { actorDisplayName, actorKindLabel, isAllActors, type ActorRow } from '@/lib/campaigns/actor-metrics';

const fInter = "'Inter', system-ui, sans-serif";

export function ActorFilter({
  actors, selected, onChange,
}: {
  actors: ActorRow[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  if (actors.length <= 1) return null; // rien à filtrer

  const all = actors.map((a) => a.actor);
  const allSelected = isAllActors(selected, all.length);
  const label = allSelected ? 'Tous les acteurs' : `${selected.length} acteur${selected.length > 1 ? 's' : ''}`;

  const toggle = (actor: string) => {
    const base = allSelected ? all : selected;
    const next = base.includes(actor) ? base.filter((a) => a !== actor) : [...base, actor];
    // [] = tous (le parent n'envoie pas de param). Décocher le dernier acteur
    // retombe donc sur « tous » plutôt que sur un état vide (sans signification).
    onChange(next.length === all.length ? [] : next); // [] = tous (pas de param)
  };

  return (
    <div style={{ position: 'relative', marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
          borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13,
          color: 'var(--text-primary)', cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>Acteurs : {label}</span>
        <ChevronDown size={14} color="var(--text-tertiary)" />
      </button>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)',
          borderRadius: 6, padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {actors.map((a) => {
            const checked = allSelected || selected.includes(a.actor);
            return (
              <label
                key={a.actor}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                  borderRadius: 4, cursor: 'pointer', fontFamily: fInter, fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(a.actor)} />
                <span style={{ flex: 1, color: 'var(--text-primary)' }}>{actorDisplayName(a.actor)}</span>
                <span style={{
                  fontFamily: fInter, fontSize: 9, color: 'var(--text-tertiary)',
                  border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '1px 5px',
                }}>
                  {actorKindLabel(a.kind)}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
