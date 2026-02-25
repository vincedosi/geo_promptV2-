'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  ParseResult,
  DryRunResult,
  ImportProgress,
  ImportReport,
  GeoMode,
  DataType,
  FieldMapping,
  GeoConfig,
} from '@/lib/import/types';

// ============================================================
// State interfaces
// ============================================================

interface MappingState extends FieldMapping {
  [key: string]: string | undefined;
}

// ============================================================
// Constants
// ============================================================

const GEO_MODES: { val: GeoMode; title: string; desc: string }[] = [
  { val: 'gps', title: 'GPS direct', desc: 'Colonnes latitude / longitude deja presentes' },
  { val: 'address', title: 'Geocodage adresse', desc: 'Adresse → coordonnees via API BAN (gratuit)' },
  { val: 'lambert93', title: 'Lambert 93 (X, Y)', desc: 'Coordonnees projetees EPSG:2154 → WGS84' },
];

const POI_CATEGORIES = [
  { val: 'lycee', label: 'Lycee' },
  { val: 'college', label: 'College' },
  { val: 'gare', label: 'Gare' },
  { val: 'sport', label: 'Sport' },
  { val: 'autre', label: 'Autre' },
];

const GENESIS_FIELDS_POI = [
  { key: 'nom', label: 'Nom', required: false },
  { key: 'adresse', label: 'Adresse', required: false },
  { key: 'ville', label: 'Ville', required: false },
  { key: 'code_postal', label: 'Code postal', required: false },
  { key: 'departement', label: 'Departement', required: false },
  { key: 'region', label: 'Region', required: false },
];

const GENESIS_FIELDS_PANNEAUX = [
  { key: 'nom', label: 'Nom', required: false },
  { key: 'reference_panneau', label: 'Reference panneau', required: false },
  { key: 'type_panneau', label: 'Format / type', required: false },
  { key: 'adresse', label: 'Adresse', required: false },
  { key: 'ville', label: 'Ville', required: false },
  { key: 'code_postal', label: 'Code postal', required: false },
  { key: 'departement', label: 'Departement', required: false },
  { key: 'region', label: 'Region', required: false },
];

// ============================================================
// Spinner SVG
// ============================================================

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ============================================================
// Main Component
// ============================================================

