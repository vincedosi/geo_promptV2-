'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

interface ChangeRow {
  id: string;
  change_type: string;
  field_path: string | null;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  triggered_by: string;
  user_email: string | null;
  created_at: string;
}

const TYPE_LABEL_FR: Record<string, string> = {
  created: 'Création',
  config_updated: 'Configuration modifiée',
  scope_changed: 'Périmètre modifié',
  weighting_updated: 'Pondération modifiée',
  preset_applied: 'Preset appliqué',
  subzones_modified: 'Sous-zones modifiées',
  mode_changed: 'Mode modifié',
  autonomy_changed: 'Autonomie modifiée',
  paused: 'Mise en pause',
  resumed: 'Reprise',
  archived: 'Archivée',
  reactivated: 'Réactivée',
};

const TYPE_COLOR: Record<string, string> = {
  created: 'var(--success)',
  paused: 'var(--warning)',
  archived: 'var(--danger)',
  reactivated: 'var(--success)',
  resumed: 'var(--success)',
};

interface Props {
  strategyId: string;
}

export function StrategyHistoryView({ strategyId }: Props) {
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!strategyId) return;
    setLoading(true);
    adminFetch(`/api/bidding/strategies/${strategyId}/changes`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { changes: [] })
      .then(j => {
        setChanges(j.changes ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [strategyId]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-4">
      {loading && <p className="text-xs text-text-tertiary font-mono">chargement…</p>}

      {!loading && changes.length === 0 && (
        <p className="text-xs text-text-tertiary">Aucun changement enregistré.</p>
      )}

      {!loading && changes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {changes.map(c => {
            const isOpen = expanded.has(c.id);
            const color = TYPE_COLOR[c.change_type] ?? 'var(--text-secondary)';
            return (
              <li key={c.id} className="border border-border-subtle bg-bg-level-1 rounded-md">
                <button
                  onClick={() => toggle(c.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-bg-level-2"
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: color }}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-text-primary">
                      {TYPE_LABEL_FR[c.change_type] ?? c.change_type}
                      {c.field_path && (
                        <span className="text-text-tertiary font-mono"> · {c.field_path}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-text-tertiary font-mono mt-0.5">
                      {new Date(c.created_at).toLocaleString('fr-FR')} ·{' '}
                      {c.user_email ?? c.triggered_by}
                      {c.reason && <> · {c.reason}</>}
                    </div>
                  </div>
                  <span className="text-[10px] text-text-tertiary">{isOpen ? '▾' : '▸'}</span>
                </button>

                {isOpen && (
                  <div className="px-4 pb-3 grid grid-cols-2 gap-3 text-[11px] font-mono">
                    <div>
                      <div className="text-text-tertiary mb-1">avant</div>
                      <pre className="bg-bg-level-0 border border-border-subtle p-2 rounded text-text-secondary overflow-x-auto">
                        {JSON.stringify(c.old_value, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <div className="text-text-tertiary mb-1">après</div>
                      <pre className="bg-bg-level-0 border border-border-subtle p-2 rounded text-text-secondary overflow-x-auto">
                        {JSON.stringify(c.new_value, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
