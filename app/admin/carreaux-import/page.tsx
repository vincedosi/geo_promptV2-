'use client';

import { useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// ============================================================
// Client-side column preview — no server call needed
// ============================================================

type ColType = 'id' | 'number' | 'string';
interface ColInfo { type: ColType; dtype: string; samples: string[] }

const ID_PATTERNS = new Set([
  'idcar', 'id', 'idcom', 'idk', 'id_car', 'id_carreau',
  'code_iris', 'depcom', 'dep', 'reg', 'epci', 'id_inspire',
  'lcog_geo', 'i_est_cr',
]);

function classifyColumn(name: string, values: (string | null)[]): { type: ColType; dtype: string } {
  const n = name.toLowerCase().trim();
  if (ID_PATTERNS.has(n) || n.startsWith('id_') || n.startsWith('code_')) {
    return { type: 'id', dtype: 'object' };
  }
  const nonNull = values.filter((v): v is string => v !== null && v !== undefined && v.trim() !== '');
  if (nonNull.length === 0) return { type: 'string', dtype: 'object' };

  let intCount = 0, floatCount = 0;
  for (const v of nonNull) {
    const num = Number(v.replace(',', '.'));
    if (!isNaN(num) && v.trim() !== '') {
      Number.isInteger(num) ? intCount++ : floatCount++;
    }
  }
  if ((intCount + floatCount) / nonNull.length > 0.7) {
    return { type: 'number', dtype: floatCount > 0 ? 'float64' : 'int64' };
  }
  return { type: 'string', dtype: 'object' };
}

function parseDbfPreview(data: Uint8Array, maxRows: number): Record<string, string | null>[] {
  if (data.length < 32) throw new Error('Fichier DBF invalide (trop court)');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const recordCount = view.getUint32(4, true);
  const headerSize = view.getUint16(8, true);
  const recordSize = view.getUint16(10, true);
  const fields: { name: string; length: number }[] = [];
  let off = 32;
  while (off + 32 <= headerSize) {
    if (data[off] === 0x0d) break;
    const name = new TextDecoder('latin1').decode(data.slice(off, off + 11)).replace(/\0/g, '').trim();
    if (!name) break;
    fields.push({ name, length: data[off + 16] });
    off += 32;
  }
  const rows: Record<string, string | null>[] = [];
  let recOff = headerSize;
  const limit = Math.min(recordCount, maxRows);
  for (let i = 0; i < limit && recOff + recordSize <= data.length; i++) {
    const deleted = data[recOff] === 0x2a;
    recOff += 1;
    if (deleted) { recOff += recordSize - 1; continue; }
    const rec: Record<string, string | null> = {};
    for (const f of fields) {
      const raw = new TextDecoder('latin1').decode(data.slice(recOff, recOff + f.length)).trim();
      rec[f.name] = raw || null;
      recOff += f.length;
    }
    rows.push(rec);
  }
  return rows;
}

// Robust file reading — FileReader with clear error messages
function readBlobAsText(blob: Blob, fileName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(
      `Impossible de lire "${fileName}". Le fichier est peut-être verrouillé ou supprimé.\n` +
      'Essayez de re-sélectionner le fichier.'
    ));
    reader.readAsText(blob);
  });
}

function readBlobAsArrayBuffer(blob: Blob, fileName: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error(
      `Impossible de lire "${fileName}". Le fichier est peut-être verrouillé ou supprimé.\n` +
      'Essayez de re-sélectionner le fichier.'
    ));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Capture a preview snapshot of a file immediately at selection time.
 * This avoids stale File handles — the browser reads the file once,
 * and we store the bytes in memory for later analysis.
 */
