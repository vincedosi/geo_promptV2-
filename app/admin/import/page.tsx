'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type {
  ParseResult,
  DryRunResult,
  ImportProgress,
  ImportReport,
  GeoMode,
  GeoConfig,
  GeocodeDetailedResult,
} from '@/lib/import/types';
import {
  C,
  fontInter,
  fontMono,
  type MappingState,
  type PoiCategoryOption,
} from './_components/shared';
import { badgeGreen, badgeWarn } from './_components/styles';
import { UploadStep } from './_components/UploadStep';
import { CategoryStep } from './_components/CategoryStep';
import { MappingStep } from './_components/MappingStep';
import { ColumnSelectionStep } from './_components/ColumnSelectionStep';
import { DryRunStep } from './_components/DryRunStep';
import { GeocodeStep } from './_components/GeocodeStep';
import { ImportStep } from './_components/ImportStep';

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
  const [poiCategories, setPoiCategories] = useState<PoiCategoryOption[]>([]);
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

  const columns = parseResult?.columns || [];

  // ============================================================
  // Render
  // ============================================================

  const isStep2Valid = category.length > 0;
  const isStep3Valid = geoMode === 'gps'
    ? !!(geoMapping.colLat && geoMapping.colLng)
    : geoMode === 'address'
      ? !!(geoMapping.colAdresse || mapping.adresse || geoMapping.colVille || mapping.ville)
      : !!(geoMapping.colX && geoMapping.colY);

  // For address mode: geocode step must be completed and validated before proceeding
  const isGeocodeReady = geoMode !== 'address' || geocodeValidated;

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
        <UploadStep
          file={file}
          parseResult={parseResult}
          isParsing={isParsing}
          isDragging={isDragging}
          fileInputRef={fileInputRef}
          handleFileUpload={handleFileUpload}
          handleDrop={handleDrop}
          handleDragOver={handleDragOver}
          handleDragLeave={handleDragLeave}
        />

        {/* ============================================================ */}
        {/* STEP 02 — Categorie POI */}
        {/* ============================================================ */}
        {parseResult?.success && (
          <CategoryStep
            category={category}
            setCategory={setCategory}
            poiCategories={poiCategories}
            setPoiCategories={setPoiCategories}
            newCategoryName={newCategoryName}
            setNewCategoryName={setNewCategoryName}
            isCreatingCategory={isCreatingCategory}
            setIsCreatingCategory={setIsCreatingCategory}
          />
        )}

        {/* ============================================================ */}
        {/* STEP 03 — Mapping colonnes */}
        {/* ============================================================ */}
        {parseResult?.success && isStep2Valid && (
          <MappingStep
            columns={columns}
            mapping={mapping}
            setMapping={setMapping}
            geoMode={geoMode}
            setGeoMode={setGeoMode}
            geoMapping={geoMapping}
            setGeoMapping={setGeoMapping}
          />
        )}

        {/* ============================================================ */}
        {/* STEP 03b — Selection des colonnes a importer + filtres        */}
        {/* ============================================================ */}
        {parseResult?.success && isStep2Valid && isStep3Valid && columns.length > 0 && (
          <ColumnSelectionStep
            columns={columns}
            mapping={mapping}
            geoMapping={geoMapping}
            importedColumns={importedColumns}
            setImportedColumns={setImportedColumns}
            filterFields={filterFields}
            setFilterFields={setFilterFields}
          />
        )}

        {/* ============================================================ */}
        {/* STEP 03c — Geocodage adresses (BAN API)                       */}
        {/* ============================================================ */}
        {parseResult?.success && isStep2Valid && isStep3Valid && geoMode === 'address' && (
          <GeocodeStep
            parseResult={parseResult}
            geocodeId={geocodeId}
            setGeocodeId={setGeocodeId}
            isGeocoding={isGeocoding}
            handleGeocodeBatch={handleGeocodeBatch}
            geocodeResults={geocodeResults}
            setGeocodeResults={setGeocodeResults}
            geocodeStats={geocodeStats}
            setGeocodeStats={setGeocodeStats}
            geocodeError={geocodeError}
            setGeocodeError={setGeocodeError}
            geocodeFilter={geocodeFilter}
            setGeocodeFilter={setGeocodeFilter}
            editingRow={editingRow}
            setEditingRow={setEditingRow}
            editAddress={editAddress}
            setEditAddress={setEditAddress}
            editLat={editLat}
            setEditLat={setEditLat}
            editLng={editLng}
            setEditLng={setEditLng}
            isUpdatingRow={isUpdatingRow}
            handleGeocodeUpdateRow={handleGeocodeUpdateRow}
            geocodeValidated={geocodeValidated}
            setGeocodeValidated={setGeocodeValidated}
          />
        )}

        {/* ============================================================ */}
        {/* STEP 04 — Dry-run */}
        {/* ============================================================ */}
        {parseResult?.success && isStep2Valid && isStep3Valid && isGeocodeReady && (
          <DryRunStep
            dryRunResult={dryRunResult}
            handleDryRun={handleDryRun}
            isDryRunning={isDryRunning}
          />
        )}

        {/* ============================================================ */}
        {/* STEP 05 — Import reel */}
        {/* ============================================================ */}
        {dryRunResult?.success && dryRunResult.stats.validRows > 0 && (
          <ImportStep
            parseResult={parseResult}
            sourceName={sourceName}
            setSourceName={setSourceName}
            organizationId={organizationId}
            setOrganizationId={setOrganizationId}
            organizations={organizations}
            handleImport={handleImport}
            isImporting={isImporting}
            importProgress={importProgress}
            importReport={importReport}
            logLines={logLines}
            logContainerRef={logContainerRef}
          />
        )}

        {/* Footer hint */}
        <div style={{ padding: '12px 0', fontFamily: fontMono, fontSize: 10, color: C.muted, borderTop: `1px solid ${C.border}` }}>
          {'// Formats supportes: CSV, Excel (.xlsx), GeoJSON · Encodages: UTF-8, Latin-1 (auto-detecte)'}
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
