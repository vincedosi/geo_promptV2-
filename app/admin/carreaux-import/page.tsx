'use client';

import { useState } from 'react';

interface UrlCheckResult {
  valid: boolean;
  url?: string;
  error?: string;
  warning?: boolean;
  fileSize?: number;
  fileSizeMB?: string;
  contentType?: string;
  lastModified?: string;
  message?: string;
}

interface ImportReport {
  fichierSource?: string;
  tableTarget?: string;
  lignesChargees?: number;
  carreauxTraites?: number;
  carreauxInseres?: number;
}

interface ImportResult {
  success: boolean;
  mode?: string;
  dryRun?: boolean;
  output?: string;
  errors?: string;
  report?: ImportReport;
  error?: string;
}

// Presets géographiques — bbox WGS84 (west south east north) + estimation
const GEO_PRESETS = [
  { label: 'Toute la France métropolitaine', bbox: '-5.5 41.0 10.0 51.5', rows: 2300000, storageMb: 2500, warn: true },
  { label: 'Île-de-France', bbox: '1.5 48.0 3.2 49.2', rows: 230000, storageMb: 250, warn: false },
  { label: 'Auvergne-Rhône-Alpes', bbox: '2.0 44.0 7.2 46.8', rows: 280000, storageMb: 300, warn: false },
  { label: 'PACA', bbox: '4.0 42.8 7.8 44.9', rows: 130000, storageMb: 140, warn: false },
  { label: 'Occitanie', bbox: '-2.0 42.3 4.9 45.1', rows: 180000, storageMb: 195, warn: false },
  { label: 'Nouvelle-Aquitaine', bbox: '-1.9 42.7 2.6 47.1', rows: 200000, storageMb: 215, warn: false },
  { label: 'Grand Est', bbox: '3.4 47.4 8.2 49.7', rows: 190000, storageMb: 205, warn: false },
  { label: 'Hauts-de-France', bbox: '1.5 49.5 4.3 51.1', rows: 110000, storageMb: 120, warn: false },
  { label: 'Bretagne', bbox: '-5.2 47.3 -1.0 48.9', rows: 90000, storageMb: 98, warn: false },
  { label: 'Pays de la Loire', bbox: '-2.6 46.3 0.9 48.2', rows: 110000, storageMb: 120, warn: false },
  { label: 'Haute-Garonne (31)', bbox: '0.7 42.9 2.3 44.0', rows: 35000, storageMb: 38, warn: false },
  { label: 'Gironde (33)', bbox: '-1.3 44.0 0.3 45.9', rows: 40000, storageMb: 43, warn: false },
  { label: 'Rhône (69)', bbox: '4.4 45.3 5.7 46.1', rows: 30000, storageMb: 33, warn: false },
  { label: 'Nord (59)', bbox: '2.0 50.0 4.3 51.1', rows: 45000, storageMb: 49, warn: false },
  { label: 'Bas-Rhin (67)', bbox: '6.8 47.4 8.2 49.1', rows: 28000, storageMb: 30, warn: false },
  { label: 'Pas de filtre (bbox auto)', bbox: '', rows: 0, storageMb: 0, warn: false },
] as const;

