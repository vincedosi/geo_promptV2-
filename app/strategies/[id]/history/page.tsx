'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  created: '#3dffa0',
  paused: '#f7b731',
  archived: '#ff5757',
  reactivated: '#3dffa0',
  resumed: '#3dffa0',
};

export default function StrategyHistoryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const strategyId = params?.id;
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!strategyId) return;
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
    <div className="min-h-screen bg-[#050505] text-[#f0f0f0] p-6">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-base font-medium">Historique de la stratégie</h1>
            <p className="text-[11px] text-[#666] font-mono">{strategyId}</p>
          </div>
          <button
            onClick={() => router.push(`/custom-bidding/${strategyId}`)}
            className="text-xs text-[#4ecdc4] hover:text-[#3dbdb5]"
          >
            ← Retour au pilotage
          </button>
        </header>

        {loading && <p className="text-xs text-[#666] font-mono">chargement…</p>}

        {!loading && changes.length === 0 && (
          <p className="text-xs text-[#666]">Aucun changement enregistré.</p>
        )}

        {!loading && changes.length > 0 && (
          <ul className="flex flex-col gap-2">
            {changes.map(c => {
              const isOpen = expanded.has(c.id);
              const color = TYPE_COLOR[c.change_type] ?? '#a0a0a0';
              return (
                <li key={c.id} className="border border-[#1a1a1a] bg-[#0a0a0a] rounded-md">
                  <button
                    onClick={() => toggle(c.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#111]"
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium">
                        {TYPE_LABEL_FR[c.change_type] ?? c.change_type}
                        {c.field_path && (
                          <span className="text-[#666] font-mono"> · {c.field_path}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#666] font-mono mt-0.5">
                        {new Date(c.created_at).toLocaleString('fr-FR')} ·{' '}
                        {c.user_email ?? c.triggered_by}
                        {c.reason && <> · {c.reason}</>}
                      </div>
                    </div>
                    <span className="text-[10px] text-[#666]">{isOpen ? '▾' : '▸'}</span>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-3 grid grid-cols-2 gap-3 text-[11px] font-mono">
                      <div>
                        <div className="text-[#666] mb-1">avant</div>
                        <pre className="bg-[#050505] border border-[#1a1a1a] p-2 rounded text-[#a0a0a0] overflow-x-auto">
                          {JSON.stringify(c.old_value, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-[#666] mb-1">après</div>
                        <pre className="bg-[#050505] border border-[#1a1a1a] p-2 rounded text-[#a0a0a0] overflow-x-auto">
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
    </div>
  );
}
