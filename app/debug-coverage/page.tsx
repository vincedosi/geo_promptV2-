'use client';

import { useState } from 'react';

type StepResult = {
  step: string;
  status: 'ok' | 'error' | 'warn';
  duration_ms: number;
  data: unknown;
};

type DebugResult = {
  test_params: { poi: string; region: string; minutes: number; demo_col: string; mode: string; ors_test_max: number };
  total_duration_ms: number;
  summary: { total_steps: number; errors: number; warnings: number; first_error: string | null; verdict: string };
  steps: StepResult[];
};

const STATUS_COLOR: Record<string, string> = {
  ok:    'bg-green-900 border-green-500 text-green-200',
  error: 'bg-red-900 border-red-500 text-red-200',
  warn:  'bg-yellow-900 border-yellow-500 text-yellow-200',
};
const STATUS_BADGE: Record<string, string> = {
  ok:    'bg-green-500 text-black',
  error: 'bg-red-500 text-white',
  warn:  'bg-yellow-500 text-black',
};
const STATUS_ICON: Record<string, string> = { ok: '✅', error: '⛔', warn: '⚠️' };

export default function DebugCoveragePage() {
  const [poi,     setPoi]     = useState('cirfa');
  const [region,  setRegion]  = useState('Bretagne');
  const [minutes, setMinutes] = useState('30');
  const [demo,    setDemo]    = useState('ind_18_24');
  const [mode,    setMode]    = useState('drive');
  const [orsMax,  setOrsMax]  = useState('2');
  const [full,    setFull]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<DebugResult | null>(null);
  const [rawLog,  setRawLog]  = useState<string>('');

  async function runTest() {
    setLoading(true);
    setResult(null);
    setRawLog('');

    const params = new URLSearchParams({
      poi,
      region,
      minutes,
      demo,
      mode,
      ors_max: orsMax,
      ...(full ? { full: '1' } : {}),
    });

    const url = `/api/debug-coverage?${params}`;
    setRawLog(`[${new Date().toISOString()}] GET ${url}\n`);

    try {
      const t0  = Date.now();
      const res = await fetch(url);
      const elapsed = Date.now() - t0;
      const text = await res.text();

      setRawLog(prev => prev + `[${new Date().toISOString()}] HTTP ${res.status} après ${elapsed}ms\n\nRéponse JSON brute:\n${text}`);

      const data: DebugResult = JSON.parse(text);
      setResult(data);
    } catch (e: any) {
      setRawLog(prev => prev + `\n[ERREUR] ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-mono text-sm">
      <h1 className="text-2xl font-bold mb-2 text-white">
        Debug — Couverture réseau CIRFA
      </h1>
      <p className="text-gray-400 mb-6">
        Teste chaque étape du pipeline : DB catégories → fetchPois → ORS → PostGIS RPC
      </p>

      {/* ── Paramètres ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
        <label className="flex flex-col gap-1">
          <span className="text-gray-400 text-xs">POI category</span>
          <input className="bg-gray-800 text-white px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            value={poi} onChange={e => setPoi(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-400 text-xs">Région</span>
          <input className="bg-gray-800 text-white px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            value={region} onChange={e => setRegion(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-400 text-xs">Minutes</span>
          <input type="number" className="bg-gray-800 text-white px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            value={minutes} onChange={e => setMinutes(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-400 text-xs">Demo column</span>
          <select className="bg-gray-800 text-white px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            value={demo} onChange={e => setDemo(e.target.value)}>
            <option value="ind_18_24">ind_18_24 (18-24 ans)</option>
            <option value="Ind">Ind (Population totale)</option>
            <option value="Ind_25_39">Ind_25_39 (25-39 ans)</option>
            <option value="Ind_65_79">Ind_65_79 (65-79 ans)</option>
            <option value="Men">Men (Ménages)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-400 text-xs">Mode transport</span>
          <select className="bg-gray-800 text-white px-2 py-1 rounded border border-gray-600"
            value={mode} onChange={e => setMode(e.target.value)}>
            <option value="drive">drive (voiture)</option>
            <option value="walk">walk (pied)</option>
            <option value="bike">bike (vélo)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-400 text-xs">ORS test max (POIs)</span>
          <input type="number" min={1} max={5} className="bg-gray-800 text-white px-2 py-1 rounded border border-gray-600"
            value={orsMax} onChange={e => setOrsMax(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2 items-start justify-end">
          <span className="text-gray-400 text-xs">Appel complet API (lent ~1-5min)</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={full} onChange={e => setFull(e.target.checked)}
              className="w-4 h-4 rounded" />
            <span className="text-yellow-400">Activer ?full=1</span>
          </label>
        </label>
      </div>

      <button
        onClick={runTest}
        disabled={loading}
        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-lg transition-colors mb-6"
      >
        {loading ? '⏳ Test en cours...' : '▶ Lancer le diagnostic'}
      </button>

      {loading && (
        <div className="flex items-center gap-3 p-4 bg-blue-950 border border-blue-700 rounded-lg mb-6">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-blue-300">
            Diagnostic en cours — les étapes DB + ORS peuvent prendre 15-30 secondes...
            {full && ' (mode full: jusqu\'à 5 min)'}
          </span>
        </div>
      )}

      {/* ── Résultat ── */}
      {result && (
        <div className="space-y-4">
          {/* Verdict global */}
          <div className={`p-4 rounded-lg border-2 ${
            result.summary.errors > 0   ? 'bg-red-950 border-red-500' :
            result.summary.warnings > 0 ? 'bg-yellow-950 border-yellow-500' :
                                          'bg-green-950 border-green-500'
          }`}>
            <div className="text-lg font-bold mb-1">{result.summary.verdict}</div>
            <div className="text-xs text-gray-400">
              {result.summary.total_steps} étapes •{' '}
              {result.summary.errors} erreur(s) •{' '}
              {result.summary.warnings} avertissement(s) •{' '}
              {result.total_duration_ms}ms total
            </div>
            {result.summary.first_error && (
              <div className="mt-2 text-red-300 text-sm">
                Première erreur : <strong>{result.summary.first_error}</strong>
              </div>
            )}
          </div>

          {/* Paramètres utilisés */}
          <div className="p-3 bg-gray-900 rounded border border-gray-700">
            <div className="text-xs text-gray-500 mb-1">Paramètres du test</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(result.test_params).map(([k, v]) => (
                <span key={k} className="px-2 py-0.5 bg-gray-800 rounded text-xs">
                  <span className="text-gray-500">{k}:</span>{' '}
                  <span className="text-white">{String(v)}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Steps */}
          {result.steps.map((step) => (
            <div key={step.step} className={`border rounded-lg overflow-hidden ${STATUS_COLOR[step.status]}`}>
              <div className="flex items-center justify-between px-4 py-2 border-b border-current/30">
                <div className="flex items-center gap-2">
                  <span>{STATUS_ICON[step.status]}</span>
                  <span className="font-bold text-white">{step.step}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_BADGE[step.status]}`}>
                    {step.status.toUpperCase()}
                  </span>
                </div>
                <span className="text-xs text-gray-400">{step.duration_ms}ms</span>
              </div>
              <div className="p-4">
                <StepData data={step.data} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Raw log */}
      {rawLog && (
        <div className="mt-6">
          <div className="text-xs text-gray-500 mb-2">Log brut (console)</div>
          <pre className="p-4 bg-black rounded-lg border border-gray-800 text-xs text-green-400 overflow-auto max-h-96 whitespace-pre-wrap">
            {rawLog}
          </pre>
        </div>
      )}
    </div>
  );
}

