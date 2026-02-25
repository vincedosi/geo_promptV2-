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

export default function CarreauxImportPage() {
  const [url, setUrl] = useState('https://www.insee.fr/fr/statistiques/fichier/7655475/Filosofi2015_carreaux_200m_metropole.zip');
  const [urlCheckResult, setUrlCheckResult] = useState<UrlCheckResult | null>(null);
  const [isCheckingUrl, setIsCheckingUrl] = useState(false);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState('1000');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

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

  const handleImport = async () => {
    if (mode === 'auto' && !urlCheckResult?.valid) { alert("Vérifiez l'URL d'abord"); return; }
    if (mode === 'manual' && !file) { alert('Sélectionnez un fichier'); return; }
    if (!confirm(dryRun ? `Dry-run sur ${limit || 'toutes les'} lignes ?` : '⚠️ IMPORT RÉEL en base ?')) return;

    setIsImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('mode', mode);
      fd.append('dryRun', String(dryRun));
      if (limit) fd.append('limit', limit);
      if (mode === 'auto') fd.append('url', url);
      else if (file) fd.append('file', file);
      const res = await fetch('/api/admin/import-carreaux', { method: 'POST', body: fd });
      setImportResult(await res.json());
    } catch (e: any) {
      setImportResult({ success: false, error: e.message });
    } finally {
      setIsImporting(false);
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
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>// formats acceptés: .zip .csv .xlsx .xls .geojson</div>

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
                      <input type="file" accept=".csv,.zip,.xlsx,.xls,.geojson,.json" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontSize: 12, color: 'var(--text-secondary)' }} />
                      {file && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace' }}>✓ {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</div>}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Step 03 */}
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>03</span>
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
              <input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="1000" min="1" className="g-input" style={{ maxWidth: 200 }} />
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>// vide = tous les carreaux (~450 000)</div>
            </div>
          </div>
        </div>

        {/* Step 04 */}
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>04</span>
            <span className="g-card-title">Lancer l'import</span>
          </div>
          <div className="g-card-body">
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

        <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', borderTop: '1px solid var(--border)' }}>
          <span>// </span>Premier test recommandé : dry-run + limite 1000 lignes · Import complet (~450k) ≈ 10-15 min
        </div>
      </div>
    </div>
  );
}