export default function ImportUniverselPage() {
  // -- Step 1: File Upload
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -- Step 2: Data Type
  const [dataType, setDataType] = useState<DataType>('poi');
  const [category, setCategory] = useState('lycee');
  const [regie, setRegie] = useState('');

  // -- Step 3: Column Mapping
  const [mapping, setMapping] = useState<MappingState>({});
  const [geoMode, setGeoMode] = useState<GeoMode>('gps');
  const [geoMapping, setGeoMapping] = useState<Record<string, string>>({});

  // -- Step 4: Dry-run
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [isDryRunning, setIsDryRunning] = useState(false);

  // -- Step 5: Import
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);

  // -- Live Logs
  const [logLines, setLogLines] = useState<{ level: string; line: string; ts: number }[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // -- Column selection: which columns to include in metadata
  const [importedColumns, setImportedColumns] = useState<string[]>([]);
  // -- Filter fields: subset of importedColumns to expose as map filters
  const [filterFields, setFilterFields] = useState<string[]>([]);

  // -- Back-office: Source name + Organization
  const [sourceName, setSourceName] = useState('');
  const [organizationId, setOrganizationId] = useState('00000000-0000-0000-0000-000000000001');
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);

  // Load organizations on mount
  useEffect(() => {
    fetch('/api/admin/organizations')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.organizations) {
          setOrganizations(data.organizations.map((o: { id: string; name: string }) => ({ id: o.id, name: o.name })));
        }
      })
      .catch(() => { /* API pas encore configuree */ });
  }, []);

  // ============================================================
  // Step 1: File Upload
  // ============================================================

  const handleFileUpload = useCallback(async (uploadedFile: File) => {
    setFile(uploadedFile);
    setIsParsing(true);
    setParseResult(null);
    setDryRunResult(null);
    setImportReport(null);
    setImportProgress(null);

    try {
      const fd = new FormData();
      fd.append('file', uploadedFile);

      const res = await fetch('/api/admin/import-poi/parse', { method: 'POST', body: fd });
      const data: ParseResult = await res.json();
      setParseResult(data);

      // Apply suggested mapping
      if (data.success && data.suggestedMapping) {
        const suggested: MappingState = {};
        for (const [key, val] of Object.entries(data.suggestedMapping)) {
          if (val) suggested[key] = val;
        }
        setMapping(suggested);

        // Auto-set geo mapping from suggestions
        const newGeo: Record<string, string> = {};
        if (suggested.lat) { newGeo.colLat = suggested.lat; setGeoMode('gps'); }
        if (suggested.lng) { newGeo.colLng = suggested.lng; }
        if (suggested.x) { newGeo.colX = suggested.x; }
        if (suggested.y) { newGeo.colY = suggested.y; }
        setGeoMapping(newGeo);
      }

      // Auto-select all columns for import (user can deselect in Step 03b)
      if (data.success && data.columns) {
        setImportedColumns(data.columns.map((c: { name: string }) => c.name));
        setFilterFields([]);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur upload';
      setParseResult({ success: false, error: msg } as ParseResult);
    } finally {
      setIsParsing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileUpload(droppedFile);
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  // ============================================================
  // Step 4: Dry-run
  // ============================================================

  const buildGeoConfig = (): GeoConfig => ({
    mode: geoMode,
    ...(geoMode === 'gps' && { colLat: geoMapping.colLat, colLng: geoMapping.colLng }),
    ...(geoMode === 'address' && {
      colAdresse: geoMapping.colAdresse || mapping.adresse,
      colCodePostal: geoMapping.colCodePostal || mapping.code_postal,
      colVille: geoMapping.colVille || mapping.ville,
    }),
    ...(geoMode === 'lambert93' && { colX: geoMapping.colX, colY: geoMapping.colY }),
  });

  const handleDryRun = async () => {
    if (!parseResult?.fileId) return;
    setIsDryRunning(true);
    setDryRunResult(null);

    try {
      const body = {
        fileId: parseResult.fileId,
        dataType,
        category: dataType === 'poi' ? category : undefined,
        regie: dataType === 'panneaux' ? regie : undefined,
        mapping,
        geolocation: buildGeoConfig(),
        limit: 100,
      };

      const res = await fetch('/api/admin/import-poi/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      setDryRunResult(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur dry-run';
      setDryRunResult({ success: false, error: msg } as DryRunResult);
    } finally {
      setIsDryRunning(false);
    }
  };

  // ============================================================
  // Step 5: Import
  // ============================================================

  const handleImport = async () => {
    if (!parseResult?.fileId) return;
    if (!confirm('Lancer l\'import reel en base Supabase ?')) return;

    setIsImporting(true);
    setImportReport(null);
    setImportProgress(null);
    setLogLines([]);

    try {
      const body = {
        fileId: parseResult.fileId,
        dataType,
        category: dataType === 'poi' ? category : undefined,
        regie: dataType === 'panneaux' ? regie : undefined,
        mapping,
        geolocation: buildGeoConfig(),
        sourceName: sourceName.trim() || undefined,
        organizationId,
        importedColumns: importedColumns.length > 0 ? importedColumns : undefined,
        filterFields: filterFields.length > 0 ? filterFields : undefined,
      };

      const res = await fetch('/api/admin/import-poi/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.body) throw new Error('Pas de stream SSE');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: ImportProgress = JSON.parse(line.slice(6));

              // Accumulate log events into the live log panel
              if (event.type === 'log' && event.logLine) {
                setLogLines((prev) => [...prev, { level: event.logLevel || 'info', line: event.logLine!, ts: Date.now() }]);
                // Auto-scroll
                requestAnimationFrame(() => {
                  if (logContainerRef.current) {
                    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                  }
                });
              } else {
                setImportProgress(event);
              }

              if (event.type === 'complete' && event.report) {
                setImportReport(event.report);
              }
            } catch { /* ignore malformed SSE */ }
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur import';
      setImportProgress({ type: 'error', message: msg });
    } finally {
      setIsImporting(false);
    }
  };

  // ============================================================
  // Helper: Column dropdown
  // ============================================================

  const columns = parseResult?.columns || [];

  function ColSelect({
    label,
    value,
    onChange,
    sample,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    sample?: boolean;
  }) {
    const selectedCol = columns.find((c) => c.name === value);

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <label className="g-label" style={{ minWidth: 130, margin: 0, flexShrink: 0 }}>{label}</label>
        <select
          className="g-input"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1 }}
        >
          <option value="">— Non mappe —</option>
          {columns.map((col) => (
            <option key={col.name} value={col.name}>{col.name}</option>
          ))}
        </select>
        {sample && selectedCol && selectedCol.sampleValues.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
            ex: {selectedCol.sampleValues[0]}
          </span>
        )}
      </div>
    );
  }

  // ============================================================
  // Map preview URL
  // ============================================================

  function getMapPreviewUrl(points: { lat: number; lng: number }[]): string {
    if (!points || points.length === 0) return '';
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats) - 0.01;
    const maxLat = Math.max(...lats) + 0.01;
    const minLng = Math.min(...lngs) - 0.01;
    const maxLng = Math.max(...lngs) + 0.01;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${minLng},${minLat},${maxLng},${maxLat}&layer=mapnik`;
  }

  // ============================================================
  // Render
  // ============================================================

  const genesisFields = dataType === 'panneaux' ? GENESIS_FIELDS_PANNEAUX : GENESIS_FIELDS_POI;
  const isStep2Valid = dataType === 'panneaux' ? regie.trim().length > 0 : category.length > 0;
  const isStep3Valid = geoMode === 'gps'
    ? !!(geoMapping.colLat && geoMapping.colLng)
    : geoMode === 'address'
      ? !!(geoMapping.colAdresse || mapping.adresse || geoMapping.colVille || mapping.ville)
      : !!(geoMapping.colX && geoMapping.colY);

  return (
    <div className="genesis-content" style={{ maxWidth: 900 }}>

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h1 className="page-title">admin / import-universel</h1>
          <span className="g-badge g-badge-orange">ADMIN</span>
          {parseResult?.success && <span className="g-badge g-badge-green">PARSED</span>}
        </div>
        <p className="page-subtitle">Import universel — Panneaux d&apos;affichage ou Points d&apos;interet (POI)</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ============================================================ */}
        {/* STEP 01 — Upload fichier */}
        {/* ============================================================ */}
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>01</span>
            <span className="g-card-title">Upload fichier</span>
            {parseResult?.success && (
              <span className="g-badge g-badge-green" style={{ marginLeft: 'auto' }}>
                {parseResult.totalRows.toLocaleString()} lignes
              </span>
            )}
          </div>
          <div className="g-card-body">
            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 8,
                padding: '32px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                backgroundColor: isDragging ? 'var(--accent-dim)' : 'transparent',
                transition: 'all 0.15s ease',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.geojson,.json,.txt,.tsv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                style={{ display: 'none' }}
              />
              {isParsing ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--accent)' }}>
                  <Spinner size={16} /> Analyse du fichier...
                </div>
              ) : file ? (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--green)', marginBottom: 4 }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {(file.size / 1024 / 1024).toFixed(2)} MB — Cliquez pour changer
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
                    Glissez un fichier ici ou cliquez pour selectionner
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
                    // formats: .csv .xlsx .xls .geojson
                  </div>
                </div>
              )}
            </div>

            {/* Parse result info */}
            {parseResult?.success && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)', marginBottom: 10 }}>
                  <span>format: <span style={{ color: 'var(--accent)' }}>{parseResult.format}</span></span>
                  <span>encoding: <span style={{ color: 'var(--accent)' }}>{parseResult.encoding}</span></span>
                  {parseResult.format === 'csv' && <span>separator: <span style={{ color: 'var(--accent)' }}>{parseResult.separator === '\t' ? 'TAB' : `"${parseResult.separator}"`}</span></span>}
                  <span>colonnes: <span style={{ color: 'var(--accent)' }}>{parseResult.columns.length}</span></span>
                  <span>lignes: <span style={{ color: 'var(--green)' }}>{parseResult.totalRows.toLocaleString()}</span></span>
                </div>

                {/* Preview table */}
                {parseResult.preview.length > 0 && (
                  <details>
                    <summary style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 6 }}>
                      Apercu des 5 premieres lignes
                    </summary>
                    <div style={{ overflow: 'auto', maxHeight: 200 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                        <thead>
                          <tr>
                            {parseResult.columns.slice(0, 8).map((col) => (
                              <th key={col.name} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', color: 'var(--accent)', textAlign: 'left', whiteSpace: 'nowrap' }}>
                                {col.name}
                              </th>
                            ))}
                            {parseResult.columns.length > 8 && <th style={{ padding: '4px 8px', color: 'var(--text-dim)' }}>...</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {parseResult.preview.map((row, idx) => (
                            <tr key={idx}>
                              {parseResult.columns.slice(0, 8).map((col) => (
                                <td key={col.name} style={{ padding: '3px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {row[col.name] ?? <span style={{ color: 'var(--text-dim)' }}>null</span>}
                                </td>
                              ))}
                              {parseResult.columns.length > 8 && <td style={{ color: 'var(--text-dim)' }}>...</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            )}

            {parseResult && !parseResult.success && (
              <div className="g-alert g-alert-error" style={{ marginTop: 12 }}>
                {parseResult.error}
              </div>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* STEP 02 — Type de donnees */}
        {/* ============================================================ */}
        {parseResult?.success && (
          <div className="g-card">
            <div className="g-card-header">
              <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>02</span>
              <span className="g-card-title">Type de donnees</span>
            </div>
            <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Radio cards */}
              {[
                { val: 'poi' as DataType, title: 'Points d\'interet (POI)', desc: 'Lycees, colleges, gares, lieux de sport, etc.' },
                { val: 'panneaux' as DataType, title: 'Panneaux d\'affichage', desc: 'Mobilier urbain publicitaire (JCDecaux, Clear Channel, etc.)' },
              ].map((opt) => (
                <label key={opt.val} className={`g-radio-card${dataType === opt.val ? ' selected' : ''}`} onClick={() => setDataType(opt.val)}>
                  <input type="radio" value={opt.val} checked={dataType === opt.val} onChange={() => setDataType(opt.val)} style={{ marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>{opt.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{opt.desc}</div>
                  </div>
                </label>
              ))}

              {/* POI: category select */}
              {dataType === 'poi' && (
                <div style={{ marginTop: 8 }}>
                  <label className="g-label">Categorie POI</label>
                  <select className="g-input" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 300 }}>
                    {POI_CATEGORIES.map((c) => (
                      <option key={c.val} value={c.val}>{c.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Panneaux: regie input */}
              {dataType === 'panneaux' && (
                <div style={{ marginTop: 8 }}>
                  <label className="g-label">Nom de la regie</label>
                  <input
                    type="text"
                    className="g-input"
                    value={regie}
                    onChange={(e) => setRegie(e.target.value)}
                    placeholder='Ex: "JCDecaux", "Clear Channel", "MULTI"'
                    style={{ maxWidth: 400 }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STEP 03 — Mapping colonnes */}
        {/* ============================================================ */}
        {parseResult?.success && isStep2Valid && (
          <div className="g-card">
            <div className="g-card-header">
              <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>03</span>
              <span className="g-card-title">Mapping colonnes</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
                {columns.length} colonnes detectees
              </span>
            </div>
            <div className="g-card-body">
              {/* Standard fields */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>
                  // champs GENESIS → colonnes fichier
                </div>
                {genesisFields.map((field) => (
                  <ColSelect
                    key={field.key}
                    label={field.label}
                    value={mapping[field.key] || ''}
                    onChange={(v) => setMapping((prev) => ({ ...prev, [field.key]: v || undefined }))}
                    sample
                  />
                ))}
              </div>

              {/* Geolocation section */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 10 }}>
                  // geolocalisation
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {GEO_MODES.map((mode) => (
                    <label key={mode.val} className={`g-radio-card${geoMode === mode.val ? ' selected' : ''}`} onClick={() => setGeoMode(mode.val)}>
                      <input type="radio" value={mode.val} checked={geoMode === mode.val} onChange={() => setGeoMode(mode.val)} style={{ marginTop: 2 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>{mode.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{mode.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>

                {/* Geo mode specific fields */}
                {geoMode === 'gps' && (
                  <div>
                    <ColSelect label="Latitude" value={geoMapping.colLat || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colLat: v }))} sample />
                    <ColSelect label="Longitude" value={geoMapping.colLng || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colLng: v }))} sample />
                  </div>
                )}
                {geoMode === 'address' && (
                  <div>
                    <ColSelect label="Adresse" value={geoMapping.colAdresse || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colAdresse: v }))} sample />
                    <ColSelect label="Code postal" value={geoMapping.colCodePostal || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colCodePostal: v }))} sample />
                    <ColSelect label="Ville" value={geoMapping.colVille || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colVille: v }))} sample />
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginTop: 4 }}>
                      // geocodage via api-adresse.data.gouv.fr (BAN) — ~100ms/adresse
                    </div>
                  </div>
                )}
                {geoMode === 'lambert93' && (
                  <div>
                    <ColSelect label="X (Est)" value={geoMapping.colX || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colX: v }))} sample />
                    <ColSelect label="Y (Nord)" value={geoMapping.colY || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colY: v }))} sample />
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginTop: 4 }}>
                      // EPSG:2154 → EPSG:4326 via proj4
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STEP 03b — Sélection des colonnes à importer + filtres      */}
        {/* ============================================================ */}
        {parseResult?.success && isStep2Valid && isStep3Valid && columns.length > 0 && (() => {
          // Compute which columns are already handled by the schema/geo mapping
          const mappedSourceCols = new Set<string>([
            ...Object.values(mapping).filter(Boolean) as string[],
            geoMapping.colLat, geoMapping.colLng,
            geoMapping.colX, geoMapping.colY,
            geoMapping.colAdresse, geoMapping.colCodePostal, geoMapping.colVille,
          ].filter(Boolean));

          // Build reverse map: source column → genesis field label
          const colToSchema: Record<string, string> = {};
          const fieldLabels: Record<string, string> = {
            nom: 'nom', adresse: 'adresse', ville: 'ville', code_postal: 'code_postal',
            departement: 'departement', region: 'region',
            reference_panneau: 'reference', type_panneau: 'type_panneau',
          };
          Object.entries(mapping).forEach(([f, src]) => { if (src) colToSchema[src] = fieldLabels[f] || f; });
          if (geoMapping.colLat) colToSchema[geoMapping.colLat] = 'latitude';
          if (geoMapping.colLng) colToSchema[geoMapping.colLng] = 'longitude';
          if (geoMapping.colX) colToSchema[geoMapping.colX] = 'X Lambert';
          if (geoMapping.colY) colToSchema[geoMapping.colY] = 'Y Lambert';
          if (geoMapping.colAdresse) colToSchema[geoMapping.colAdresse] = 'adresse (géoloc)';
          if (geoMapping.colCodePostal) colToSchema[geoMapping.colCodePostal] = 'CP (géoloc)';
          if (geoMapping.colVille) colToSchema[geoMapping.colVille] = 'ville (géoloc)';

          const unmappedCols = columns.filter(c => !mappedSourceCols.has(c.name));
          const importedCount = unmappedCols.filter(c => importedColumns.includes(c.name)).length;

          const toggleImport = (colName: string) => {
            setImportedColumns(prev => {
              const next = prev.includes(colName) ? prev.filter(c => c !== colName) : [...prev, colName];
              if (!next.includes(colName)) setFilterFields(pf => pf.filter(f => f !== colName));
              return next;
            });
          };
          const toggleFilter = (colName: string) => {
            setFilterFields(prev => prev.includes(colName) ? prev.filter(f => f !== colName) : [...prev, colName]);
          };

          return (
            <div className="g-card">
              <div className="g-card-header">
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>03b</span>
                <span className="g-card-title">Colonnes à importer</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <span className="g-badge g-badge-green">{importedCount + mappedSourceCols.size} importées</span>
                  {filterFields.length > 0 && (
                    <span className="g-badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                      {filterFields.length} filtre{filterFields.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="g-card-body">
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 10 }}>
                  // schema = toujours importé via champs GENESIS · cochez Importer pour metadata · Filtre = filtre sur la carte
                </div>

                {/* Table header */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 180px 80px 70px',
                  gap: 4, padding: '4px 8px',
                  fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
                  color: 'var(--text-dim)', borderBottom: '1px solid var(--border)',
                  marginBottom: 4,
                }}>
                  <span>Colonne · exemples</span>
                  <span>Statut</span>
                  <span style={{ textAlign: 'center' }}>Importer</span>
                  <span style={{ textAlign: 'center' }}>Filtre</span>
                </div>

                {/* Rows */}
                <div style={{ maxHeight: 400, overflow: 'auto' }}>
                  {columns.map(col => {
                    const isMapped = mappedSourceCols.has(col.name);
                    const schemaField = colToSchema[col.name];
                    const isImported = importedColumns.includes(col.name);
                    const isFilter = filterFields.includes(col.name);

                    return (
                      <div key={col.name} style={{
                        display: 'grid', gridTemplateColumns: '1fr 180px 80px 70px',
                        gap: 4, padding: '5px 8px', borderRadius: 4,
                        background: isMapped ? 'rgba(99,102,241,0.05)' : isImported ? 'transparent' : 'rgba(0,0,0,0.2)',
                        opacity: isMapped ? 0.75 : 1,
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                        alignItems: 'center',
                      }}>
                        {/* Nom + exemples */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontSize: 12, fontWeight: 600,
                            color: isMapped ? 'var(--accent)' : isImported ? 'var(--text-primary)' : 'var(--text-dim)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {col.name}
                          </div>
                          {col.sampleValues.length > 0 && (
                            <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {col.sampleValues.slice(0, 2).join(' · ')}
                            </div>
                          )}
                        </div>

                        {/* Statut */}
                        {isMapped ? (
                          <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>
                            → schema:{schemaField}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
                            {isImported ? (isFilter ? 'metadata + filtre' : 'metadata') : 'exclu'}
                          </span>
                        )}

                        {/* Importer checkbox */}
                        <div style={{ textAlign: 'center' }}>
                          {isMapped ? (
                            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>—</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={isImported}
                              onChange={() => toggleImport(col.name)}
                              style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: 14, height: 14 }}
                            />
                          )}
                        </div>

                        {/* Filtre checkbox */}
                        <div style={{ textAlign: 'center' }}>
                          {isMapped ? (
                            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>—</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={isFilter}
                              disabled={!isImported}
                              onChange={() => isImported && toggleFilter(col.name)}
                              style={{ accentColor: '#10b981', cursor: isImported ? 'pointer' : 'not-allowed', width: 14, height: 14, opacity: isImported ? 1 : 0.3 }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer actions */}
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <button
                    className="g-btn g-btn-ghost"
                    style={{ fontSize: 10, padding: '2px 8px' }}
                    onClick={() => setImportedColumns(unmappedCols.map(c => c.name))}
                  >
                    Tout importer
                  </button>
                  <button
                    className="g-btn g-btn-ghost"
                    style={{ fontSize: 10, padding: '2px 8px' }}
                    onClick={() => { setImportedColumns([]); setFilterFields([]); }}
                  >
                    Tout exclure
                  </button>
                  <button
                    className="g-btn g-btn-ghost"
                    style={{ fontSize: 10, padding: '2px 8px' }}
                    onClick={() => setFilterFields([])}
                  >
                    Effacer filtres
                  </button>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>
                    {importedCount}/{unmappedCols.length} colonnes libres importées · {filterFields.length} filtres
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ============================================================ */}
        {/* STEP 04 — Dry-run */}
        {/* ============================================================ */}
        {parseResult?.success && isStep2Valid && isStep3Valid && (
          <div className="g-card">
            <div className="g-card-header">
              <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>04</span>
              <span className="g-card-title">Test (dry-run)</span>
              {dryRunResult?.success && (
                <span className="g-badge g-badge-green" style={{ marginLeft: 'auto' }}>
                  {dryRunResult.stats.validRows} valides
                </span>
              )}
            </div>
            <div className="g-card-body">
              <button
                onClick={handleDryRun}
                disabled={isDryRunning}
                className="g-btn g-btn-success"
                style={{ minWidth: 200 }}
              >
                {isDryRunning ? <><Spinner /> Test en cours...</> : '→ Tester (100 lignes)'}
              </button>

              {dryRunResult?.success && (
                <div style={{ marginTop: 16 }}>
                  {/* Stats grid */}
                  <div className="g-grid-3">
                    <div className="stat-card">
                      <div className="stat-label">Valides</div>
                      <div className="stat-value" style={{ color: 'var(--green)' }}>{dryRunResult.stats.validRows}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Sans coords</div>
                      <div className="stat-value" style={{ color: 'var(--orange)' }}>{dryRunResult.stats.missingCoords}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Exclus</div>
                      <div className="stat-value" style={{ color: 'var(--red)' }}>{dryRunResult.stats.invalidRows}</div>
                    </div>
                  </div>

                  {/* Additional geocoding stats */}
                  {dryRunResult.stats.geocodedRows !== undefined && (
                    <div className="g-grid-3" style={{ marginTop: 8 }}>
                      <div className="stat-card">
                        <div className="stat-label">Geocodes</div>
                        <div className="stat-value" style={{ color: 'var(--accent)' }}>{dryRunResult.stats.geocodedRows}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Echecs geocodage</div>
                        <div className="stat-value" style={{ color: 'var(--red)' }}>{dryRunResult.stats.geocodeErrors}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Total fichier</div>
                        <div className="stat-value" style={{ color: 'var(--text-secondary)' }}>{dryRunResult.stats.totalRows.toLocaleString()}</div>
                      </div>
                    </div>
                  )}

                  {/* Map preview */}
                  {dryRunResult.samplePoints.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 6 }}>
                        // apercu carte — {dryRunResult.samplePoints.length} premiers points
                      </div>
                      <iframe
                        src={getMapPreviewUrl(dryRunResult.samplePoints)}
                        width="100%"
                        height="250"
                        style={{ border: '1px solid var(--border)', borderRadius: 6 }}
                        title="Apercu carte"
                      />
                    </div>
                  )}

                  {/* Sample points list */}
                  {dryRunResult.samplePoints.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        Points d&apos;apercu ({dryRunResult.samplePoints.length})
                      </summary>
                      <pre className="g-code" style={{ marginTop: 6, fontSize: 11, maxHeight: 150, overflow: 'auto' }}>
                        {JSON.stringify(dryRunResult.samplePoints, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* Errors */}
                  {dryRunResult.errors.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 12, color: 'var(--orange)', cursor: 'pointer' }}>
                        Erreurs ({dryRunResult.errors.length})
                      </summary>
                      <pre className="g-code" style={{ marginTop: 6, fontSize: 11, maxHeight: 150, overflow: 'auto', color: 'var(--orange)' }}>
                        {dryRunResult.errors.map((e) => `Ligne ${e.row}: [${e.field}] ${e.message}`).join('\n')}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              {dryRunResult && !dryRunResult.success && (
                <div className="g-alert g-alert-error" style={{ marginTop: 12 }}>
                  {dryRunResult.error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STEP 05 — Import reel */}
        {/* ============================================================ */}
        {dryRunResult?.success && dryRunResult.stats.validRows > 0 && (
          <div className="g-card">
            <div className="g-card-header">
              <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>05</span>
              <span className="g-card-title">Import reel</span>
              {importReport && (
                <span className="g-badge g-badge-green" style={{ marginLeft: 'auto' }}>
                  {importReport.inserted.toLocaleString()} inseres
                </span>
              )}
            </div>
            <div className="g-card-body">
              {/* Source metadata */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label className="g-label">Nom de la source (optionnel)</label>
                  <input
                    type="text"
                    className="g-input"
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder={`Import ${dataType} — ${new Date().toLocaleDateString('fr-FR')}`}
                  />
                </div>
                <div>
                  <label className="g-label">Organisation</label>
                  <select
                    className="g-input"
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                  >
                    {organizations.length > 0 ? (
                      organizations.map((org) => (
                        <option key={org.id} value={org.id}>{org.name}</option>
                      ))
                    ) : (
                      <option value="00000000-0000-0000-0000-000000000001">GENESIS (Global)</option>
                    )}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button
                  onClick={handleImport}
                  disabled={isImporting}
                  className="g-btn g-btn-danger"
                  style={{ minWidth: 200 }}
                >
                  {isImporting ? <><Spinner /> Import en cours...</> : 'LANCER L\'IMPORT REEL'}
                </button>
                <span style={{ fontSize: 12, color: 'var(--red)', fontFamily: 'JetBrains Mono, monospace' }}>
                  Insertion en base Supabase ({parseResult?.totalRows.toLocaleString()} lignes)
                </span>
              </div>

              {/* Progress bar */}
              {importProgress && importProgress.total && importProgress.total > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="g-progress" style={{ marginBottom: 8 }}>
                    <div
                      className="g-progress-bar"
                      style={{
                        width: `${((importProgress.processed || 0) / importProgress.total) * 100}%`,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>
                    <span>traites: <span style={{ color: 'var(--text-primary)' }}>{(importProgress.processed || 0).toLocaleString()}/{importProgress.total.toLocaleString()}</span></span>
                    {importProgress.inserted !== undefined && <span>inseres: <span style={{ color: 'var(--green)' }}>{importProgress.inserted.toLocaleString()}</span></span>}
                    {importProgress.ignored !== undefined && importProgress.ignored > 0 && <span>ignores: <span style={{ color: 'var(--orange)' }}>{importProgress.ignored.toLocaleString()}</span></span>}
                    {importProgress.errors !== undefined && importProgress.errors > 0 && <span>erreurs: <span style={{ color: 'var(--red)' }}>{importProgress.errors.toLocaleString()}</span></span>}
                  </div>
                </div>
              )}

              {/* Geocoding progress */}
              {importProgress?.type === 'geocode' && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {importProgress.message}
                </div>
              )}

              {/* Error message */}
              {importProgress?.type === 'error' && (
                <div className="g-alert g-alert-error" style={{ marginTop: 12 }}>
                  {importProgress.message}
                </div>
              )}

              {/* Final report */}
              {importReport && (
                <div style={{ marginTop: 16 }}>
                  {importReport.errors > 0 && importReport.inserted === 0 ? (
                    <div className="g-alert g-alert-error">Import echoue — {importReport.errors} erreurs, 0 inseres</div>
                  ) : importReport.errors > 0 ? (
                    <div className="g-alert g-alert-warning">Import partiel — {importReport.inserted} inseres, {importReport.errors} erreurs</div>
                  ) : (
                    <div className="g-alert g-alert-success">Import termine avec succes !</div>
                  )}
                  <div className="g-code" style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    <div><span style={{ color: 'var(--text-dim)' }}>total: </span><span style={{ color: 'var(--text-primary)' }}>{importReport.total.toLocaleString()}</span></div>
                    <div><span style={{ color: 'var(--text-dim)' }}>inseres: </span><span style={{ color: 'var(--green)' }}>{importReport.inserted.toLocaleString()}</span></div>
                    <div><span style={{ color: 'var(--text-dim)' }}>ignores: </span><span style={{ color: 'var(--orange)' }}>{importReport.ignored.toLocaleString()}</span></div>
                    <div><span style={{ color: 'var(--text-dim)' }}>erreurs: </span><span style={{ color: importReport.errors > 0 ? 'var(--red)' : 'var(--text-primary)' }}>{importReport.errors.toLocaleString()}</span></div>
                  </div>
                  {/* Afficher le message d erreur SQL si present */}
                  {importProgress?.firstError && (
                    <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--red)' }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ Erreur SQL detectee :</div>
                      <div style={{ wordBreak: 'break-all', lineHeight: 1.6 }}>{importProgress.firstError}</div>
                      <div style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: 10 }}>
                        → Si &quot;column does not exist&quot;: executer le SQL ALTER TABLE dans Supabase Dashboard
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================ */}
              {/* LIVE LOG PANEL — Journal d'erreur en direct                  */}
              {/* ============================================================ */}
              {logLines.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  {/* Log header with counters */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 6,
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 11,
                  }}>
                    <span style={{ color: 'var(--text-dim)', fontWeight: 700 }}>// JOURNAL EN DIRECT</span>
                    <span style={{ color: 'var(--green)' }}>
                      OK {logLines.filter(l => l.level === 'info' && l.line.startsWith('[OK]')).length}
                    </span>
                    <span style={{ color: 'var(--orange)' }}>
                      SKIP {logLines.filter(l => l.level === 'warn' && l.line.startsWith('[SKIP]')).length}
                    </span>
                    <span style={{ color: 'var(--red)' }}>
                      ERR {logLines.filter(l => l.level === 'error' && l.line.startsWith('[ERR]')).length}
                    </span>
                    <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>
                      {logLines.length} lignes
                    </span>
                  </div>

                  {/* Scrollable log container */}
                  <div
                    ref={logContainerRef}
                    style={{
                      background: '#0a0a0f',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '8px 12px',
                      maxHeight: 350,
                      overflowY: 'auto',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 10,
                      lineHeight: 1.7,
                    }}
                  >
                    {logLines.map((log, idx) => (
                      <div key={idx} style={{
                        color: log.level === 'error'
                          ? '#ef4444'
                          : log.level === 'warn'
                            ? '#fb923c'
                            : log.line.startsWith('[OK]')
                              ? '#22c55e'
                              : '#8b8b9a',
                        borderBottom: log.line.startsWith('---') ? '1px solid #222' : 'none',
                        paddingBottom: log.line.startsWith('---') ? 2 : 0,
                        marginBottom: log.line.startsWith('---') ? 2 : 0,
                      }}>
                        {log.line}
                      </div>
                    ))}
                    {isImporting && (
                      <div style={{ color: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite' }}>
                        {'>'} en cours...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer hint */}
        <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', borderTop: '1px solid var(--border)' }}>
          <span>// </span>Formats supportes: CSV, Excel (.xlsx/.xls), GeoJSON · Encodages: UTF-8, Latin-1 (auto-detecte)
        </div>
      </div>
    </div>
  );
}
