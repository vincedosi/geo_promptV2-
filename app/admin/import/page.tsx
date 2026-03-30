'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type {
  ParseResult,
  DryRunResult,
  ImportProgress,
  ImportReport,
  GeoMode,
  FieldMapping,
  GeoConfig,
  GeocodeDetailedResult,
} from '@/lib/import/types';

// ============================================================
// Design tokens
// ============================================================

const C = {
  bg: '#050505', bgElevated: '#0a0a0a', bgSurface: '#111111',
  border: '#1a1a1a', borderLight: 'rgba(78,205,196,0.2)',
  accent: '#4ecdc4', accentDim: 'rgba(78,205,196,0.08)',
  text: '#f0f0f0', textDim: '#a0a0a0', textSec: '#666666', muted: '#505050',
  green: '#3dffa0', greenDim: 'rgba(61,255,160,0.12)',
  red: '#f87171', redDim: 'rgba(248,113,113,0.1)',
  warn: '#fbbf24', warnDim: 'rgba(251,191,36,0.1)', blue: '#3b82f6',
};
const fontMono = "'JetBrains Mono',monospace";
const fontInter = "'Inter',system-ui,sans-serif";

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

// POI_CATEGORIES loaded dynamically from Supabase (poi_categories table)

const GENESIS_FIELDS_POI = [
  { key: 'nom', label: 'Nom', required: false },
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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite', display: 'inline-block', verticalAlign: 'middle' }}>
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

  // -- Step 2: Categorie POI
  const [category, setCategory] = useState('');

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

  // -- Geocode Review (Step 03c)
  const [geocodeId, setGeocodeId] = useState<string | null>(null);
  const [geocodeResults, setGeocodeResults] = useState<GeocodeDetailedResult[]>([]);
  const [geocodeStats, setGeocodeStats] = useState<{ green: number; orange: number; red: number } | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editAddress, setEditAddress] = useState('');
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [geocodeFilter, setGeocodeFilter] = useState<'all' | 'green' | 'orange' | 'red'>('all');
  const [isUpdatingRow, setIsUpdatingRow] = useState(false);
  const [geocodeValidated, setGeocodeValidated] = useState(false);

  // -- Column selection: which columns to include in metadata
  const [importedColumns, setImportedColumns] = useState<string[]>([]);
  // -- Filter fields: subset of importedColumns to expose as map filters
  const [filterFields, setFilterFields] = useState<string[]>([]);

  // -- Dynamic POI categories from DB
  const [poiCategories, setPoiCategories] = useState<{ val: string; label: string; icone: string }[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  // -- Back-office: Source name + Organization
  const [sourceName, setSourceName] = useState('');
  const [organizationId, setOrganizationId] = useState('00000000-0000-0000-0000-000000000001');
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);

  // Load organizations + categories on mount
  useEffect(() => {
    adminFetch('/api/admin/organizations')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.organizations) {
          setOrganizations(data.organizations.map((o: { id: string; name: string }) => ({ id: o.id, name: o.name })));
        }
      })
      .catch(() => { /* API pas encore configuree */ });

    // Load POI categories from DB
    adminFetch('/api/admin/poi-categories')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.categories) {
          const cats = data.categories.map((c: { categorie: string; label_fr: string; icone: string }) => ({
            val: c.categorie,
            label: c.label_fr || c.categorie,
            icone: c.icone || '',
          }));
          setPoiCategories(cats);
        }
      })
      .catch(() => {
        // Fallback hardcoded if API not available
        setPoiCategories([
          { val: 'lycee', label: 'Lycee', icone: '' },
          { val: 'college', label: 'College', icone: '' },
          { val: 'gare', label: 'Gare', icone: '' },
          { val: 'sport', label: 'Sport', icone: '' },
          { val: 'autre', label: 'Autre', icone: '' },
        ]);
      });
  }, []);

  // ============================================================
  // Step 1: File Upload
  // ============================================================

  const handleFileUpload = useCallback(async (uploadedFiles: File | File[]) => {
    const files = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];

    // Display first file name in UI (or bundle name for Shapefile)
    const displayName = files.length === 1 ? files[0].name : `${files.length} fichiers`;
    setFile(files[0]); // Store primary file reference
    setIsParsing(true);
    setParseResult(null);
    setDryRunResult(null);
    setImportReport(null);
    setImportProgress(null);

    try {
      const fd = new FormData();

      // Add all files to FormData
      files.forEach((file, idx) => {
        if (idx === 0) {
          fd.append('file', file); // Legacy support
        }
        fd.append('files', file);
      });

      const res = await adminFetch('/api/admin/import-poi/parse', { method: 'POST', body: fd });
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
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) handleFileUpload(droppedFiles);
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

  // ============================================================
  // Step 03c: Geocode batch (BAN API)
  // ============================================================

  const handleGeocodeBatch = async () => {
    if (!parseResult?.fileId) return;
    setIsGeocoding(true);
    setGeocodeError(null);
    setGeocodeResults([]);
    setGeocodeStats(null);
    setGeocodeId(null);
    setGeocodeValidated(false);

    try {
      const gc = buildGeoConfig();
      const body = {
        fileId: parseResult.fileId,
        colAdresse: gc.colAdresse,
        colCodePostal: gc.colCodePostal,
        colVille: gc.colVille,
      };

      const res = await adminFetch('/api/admin/geocode/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!data.success) {
        setGeocodeError(data.error || 'Erreur geocodage');
        return;
      }

      setGeocodeId(data.geocodeId);
      setGeocodeResults(data.results);
      setGeocodeStats(data.stats);
    } catch (e: unknown) {
      setGeocodeError(e instanceof Error ? e.message : 'Erreur geocodage');
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleGeocodeUpdateRow = async (rowIndex: number, action: { type: 'manual'; lat: number; lng: number } | { type: 'reGeocode'; address: string } | { type: 'ignore' }) => {
    if (!geocodeId) return;
    setIsUpdatingRow(true);

    try {
      const res = await adminFetch('/api/admin/geocode/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geocodeId, rowIndex, action }),
      });

      const data = await res.json();
      if (data.success) {
        // Update local state
        setGeocodeResults((prev) =>
          prev.map((r) => (r.rowIndex === rowIndex ? data.updatedResult : r))
        );
        setGeocodeStats(data.stats);
        setEditingRow(null);
        setEditAddress('');
        setEditLat('');
        setEditLng('');
      }
    } catch { /* ignore */ } finally {
      setIsUpdatingRow(false);
    }
  };

  // ============================================================
  // Step 4: Dry-run
  // ============================================================

  const handleDryRun = async () => {
    if (!parseResult?.fileId) return;
    setIsDryRunning(true);
    setDryRunResult(null);

    try {
      const body: Record<string, unknown> = {
        fileId: parseResult.fileId,
        dataType: 'poi',
        category,
        mapping,
        geolocation: buildGeoConfig(),
        limit: 100,
      };

      // Pass geocodeId if address mode was used with pre-geocoding
      if (geoMode === 'address' && geocodeId) {
        body.geocodeId = geocodeId;
      }

      const res = await adminFetch('/api/admin/import-poi/dry-run', {
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
      const body: Record<string, unknown> = {
        fileId: parseResult.fileId,
        dataType: 'poi',
        category,
        mapping,
        geolocation: buildGeoConfig(),
        sourceName: sourceName.trim() || undefined,
        organizationId,
        importedColumns: importedColumns.length > 0 ? importedColumns : undefined,
        filterFields: filterFields.length > 0 ? filterFields : undefined,
      };

      // Pass geocodeId if address mode was used with pre-geocoding
      if (geoMode === 'address' && geocodeId) {
        body.geocodeId = geocodeId;
      }

      const res = await adminFetch('/api/admin/import-poi/execute', {
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
        <label style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.text, minWidth: 130, margin: 0, flexShrink: 0 }}>{label}</label>
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 2,
            color: C.text,
            fontFamily: fontMono,
            fontSize: 11,
            padding: '5px 8px',
            outline: 'none',
          }}
        >
          <option value="">— Non mappe —</option>
          {columns.map((col) => (
            <option key={col.name} value={col.name}>{col.name}</option>
          ))}
        </select>
        {sample && selectedCol && selectedCol.sampleValues.length > 0 && (
          <span style={{ fontSize: 11, color: C.textDim, fontFamily: fontMono, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
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

  const genesisFields = GENESIS_FIELDS_POI;
  const isStep2Valid = category.length > 0;
  const isStep3Valid = geoMode === 'gps'
    ? !!(geoMapping.colLat && geoMapping.colLng)
    : geoMode === 'address'
      ? !!(geoMapping.colAdresse || mapping.adresse || geoMapping.colVille || mapping.ville)
      : !!(geoMapping.colX && geoMapping.colY);

  // For address mode: geocode step must be completed and validated before proceeding
  const isGeocodeReady = geoMode !== 'address' || geocodeValidated;

  const sLabel: React.CSSProperties = {
    fontFamily: fontInter,
    fontSize: 12,
    fontWeight: 500,
    color: C.text,
    margin: 0,
    display: 'block',
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 2,
    color: C.text,
    fontFamily: fontMono,
    fontSize: 11,
    padding: '6px 10px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };

  const btnPrimary: React.CSSProperties = {
    fontFamily: fontInter,
    fontSize: 12,
    fontWeight: 500,
    background: C.accentDim,
    border: `1px solid ${C.borderLight}`,
    borderRadius: 2,
    color: '#050505',
    padding: '7px 16px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  const btnSuccess: React.CSSProperties = {
    fontFamily: fontInter,
    fontSize: 12,
    fontWeight: 500,
    background: C.greenDim,
    border: `1px solid rgba(61,255,160,0.3)`,
    borderRadius: 2,
    color: C.green,
    padding: '7px 16px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  const btnDanger: React.CSSProperties = {
    fontFamily: fontInter,
    fontSize: 12,
    fontWeight: 500,
    background: C.redDim,
    border: `1px solid rgba(248,113,113,0.3)`,
    borderRadius: 2,
    color: C.red,
    padding: '7px 16px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  const btnGhost: React.CSSProperties = {
    fontFamily: fontInter,
    fontSize: 12,
    fontWeight: 500,
    background: 'transparent',
    border: `1px solid ${C.border}`,
    borderRadius: 2,
    color: C.textDim,
    padding: '4px 10px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  };

  const card: React.CSSProperties = {
    background: C.bgElevated,
    border: `1px solid ${C.border}`,
    borderRadius: 2,
  };

  const cardHeader: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderBottom: `1px solid ${C.border}`,
  };

  const cardBody: React.CSSProperties = {
    padding: '14px',
  };

  const stepNum: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 11,
    color: C.accent,
    fontWeight: 700,
  };

  const cardTitle: React.CSSProperties = {
    fontFamily: fontInter,
    fontSize: 12,
    fontWeight: 500,
    color: C.text,
  };

  const badge = (color: string, bg: string, border: string): React.CSSProperties => ({
    fontFamily: fontInter,
    fontSize: 11,
    fontWeight: 500,
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 2,
    color: color,
    padding: '2px 6px',
    display: 'inline-block',
  });

  const badgeGreen = badge(C.green, C.greenDim, 'rgba(61,255,160,0.3)');
  const badgeWarn = badge(C.warn, C.warnDim, 'rgba(251,191,36,0.3)');
  const badgeRed = badge(C.red, C.redDim, 'rgba(248,113,113,0.3)');
  const badgeAccent = badge(C.accent, C.accentDim, C.borderLight);

  const statusColor = (s: string) =>
    s === 'green' ? C.green : s === 'orange' ? C.warn : C.red;
  const statusLabel = (s: string) =>
    s === 'green' ? 'OK' : s === 'orange' ? 'Approx.' : 'Echec';

  return (
    <div style={{ maxWidth: 900, fontFamily: fontInter, color: C.text }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h1 style={{ fontFamily: fontInter, fontSize: 18, fontWeight: 500, color: C.text, margin: 0 }}>
            Import POI
          </h1>
          <span style={badgeWarn}>Admin</span>
          {parseResult?.success && <span style={badgeGreen}>Parsé</span>}
        </div>
        <p style={{ fontFamily: fontInter, fontSize: 12, color: C.textDim, margin: 0 }}>
          Import Points d&apos;interet (POI)
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ============================================================ */}
        {/* STEP 01 — Upload fichier */}
        {/* ============================================================ */}
        <div style={card}>
          <div style={cardHeader}>
            <span style={stepNum}>01</span>
            <span style={cardTitle}>Upload fichier</span>
            {parseResult?.success && (
              <span style={{ ...badgeGreen, marginLeft: 'auto' }}>
                {parseResult.totalRows.toLocaleString()} lignes
              </span>
            )}
          </div>
          <div style={cardBody}>
            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? C.accent : C.border}`,
                borderRadius: 2,
                padding: '28px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                backgroundColor: isDragging ? C.accentDim : 'transparent',
                transition: 'all 0.15s ease',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,.xlsx,.xls,.geojson,.json,.txt,.tsv,.shp,.dbf,.prj,.shx"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) handleFileUpload(files);
                }}
                style={{ display: 'none' }}
              />
              {isParsing ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.accent, fontFamily: fontMono, fontSize: 12 }}>
                  <Spinner size={16} /> Analyse du fichier...
                </div>
              ) : file ? (
                <div>
                  <div style={{ fontFamily: fontMono, fontSize: 13, fontWeight: 600, color: C.green, marginBottom: 4 }}>
                    {file.name}
                  </div>
                  <div style={{ fontFamily: fontMono, fontSize: 11, color: C.textDim }}>
                    {parseResult?.format === 'shapefile' ? (
                      <span>Shapefile bundle — {parseResult.totalRows?.toLocaleString()} enregistrements</span>
                    ) : (
                      <>{(file.size / 1024 / 1024).toFixed(2)} MB — Cliquez pour changer</>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontFamily: fontInter, fontSize: 13, color: C.text, marginBottom: 6 }}>
                    Glissez un ou plusieurs fichiers ici ou cliquez pour selectionner
                  </div>
                  <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
                    // formats: .csv .xlsx .geojson | Shapefile (.shp+.dbf+.prj+.shx)
                  </div>
                </div>
              )}
            </div>

            {/* Parse result info */}
            {parseResult?.success && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontFamily: fontMono, fontSize: 10, color: C.textDim, marginBottom: 10 }}>
                  <span>format: <span style={{ color: C.accent }}>{parseResult.format}</span></span>
                  <span>encoding: <span style={{ color: C.accent }}>{parseResult.encoding}</span></span>
                  {parseResult.format === 'csv' && <span>separator: <span style={{ color: C.accent }}>{parseResult.separator === '\t' ? 'TAB' : `"${parseResult.separator}"`}</span></span>}
                  <span>colonnes: <span style={{ color: C.accent }}>{parseResult.columns.length}</span></span>
                  <span>lignes: <span style={{ color: C.green }}>{parseResult.totalRows.toLocaleString()}</span></span>
                </div>

                {/* Shapefile info box */}
                {parseResult.format === 'shapefile' && (
                  <div style={{ background: C.greenDim, border: `1px solid rgba(61,255,160,0.25)`, borderRadius: 2, padding: '8px 12px', marginBottom: 10, fontFamily: fontMono, fontSize: 11, color: C.green }}>
                    [OK] Shapefile detecte et parse avec succes. Les attributs du fichier .dbf sont maintenant disponibles.
                  </div>
                )}

                {/* Preview table */}
                {parseResult.preview.length > 0 && (
                  <details>
                    <summary style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, cursor: 'pointer', marginBottom: 6 }}>
                      Apercu — 5 premieres lignes
                    </summary>
                    <div style={{ overflow: 'auto', maxHeight: 200, marginTop: 6 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontMono, fontSize: 10 }}>
                        <thead>
                          <tr style={{ background: C.bgSurface }}>
                            {parseResult.columns.slice(0, 8).map((col) => (
                              <th key={col.name} style={{ padding: '5px 8px', borderBottom: `1px solid ${C.border}`, color: C.accent, textAlign: 'left', whiteSpace: 'nowrap', fontFamily: fontInter, fontSize: 11, fontWeight: 500 }}>
                                {col.name}
                              </th>
                            ))}
                            {parseResult.columns.length > 8 && <th style={{ padding: '5px 8px', color: C.muted }}>...</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {parseResult.preview.map((row, idx) => (
                            <tr key={idx} style={{ background: idx % 2 === 0 ? 'transparent' : C.bgSurface }}>
                              {parseResult.columns.slice(0, 8).map((col) => (
                                <td key={col.name} style={{ padding: '4px 8px', borderBottom: `1px solid ${C.border}`, color: C.textDim, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>
                                  {row[col.name] ?? <span style={{ color: C.muted }}>null</span>}
                                </td>
                              ))}
                              {parseResult.columns.length > 8 && <td style={{ color: C.muted }}>...</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Shapefile tips */}
            {!file && (
              <div style={{ marginTop: 12, padding: 12, background: C.bgSurface, borderRadius: 2, border: `1px solid ${C.border}`, fontFamily: fontInter, fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>
                <div style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.text, marginBottom: 8 }}>Formats supportes</div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  <li><strong style={{ color: C.textDim }}>Fichier unique :</strong> CSV, XLSX, TSV, GeoJSON</li>
                  <li><strong style={{ color: C.textDim }}>Shapefile :</strong> Selectionnez les fichiers .shp, .dbf, .prj, .shx ensemble (meme nom de base).</li>
                  <li><strong style={{ color: C.textDim }}>Carreaux INSEE :</strong> Le systeme detecte automatiquement les colonnes.</li>
                </ul>
              </div>
            )}

            {parseResult && !parseResult.success && (
              <div style={{ marginTop: 12, background: C.redDim, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red }}>
                ! {parseResult.error}
              </div>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* STEP 02 — Categorie POI */}
        {/* ============================================================ */}
        {parseResult?.success && (
          <div style={card}>
            <div style={cardHeader}>
              <span style={stepNum}>02</span>
              <span style={cardTitle}>Categorie POI</span>
            </div>
            <div style={{ ...cardBody, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={sLabel}>Categorie</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{ ...inputStyle, maxWidth: 300, color: category ? undefined : C.muted }}
                  >
                    <option value="" disabled>-- Choisir une categorie --</option>
                    {poiCategories.map((c) => (
                      <option key={c.val} value={c.val}>{c.icone ? `${c.icone} ${c.label}` : c.label}</option>
                    ))}
                  </select>
                  {poiCategories.length === 0 && (
                    <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>Chargement...</span>
                  )}
                </div>
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.accent, cursor: 'pointer' }}>
                    + Creer une nouvelle categorie
                  </summary>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="Ex: cirfa, commerce, sante..."
                      style={{ ...inputStyle, maxWidth: 250, fontSize: 11, padding: '5px 8px' }}
                    />
                    <button
                      style={{ ...btnSuccess, opacity: (!newCategoryName.trim() || isCreatingCategory) ? 0.5 : 1 }}
                      disabled={!newCategoryName.trim() || isCreatingCategory}
                      onClick={async () => {
                        setIsCreatingCategory(true);
                        try {
                          const res = await adminFetch('/api/admin/poi-categories', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ categorie: newCategoryName.trim() }),
                          });
                          const data = await res.json();
                          if (data.success) {
                            const res2 = await adminFetch('/api/admin/poi-categories');
                            const data2 = await res2.json();
                            if (data2.success) {
                              const cats = data2.categories.map((c: { categorie: string; label_fr: string; icone: string }) => ({
                                val: c.categorie, label: c.label_fr || c.categorie, icone: c.icone || '',
                              }));
                              setPoiCategories(cats);
                            }
                            setCategory(data.categorie);
                            setNewCategoryName('');
                          }
                        } catch { /* ignore */ } finally {
                          setIsCreatingCategory(false);
                        }
                      }}
                    >
                      {isCreatingCategory ? <Spinner size={10} /> : 'Creer'}
                    </button>
                  </div>
                </details>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STEP 03 — Mapping colonnes */}
        {/* ============================================================ */}
        {parseResult?.success && isStep2Valid && (
          <div style={card}>
            <div style={cardHeader}>
              <span style={stepNum}>03</span>
              <span style={cardTitle}>Mapping colonnes</span>
              <span style={{ marginLeft: 'auto', fontFamily: fontMono, fontSize: 10, color: C.muted }}>
                {columns.length} colonnes detectees
              </span>
            </div>
            <div style={cardBody}>
              {/* Standard fields */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginBottom: 10 }}>
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
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginBottom: 12 }}>
                  // geolocalisation
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  {GEO_MODES.map((mode) => (
                    <label
                      key={mode.val}
                      onClick={() => setGeoMode(mode.val)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '9px 12px',
                        borderRadius: 2,
                        border: `1px solid ${geoMode === mode.val ? C.borderLight : C.border}`,
                        background: geoMode === mode.val ? C.accentDim : C.bgSurface,
                        cursor: 'pointer',
                      }}
                    >
                      <input type="radio" value={mode.val} checked={geoMode === mode.val} onChange={() => setGeoMode(mode.val)} style={{ marginTop: 2, accentColor: C.accent }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: geoMode === mode.val ? C.accent : C.text, marginBottom: 2 }}>{mode.title}</div>
                        <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim }}>{mode.desc}</div>
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
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginTop: 4 }}>
                      // geocodage via api-adresse.data.gouv.fr (BAN) — ~100ms/adresse
                    </div>
                  </div>
                )}
                {geoMode === 'lambert93' && (
                  <div>
                    <ColSelect label="X (Est)" value={geoMapping.colX || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colX: v }))} sample />
                    <ColSelect label="Y (Nord)" value={geoMapping.colY || ''} onChange={(v) => setGeoMapping((p) => ({ ...p, colY: v }))} sample />
                    <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginTop: 4 }}>
                      // EPSG:2154 → EPSG:4326 via proj4
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STEP 03b — Selection des colonnes a importer + filtres        */}
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
          if (geoMapping.colAdresse) colToSchema[geoMapping.colAdresse] = 'adresse (geoloc)';
          if (geoMapping.colCodePostal) colToSchema[geoMapping.colCodePostal] = 'CP (geoloc)';
          if (geoMapping.colVille) colToSchema[geoMapping.colVille] = 'ville (geoloc)';

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
            <div style={card}>
              <div style={cardHeader}>
                <span style={stepNum}>03b</span>
                <span style={cardTitle}>Colonnes a importer</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <span style={badgeGreen}>{importedCount + mappedSourceCols.size} importees</span>
                  {filterFields.length > 0 && (
                    <span style={badgeAccent}>
                      {filterFields.length} filtre{filterFields.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
              <div style={cardBody}>
                <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginBottom: 10 }}>
                  // schema = toujours importe via champs GENESIS · cochez Importer pour metadata · Filtre = filtre carte
                </div>

                {/* Table header */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 180px 80px 70px',
                  gap: 4, padding: '5px 8px',
                  fontFamily: fontInter, fontSize: 11, fontWeight: 500,
                  color: C.muted, borderBottom: `1px solid ${C.border}`,
                  marginBottom: 4,
                }}>
                  <span>Colonne / exemples</span>
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
                        gap: 4, padding: '5px 8px', borderRadius: 2,
                        background: isMapped ? 'rgba(78,205,196,0.04)' : isImported ? 'transparent' : 'rgba(0,0,0,0.2)',
                        opacity: isMapped ? 0.75 : 1,
                        borderBottom: `1px solid ${C.border}`,
                        alignItems: 'center',
                      }}>
                        {/* Nom + exemples */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontFamily: fontMono,
                            fontSize: 11,
                            fontWeight: 600,
                            color: isMapped ? C.accent : isImported ? C.text : C.muted,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {col.name}
                          </div>
                          {col.sampleValues.length > 0 && (
                            <div style={{ fontFamily: fontMono, fontSize: 9, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {col.sampleValues.slice(0, 2).join(' · ')}
                            </div>
                          )}
                        </div>

                        {/* Statut */}
                        {isMapped ? (
                          <span style={{ fontFamily: fontMono, fontSize: 9, color: C.accent }}>
                            → schema:{schemaField}
                          </span>
                        ) : (
                          <span style={{ fontFamily: fontMono, fontSize: 9, color: C.muted }}>
                            {isImported ? (isFilter ? 'metadata + filtre' : 'metadata') : 'exclu'}
                          </span>
                        )}

                        {/* Importer checkbox */}
                        <div style={{ textAlign: 'center' }}>
                          {isMapped ? (
                            <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>—</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={isImported}
                              onChange={() => toggleImport(col.name)}
                              style={{ accentColor: C.accent, cursor: 'pointer', width: 13, height: 13 }}
                            />
                          )}
                        </div>

                        {/* Filtre checkbox */}
                        <div style={{ textAlign: 'center' }}>
                          {isMapped ? (
                            <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>—</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={isFilter}
                              disabled={!isImported}
                              onChange={() => isImported && toggleFilter(col.name)}
                              style={{ accentColor: C.green, cursor: isImported ? 'pointer' : 'not-allowed', width: 13, height: 13, opacity: isImported ? 1 : 0.3 }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer actions */}
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                  <button style={btnGhost} onClick={() => setImportedColumns(unmappedCols.map(c => c.name))}>
                    Tout importer
                  </button>
                  <button style={btnGhost} onClick={() => { setImportedColumns([]); setFilterFields([]); }}>
                    Tout exclure
                  </button>
                  <button style={btnGhost} onClick={() => setFilterFields([])}>
                    Effacer filtres
                  </button>
                  <span style={{ fontFamily: fontMono, fontSize: 9, color: C.muted, marginLeft: 'auto' }}>
                    {importedCount}/{unmappedCols.length} colonnes libres · {filterFields.length} filtres
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ============================================================ */}
        {/* STEP 03c — Geocodage adresses (BAN API)                       */}
        {/* ============================================================ */}
        {parseResult?.success && isStep2Valid && isStep3Valid && geoMode === 'address' && (() => {
          const filteredResults = geocodeFilter === 'all'
            ? geocodeResults
            : geocodeResults.filter((r) => r.status === geocodeFilter);

          // Sort: red first, then orange, then green
          const sortedResults = [...filteredResults].sort((a, b) => {
            const order = { red: 0, orange: 1, green: 2 };
            return order[a.status] - order[b.status];
          });

          return (
            <div style={card}>
              <div style={cardHeader}>
                <span style={stepNum}>03c</span>
                <span style={cardTitle}>Geocodage adresses</span>
                {geocodeStats && (
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <span style={badgeGreen}>{geocodeStats.green} OK</span>
                    {geocodeStats.orange > 0 && (
                      <span style={badgeWarn}>{geocodeStats.orange} approx.</span>
                    )}
                    {geocodeStats.red > 0 && (
                      <span style={badgeRed}>{geocodeStats.red} echecs</span>
                    )}
                  </div>
                )}
              </div>
              <div style={cardBody}>
                <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginBottom: 12 }}>
                  // geocodage via api-adresse.data.gouv.fr (BAN) — endpoint batch CSV
                </div>

                {/* Launch button */}
                {!geocodeId && (
                  <button
                    onClick={handleGeocodeBatch}
                    disabled={isGeocoding}
                    style={{ ...btnSuccess, minWidth: 250, opacity: isGeocoding ? 0.6 : 1 }}
                  >
                    {isGeocoding ? <><Spinner /> Geocodage en cours...</> : `Lancer le geocodage (${parseResult.totalRows} adresses)`}
                  </button>
                )}

                {geocodeError && (
                  <div style={{ marginTop: 12, background: C.redDim, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red }}>
                    ! {geocodeError}
                  </div>
                )}

                {/* Results review */}
                {geocodeResults.length > 0 && geocodeStats && (
                  <div style={{ marginTop: 16 }}>
                    {/* Stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                      {[
                        { key: 'green', label: 'Geocodes OK', val: geocodeStats.green, note: 'score >= 0.6', color: C.green },
                        { key: 'orange', label: 'Approximatifs', val: geocodeStats.orange, note: 'score 0.3–0.6', color: C.warn },
                        { key: 'red', label: 'Non trouves', val: geocodeStats.red, note: 'score < 0.3', color: C.red },
                      ].map(({ key, label, val, note, color }) => (
                        <div
                          key={key}
                          onClick={() => setGeocodeFilter(key as 'green' | 'orange' | 'red')}
                          style={{
                            background: C.bgSurface,
                            border: `1px solid ${geocodeFilter === key ? color : C.border}`,
                            borderRadius: 2,
                            padding: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontFamily: fontInter, fontSize: 8, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>{label}</div>
                          <div style={{ fontFamily: fontInter, fontSize: 22, color, fontWeight: 700 }}>{val}</div>
                          <div style={{ fontFamily: fontMono, fontSize: 9, color: C.muted, marginTop: 4 }}>{note}</div>
                        </div>
                      ))}
                    </div>

                    {/* Filter bar */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
                      {(['all', 'red', 'orange', 'green'] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setGeocodeFilter(f)}
                          style={{
                            fontFamily: fontInter,
                            fontSize: 12,
                            fontWeight: 500,
                            padding: '4px 10px',
                            borderRadius: 2,
                            cursor: 'pointer',
                            background: geocodeFilter === f
                              ? (f === 'all' ? C.accentDim : `${statusColor(f)}22`)
                              : 'transparent',
                            color: geocodeFilter === f
                              ? (f === 'all' ? C.accent : statusColor(f))
                              : C.muted,
                            border: `1px solid ${geocodeFilter === f
                              ? (f === 'all' ? C.accent : statusColor(f))
                              : C.border}`,
                          }}
                        >
                          {f === 'all' ? `Tous (${geocodeResults.length})` : `${statusLabel(f)} (${geocodeResults.filter(r => r.status === f).length})`}
                        </button>
                      ))}
                      <span style={{ marginLeft: 'auto', fontFamily: fontMono, fontSize: 9, color: C.muted }}>
                        {filteredResults.length} resultats affiches
                      </span>
                    </div>

                    {/* Results table */}
                    <div style={{ maxHeight: 500, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 2 }}>
                      {/* Table header */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '50px 1fr 1fr 60px 70px 120px',
                        gap: 4, padding: '6px 8px',
                        fontFamily: fontInter, fontSize: 11, fontWeight: 500,
                        color: C.muted, borderBottom: `1px solid ${C.border}`,
                        position: 'sticky', top: 0, background: C.bgElevated, zIndex: 1,
                      }}>
                        <span>#</span>
                        <span>Adresse saisie</span>
                        <span>Resultat BAN</span>
                        <span>Score</span>
                        <span>Statut</span>
                        <span>Actions</span>
                      </div>

                      {/* Table rows (show max 200 for performance) */}
                      {sortedResults.slice(0, 200).map((result) => (
                        <div key={result.rowIndex}>
                          <div style={{
                            display: 'grid', gridTemplateColumns: '50px 1fr 1fr 60px 70px 120px',
                            gap: 4, padding: '5px 8px',
                            borderBottom: `1px solid ${C.border}`,
                            alignItems: 'center',
                            background: result.status === 'red'
                              ? 'rgba(248,113,113,0.04)'
                              : result.status === 'orange'
                                ? 'rgba(251,191,36,0.03)'
                                : 'transparent',
                          }}>
                            <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>{result.rowIndex + 1}</span>
                            <span style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={result.inputAddress}>
                              {result.inputAddress || <i style={{ color: C.muted }}>vide</i>}
                            </span>
                            <span style={{ fontFamily: fontMono, fontSize: 10, color: result.status === 'green' ? C.text : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={result.resultLabel}>
                              {result.resultLabel || '—'}
                              {result.manualOverride && <span style={{ fontFamily: fontMono, fontSize: 9, color: C.accent, marginLeft: 4 }}>[edit]</span>}
                            </span>
                            <span style={{ fontFamily: fontMono, fontSize: 10, color: statusColor(result.status), fontWeight: 600 }}>
                              {result.score.toFixed(2)}
                            </span>
                            <span style={{ fontFamily: fontInter, fontSize: 11, fontWeight: 600, color: statusColor(result.status) }}>
                              {statusLabel(result.status)}
                            </span>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {result.status !== 'green' && (
                                <>
                                  <button
                                    style={{ ...btnGhost, fontSize: 8, padding: '2px 6px' }}
                                    onClick={() => {
                                      setEditingRow(editingRow === result.rowIndex ? null : result.rowIndex);
                                      setEditAddress(result.inputAddress);
                                      setEditLat(result.lat?.toString() || '');
                                      setEditLng(result.lng?.toString() || '');
                                    }}
                                  >
                                    {editingRow === result.rowIndex ? 'Fermer' : 'Corriger'}
                                  </button>
                                  <button
                                    style={{ ...btnGhost, fontSize: 8, padding: '2px 6px', opacity: isUpdatingRow ? 0.5 : 1 }}
                                    onClick={() => handleGeocodeUpdateRow(result.rowIndex, { type: 'ignore' })}
                                    disabled={isUpdatingRow}
                                  >
                                    Ignorer
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Inline edit form */}
                          {editingRow === result.rowIndex && (
                            <div style={{
                              padding: '10px 8px 10px 58px',
                              background: C.accentDim,
                              borderBottom: `1px solid ${C.border}`,
                              display: 'flex', flexDirection: 'column', gap: 8,
                            }}>
                              {/* Re-geocode with corrected address */}
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <label style={{ fontFamily: fontInter, fontSize: 11, fontWeight: 500, color: C.muted, minWidth: 80 }}>Adresse :</label>
                                <input
                                  type="text"
                                  value={editAddress}
                                  onChange={(e) => setEditAddress(e.target.value)}
                                  style={{ ...inputStyle, flex: 1, fontSize: 10, padding: '4px 8px' }}
                                  placeholder="Corrigez l'adresse et re-geocodez"
                                />
                                <button
                                  style={{ ...btnSuccess, fontSize: 9, padding: '4px 10px', opacity: (!editAddress.trim() || isUpdatingRow) ? 0.5 : 1 }}
                                  disabled={!editAddress.trim() || isUpdatingRow}
                                  onClick={() => handleGeocodeUpdateRow(result.rowIndex, { type: 'reGeocode', address: editAddress.trim() })}
                                >
                                  {isUpdatingRow ? <Spinner size={10} /> : 'Re-geocoder'}
                                </button>
                              </div>
                              {/* Manual lat/lng */}
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <label style={{ fontFamily: fontInter, fontSize: 11, fontWeight: 500, color: C.muted, minWidth: 80 }}>Manuel :</label>
                                <input
                                  type="text"
                                  value={editLat}
                                  onChange={(e) => setEditLat(e.target.value)}
                                  style={{ ...inputStyle, width: 100, fontSize: 10, padding: '4px 8px' }}
                                  placeholder="Latitude"
                                />
                                <input
                                  type="text"
                                  value={editLng}
                                  onChange={(e) => setEditLng(e.target.value)}
                                  style={{ ...inputStyle, width: 100, fontSize: 10, padding: '4px 8px' }}
                                  placeholder="Longitude"
                                />
                                <button
                                  style={{ ...btnSuccess, fontSize: 9, padding: '4px 10px', opacity: (!editLat || !editLng || isNaN(Number(editLat)) || isNaN(Number(editLng)) || isUpdatingRow) ? 0.5 : 1 }}
                                  disabled={!editLat || !editLng || isNaN(Number(editLat)) || isNaN(Number(editLng)) || isUpdatingRow}
                                  onClick={() => handleGeocodeUpdateRow(result.rowIndex, { type: 'manual', lat: Number(editLat), lng: Number(editLng) })}
                                >
                                  Valider coords
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}

                      {sortedResults.length > 200 && (
                        <div style={{ padding: 12, textAlign: 'center', fontFamily: fontMono, fontSize: 10, color: C.muted }}>
                          ... et {sortedResults.length - 200} autres resultats (utilisez les filtres pour affiner)
                        </div>
                      )}
                    </div>

                    {/* Validate button */}
                    <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button
                        style={{ ...btnSuccess, minWidth: 200, opacity: geocodeStats.green === 0 ? 0.4 : 1 }}
                        onClick={() => setGeocodeValidated(true)}
                        disabled={geocodeStats.green === 0}
                      >
                        Valider le geocodage ({geocodeStats.green + geocodeStats.orange} lignes avec coordonnees)
                      </button>
                      {geocodeStats.red > 0 && (
                        <span style={{ fontFamily: fontMono, fontSize: 10, color: C.warn }}>
                          ! {geocodeStats.red} ligne{geocodeStats.red > 1 ? 's' : ''} sans coordonnees (seront exclues)
                        </span>
                      )}
                      {geocodeValidated && (
                        <span style={{ ...badgeGreen, marginLeft: 'auto' }}>VALIDE</span>
                      )}
                    </div>

                    {/* Re-geocode button */}
                    <div style={{ marginTop: 8 }}>
                      <button
                        style={btnGhost}
                        onClick={() => {
                          setGeocodeId(null);
                          setGeocodeResults([]);
                          setGeocodeStats(null);
                          setGeocodeValidated(false);
                          setGeocodeError(null);
                        }}
                      >
                        Relancer tout le geocodage
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ============================================================ */}
        {/* STEP 04 — Dry-run */}
        {/* ============================================================ */}
        {parseResult?.success && isStep2Valid && isStep3Valid && isGeocodeReady && (
          <div style={card}>
            <div style={cardHeader}>
              <span style={stepNum}>04</span>
              <span style={cardTitle}>Test (dry-run)</span>
              {dryRunResult?.success && (
                <span style={{ ...badgeGreen, marginLeft: 'auto' }}>
                  {dryRunResult.stats.validRows} valides
                </span>
              )}
            </div>
            <div style={cardBody}>
              <button
                onClick={handleDryRun}
                disabled={isDryRunning}
                style={{ ...btnSuccess, minWidth: 200, opacity: isDryRunning ? 0.6 : 1 }}
              >
                {isDryRunning ? <><Spinner /> Test en cours...</> : '> Tester (100 lignes)'}
              </button>

              {dryRunResult?.success && (
                <div style={{ marginTop: 16 }}>
                  {/* Stats grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {[
                      { label: 'Valides', val: dryRunResult.stats.validRows, color: C.green },
                      { label: 'Sans coords', val: dryRunResult.stats.missingCoords, color: C.warn },
                      { label: 'Exclus', val: dryRunResult.stats.invalidRows, color: C.red },
                    ].map(({ label, val, color }) => (
                      <div key={label} style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: 12 }}>
                        <div style={{ fontFamily: fontInter, fontSize: 8, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>{label}</div>
                        <div style={{ fontFamily: fontInter, fontSize: 22, color, fontWeight: 700 }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Additional geocoding stats */}
                  {dryRunResult.stats.geocodedRows !== undefined && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 10 }}>
                      {[
                        { label: 'Geocodes', val: dryRunResult.stats.geocodedRows, color: C.accent },
                        { label: 'Echecs geocodage', val: dryRunResult.stats.geocodeErrors, color: C.red },
                        { label: 'Total fichier', val: dryRunResult.stats.totalRows.toLocaleString(), color: C.textDim },
                      ].map(({ label, val, color }) => (
                        <div key={label} style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: 12 }}>
                          <div style={{ fontFamily: fontInter, fontSize: 8, fontWeight: 500, color: C.textDim, marginBottom: 6 }}>{label}</div>
                          <div style={{ fontFamily: fontInter, fontSize: 22, color, fontWeight: 700 }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Map preview */}
                  {dryRunResult.samplePoints.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginBottom: 6 }}>
                        // apercu carte — {dryRunResult.samplePoints.length} premiers points
                      </div>
                      <iframe
                        src={getMapPreviewUrl(dryRunResult.samplePoints)}
                        width="100%"
                        height="250"
                        style={{ border: `1px solid ${C.border}`, borderRadius: 2, display: 'block' }}
                        title="Apercu carte"
                      />
                    </div>
                  )}

                  {/* Sample points list */}
                  {dryRunResult.samplePoints.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.textDim, cursor: 'pointer' }}>
                        Points d&apos;apercu ({dryRunResult.samplePoints.length})
                      </summary>
                      <pre style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: 10, fontFamily: fontMono, fontSize: 10, maxHeight: 150, overflow: 'auto', marginTop: 6, color: C.textDim }}>
                        {JSON.stringify(dryRunResult.samplePoints, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* Errors */}
                  {dryRunResult.errors.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.warn, cursor: 'pointer' }}>
                        Erreurs ({dryRunResult.errors.length})
                      </summary>
                      <pre style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: 10, fontFamily: fontMono, fontSize: 10, maxHeight: 150, overflow: 'auto', marginTop: 6, color: C.warn }}>
                        {dryRunResult.errors.map((e) => `Ligne ${e.row}: [${e.field}] ${e.message}`).join('\n')}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              {dryRunResult && !dryRunResult.success && (
                <div style={{ marginTop: 12, background: C.redDim, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red }}>
                  ! {dryRunResult.error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STEP 05 — Import reel */}
        {/* ============================================================ */}
        {dryRunResult?.success && dryRunResult.stats.validRows > 0 && (
          <div style={card}>
            <div style={cardHeader}>
              <span style={stepNum}>05</span>
              <span style={cardTitle}>Import reel</span>
              {importReport && (
                <span style={{ ...badgeGreen, marginLeft: 'auto' }}>
                  {importReport.inserted.toLocaleString()} inseres
                </span>
              )}
            </div>
            <div style={cardBody}>
              {/* Source metadata */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={sLabel}>Nom de la source (optionnel)</label>
                  <input
                    type="text"
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder={`Import POI — ${new Date().toLocaleDateString('fr-FR')}`}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={sLabel}>Organisation</label>
                  <select
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                    style={inputStyle}
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
                  style={{ ...btnDanger, minWidth: 200, opacity: isImporting ? 0.6 : 1 }}
                >
                  {isImporting ? <><Spinner /> Import en cours...</> : 'LANCER L\'IMPORT REEL'}
                </button>
                <span style={{ fontFamily: fontMono, fontSize: 11, color: C.red }}>
                  ! Insertion en base Supabase ({parseResult?.totalRows.toLocaleString()} lignes)
                </span>
              </div>

              {/* Progress bar */}
              {importProgress && importProgress.total && importProgress.total > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, height: 6, overflow: 'hidden', marginBottom: 8 }}>
                    <div
                      style={{
                        height: '100%',
                        background: C.accent,
                        borderRadius: 2,
                        width: `${((importProgress.processed || 0) / importProgress.total) * 100}%`,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
                    <span>traites: <span style={{ color: C.text }}>{(importProgress.processed || 0).toLocaleString()}/{importProgress.total.toLocaleString()}</span></span>
                    {importProgress.inserted !== undefined && <span>inseres: <span style={{ color: C.green }}>{importProgress.inserted.toLocaleString()}</span></span>}
                    {importProgress.ignored !== undefined && importProgress.ignored > 0 && <span>ignores: <span style={{ color: C.warn }}>{importProgress.ignored.toLocaleString()}</span></span>}
                    {importProgress.errors !== undefined && importProgress.errors > 0 && <span>erreurs: <span style={{ color: C.red }}>{importProgress.errors.toLocaleString()}</span></span>}
                  </div>
                </div>
              )}

              {/* Geocoding progress */}
              {importProgress?.type === 'geocode' && (
                <div style={{ marginTop: 8, fontFamily: fontMono, fontSize: 11, color: C.accent }}>
                  {importProgress.message}
                </div>
              )}

              {/* Error message */}
              {importProgress?.type === 'error' && (
                <div style={{ marginTop: 12, background: C.redDim, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red }}>
                  ! {importProgress.message}
                </div>
              )}

              {/* Final report */}
              {importReport && (
                <div style={{ marginTop: 16 }}>
                  {importReport.errors > 0 && importReport.inserted === 0 ? (
                    <div style={{ background: C.redDim, border: `1px solid rgba(248,113,113,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.red, marginBottom: 10 }}>
                      ! Import echoue — {importReport.errors} erreurs, 0 inseres
                    </div>
                  ) : importReport.errors > 0 ? (
                    <div style={{ background: C.warnDim, border: `1px solid rgba(251,191,36,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.warn, marginBottom: 10 }}>
                      ! Import partiel — {importReport.inserted} inseres, {importReport.errors} erreurs
                    </div>
                  ) : (
                    <div style={{ background: C.greenDim, border: `1px solid rgba(61,255,160,0.3)`, borderRadius: 2, padding: '8px 12px', fontFamily: fontMono, fontSize: 11, color: C.green, marginBottom: 10 }}>
                      [OK] Import termine avec succes
                    </div>
                  )}
                  <div style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: 12, fontFamily: fontMono, fontSize: 11, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    <div><span style={{ color: C.muted }}>total: </span><span style={{ color: C.text }}>{importReport.total.toLocaleString()}</span></div>
                    <div><span style={{ color: C.muted }}>inseres: </span><span style={{ color: C.green }}>{importReport.inserted.toLocaleString()}</span></div>
                    <div><span style={{ color: C.muted }}>ignores: </span><span style={{ color: C.warn }}>{importReport.ignored.toLocaleString()}</span></div>
                    <div><span style={{ color: C.muted }}>erreurs: </span><span style={{ color: importReport.errors > 0 ? C.red : C.text }}>{importReport.errors.toLocaleString()}</span></div>
                  </div>
                  {/* Afficher le message d erreur SQL si present */}
                  {importProgress?.firstError && (
                    <div style={{ marginTop: 10, padding: '10px 12px', background: C.redDim, border: `1px solid rgba(248,113,113,0.4)`, borderRadius: 2, fontFamily: fontMono, fontSize: 11, color: C.red }}>
                      <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, marginBottom: 6, color: C.red }}>! Erreur SQL detectee</div>
                      <div style={{ wordBreak: 'break-all', lineHeight: 1.6 }}>{importProgress.firstError}</div>
                      <div style={{ marginTop: 8, color: C.muted, fontSize: 9 }}>
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
                    fontFamily: fontMono,
                    fontSize: 10,
                  }}>
                    <span style={{ color: C.muted, fontWeight: 700 }}>// JOURNAL EN DIRECT</span>
                    <span style={{ color: C.green }}>
                      OK {logLines.filter(l => l.level === 'info' && l.line.startsWith('[OK]')).length}
                    </span>
                    <span style={{ color: C.warn }}>
                      SKIP {logLines.filter(l => l.level === 'warn' && l.line.startsWith('[SKIP]')).length}
                    </span>
                    <span style={{ color: C.red }}>
                      ERR {logLines.filter(l => l.level === 'error' && l.line.startsWith('[ERR]')).length}
                    </span>
                    <span style={{ color: C.muted, marginLeft: 'auto' }}>
                      {logLines.length} lignes
                    </span>
                  </div>

                  {/* Scrollable log container */}
                  <div
                    ref={logContainerRef}
                    style={{
                      background: '#020202',
                      border: `1px solid ${C.border}`,
                      borderRadius: 2,
                      padding: '8px 12px',
                      maxHeight: 350,
                      overflowY: 'auto',
                      fontFamily: fontMono,
                      fontSize: 10,
                      lineHeight: 1.7,
                    }}
                  >
                    {logLines.map((log, idx) => (
                      <div key={idx} style={{
                        color: log.level === 'error'
                          ? C.red
                          : log.level === 'warn'
                            ? C.warn
                            : log.line.startsWith('[OK]')
                              ? C.green
                              : C.muted,
                        borderBottom: log.line.startsWith('---') ? `1px solid ${C.border}` : 'none',
                        paddingBottom: log.line.startsWith('---') ? 2 : 0,
                        marginBottom: log.line.startsWith('---') ? 2 : 0,
                      }}>
                        {log.line}
                      </div>
                    ))}
                    {isImporting && (
                      <div style={{ color: C.accent }}>
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
        <div style={{ padding: '12px 0', fontFamily: fontMono, fontSize: 10, color: C.muted, borderTop: `1px solid ${C.border}` }}>
          // Formats supportes: CSV, Excel (.xlsx/.xls), GeoJSON · Encodages: UTF-8, Latin-1 (auto-detecte)
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
