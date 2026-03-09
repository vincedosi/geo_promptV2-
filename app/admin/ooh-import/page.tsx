'use client';

import { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ImportRun {
  id:          string;
  source:      string;
  url:         string;
  lance_le:    string;
  termine_le:  string | null;
  statut:      'running' | 'done' | 'error';
  nb_total:    number;
  nb_inseres:  number;
  nb_maj:      number;
  nb_doublons: number;
  nb_erreurs:  number;
  erreurs:     string[];
}

interface SourceConfig {
  label:     string;
  arcgisUrl: string;
}

type StreamEvent =
  | { type: 'status';   message: string }
  | { type: 'progress'; page: number; fetched: number; inserted: number; updated: number; errors: number }
  | { type: 'done';     run_id: string; nb_total: number; nb_inseres: number; nb_maj: number; nb_doublons: number; nb_erreurs: number }
  | { type: 'error';    message: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Badge({ statut }: { statut: string }) {
  const colors: Record<string, string> = {
    running: 'bg-yellow-100 text-yellow-800',
    done:    'bg-green-100  text-green-800',
    error:   'bg-red-100    text-red-800',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[statut] ?? 'bg-gray-100 text-gray-700'}`}>
      {statut}
    </span>
  );
}

function fmt(n: number) {
  return n.toLocaleString('fr-FR');
}

function relDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OohImportPage() {
  const [sources,   setSources]   = useState<Record<string, SourceConfig>>({});
  const [runs,      setRuns]      = useState<ImportRun[]>([]);
  const [selected,  setSelected]  = useState('custom');
  const [customUrl, setCustomUrl] = useState('');
  const [logs,      setLogs]      = useState<string[]>([]);
  const [running,   setRunning]   = useState(false);
  const [stats,     setStats]     = useState<StreamEvent & { type: 'done' } | null>(null);
  const [replace,     setReplace]     = useState(false);
  const [datasetName, setDatasetName] = useState('');
  const [nameSaved,   setNameSaved]   = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── Chargement initial ────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/admin/import-ooh/arcgis')
      .then(r => r.json())
      .then(d => {
        setSources(d.sources ?? {});
        setRuns(d.runs ?? []);
      });
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── Lancer un import ─────────────────────────────────────────────────────
  async function startImport() {
    setRunning(true);
    setLogs([]);
    setStats(null);
    setDatasetName('');
    setNameSaved(false);

    try {
      const body: Record<string, string | boolean> = { source: selected, replace };
      if (customUrl.trim())  body.arcgisUrl = customUrl.trim();
      if (selected === 'custom' && customUrl.trim()) body.source = 'custom';

      const resp = await fetch('/api/admin/import-ooh/arcgis', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!resp.body) throw new Error('Pas de stream');
      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as StreamEvent;

            if (evt.type === 'status')   setLogs(p => [...p, `ℹ ${evt.message}`]);
            if (evt.type === 'progress') setLogs(p => [...p, `📄 Page ${evt.page} — ${fmt(evt.fetched)} récupérés / ${fmt(evt.inserted)} insérés`]);
            if (evt.type === 'error')    setLogs(p => [...p, `❌ ${evt.message}`]);
            if (evt.type === 'done') {
              setStats(evt);
              setLogs(p => [...p, `✅ Import terminé — ${fmt(evt.nb_total)} panneaux / ${fmt(evt.nb_inseres)} insérés`]);
              // Rafraîchir la liste des runs
              fetch('/api/admin/import-ooh/arcgis')
                .then(r => r.json())
                .then(d => setRuns(d.runs ?? []));
            }
          } catch { /* JSON invalide */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogs(p => [...p, `❌ ${msg}`]);
    } finally {
      setRunning(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import panneaux OOH</h1>
        <p className="text-sm text-gray-500 mt-1">
          Import des panneaux depuis des sources ArcGIS / data.gouv.fr vers la table{' '}
          <code className="bg-gray-100 px-1 rounded">global_ooh</code>.
        </p>
      </div>

      {/* ── Sélection source + bouton ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Nouvelle importation</h2>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">URL ArcGIS REST <span className="text-red-500">*</span></label>
          <input
            type="url"
            value={customUrl}
            onChange={e => setCustomUrl(e.target.value)}
            disabled={running}
            placeholder="https://geo.example.fr/arcgis/rest/services/.../MapServer/0"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder:text-gray-300"
            autoFocus
          />
          <p className="text-xs text-gray-400">Doit se terminer par <code>/MapServer/N</code> — pas une page data.gouv.fr</p>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={replace}
            onChange={e => setReplace(e.target.checked)}
            disabled={running}
            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
          />
          <span>Remplacer les données existantes <span className="text-gray-400">(supprime et réimporte)</span></span>
        </label>

        <button
          onClick={startImport}
          disabled={running || !customUrl.trim()}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {running && (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
          {running ? 'Import en cours…' : '▶ Lancer l\'import'}
        </button>
      </div>

      {/* ── Logs ── */}
      {logs.length > 0 && (
        <div className="bg-gray-950 text-gray-100 rounded-xl p-4 font-mono text-xs space-y-0.5 max-h-64 overflow-y-auto">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* ── Stats import terminé ── */}
      {stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total récupérés', value: fmt(stats.nb_total),   color: 'text-gray-800' },
              { label: 'Insérés / MàJ',  value: fmt(stats.nb_inseres),  color: 'text-green-700' },
              { label: 'Doublons',        value: fmt(stats.nb_doublons), color: 'text-yellow-700' },
              { label: 'Erreurs',         value: fmt(stats.nb_erreurs),  color: 'text-red-700' },
            ].map(s => (
              <div key={s.label} className="bg-white border border-gray-200 rounded-lg p-3 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Nommage du jeu de données */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-purple-800">Donnez un nom à ce jeu de données</p>
            {nameSaved ? (
              <p className="text-sm text-green-700">✅ Nom enregistré : <strong>{datasetName}</strong></p>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={datasetName}
                  onChange={e => setDatasetName(e.target.value)}
                  placeholder="ex. Brest Métropole 2026, JCDecaux Paris..."
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <button
                  onClick={async () => {
                    if (!datasetName.trim()) return;
                    await fetch('/api/admin/import-ooh/arcgis', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: stats.run_id, label: datasetName.trim() }),
                    });
                    setNameSaved(true);
                    setRuns(prev => prev.map(r => r.id === stats.run_id ? { ...r, source: datasetName.trim() } : r));
                  }}
                  disabled={!datasetName.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                >
                  Enregistrer
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Historique ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Historique des imports</h2>
        </div>
        {runs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-400">Aucun import réalisé.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {['Source', 'Date', 'Statut', 'Total', 'Insérés', 'Erreurs', ''].map(h => (
                  <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{r.source}</td>
                  <td className="px-4 py-2 text-gray-500">{relDate(r.lance_le)}</td>
                  <td className="px-4 py-2"><Badge statut={r.statut} /></td>
                  <td className="px-4 py-2">{fmt(r.nb_total)}</td>
                  <td className="px-4 py-2 text-green-700">{fmt(r.nb_inseres)}</td>
                  <td className="px-4 py-2 text-red-600">{r.nb_erreurs > 0 ? fmt(r.nb_erreurs) : '—'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={async () => {
                        await fetch('/api/admin/import-ooh/arcgis', {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: r.id }),
                        });
                        setRuns(prev => prev.filter(x => x.id !== r.id));
                      }}
                      className="text-gray-300 hover:text-red-500 transition-colors text-xs"
                      title="Supprimer"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