export default function CarreauxImportPage() {
  const [url, setUrl] = useState('https://www.insee.fr/fr/statistiques/fichier/7655475/Filosofi2015_carreaux_200m_metropole.zip');
  const [urlCheckResult, setUrlCheckResult] = useState<UrlCheckResult | null>(null);
  const [isCheckingUrl, setIsCheckingUrl] = useState(false);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState('1000');
  const [geoPreset, setGeoPreset] = useState<string>('0.7 42.9 2.3 44.0'); // Haute-Garonne par défaut
  const [tableName, setTableName] = useState('');
  // Sélection de colonnes
  const [columnsData, setColumnsData] = useState<Record<string, { type: string; dtype: string; samples: string[] }> | null>(null);
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [columnsError, setColumnsError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [lastLog, setLastLog] = useState('');

  const selectedPreset = GEO_PRESETS.find(p => p.bbox === geoPreset) ?? GEO_PRESETS[GEO_PRESETS.length - 1];

  const handleVerifyUrl = async () => {
    if (!url.trim()) return;
    setIsCheckingUrl(true);
    setUrlCheckResult(null);
    try {
      const res = await fetch('/api/admin/verify-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      setUrlCheckResult(await res.json());
    } catch (e: any) {
      setUrlCheckResult({ valid: false, error: e.message });
    } finally {
      setIsCheckingUrl(false);
    }
  };

  const handlePreviewColumns = async () => {
    if (mode === 'manual' && !file) { alert('Sélectionnez un fichier d\'abord'); return; }
    if (mode === 'auto') { alert('La prévisualisation des colonnes nécessite l\'upload manuel du fichier.'); return; }
    setLoadingColumns(true);
    setColumnsError('');
    setColumnsData(null);
    try {
      const fd = new FormData();
      fd.append('mode', mode);
      if (file) fd.append('file', file);
      const res = await fetch('/api/admin/preview-carreaux', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error) {
        setColumnsError(data.error || 'Erreur inconnue');
        return;
      }
      const cols: Record<string, { type: string; dtype: string; samples: string[] }> = data.columns || {};
      setColumnsData(cols);
      // Par défaut : sélectionner toutes les colonnes numériques (pas les string ni les id)
      const defaultSel = new Set(
        Object.entries(cols)
          .filter(([, v]) => v.type !== 'string')
          .map(([k]) => k)
      );
      setSelectedCols(defaultSel);
    } catch (e: any) {
      setColumnsError(e.message);
    } finally {
      setLoadingColumns(false);
    }
  };

  const handleImport = async () => {
    if (mode === 'auto' && !urlCheckResult?.valid) { alert("Vérifiez l'URL d'abord"); return; }
    if (mode === 'manual' && !file) { alert('Sélectionnez un fichier'); return; }
    if (!confirm(dryRun ? `Dry-run sur ${limit || 'toutes les'} lignes ?` : '⚠️ IMPORT RÉEL en base ?')) return;

    setIsImporting(true);
    setImportResult(null);
    setImportProgress(null);
    setLastLog('');
    try {
      const fd = new FormData();
      fd.append('mode', mode);
      fd.append('dryRun', String(dryRun));
      if (limit) fd.append('limit', limit);
      if (geoPreset) fd.append('bbox', geoPreset);
      if (tableName.trim()) fd.append('tableName', tableName.trim());
      // Colonnes sélectionnées (vide = toutes)
      if (columnsData && selectedCols.size > 0 && selectedCols.size < Object.keys(columnsData).length) {
        fd.append('columns', [...selectedCols].join(','));
      }
      if (mode === 'auto') fd.append('url', url);
      else if (file) fd.append('file', file);

      const res = await fetch('/api/admin/import-carreaux', { method: 'POST', body: fd });

      if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'log') setLastLog(ev.line);
              else if (ev.type === 'progress') setImportProgress({ current: ev.current, total: ev.total });
              else if (ev.type === 'done') setImportResult({ success: ev.success, mode: ev.mode, dryRun: ev.dryRun, output: ev.output, errors: ev.errors, report: ev.report, error: ev.error });
            } catch {}
          }
        }
      } else {
        setImportResult(await res.json());
      }
    } catch (e: any) {
      setImportResult({ success: false, error: e.message });
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <div className="genesis-content" style={{ maxWidth: 860 }}>

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h1 className="page-title">admin / import-carreaux</h1>
          <span className="g-badge g-badge-orange">ADMIN</span>
          {dryRun && <span className="g-badge g-badge-green">DRY-RUN</span>}
        </div>
        <p className="page-subtitle">Import données INSEE Filosofi — carreaux socio-démographiques 200m × 200m</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Step 01 */}
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>01</span>
            <span className="g-card-title">Vérifier la source</span>
            {urlCheckResult?.valid && <span className="g-badge g-badge-green" style={{ marginLeft: 'auto' }}>✓ valid</span>}
          </div>
          <div className="g-card-body">
            <label className="g-label">URL du fichier source</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} className="g-input" disabled={isCheckingUrl} style={{ flex: 1 }} placeholder="https://www.insee.fr/..." />
              <button onClick={handleVerifyUrl} disabled={isCheckingUrl || !url.trim()} className="g-btn g-btn-ghost" style={{ flexShrink: 0 }}>
                {isCheckingUrl ? <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                  Vérif...
                </> : '→ Vérifier'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>// formats acceptés: .zip .csv .xlsx .xls .geojson .shp .gpkg .kml .gpx · Shapefile → zipper .shp+.dbf+.prj+.shx</div>

            {urlCheckResult && (
              <div className={`g-alert ${urlCheckResult.valid ? 'g-alert-success' : 'g-alert-error'}`} style={{ marginTop: 12 }}>
                {urlCheckResult.valid ? (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{urlCheckResult.message}</div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                      {urlCheckResult.fileSizeMB && <span>size: {urlCheckResult.fileSizeMB} MB</span>}
                      {urlCheckResult.contentType && <span>type: {urlCheckResult.contentType}</span>}
                      {urlCheckResult.lastModified && <span>modified: {new Date(urlCheckResult.lastModified).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ) : <span>{urlCheckResult.error}</span>}
              </div>
            )}
          </div>
        </div>

        {/* Step 02 */}
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>02</span>
            <span className="g-card-title">Mode de téléchargement</span>
          </div>
          <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { val: 'auto', title: 'Téléchargement automatique', desc: 'Le serveur télécharge depuis l\'URL vérifiée' },
              { val: 'manual', title: 'Upload manuel', desc: 'Fichier déjà téléchargé sur votre machine' },
            ].map((opt) => (
              <label key={opt.val} className={`g-radio-card${mode === opt.val ? ' selected' : ''}`} onClick={() => setMode(opt.val as any)}>
                <input type="radio" value={opt.val} checked={mode === opt.val} onChange={() => setMode(opt.val as any)} style={{ marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>{opt.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{opt.desc}</div>
                  {opt.val === 'manual' && mode === 'manual' && (
                    <div style={{ marginTop: 10 }}>
                      <input type="file" accept=".csv,.zip,.xlsx,.xls,.geojson,.json,.shp,.gpkg,.kml,.gpx" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontSize: 12, color: 'var(--text-secondary)' }} />
                      {file && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace' }}>✓ {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</div>}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Step 02b — Sélection des colonnes (mode manual uniquement) */}
        {mode === 'manual' && file && (
          <div className="g-card">
            <div className="g-card-header">
              <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>02b</span>
              <span className="g-card-title">Colonnes à importer</span>
              {columnsData && (
                <span className="g-badge g-badge-green" style={{ marginLeft: 'auto' }}>
                  {selectedCols.size} / {Object.keys(columnsData).length} colonnes
                </span>
              )}
            </div>
            <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {!columnsData && !loadingColumns && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={handlePreviewColumns} className="g-btn g-btn-ghost" disabled={loadingColumns}>
                    {loadingColumns ? (
                      <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>Chargement...</>
                    ) : '→ Inspecter les colonnes disponibles'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
                    // lecture de 5 lignes pour découvrir les colonnes
                  </span>
                </div>
              )}
              {loadingColumns && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                  Lecture du fichier en cours (peut prendre 10-30s)...
                </div>
              )}
              {columnsError && (
                <div className="g-alert g-alert-error">{columnsError}</div>
              )}
              {columnsData && (
                <>
                  {/* Boutons tout/rien */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      onClick={() => setSelectedCols(new Set(Object.keys(columnsData)))}
                      className="g-btn g-btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                    >Tout sélectionner</button>
                    <button
                      onClick={() => {
                        // Garder les colonnes id
                        setSelectedCols(new Set(Object.entries(columnsData).filter(([,v]) => v.type === 'id').map(([k]) => k)));
                      }}
                      className="g-btn g-btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                    >Numérique seulement</button>
                    <button
                      onClick={() => setColumnsData(null)}
                      className="g-btn g-btn-ghost" style={{ fontSize: 11, padding: '3px 10px', opacity: 0.6 }}
                    >× Réinitialiser</button>
                  </div>

                  {/* Grille des colonnes */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
                    {Object.entries(columnsData).map(([col, info]) => {
                      const isId = info.type === 'id';
                      const isChecked = selectedCols.has(col);
                      return (
                        <label
                          key={col}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: 8,
                            padding: '7px 10px', borderRadius: 6, cursor: isId ? 'default' : 'pointer',
                            background: isChecked ? 'rgba(61,255,160,0.05)' : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${isChecked ? 'rgba(61,255,160,0.2)' : 'var(--border)'}`,
                            opacity: isId ? 0.6 : 1,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isId}
                            onChange={e => {
                              setSelectedCols(prev => {
                                const next = new Set(prev);
                                e.target.checked ? next.add(col) : next.delete(col);
                                return next;
                              });
                            }}
                            style={{ marginTop: 2, accentColor: 'var(--accent)' }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>{col}</span>
                              <span style={{
                                fontSize: 9, padding: '1px 5px', borderRadius: 3, fontFamily: 'JetBrains Mono, monospace',
                                background: info.type === 'number' ? 'rgba(59,130,246,0.15)' : info.type === 'id' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                                color: info.type === 'number' ? '#58a6ff' : info.type === 'id' ? '#f59e0b' : 'var(--text-dim)',
                              }}>
                                {info.type === 'id' ? 'ID' : info.type === 'number' ? 'num' : 'str'}
                              </span>
                            </div>
                            {info.samples.length > 0 && (
                              <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {info.samples.slice(0, 2).join(' · ')}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
                    // {selectedCols.size} colonnes sélectionnées → seront stockées dans metadata JSONB
                    {columnsData && selectedCols.size < Object.keys(columnsData).length && (
                      <span style={{ color: 'var(--green)' }}>
                        {' '}· économie ~{Math.round((1 - selectedCols.size / Object.keys(columnsData).length) * 100)}% de stockage
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Step 03 — Périmètre géographique */}
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>03</span>
            <span className="g-card-title">Périmètre géographique</span>
            {selectedPreset.warn && <span className="g-badge g-badge-red" style={{ marginLeft: 'auto' }}>⚠ Pro plan requis</span>}
          </div>
          <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="g-label">Zone d'import</label>
              <select
                value={geoPreset}
                onChange={e => setGeoPreset(e.target.value)}
                className="g-input"
              >
                {GEO_PRESETS.map(p => (
                  <option key={p.bbox} value={p.bbox}>
                    {p.label}{p.rows > 0 ? ` — ~${(p.rows / 1000).toFixed(0)}k carreaux` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Estimation volume sélectionné */}
            {selectedPreset.rows > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { label: 'Carreaux estimés', value: `~${(selectedPreset.rows / 1000).toFixed(0)}k`, color: 'var(--accent)' },
                  { label: 'Stockage estimé', value: `~${selectedPreset.storageMb >= 1000 ? (selectedPreset.storageMb / 1000).toFixed(1) + ' GB' : selectedPreset.storageMb + ' MB'}`, color: selectedPreset.storageMb > 400 ? 'var(--red)' : 'var(--green)' },
                  { label: 'Durée estimée', value: `~${Math.ceil(selectedPreset.rows / 500 * 0.3 / 60)} min`, color: 'var(--text-secondary)' },
                ].map(item => (
                  <div key={item.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: item.color, fontFamily: 'JetBrains Mono, monospace' }}>{item.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Alerte plan Supabase */}
            {selectedPreset.warn && (
              <div className="g-alert g-alert-error">
                <strong>⚠ Supabase Pro plan requis</strong> — La France entière (~2,5 GB) dépasse la limite Free de 500 MB.
                Upgrade sur <a href="https://supabase.com/pricing" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>supabase.com/pricing</a> → Pro ($25/mois, 8 GB).
                <br /><em style={{ fontSize: 11, opacity: 0.8 }}>Alternative : importez région par région pour rester en Free.</em>
              </div>
            )}

            {/* Bbox manuelle */}
            <details>
              <summary style={{ fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}>// bbox manuelle (west south east north WGS84)</summary>
              <input
                type="text"
                value={geoPreset}
                onChange={e => setGeoPreset(e.target.value)}
                placeholder="ex: 0.7 42.9 2.3 44.0"
                className="g-input"
                style={{ marginTop: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
              />
            </details>
          </div>
        </div>

        {/* Step 04 — Options d'import */}
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>04</span>
            <span className="g-card-title">Options d'import</span>
          </div>
          <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Mode test (dry-run)</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Aperçu sans insertion en base — recommandé pour le premier test</div>
              </div>
            </label>
            <div>
              <label className="g-label">Limite de lignes (optionnel)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="vide = tout" min="1" className="g-input" style={{ maxWidth: 200 }} />
                <button onClick={() => setLimit('')} className="g-btn g-btn-ghost" style={{ fontSize: 11, padding: '4px 10px', opacity: limit ? 1 : 0.4 }} disabled={!limit}>× Pas de limite</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>// vide = tous les carreaux (~450 000)</div>
            </div>
          </div>
        </div>

        {/* Step 05 — Nom de table + lancement */}
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>05</span>
            <span className="g-card-title">Lancer l'import</span>
          </div>
          <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="g-label">Nom de table Supabase (optionnel)</label>
              <input
                type="text"
                value={tableName}
                onChange={e => setTableName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                placeholder="ex: filosofi_2021_toulouse — vide = auto depuis nom du fichier"
                className="g-input"
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={handleImport}
                disabled={isImporting || (mode === 'auto' && !urlCheckResult?.valid) || (mode === 'manual' && !file)}
                className={`g-btn ${dryRun ? 'g-btn-success' : 'g-btn-danger'}`}
                style={{ minWidth: 200 }}
              >
                {isImporting ? (
                  <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>Import en cours...</>
                ) : dryRun ? '→ Tester (dry-run)' : '⚠ LANCER L\'IMPORT RÉEL'}
              </button>
              {!dryRun && <span style={{ fontSize: 12, color: 'var(--red)', fontFamily: 'JetBrains Mono, monospace' }}>⚠ Insertion en base Supabase</span>}
            </div>

            {/* Barre de progression SSE */}
            {isImporting && (
              <div style={{ marginTop: 16 }}>
                {importProgress ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {importProgress.current.toLocaleString('fr-FR')} / {importProgress.total.toLocaleString('fr-FR')} carreaux
                      </span>
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
                        {Math.round(importProgress.current / importProgress.total * 100)} %
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${Math.round(importProgress.current / importProgress.total * 100)}%`, transition: 'width 0.4s ease' }} />
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>// initialisation Python...</div>
                )}
                {lastLog && (
                  <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ↳ {lastLog}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Résultat */}
        {importResult && (
          <div className="g-card" style={{ borderColor: importResult.success ? 'rgba(61,255,160,0.3)' : 'rgba(255,87,87,0.3)' }}>
            <div className="g-card-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={importResult.success ? 'var(--green)' : 'var(--red)'} strokeWidth="2">
                {importResult.success ? <polyline points="20 6 9 17 4 12" /> : <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>}
              </svg>
              <span className="g-card-title">import.result</span>
              <span className={`g-badge ${importResult.success ? 'g-badge-green' : 'g-badge-red'}`} style={{ marginLeft: 'auto' }}>
                {importResult.success ? 'success' : 'error'}
              </span>
            </div>
            <div className="g-card-body">
              {importResult.success ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {importResult.report && (
                    <div className="g-code" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                      {importResult.report.fichierSource && <div><span style={{ color: 'var(--text-dim)' }}>fichier: </span><span style={{ color: 'var(--accent)' }}>{importResult.report.fichierSource}</span></div>}
                      {importResult.report.tableTarget && <div><span style={{ color: 'var(--text-dim)' }}>table_créée: </span><span style={{ color: 'var(--accent)' }}>{importResult.report.tableTarget}</span></div>}
                      {importResult.report.lignesChargees !== undefined && <div><span style={{ color: 'var(--text-dim)' }}>lignes_chargées: </span><span style={{ color: 'var(--green)' }}>{importResult.report.lignesChargees}</span></div>}
                      {importResult.report.carreauxTraites !== undefined && <div><span style={{ color: 'var(--text-dim)' }}>carreaux_traités: </span><span style={{ color: 'var(--green)' }}>{importResult.report.carreauxTraites}</span></div>}
                      {importResult.report.carreauxInseres !== undefined && <div><span style={{ color: 'var(--text-dim)' }}>carreaux_insérés: </span><span style={{ color: 'var(--green)' }}>{importResult.report.carreauxInseres}</span></div>}
                    </div>
                  )}
                  {importResult.output && (
                    <details><summary>logs complets</summary>
                      <pre className="g-code" style={{ marginTop: 8, fontSize: 11, maxHeight: 300, overflow: 'auto' }}>{importResult.output}</pre>
                    </details>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="g-alert g-alert-error">{importResult.error || 'Erreur inconnue'}</div>
                  {importResult.output && <details><summary>console output</summary><pre className="g-code" style={{ marginTop: 8, fontSize: 11, maxHeight: 200, overflow: 'auto' }}>{importResult.output}</pre></details>}
                  {importResult.errors && <details><summary>stderr</summary><pre className="g-code" style={{ marginTop: 8, fontSize: 11, maxHeight: 200, overflow: 'auto', color: 'var(--red)' }}>{importResult.errors}</pre></details>}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>// Workflow recommandé :</span>
          <span>// 1. dry-run + limite 1000 → vérifier les indicateurs</span>
          <span>// 2. dry-run sans limite + filtre département → estimer le volume</span>
          <span>// 3. import réel département par département</span>
          <span>// Import France entière (~2,3M lignes, batch 500) ≈ 25-40 min · Plan Pro requis (2,5 GB)</span>
        </div>
      </div>
    </div>
  );
}
