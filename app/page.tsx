'use client';

import { useState } from 'react';

type Filtres = {
  region: string | null;
  ville: string | null;
  poi_type: string | null;
  poi_rayon_m: number | null;
  poi_filtre: Record<string, unknown> | null;
  cible_age: string | null;
  regie: string | null;
  format: string | null;
  nb_resultats: number;
};

type ApiResponse = {
  filtres: Filtres;
  confiance: number;
  prompt_original: string;
  raison?: string;
};

type Panneau = {
  id: string;
  latitude: number;
  longitude: number;
  ville?: string;
  region?: string;
  format?: string;
  regie?: string;
  nom?: string;
  [key: string]: any;
};

type SearchResponse = {
  panneaux: Panneau[];
  filtres_appliques: Filtres;
  total: number;
  total_base?: number;
};

const EXAMPLES = [
  'je veux toucher les jeunes autour des lycées à Brest',
  'panneaux proches des CIRFA Air en Île-de-France',
  'grands formats JCDecaux à Marseille',
  '4x3 dans les zones commerciales de Lyon',
];

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'idle' | 'parsing' | 'searching' | 'done'>('idle');
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);
    setSearchResponse(null);
    setStep('parsing');

    try {
      const parseRes = await fetch('/api/parse-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const parseData = await parseRes.json();
      if (!parseRes.ok) { setError(parseData.error || 'Erreur parsing'); setStep('idle'); return; }
      setResponse(parseData);
      setStep('searching');

      const searchRes = await fetch('/api/search-panneaux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parseData.filtres),
      });
      const searchData = await searchRes.json();
      if (!searchRes.ok) { setError(searchData.error || 'Erreur recherche'); setStep('idle'); return; }
      setSearchResponse(searchData);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau');
      setStep('idle');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setPrompt(''); setResponse(null); setSearchResponse(null); setError(null); setStep('idle'); };

  const confColor = response
    ? response.confiance >= 0.8 ? 'var(--green)' : response.confiance >= 0.5 ? 'var(--orange)' : 'var(--red)'
    : 'var(--accent)';

  return (
    <div className="genesis-content" style={{ maxWidth: 900 }}>

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h1 className="page-title">parse-prompt</h1>
          <span className="g-badge g-badge-green">MISTRAL-SMALL</span>
          <span className="g-badge g-badge-purple">ZOD VALIDATED</span>
        </div>
        <p className="page-subtitle">
          Analyse un prompt marketing francophone → extrait filtres géographiques &amp; démographiques
        </p>
      </div>

      {/* Input */}
      <div className="g-card" style={{ marginBottom: 16 }}>
        <div className="g-card-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span className="g-card-title">prompt.input</span>
          {loading && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
              <div className="status-dot" />
              {step === 'parsing' ? 'Analyse Mistral...' : 'Recherche panneaux...'}
            </div>
          )}
        </div>
        <div className="g-card-body">
          <form onSubmit={handleSubmit}>
            <label className="g-label">Requête marketing</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ex: je veux toucher les jeunes autour des lycées à Brest"
              className="g-input"
              rows={3}
              style={{ marginBottom: 12 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" disabled={loading || !prompt.trim()} className="g-btn g-btn-primary">
                {loading ? (
                  <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>{step === 'parsing' ? 'Parsing...' : 'Recherche...'}</>
                ) : (
                  <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>Exécuter</>
                )}
              </button>
              {(response || error) && (
                <button type="button" onClick={reset} className="g-btn g-btn-ghost">Réinitialiser</button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Examples */}
      <div className="g-card" style={{ marginBottom: 16 }}>
        <div className="g-card-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="g-card-title">examples</span>
        </div>
        <div className="g-card-body" style={{ paddingTop: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => setPrompt(ex)}
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 5, padding: '6px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', transition: 'all 0.15s ease' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
              >
                "{ex}"
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="g-alert g-alert-error" style={{ marginBottom: 16 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
          <span><strong>error:</strong> {error}</span>
        </div>
      )}

      {/* Results */}
      {response && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Stats */}
          <div className="g-grid-2" style={{ gap: 16 }}>
            <div className="stat-card">
              <div className="stat-label">confiance</div>
              <div className="stat-value" style={{ color: confColor }}>{(response.confiance * 100).toFixed(0)}%</div>
              <div className="g-progress" style={{ marginTop: 8 }}>
                <div className="g-progress-bar" style={{ width: `${response.confiance * 100}%`, background: confColor }} />
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">model</div>
              <div style={{ fontSize: 14, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)', marginTop: 4 }}>mistral-small-latest</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>JSON mode · Zod validated</div>
              {response.raison && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{response.raison}</div>
              )}
            </div>
          </div>

          {/* Filtres JSON */}
          <div className="g-card">
            <div className="g-card-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
              <span className="g-card-title">filtres.json</span>
              <span className="g-badge g-badge-purple" style={{ marginLeft: 'auto' }}>extracted</span>
            </div>
            <div style={{ padding: 0 }}>
              <pre className="g-code" style={{ borderRadius: '0 0 8px 8px', border: 'none', margin: 0 }}>
                {JSON.stringify(response.filtres, null, 2)}
              </pre>
            </div>
          </div>

          {/* Panneaux */}
          {searchResponse && (
            <div className="g-card">
              <div className="g-card-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                <span className="g-card-title">panneaux.results</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <span className="g-badge g-badge-green">{searchResponse.total} résultats</span>
                </div>
              </div>

              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div className="g-grid-3" style={{ gap: 12 }}>
                  <div className="stat-card" style={{ padding: '12px 16px' }}>
                    <div className="stat-label">total base</div>
                    <div className="stat-value" style={{ fontSize: 20, color: 'var(--text-secondary)' }}>{searchResponse.total_base || searchResponse.total}</div>
                  </div>
                  <div className="stat-card" style={{ padding: '12px 16px' }}>
                    <div className="stat-label">résultats</div>
                    <div className="stat-value" style={{ fontSize: 20, color: 'var(--green)' }}>{searchResponse.total}</div>
                  </div>
                  <div className="stat-card" style={{ padding: '12px 16px' }}>
                    <div className="stat-label">filtres actifs</div>
                    <div style={{ fontSize: 12, marginTop: 4, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>
                      {[
                        searchResponse.filtres_appliques.ville && `ville:${searchResponse.filtres_appliques.ville}`,
                        searchResponse.filtres_appliques.region && `reg:${searchResponse.filtres_appliques.region}`,
                        searchResponse.filtres_appliques.poi_type && `poi:${searchResponse.filtres_appliques.poi_type}`,
                      ].filter(Boolean).join(' · ') || 'aucun'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="g-card-body">
                {searchResponse.panneaux.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
                    // No results matching criteria
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {searchResponse.panneaux.map((panneau, index) => (
                      <div key={panneau.id || index} className="g-row">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>#{String(index + 1).padStart(3, '0')}</span>
                              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{panneau.nom || 'Panneau sans nom'}</span>
                              {panneau.format && <span className="g-badge g-badge-purple">{panneau.format}</span>}
                              {panneau.regie && <span className="g-badge g-badge-orange">{panneau.regie}</span>}
                            </div>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
                              {panneau.ville && <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>📍 {panneau.ville}</span>}
                              {panneau.region && <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>🗺 {panneau.region}</span>}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>
                              {panneau.latitude?.toFixed(5) || '?'}, {panneau.longitude?.toFixed(5) || '?'}
                            </div>
                            {panneau.latitude && panneau.longitude && (
                              <a href={`https://www.google.com/maps/?q=${panneau.latitude},${panneau.longitude}`} target="_blank" rel="noopener noreferrer" className="g-btn g-btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }}>
                                Maps ↗
                              </a>
                            )}
                          </div>
                        </div>
                        <details style={{ marginTop: 10 }}>
                          <summary>raw data</summary>
                          <pre className="g-code" style={{ marginTop: 8, fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
                            {JSON.stringify(panneau, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