function StepData({ data }: { data: unknown }) {
  if (data === null || data === undefined) return <span className="text-gray-500">null</span>;

  if (typeof data === 'string') {
    return <span className="text-yellow-300">{data}</span>;
  }

  if (typeof data !== 'object') {
    return <span className="text-yellow-300">{String(data)}</span>;
  }

  const obj = data as Record<string, unknown>;
  const note = obj.note as string | undefined;

  return (
    <div className="space-y-2">
      {/* Note en grand si présente */}
      {note && (
        <div className="text-sm font-semibold text-white bg-black/30 px-3 py-2 rounded">
          {note}
        </div>
      )}
      {/* Autres champs */}
      <div className="space-y-1">
        {Object.entries(obj)
          .filter(([k]) => k !== 'note')
          .map(([k, v]) => (
            <div key={k} className="flex gap-2 text-xs">
              <span className="text-gray-400 shrink-0 min-w-[160px]">{k}:</span>
              <span className="text-white break-all">
                {renderValue(v)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `"${v}"`;
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.length <= 10) return JSON.stringify(v);
    return `[${v.slice(0, 10).map(x => typeof x === 'string' ? `"${x}"` : JSON.stringify(x)).join(', ')} ... +${v.length - 10} de plus]`;
  }
  return JSON.stringify(v, null, 2);
}