async function captureFilePreview(file: File): Promise<{ fileName: string; ext: string; headerText?: string; headerBuf?: ArrayBuffer }> {
  const ext = file.name.toLowerCase().split('.').pop() || '';

  if (ext === 'csv' || ext === 'tsv' || ext === 'txt' || ext === 'geojson' || ext === 'json') {
    const blob = file.slice(0, ext === 'geojson' || ext === 'json' ? 500 * 1024 : 100 * 1024);
    const headerText = await readBlobAsText(blob, file.name);
    return { fileName: file.name, ext, headerText };
  }

  if (ext === 'dbf') {
    // DBF: header + first records are in the first ~256KB — never read the whole file
    const blob = file.slice(0, 256 * 1024);
    const headerBuf = await readBlobAsArrayBuffer(blob, file.name);
    return { fileName: file.name, ext, headerBuf };
  }

  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    // Excel: need full structure for SheetJS, but cap at 5MB for preview
    const blob = file.size > 5 * 1024 * 1024 ? file.slice(0, 5 * 1024 * 1024) : file;
    const headerBuf = await readBlobAsArrayBuffer(blob, file.name);
    return { fileName: file.name, ext, headerBuf };
  }

  // For other formats, just store metadata — preview won't be supported
  return { fileName: file.name, ext };
}

type FilePreviewSnapshot = Awaited<ReturnType<typeof captureFilePreview>>;

// ============================================================
// Auto-detect resolution + millésime from file name & columns
// ============================================================

interface DetectedMeta {
  resolution: '200m' | '1km' | null;
  millesime: string | null;
  source: 'filename' | 'columns' | null;
}

function detectFileMetadata(
  fileName: string,
  columns?: Record<string, ColInfo>,
): DetectedMeta {
  const meta: DetectedMeta = { resolution: null, millesime: null, source: null };
  const lower = fileName.toLowerCase();

  // --- Resolution from filename ---
  if (/[_\-.]200m/i.test(lower)) {
    meta.resolution = '200m';
    meta.source = 'filename';
  } else if (/[_\-.]1000m|[_\-.]1km/i.test(lower)) {
    meta.resolution = '1km';
    meta.source = 'filename';
  }

  // --- Millésime from filename ---
  // Patterns: Filosofi2019, carreaux_200m_met_2021, filosofi_2017, etc.
  const yearMatch = lower.match(/filosofi[_\-]?(\d{4})/i)
    || lower.match(/(?:carreaux|carr)[^0-9]*(\d{4})/)
    || lower.match(/[_\-](\d{4})[_\-.]/)
    || lower.match(/(\d{4})/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 2010 && year <= 2030) {
      meta.millesime = String(year);
    }
  }

  // --- Resolution from column names (more reliable) ---
  if (columns) {
    const colNames = Object.keys(columns).map(c => c.toLowerCase());
    if (colNames.some(c => c.includes('idcar_200m') || c === 'id_200m' || c === 'idcar200m')) {
      meta.resolution = '200m';
      meta.source = meta.source || 'columns';
    } else if (colNames.some(c => c.includes('idcar_1km') || c.includes('idcar_1000m') || c === 'id_1km')) {
      meta.resolution = '1km';
      meta.source = meta.source || 'columns';
    }

    // --- Resolution from idcar sample values ---
    if (!meta.resolution) {
      for (const [, info] of Object.entries(columns)) {
        for (const sample of info.samples) {
          if (/RES200m/i.test(sample)) { meta.resolution = '200m'; meta.source = 'columns'; break; }
          if (/RES1000m/i.test(sample)) { meta.resolution = '1km'; meta.source = 'columns'; break; }
        }
        if (meta.resolution) break;
      }
    }
  }

  return meta;
}

function analyzePreviewSnapshot(
  snap: FilePreviewSnapshot,
): { columns: Record<string, ColInfo>; bbox?: { bboxWgs84: string } } {
  let rows: Record<string, string | null>[] = [];

  if ((snap.ext === 'csv' || snap.ext === 'tsv' || snap.ext === 'txt') && snap.headerText) {
    const text = snap.headerText;
    const firstLine = text.split('\n')[0] || '';
    const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
    const result = Papa.parse<Record<string, string>>(text, {
      header: true, delimiter: sep, preview: 10, skipEmptyLines: true,
    });
    rows = result.data;
  } else if ((snap.ext === 'xlsx' || snap.ext === 'xls' || snap.ext === 'xlsm') && snap.headerBuf) {
    const wb = XLSX.read(snap.headerBuf, { type: 'array', sheetRows: 15 });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (sheet) rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: null, raw: false });
  } else if ((snap.ext === 'geojson' || snap.ext === 'json') && snap.headerText) {
    const geojson = JSON.parse(snap.headerText);
    rows = (geojson.features || []).slice(0, 10).map((f: { properties?: Record<string, unknown> }) => {
      const props: Record<string, string | null> = {};
      if (f.properties) {
        for (const [k, v] of Object.entries(f.properties)) {
          props[k] = v != null ? String(v) : null;
        }
      }
      return props;
    });
  } else if (snap.ext === 'dbf' && snap.headerBuf) {
    rows = parseDbfPreview(new Uint8Array(snap.headerBuf), 10);
  } else if (snap.ext === 'zip') {
    throw new Error(
      'Les fichiers ZIP ne peuvent pas être prévisualisés directement.\n' +
      'Veuillez extraire le fichier CSV/Excel du ZIP avant de le charger.'
    );
  } else {
    throw new Error(`Format .${snap.ext} non supporté pour la prévisualisation. Formats : CSV, Excel, GeoJSON, DBF.`);
  }

  if (rows.length === 0) throw new Error('Aucune ligne de données trouvée dans le fichier');

  const columns: Record<string, ColInfo> = {};
  const keys = Object.keys(rows[0]);
  for (const col of keys) {
    const values = rows.map(r => r[col] ?? null);
    const { type, dtype } = classifyColumn(col, values);
    const samples = values.filter((v): v is string => v !== null && v.trim() !== '').slice(0, 3);
    columns[col] = { type, dtype, samples };
  }

  let bbox: { bboxWgs84: string } | undefined;
  const latCol = keys.find(k => /^(lat|latitude|_geojson_lat)$/i.test(k));
  const lngCol = keys.find(k => /^(lng|lon|long|longitude|_geojson_lng)$/i.test(k));
  if (latCol && lngCol) {
    const lats = rows.map(r => parseFloat(r[latCol] || '')).filter(n => !isNaN(n));
    const lngs = rows.map(r => parseFloat(r[lngCol] || '')).filter(n => !isNaN(n));
    if (lats.length > 0 && lngs.length > 0) {
      bbox = { bboxWgs84: `${Math.min(...lngs)} ${Math.min(...lats)} ${Math.max(...lngs)} ${Math.max(...lats)}` };
    }
  }

  return { columns, bbox };
}

// ============================================================

import { createClient } from '@supabase/supabase-js';

let _sbClient: ReturnType<typeof createClient> | null = null;
function getAuthToken(): Promise<{ token: string | null }> {
  if (!_sbClient) {
    _sbClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _sbClient.auth.getSession().then(({ data }) => ({
    token: data.session?.access_token ?? null,
  }));
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
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [shpFile, setShpFile] = useState<File | null>(null);
  const [dbfFile, setDbfFile] = useState<File | null>(null);
  const [shxFile, setShxFile] = useState<File | null>(null);
  const [prjFile, setPrjFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState('1000');
  const [geoPreset, setGeoPreset] = useState<string>('');
  const [detectedBbox, setDetectedBbox] = useState<string>('');
  const [resolution, setResolution] = useState<'200m' | '1km'>('200m');
  const [millesime, setMillesime]   = useState('2021');
  const [detectedMeta, setDetectedMeta] = useState<DetectedMeta | null>(null);
  // Sélection de colonnes
  const [previewSnapshot, setPreviewSnapshot] = useState<FilePreviewSnapshot | null>(null);
  const [columnsData, setColumnsData] = useState<Record<string, { type: string; dtype: string; samples: string[] }> | null>(null);
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [columnsError, setColumnsError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [lastLog, setLastLog] = useState('');
  const [fileLoading, setFileLoading] = useState<string | null>(null); // which input is loading

  const hasShapefileInputs = !!(shpFile || dbfFile || shxFile || prjFile);
  const hasValidShapefileSet = !!(shpFile && dbfFile);
  const hasUploadReady = hasShapefileInputs ? hasValidShapefileSet : !!singleFile;

  const appendUploadFilesToFormData = (fd: FormData) => {
    if (hasShapefileInputs) {
      if (shpFile) {
        fd.append('shpFile', shpFile);
        fd.append('files', shpFile);
      }
      if (dbfFile) {
        fd.append('dbfFile', dbfFile);
        fd.append('files', dbfFile);
      }
      if (shxFile) {
        fd.append('shxFile', shxFile);
        fd.append('files', shxFile);
      }
      if (prjFile) {
        fd.append('prjFile', prjFile);
        fd.append('files', prjFile);
      }
      return;
    }

    if (singleFile) {
      fd.append('file', singleFile);
      fd.append('files', singleFile);
    }
  };

  const handlePreviewColumns = async () => {
    if (!hasUploadReady) {
      alert(hasShapefileInputs ? 'Pour un shapefile non zippé, sélectionnez au minimum .shp et .dbf' : 'Sélectionnez un fichier d\'abord');
      return;
    }
    setLoadingColumns(true);
    setColumnsError('');
    setColumnsData(null);
    try {
      // Use already-captured snapshot if available, otherwise capture now
      let snap = previewSnapshot;
      if (!snap) {
        const targetFile = (hasShapefileInputs && dbfFile) ? dbfFile : singleFile;
        if (!targetFile) throw new Error('Aucun fichier à analyser');
        snap = await captureFilePreview(targetFile);
        setPreviewSnapshot(snap);
      }

      const result = analyzePreviewSnapshot(snap);
      const bboxFromPreview = result.bbox?.bboxWgs84 || '';
      if (bboxFromPreview) {
        setDetectedBbox(bboxFromPreview);
        if (!geoPreset) setGeoPreset(bboxFromPreview);
      }
      setColumnsData(result.columns);

      // Refine auto-detection with column data
      const fileName = snap.fileName;
      const meta = detectFileMetadata(fileName, result.columns);
      setDetectedMeta(meta);
      if (meta.resolution) setResolution(meta.resolution);
      if (meta.millesime) setMillesime(meta.millesime);

      // Par défaut : sélectionner toutes les colonnes numériques (pas les string ni les id)
      const defaultSel = new Set(
        Object.entries(result.columns)
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
    if (!hasUploadReady) {
      alert(hasShapefileInputs ? 'Pour un shapefile non zippé, sélectionnez au minimum .shp et .dbf' : 'Sélectionnez un fichier');
      return;
    }
    if (!confirm(dryRun ? `Dry-run sur ${limit || 'toutes les'} lignes ?` : '⚠️ IMPORT RÉEL en base ?')) return;

    setIsImporting(true);
    setImportResult(null);
    setImportProgress(null);
    setUploadProgress(null);
    setLastLog('');
    try {
      const fd = new FormData();
      fd.append('mode', 'manual');
      fd.append('dryRun', String(dryRun));
      if (limit) fd.append('limit', limit);
      if (geoPreset) fd.append('bbox', geoPreset);
      fd.append('resolution', resolution);
      fd.append('millesime', millesime);
      // Colonnes sélectionnées (vide = toutes)
      if (columnsData && selectedCols.size > 0 && selectedCols.size < Object.keys(columnsData).length) {
        fd.append('columns', [...selectedCols].join(','));
      }
      appendUploadFilesToFormData(fd);

      // Use XHR for upload progress tracking, then switch to fetch for SSE
      const { token } = await getAuthToken();
      const uploadResult = await new Promise<{ status: number; responseText: string; contentType: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/admin/import-carreaux');
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress({ loaded: e.loaded, total: e.total });
          }
        };
        xhr.upload.onload = () => {
          setUploadProgress(null);
          setLastLog('Upload terminé — traitement serveur en cours...');
        };
        xhr.onload = () => resolve({ status: xhr.status, responseText: xhr.responseText, contentType: xhr.getResponseHeader('content-type') || '' });
        xhr.onerror = () => reject(new Error('Erreur réseau pendant l\'upload'));
        xhr.send(fd);
      });

      // For SSE streaming, re-issue with fetch (files already on server)
      // Parse the XHR response
      if (uploadResult.contentType.includes('text/event-stream')) {
        // SSE was returned — parse events from responseText
        const lines = uploadResult.responseText.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'log') setLastLog(ev.line);
            else if (ev.type === 'progress') setImportProgress({ current: ev.current, total: ev.total });
            else if (ev.type === 'done') setImportResult({ success: ev.success, mode: ev.mode, dryRun: ev.dryRun, output: ev.output, errors: ev.errors, report: ev.report, error: ev.error });
          } catch {}
        }
      } else {
        try {
          setImportResult(JSON.parse(uploadResult.responseText));
        } catch {
          setImportResult({ success: uploadResult.status < 400, output: uploadResult.responseText });
        }
      }
    } catch (e: any) {
      setImportResult({ success: false, error: e.message });
    } finally {
      setIsImporting(false);
      setImportProgress(null);
      setUploadProgress(null);
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
        <p className="page-subtitle">
          Import données INSEE Filosofi — carreaux socio-démographiques{' '}
          {resolution === '200m' ? '200m × 200m' : '1km × 1km'}
          {detectedMeta?.millesime && <> · millésime {detectedMeta.millesime}</>}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Step 01 */}
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>01</span>
            <span className="g-card-title">Upload manuel</span>
          </div>
          <div className="g-card-body">
            <label className="g-label">Fichier unique (recommandé)</label>
            <input
              type="file"
              accept=".zip,.csv,.xlsx,.xls,.geojson,.json,.gpkg,.kml,.gpx"
              onChange={async (e) => {
                const next = e.target.files?.[0] || null;
                // Set loading FIRST for instant visual feedback
                if (next) setFileLoading('single');
                setSingleFile(next);
                setColumnsData(null);
                setColumnsError('');
                setPreviewSnapshot(null);
                setDetectedMeta(null);
                if (next) {
                  setShpFile(null);
                  setDbfFile(null);
                  setShxFile(null);
                  setPrjFile(null);
                  const meta = detectFileMetadata(next.name);
                  setDetectedMeta(meta);
                  if (meta.resolution) setResolution(meta.resolution);
                  if (meta.millesime) setMillesime(meta.millesime);
                  try {
                    const snap = await captureFilePreview(next);
                    setPreviewSnapshot(snap);
                  } catch {
                    // Will retry in handlePreviewColumns
                  } finally {
                    setFileLoading(null);
                  }
                }
              }}
              style={{ fontSize: 12, color: 'var(--text-secondary)' }}
            />
            {/* Loading state */}
            {fileLoading === 'single' && (
              <div style={{
                marginTop: 6, padding: '8px 12px', borderRadius: 6,
                background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.2)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                <div>
                  <div style={{ fontSize: 12, color: '#58a6ff', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                    Lecture de l&apos;en-tête en cours...
                  </div>
                  {singleFile && (
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                      {singleFile.name} ({(singleFile.size / 1024 / 1024).toFixed(1)} MB)
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Success state */}
            {singleFile && fileLoading !== 'single' && (
              <div style={{
                marginTop: 6, padding: '8px 12px', borderRadius: 6,
                background: 'rgba(61,255,160,0.06)', border: '1px solid rgba(61,255,160,0.2)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12" /></svg>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                    {singleFile.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>
                    {(singleFile.size / 1024 / 1024).toFixed(2)} MB
                    {previewSnapshot ? ' · en-tête capturé · prêt pour l\'analyse' : ''}
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <label className="g-label">Shapefile non zippé (une zone par fichier)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>1) .shp (obligatoire)</div>
                  <input type="file" accept=".shp" onChange={(e) => { setShpFile(e.target.files?.[0] || null); setColumnsData(null); setColumnsError(''); setPreviewSnapshot(null); setDetectedMeta(null); if (e.target.files?.[0]) setSingleFile(null); }} style={{ fontSize: 12, color: 'var(--text-secondary)' }} />
                  {shpFile && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace' }}>✓ {shpFile.name}</div>}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>2) .dbf (obligatoire)</div>
                  <input type="file" accept=".dbf" onChange={async (e) => {
                    const f = e.target.files?.[0] || null;
                    // Set loading FIRST, before anything else — instant visual feedback
                    if (f) setFileLoading('dbf');
                    setDbfFile(f);
                    setColumnsData(null);
                    setColumnsError('');
                    setPreviewSnapshot(null);
                    setDetectedMeta(null);
                    if (f) {
                      setSingleFile(null);
                      const meta = detectFileMetadata(f.name);
                      setDetectedMeta(meta);
                      if (meta.resolution) setResolution(meta.resolution);
                      if (meta.millesime) setMillesime(meta.millesime);
                      try {
                        const snap = await captureFilePreview(f);
                        setPreviewSnapshot(snap);
                      } catch {
                        // Will retry in handlePreviewColumns
                      } finally {
                        setFileLoading(null);
                      }
                    }
                  }} style={{ fontSize: 12, color: 'var(--text-secondary)' }} />

                  {/* Loading state */}
                  {fileLoading === 'dbf' && (
                    <div style={{
                      marginTop: 6, padding: '8px 12px', borderRadius: 6,
                      background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.2)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                      <div>
                        <div style={{ fontSize: 12, color: '#58a6ff', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                          Lecture en-tête DBF en cours...
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                          {dbfFile ? `${dbfFile.name} (${(dbfFile.size / 1024 / 1024).toFixed(0)} MB)` : 'Analyse...'} — seuls les premiers 256 Ko sont lus
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Success state */}
                  {dbfFile && fileLoading !== 'dbf' && (
                    <div style={{
                      marginTop: 6, padding: '8px 12px', borderRadius: 6,
                      background: 'rgba(61,255,160,0.06)', border: '1px solid rgba(61,255,160,0.2)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12" /></svg>
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                          {dbfFile.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>
                          {(dbfFile.size / 1024 / 1024).toFixed(0)} MB total · en-tête capturé (256 Ko)
                          {previewSnapshot ? ' · prêt pour l\'analyse' : ''}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>3) .shx (optionnel)</div>
                  <input type="file" accept=".shx" onChange={(e) => { setShxFile(e.target.files?.[0] || null); if (e.target.files?.[0]) setSingleFile(null); }} style={{ fontSize: 12, color: 'var(--text-secondary)' }} />
                  {shxFile && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace' }}>✓ {shxFile.name}</div>}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>4) .prj (optionnel)</div>
                  <input type="file" accept=".prj" onChange={(e) => { setPrjFile(e.target.files?.[0] || null); if (e.target.files?.[0]) setSingleFile(null); }} style={{ fontSize: 12, color: 'var(--text-secondary)' }} />
                  {prjFile && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace' }}>✓ {prjFile.name}</div>}
                </div>
              </div>
              {hasShapefileInputs && !hasValidShapefileSet && (
                <div className="g-alert g-alert-error" style={{ marginTop: 10 }}>
                  Sélection incomplète : fournissez au minimum les fichiers .shp et .dbf
                </div>
              )}
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, fontFamily: 'JetBrains Mono, monospace' }}>// priorité utilisée : shapefile compartimenté si renseigné, sinon fichier unique</div>
          </div>
        </div>

        {/* Dynamic file info card */}
        {hasUploadReady && detectedMeta && (detectedMeta.resolution || detectedMeta.millesime) && (
          <div className="g-card" style={{ borderColor: 'rgba(88,166,255,0.3)' }}>
            <div className="g-card-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
              <span className="g-card-title">Détection automatique</span>
              <span className="g-badge" style={{ marginLeft: 'auto', background: 'rgba(88,166,255,0.15)', color: '#58a6ff' }}>
                {detectedMeta.source === 'columns' ? 'depuis colonnes' : detectedMeta.source === 'filename' ? 'depuis nom de fichier' : 'auto'}
              </span>
            </div>
            <div className="g-card-body">
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                {detectedMeta.resolution && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2 }}>Résolution</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#3dffa0', fontFamily: 'JetBrains Mono, monospace' }}>
                      {detectedMeta.resolution === '200m' ? '200m × 200m' : '1km × 1km'}
                    </div>
                  </div>
                )}
                {detectedMeta.millesime && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2 }}>Millésime INSEE</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#3dffa0', fontFamily: 'JetBrains Mono, monospace' }}>
                      {detectedMeta.millesime}
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2 }}>Fichier</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {(singleFile || dbfFile)?.name}
                    {singleFile && <span style={{ color: 'var(--text-dim)' }}> ({(singleFile.size / 1024 / 1024).toFixed(1)} MB)</span>}
                  </div>
                </div>
                {columnsData && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2 }}>Colonnes</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {Object.keys(columnsData).length} détectées · {Object.values(columnsData).filter(v => v.type === 'number').length} numériques
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 02 — Sélection des colonnes */}
        {hasUploadReady && (
          <div className="g-card">
            <div className="g-card-header">
              <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>02</span>
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
                    // analyse locale — pas d'upload réseau
                  </span>
                </div>
              )}
              {loadingColumns && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                  Analyse du fichier en cours...
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

        {/* Step 03 — Périmètre géographique (visible only when file loaded) */}
        {hasUploadReady && (
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>03</span>
            <span className="g-card-title">Périmètre géographique</span>
          </div>
          <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="g-label">Zone d'import</label>
              <select
                value={geoPreset}
                onChange={e => setGeoPreset(e.target.value)}
                className="g-input"
              >
                {detectedBbox && <option value={detectedBbox}>BBox détectée depuis le fichier</option>}
                <option value="">Pas de filtre (bbox auto)</option>
              </select>
            </div>

            {detectedBbox && (
              <div className="g-alert g-alert-success" style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                bbox détectée (WGS84): {detectedBbox}
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
        )}

        {/* Step 04 — Options d'import */}
        {hasUploadReady && (
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
        )}

        {/* Step 05 — Nom de table + lancement */}
        {hasUploadReady && (
        <div className="g-card">
          <div className="g-card-header">
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 700 }}>05</span>
            <span className="g-card-title">Lancer l'import</span>
          </div>
          <div className="g-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Résolution + Millésime */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label className="g-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Résolution
                  {detectedMeta?.resolution && (
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(61,255,160,0.12)', color: '#3dffa0', fontFamily: 'JetBrains Mono, monospace' }}>
                      auto-détecté
                    </span>
                  )}
                </label>
                <select
                  value={resolution}
                  onChange={e => setResolution(e.target.value as '200m' | '1km')}
                  className="g-input"
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
                >
                  <option value="200m">200m (Filosofi standard)</option>
                  <option value="1km">1km (Filosofi agrégé)</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label className="g-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Millésime INSEE
                  {detectedMeta?.millesime && (
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(61,255,160,0.12)', color: '#3dffa0', fontFamily: 'JetBrains Mono, monospace' }}>
                      auto-détecté
                    </span>
                  )}
                </label>
                <select
                  value={millesime}
                  onChange={e => setMillesime(e.target.value)}
                  className="g-input"
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
                >
                  {detectedMeta?.millesime && !['2021','2019','2017','2015'].includes(detectedMeta.millesime) && (
                    <option value={detectedMeta.millesime}>{detectedMeta.millesime} (détecté)</option>
                  )}
                  <option value="2021">2021 (dernière version)</option>
                  <option value="2019">2019</option>
                  <option value="2017">2017</option>
                  <option value="2015">2015</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'JetBrains Mono, monospace', marginTop: -6 }}>
              → Table cible : <strong style={{ color: '#3dffa0' }}>carreaux_filosofi</strong>
              {' '}(résolution={resolution}, millésime={millesime})
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={handleImport}
                disabled={isImporting || !hasUploadReady}
                className={`g-btn ${dryRun ? 'g-btn-success' : 'g-btn-danger'}`}
                style={{ minWidth: 200 }}
              >
                {isImporting ? (
                  <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>Import en cours...</>
                ) : dryRun ? '→ Tester (dry-run)' : '⚠ LANCER L\'IMPORT RÉEL'}
              </button>
              {!dryRun && <span style={{ fontSize: 12, color: 'var(--red)', fontFamily: 'JetBrains Mono, monospace' }}>⚠ Insertion en base Supabase</span>}
            </div>

            {/* Barre de progression upload + traitement */}
            {isImporting && (
              <div style={{ marginTop: 16 }}>
                {uploadProgress ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Upload : {(uploadProgress.loaded / 1024 / 1024).toFixed(1)} / {(uploadProgress.total / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <span style={{ color: '#58a6ff', fontWeight: 700 }}>
                        {Math.round(uploadProgress.loaded / uploadProgress.total * 100)} %
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, background: '#58a6ff', width: `${Math.round(uploadProgress.loaded / uploadProgress.total * 100)}%`, transition: 'width 0.3s ease' }} />
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
                      ↳ envoi du fichier vers le serveur...
                    </div>
                  </>
                ) : importProgress ? (
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
        )}

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
