'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import proj4 from 'proj4';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ShapefileBundle {
  shp: ArrayBuffer;
  dbf: ArrayBuffer;
  prj: string | null;
  shx: ArrayBuffer | null;
  fileName: string;
}

interface DbfField {
  name: string;
  type: string; // C=char, N=numeric, F=float, L=logical, D=date
  length: number;
  decimal: number;
}

interface Feature {
  geometry: number[][][]; // polygon rings: [ring][point][x,y]
  properties: Record<string, string | number | null>;
}

interface ColumnMapping {
  source: string;
  target: string; // user-chosen target name or '' for metadata
}

type WizardStep = 1 | 2 | 3;

// ─── SHP binary parser ──────────────────────────────────────────────────────

function parseSHP(buffer: ArrayBuffer): number[][][][] {
  const view = new DataView(buffer);
  // Validate magic number (9994 big-endian)
  const magic = view.getInt32(0, false);
  if (magic !== 9994) throw new Error(`SHP invalide (magic=${magic})`);

  const shapeType = view.getInt32(32, true);
  // We support: 5 = Polygon, 15 = PolygonZ, 25 = PolygonM
  if (shapeType !== 5 && shapeType !== 15 && shapeType !== 25) {
    throw new Error(`Type de géométrie non supporté: ${shapeType} (seuls les Polygons sont acceptés)`);
  }

  const geometries: number[][][][] = [];
  let offset = 100; // skip 100-byte header

  while (offset + 8 < buffer.byteLength) {
    // Record header: record number (4b BE) + content length in 16-bit words (4b BE)
    const contentLength = view.getInt32(offset + 4, false) * 2;
    const recordStart = offset + 8;

    if (recordStart + contentLength > buffer.byteLength) break;

    const recordType = view.getInt32(recordStart, true);

    if (recordType === 5 || recordType === 15 || recordType === 25) {
      // skip bounding box (32 bytes) after type (4 bytes)
      const numParts = view.getInt32(recordStart + 36, true);
      const numPoints = view.getInt32(recordStart + 40, true);

      // Parts array
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) {
        parts.push(view.getInt32(recordStart + 44 + i * 4, true));
      }

      // Points start after parts array
      const pointsOffset = recordStart + 44 + numParts * 4;
      const allPoints: number[][] = [];
      for (let i = 0; i < numPoints; i++) {
        const x = view.getFloat64(pointsOffset + i * 16, true);
        const y = view.getFloat64(pointsOffset + i * 16 + 8, true);
        allPoints.push([x, y]);
      }

      // Split into rings by parts indices
      const rings: number[][][] = [];
      for (let p = 0; p < numParts; p++) {
        const start = parts[p];
        const end = p + 1 < numParts ? parts[p + 1] : numPoints;
        rings.push(allPoints.slice(start, end));
      }

      geometries.push(rings);
    } else if (recordType === 0) {
      // Null shape — push empty
      geometries.push([]);
    }

    offset = recordStart + contentLength;
  }

  return geometries;
}

// ─── DBF full parser ─────────────────────────────────────────────────────────

function parseDBF(buffer: ArrayBuffer): { fields: DbfField[]; records: Record<string, string | number | null>[] } {
  const data = new Uint8Array(buffer);
  if (data.length < 32) throw new Error('DBF invalide (trop court)');

  const view = new DataView(buffer);
  const recordCount = view.getUint32(4, true);
  const headerSize = view.getUint16(8, true);
  const recordSize = view.getUint16(10, true);

  // Parse field descriptors (32 bytes each, starting at offset 32)
  const fields: DbfField[] = [];
  let off = 32;
  while (off + 32 <= headerSize) {
    if (data[off] === 0x0d) break;
    const name = new TextDecoder('latin1').decode(data.slice(off, off + 11)).replace(/\0/g, '').trim();
    if (!name) break;
    const type = String.fromCharCode(data[off + 11]);
    const length = data[off + 16];
    const decimal = data[off + 17];
    fields.push({ name, type, length, decimal });
    off += 32;
  }

  // Parse records
  const records: Record<string, string | number | null>[] = [];
  let recOff = headerSize;
  const decoder = new TextDecoder('latin1');

  for (let i = 0; i < recordCount && recOff + recordSize <= data.length; i++) {
    const deleted = data[recOff] === 0x2a;
    recOff += 1; // deletion flag byte

    if (deleted) {
      recOff += recordSize - 1;
      continue;
    }

    const rec: Record<string, string | number | null> = {};
    for (const f of fields) {
      const raw = decoder.decode(data.slice(recOff, recOff + f.length)).trim();
      recOff += f.length;

      if (raw === '' || raw === '*') {
        rec[f.name] = null;
      } else if (f.type === 'N' || f.type === 'F') {
        const num = parseFloat(raw.replace(',', '.'));
        rec[f.name] = isNaN(num) ? null : num;
      } else {
        rec[f.name] = raw;
      }
    }
    records.push(rec);
  }

  return { fields, records };
}

// ─── PRJ → proj4 string ─────────────────────────────────────────────────────

function detectCRS(prjContent: string | null, firstCoords: number[] | null): string {
  // Try to match common CRS from PRJ WKT
  if (prjContent) {
    const upper = prjContent.toUpperCase();
    if (upper.includes('LAEA') || upper.includes('3035')) return 'EPSG:3035';
    if (upper.includes('LAMBERT_CONFORMAL_CONIC') && upper.includes('93')) return 'EPSG:2154';
    if (upper.includes('RGF93') || upper.includes('2154')) return 'EPSG:2154';
    if (upper.includes('4326') || upper.includes('WGS 84') || upper.includes('WGS84')) return 'EPSG:4326';
    if (upper.includes('3857') || upper.includes('WEB_MERCATOR')) return 'EPSG:3857';
    // EPSG:5490
    if (upper.includes('5490')) return 'EPSG:5490';
  }
  // Heuristic from coordinates
  if (firstCoords) {
    const [x, y] = firstCoords;
    // EPSG:3035 LAEA Europe (France range)
    if (x > 2500000 && x < 5000000 && y > 1000000 && y < 4000000) return 'EPSG:3035';
    // EPSG:2154 Lambert 93
    if (x > 100000 && x < 1300000 && y > 6000000 && y < 7200000) return 'EPSG:2154';
    // Already WGS84
    if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return 'EPSG:4326';
  }
  return 'EPSG:3035'; // default for carreaux Filosofi
}

// Register common proj4 definitions
proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs');
proj4.defs('EPSG:2154', '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs');

function reprojectCoords(ring: number[][], fromCRS: string): number[][] {
  if (fromCRS === 'EPSG:4326') return ring;
  return ring.map(([x, y]) => {
    const [lng, lat] = proj4(fromCRS, 'EPSG:4326', [x, y]);
    return [lng, lat];
  });
}

// ─── Polygon → WKT ──────────────────────────────────────────────────────────

function polygonToEWKT(rings: number[][][]): string {
  const ringsWKT = rings.map(ring =>
    '(' + ring.map(([x, y]) => `${x} ${y}`).join(',') + ')'
  ).join(',');
  return `SRID=4326;POLYGON(${ringsWKT})`;
}

// ─── ID detection ────────────────────────────────────────────────────────────

function detectIdColumn(fields: DbfField[]): string | null {
  const names = fields.map(f => f.name.toLowerCase());
  for (const candidate of ['idinspire', 'idcar_200m', 'idcar_1km', 'idcar', 'id_car', 'id']) {
    const idx = names.indexOf(candidate);
    if (idx >= 0) return fields[idx].name;
  }
  return null;
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtTime(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec.toString().padStart(2, '0')}s`;
}

function fmtNum(n: number): string {
  return n.toLocaleString('fr-FR');
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg: '#050505',
  bgElevated: '#0d0d0d',
  bgSurface: '#111118',
  border: '#261a35',
  borderLight: 'rgba(168,85,247,0.2)',
  accent: '#a855f7',
  accentDim: 'rgba(168,85,247,0.12)',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  textSec: '#6b7280',
  muted: '#4b5563',
  green: '#3dffa0',
  greenDim: 'rgba(61,255,160,0.12)',
  red: '#f87171',
  redDim: 'rgba(248,113,113,0.1)',
  warn: '#fbbf24',
  warnDim: 'rgba(251,191,36,0.1)',
  blue: '#3b82f6',
};
const fontOrbitron = "'Orbitron',sans-serif";
const fontMichroma = "'Michroma','Orbitron',sans-serif";
const fontMono = "'JetBrains Mono',monospace";
const fontInter = "'Inter',system-ui,sans-serif";

// ═════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export default function ImportShapefilePage() {
  // ── Wizard state ──
  const [step, setStep] = useState<WizardStep>(1);

  // ── Step 1: Files ──
  const [bundle, setBundle] = useState<ShapefileBundle | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [fields, setFields] = useState<DbfField[]>([]);
  const [crs, setCrs] = useState<string>('');
  const [parseError, setParseError] = useState<string>('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<{ label: string; pct: number } | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // ── Step 2: Mapping ──
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [resolution, setResolution] = useState('200m');
  const [millesime, setMillesime] = useState('2021');
  const [idColumn, setIdColumn] = useState<string>('');

  // ── Step 3: Import ──
  const [logs, setLogs] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [importDone, setImportDone] = useState(false);
  const [importError, setImportError] = useState<string>('');
  const logRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Timer
  useEffect(() => {
    if (isImporting) {
      const start = Date.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isImporting]);

  const addLog = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString('fr-FR');
    setLogs(prev => [...prev.slice(-500), `[${ts}] ${line}`]);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1: File parsing
  // ══════════════════════════════════════════════════════════════════════════

  const processFiles = useCallback(async (fileList: File[]) => {
    setParseError('');
    setFeatures([]);
    setFields([]);
    setCrs('');
    setBundle(null);
    setStep(1);

    // Identify shapefile components
    const byExt: Record<string, File> = {};
    for (const f of fileList) {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      byExt[ext] = f;
    }

    if (!byExt['shp']) {
      setParseError('Fichier .shp manquant. Sélectionnez les 4 fichiers du Shapefile (.shp, .dbf, .prj, .shx).');
      return;
    }
    if (!byExt['dbf']) {
      setParseError('Fichier .dbf manquant (attributs). Sélectionnez au minimum .shp et .dbf.');
      return;
    }

    setIsParsing(true);
    setParseProgress({ label: 'Lecture des fichiers...', pct: 0 });

    try {
      // Read all files as ArrayBuffer
      const shpBuf = await byExt['shp'].arrayBuffer();
      setParseProgress({ label: '.shp chargé', pct: 20 });

      const dbfBuf = await byExt['dbf'].arrayBuffer();
      setParseProgress({ label: '.dbf chargé', pct: 40 });

      const prjText = byExt['prj'] ? await byExt['prj'].text() : null;
      setParseProgress({ label: '.prj chargé', pct: 50 });

      const shxBuf = byExt['shx'] ? await byExt['shx'].arrayBuffer() : null;
      setParseProgress({ label: 'Fichiers chargés — parsing SHP...', pct: 55 });

      const baseName = byExt['shp'].name.replace(/\.shp$/i, '');

      // Yield to UI before heavy parsing
      await new Promise(r => setTimeout(r, 50));

      // Parse SHP geometries
      const geometries = parseSHP(shpBuf);
      setParseProgress({ label: `${fmtNum(geometries.length)} géométries lues — parsing DBF...`, pct: 70 });

      await new Promise(r => setTimeout(r, 50));

      // Parse DBF attributes
      const { fields: dbfFields, records } = parseDBF(dbfBuf);
      setParseProgress({ label: `${fmtNum(records.length)} enregistrements lus — détection CRS...`, pct: 85 });

      if (geometries.length !== records.length) {
        throw new Error(`Incohérence: ${geometries.length} géométries vs ${records.length} enregistrements DBF`);
      }

      // Detect CRS
      const firstCoord = geometries.length > 0 && geometries[0].length > 0 && geometries[0][0].length > 0
        ? geometries[0][0][0]
        : null;
      const detectedCRS = detectCRS(prjText, firstCoord);
      setCrs(detectedCRS);

      setParseProgress({ label: `CRS détecté: ${detectedCRS} — reprojection...`, pct: 90 });
      await new Promise(r => setTimeout(r, 50));

      // Build features with reprojected geometry
      const feats: Feature[] = [];
      const needsReproj = detectedCRS !== 'EPSG:4326';

      for (let i = 0; i < records.length; i++) {
        const rings = geometries[i];
        if (!rings || rings.length === 0) continue;

        const reprojRings = needsReproj
          ? rings.map(ring => reprojectCoords(ring, detectedCRS))
          : rings;

        feats.push({
          geometry: reprojRings,
          properties: records[i],
        });

        // Progress every 100K features
        if (i > 0 && i % 100000 === 0) {
          setParseProgress({ label: `Reprojection: ${fmtNum(i)}/${fmtNum(records.length)}...`, pct: 90 + Math.round(i / records.length * 10) });
          await new Promise(r => setTimeout(r, 0)); // yield
        }
      }

      setFeatures(feats);
      setFields(dbfFields);
      setBundle({ shp: shpBuf, dbf: dbfBuf, prj: prjText, shx: shxBuf, fileName: baseName });

      // Auto-detect millesime from filename
      const mMatch = baseName.match(/(\d{4})/);
      if (mMatch) setMillesime(mMatch[1]);

      // Auto-detect resolution
      if (/200m/i.test(baseName)) setResolution('200m');
      else if (/1km/i.test(baseName)) setResolution('1km');

      // Auto-detect ID column
      const detectedId = detectIdColumn(dbfFields);
      if (detectedId) setIdColumn(detectedId);

      // Default mappings: all columns → metadata
      setMappings(dbfFields.map(f => ({ source: f.name, target: '' })));

      setParseProgress({ label: `✓ ${fmtNum(feats.length)} features prêtes`, pct: 100 });

      // Auto-advance to step 2 after brief pause
      setTimeout(() => setStep(2), 600);

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur parsing';
      setParseError(msg);
    } finally {
      setIsParsing(false);
    }
  }, []);

  // Drop handlers
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) processFiles(files);
  }, [processFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const onDragLeave = useCallback(() => setIsDragging(false), []);
  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) processFiles(files);
  }, [processFiles]);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3: Batch import
  // ══════════════════════════════════════════════════════════════════════════

  const processImport = useCallback(async () => {
    if (features.length === 0) return;

    setIsImporting(true);
    setImportDone(false);
    setImportError('');
    setLogs([]);
    setProgress(null);
    setElapsed(0);

    const total = features.length;
    const BATCH_SIZE = 1000;
    const totalBatches = Math.ceil(total / BATCH_SIZE);
    let inserted = 0;
    let errors = 0;

    addLog(`Début de l'insertion : ${fmtNum(total)} lignes détectées.`);
    addLog(`Table cible : carreaux_filosofi (resolution=${resolution}, millesime=${millesime})`);
    addLog(`Taille des lots : ${BATCH_SIZE} — ${totalBatches} lots à envoyer.`);
    addLog('');

    // Build the selected columns set + rename map
    const selectedMappings = mappings.filter(m => m.target !== '__skip__');
    const renameMap = new Map<string, string>();
    for (const m of selectedMappings) {
      // If target is non-empty and different from source, use it as renamed key
      const targetKey = m.target && m.target !== m.source ? m.target : m.source;
      renameMap.set(m.source, targetKey);
    }

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const start = batchIdx * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, total);
      const batch = features.slice(start, end);

      // Format rows
      const rows = batch.map(feat => {
        // Pick ID
        const rawId = idColumn && feat.properties[idColumn] != null
          ? String(feat.properties[idColumn])
          : `auto_${start + batch.indexOf(feat)}`;

        // Build metadata: only selected columns, with renames
        const metadata: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(feat.properties)) {
          if (val != null && renameMap.has(key)) {
            metadata[renameMap.get(key)!] = val;
          }
        }

        // Geometry → EWKT
        const ewkt = polygonToEWKT(feat.geometry);

        return {
          idcar: rawId,
          resolution,
          millesime,
          geom_wkt: ewkt,
          metadata,
        };
      });

      // Send batch to API
      try {
        const res = await adminFetch('/api/admin/import-geo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows }),
        });

        const data = await res.json();

        if (data.success) {
          inserted += data.inserted;
          addLog(`✓ Lot ${batchIdx + 1}/${totalBatches} inséré (${fmtNum(data.inserted)} lignes) — total: ${fmtNum(inserted)}/${fmtNum(total)}`);
        } else {
          errors++;
          addLog(`✕ Erreur lot ${batchIdx + 1}/${totalBatches} : ${data.error}`);

          // Retry with half batch on 413
          if (data.error?.includes('413') || data.error?.includes('too large') || data.error?.includes('payload')) {
            addLog(`  Tentative en demi-lots...`);
            const half = Math.ceil(rows.length / 2);
            for (const subBatch of [rows.slice(0, half), rows.slice(half)]) {
              try {
                const subRes = await adminFetch('/api/admin/import-geo', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rows: subBatch }),
                });
                const subData = await subRes.json();
                if (subData.success) {
                  inserted += subData.inserted;
                  addLog(`  ✓ Demi-lot inséré (${subData.inserted} lignes)`);
                } else {
                  addLog(`  ✕ Demi-lot échoué : ${subData.error}`);
                }
              } catch (se: unknown) {
                addLog(`  ✕ Demi-lot exception : ${se instanceof Error ? se.message : 'erreur'}`);
              }
            }
          }
        }
      } catch (e: unknown) {
        errors++;
        const msg = e instanceof Error ? e.message : 'Erreur réseau';
        addLog(`✕ Exception lot ${batchIdx + 1} : ${msg}`);
      }

      setProgress({ current: Math.min(end, total), total });

      // Yield to UI every batch
      await new Promise(r => setTimeout(r, 0));
    }

    addLog('');
    addLog('═══════════════════════════════════════════════');
    addLog(`RAPPORT FINAL`);
    addLog(`  Lignes insérées : ${fmtNum(inserted)} / ${fmtNum(total)}`);
    addLog(`  Erreurs : ${errors}`);
    addLog(`  Table : carreaux_filosofi`);
    addLog(`  Résolution : ${resolution} — Millésime : ${millesime}`);
    addLog('═══════════════════════════════════════════════');

    if (errors > 0) {
      setImportError(`${errors} lot(s) en erreur — ${fmtNum(inserted)}/${fmtNum(total)} insérés`);
    }

    // Register source in data_sources for /admin/sources visibility
    if (inserted > 0) {
      try {
        addLog('Enregistrement de la source dans le back-office...');
        const regRes = await adminFetch('/api/admin/import-geo/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Carreaux ${resolution} — ${millesime}${bundle?.fileName ? ` (${bundle.fileName})` : ''}`,
            resolution,
            millesime,
            row_count: inserted,
            columns: selectedMappings.map(m => m.target || m.source),
            filename: bundle?.fileName || null,
          }),
        });
        const regData = await regRes.json();
        if (regData.success) {
          addLog(`✓ Source enregistrée (id: ${regData.source_id})`);
        } else {
          addLog(`! Enregistrement source : ${regData.error}`);
        }
      } catch {
        addLog(`! Impossible d'enregistrer la source (non bloquant)`);
      }
    }

    setImportDone(true);
    setIsImporting(false);
  }, [features, mappings, resolution, millesime, idColumn, bundle, addLog]);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  const pct = progress ? Math.round(progress.current / progress.total * 100) : 0;
  const speed = progress && elapsed > 0 ? Math.round(progress.current / elapsed) : 0;
  const eta = progress && speed > 0 ? Math.ceil((progress.total - progress.current) / speed) : 0;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: '24px', fontFamily: fontInter }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin { animation: spin 1s linear infinite; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0d0d0d; }
        ::-webkit-scrollbar-thumb { background: #261a35; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(168,85,247,0.4); }
      `}</style>

      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: fontOrbitron, fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '0.04em', color: C.text }}>
            <span style={{ color: C.green }}>admin</span>
            <span style={{ color: C.muted }}> / </span>
            import-shapefile
          </h1>
          <p style={{ fontFamily: fontMono, fontSize: 12, color: C.textSec, marginTop: 6 }}>
            Import de données géographiques — Shapefile &rarr; Supabase
          </p>
        </div>

        {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
          {([
            { n: 1 as WizardStep, label: 'Fichiers' },
            { n: 2 as WizardStep, label: 'Mapping' },
            { n: 3 as WizardStep, label: 'Import' },
          ]).map(({ n, label }) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {n > 1 && (
                <div style={{
                  width: 48,
                  height: 1,
                  background: step >= n ? C.green : C.border,
                }} />
              )}
              <button
                onClick={() => n < step && setStep(n)}
                disabled={n > step}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderRadius: 2,
                  fontFamily: fontMichroma,
                  fontSize: 11,
                  fontWeight: step === n ? 700 : 400,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  cursor: n > step ? 'not-allowed' : n < step ? 'pointer' : 'default',
                  background: step === n ? C.greenDim : step > n ? C.bgElevated : C.bgElevated,
                  border: `1px solid ${step === n ? 'rgba(61,255,160,0.3)' : step > n ? C.border : C.border}`,
                  color: step === n ? C.green : step > n ? C.textDim : C.muted,
                  transition: 'all 0.15s',
                  outline: 'none',
                }}
              >
                <span style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  background: step > n ? C.green : step === n ? C.greenDim : C.bgSurface,
                  color: step > n ? '#000' : step === n ? C.green : C.muted,
                  fontFamily: fontMono,
                }}>
                  {step > n ? '✓' : n}
                </span>
                {label}
              </button>
            </div>
          ))}
        </div>

        {/* ═══════════════════════ STEP 1: FILES ═══════════════════════ */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Dropzone */}
            <div
              ref={dropRef}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => inputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? C.green : C.border}`,
                borderRadius: 2,
                padding: '48px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                background: isDragging ? C.greenDim : C.bgElevated,
                transition: 'all 0.15s',
              }}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".shp,.dbf,.prj,.shx"
                onChange={onFileInput}
                style={{ display: 'none' }}
              />

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: 2,
                  background: C.bgSurface,
                  border: `1px solid ${C.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={isDragging ? C.green : C.muted} strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div>
                  <p style={{ fontFamily: fontInter, fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>
                    Glissez vos fichiers Shapefile ici
                  </p>
                  <p style={{ fontFamily: fontMono, fontSize: 11, color: C.textSec, marginTop: 6 }}>
                    .shp + .dbf + .prj + .shx — sélection multiple obligatoire
                  </p>
                </div>
              </div>
            </div>

            {/* Parse progress */}
            {isParsing && parseProgress && (
              <div style={{
                background: C.bgElevated,
                border: `1px solid ${C.border}`,
                borderRadius: 2,
                padding: 20,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontFamily: fontMono, fontSize: 12, color: C.warn, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg
                      width="13" height="13" viewBox="0 0 24 24"
                      fill="none" stroke={C.warn} strokeWidth="2.5"
                      className="spin"
                      style={{ display: 'inline-block' }}
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    {parseProgress.label}
                  </span>
                  <span style={{ fontFamily: fontMono, fontSize: 12, color: C.warn, fontWeight: 700 }}>{parseProgress.pct}%</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: C.bgSurface, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    borderRadius: 2,
                    background: `linear-gradient(90deg, ${C.warn}, #f97316)`,
                    width: `${parseProgress.pct}%`,
                    transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            )}

            {/* Parse error */}
            {parseError && (
              <div style={{
                background: C.redDim,
                border: `1px solid rgba(248,113,113,0.25)`,
                borderRadius: 2,
                padding: '12px 16px',
              }}>
                <p style={{ fontFamily: fontMono, fontSize: 12, color: C.red, margin: 0 }}>
                  ! {parseError}
                </p>
              </div>
            )}

            {/* File summary (when parsed) */}
            {bundle && features.length > 0 && (
              <div style={{
                background: C.bgElevated,
                border: `1px solid rgba(61,255,160,0.25)`,
                borderRadius: 2,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: 2,
                    background: C.greenDim,
                    border: `1px solid rgba(61,255,160,0.2)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <p style={{ fontFamily: fontMono, fontWeight: 700, color: C.green, margin: 0, fontSize: 13 }}>{bundle.fileName}</p>
                    <p style={{ fontFamily: fontMono, fontSize: 11, color: C.textSec, marginTop: 2 }}>
                      {fmtNum(features.length)} features · {fields.length} colonnes · CRS: {crs}
                    </p>
                  </div>
                </div>

                {/* File sizes */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { ext: '.shp', size: bundle.shp.byteLength },
                    { ext: '.dbf', size: bundle.dbf.byteLength },
                    ...(bundle.prj ? [{ ext: '.prj', size: bundle.prj.length }] : []),
                    ...(bundle.shx ? [{ ext: '.shx', size: bundle.shx.byteLength }] : []),
                  ].map(f => (
                    <span key={f.ext} style={{
                      padding: '3px 10px',
                      borderRadius: 2,
                      background: C.bgSurface,
                      border: `1px solid ${C.border}`,
                      fontFamily: fontMono,
                      fontSize: 11,
                      color: C.textDim,
                    }}>
                      {f.ext} <span style={{ color: C.textSec }}>{fmtBytes(f.size)}</span>
                    </span>
                  ))}
                </div>

                {/* Column preview */}
                <div>
                  <p style={{
                    fontFamily: fontMichroma,
                    fontSize: 9,
                    color: C.accent,
                    textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                    marginBottom: 8,
                  }}>Colonnes détectées</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {fields.map(f => (
                      <span key={f.name} style={{
                        padding: '2px 8px',
                        borderRadius: 2,
                        background: C.bgSurface,
                        border: `1px solid ${C.border}`,
                        fontFamily: fontMono,
                        fontSize: 11,
                        color: C.text,
                      }}>
                        {f.name}
                        <span style={{ color: C.muted, marginLeft: 4 }}>{f.type === 'N' || f.type === 'F' ? '123' : 'abc'}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setStep(2)}
                  style={{
                    width: '100%',
                    padding: '12px 0',
                    borderRadius: 2,
                    background: C.green,
                    color: '#000',
                    fontFamily: fontMichroma,
                    fontWeight: 700,
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  Continuer — Mapping des colonnes
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════ STEP 2: MAPPING ═══════════════════════ */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Config cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {/* Resolution */}
              <div style={{
                background: C.bgElevated,
                border: `1px solid ${C.border}`,
                borderRadius: 2,
                padding: 16,
              }}>
                <label style={{
                  display: 'block',
                  fontFamily: fontMichroma,
                  fontSize: 9,
                  color: C.accent,
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  marginBottom: 8,
                }}>Résolution</label>
                <select
                  value={resolution}
                  onChange={e => setResolution(e.target.value)}
                  style={{
                    width: '100%',
                    background: C.bg,
                    border: `1px solid ${C.border}`,
                    borderRadius: 2,
                    padding: '8px 10px',
                    fontFamily: fontMono,
                    fontSize: 12,
                    color: C.text,
                    outline: 'none',
                  }}
                >
                  <option value="200m">200m × 200m</option>
                  <option value="1km">1km × 1km</option>
                </select>
              </div>

              {/* Millesime */}
              <div style={{
                background: C.bgElevated,
                border: `1px solid ${C.border}`,
                borderRadius: 2,
                padding: 16,
              }}>
                <label style={{
                  display: 'block',
                  fontFamily: fontMichroma,
                  fontSize: 9,
                  color: C.accent,
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  marginBottom: 8,
                }}>Millésime</label>
                <input
                  value={millesime}
                  onChange={e => setMillesime(e.target.value)}
                  style={{
                    width: '100%',
                    background: C.bg,
                    border: `1px solid ${C.border}`,
                    borderRadius: 2,
                    padding: '8px 10px',
                    fontFamily: fontMono,
                    fontSize: 12,
                    color: C.text,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  placeholder="2021"
                />
              </div>

              {/* ID column */}
              <div style={{
                background: C.bgElevated,
                border: `1px solid ${C.border}`,
                borderRadius: 2,
                padding: 16,
              }}>
                <label style={{
                  display: 'block',
                  fontFamily: fontMichroma,
                  fontSize: 9,
                  color: C.accent,
                  textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  marginBottom: 8,
                }}>Colonne ID (idcar)</label>
                <select
                  value={idColumn}
                  onChange={e => setIdColumn(e.target.value)}
                  style={{
                    width: '100%',
                    background: C.bg,
                    border: `1px solid ${C.border}`,
                    borderRadius: 2,
                    padding: '8px 10px',
                    fontFamily: fontMono,
                    fontSize: 12,
                    color: C.text,
                    outline: 'none',
                  }}
                >
                  <option value="">— Auto-index —</option>
                  {fields.map(f => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Column mapping table */}
            <div style={{
              background: C.bgElevated,
              border: `1px solid ${C.border}`,
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              {/* Table header */}
              <div style={{
                padding: '14px 20px',
                borderBottom: `1px solid ${C.border}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <p style={{
                    fontFamily: fontMichroma,
                    fontSize: 9,
                    color: C.accent,
                    textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                    margin: 0,
                  }}>Mapping des colonnes</p>
                  <p style={{ fontFamily: fontMono, fontSize: 11, color: C.textSec, marginTop: 4 }}>
                    Sélectionnez les colonnes à inclure dans les metadata JSONB. Décochez celles à ignorer.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setMappings(mappings.map(m => ({ ...m, target: '' })))}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 2,
                      background: C.bgSurface,
                      border: `1px solid ${C.border}`,
                      fontFamily: fontMichroma,
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: C.textDim,
                      cursor: 'pointer',
                    }}
                  >
                    Tout inclure
                  </button>
                  <button
                    onClick={() => setMappings(mappings.map(m => ({ ...m, target: '__skip__' })))}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 2,
                      background: C.bgSurface,
                      border: `1px solid ${C.border}`,
                      fontFamily: fontMichroma,
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: C.textDim,
                      cursor: 'pointer',
                    }}
                  >
                    Tout exclure
                  </button>
                </div>
              </div>

              {/* Table rows */}
              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                {/* Column headers */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr 160px 148px',
                  gap: 0,
                  padding: '6px 20px',
                  borderBottom: `1px solid ${C.border}`,
                  background: C.bgSurface,
                }}>
                  {['', 'Colonne source', 'Valeur exemple', 'Nom cible'].map((h, i) => (
                    <span key={i} style={{
                      fontFamily: fontMichroma,
                      fontSize: 8,
                      color: C.textSec,
                      textTransform: 'uppercase',
                      letterSpacing: '0.14em',
                    }}>{h}</span>
                  ))}
                </div>

                {mappings.map((m, idx) => {
                  const field = fields[idx];
                  const sample = features.length > 0 ? features[0].properties[m.source] : null;
                  const isIncluded = m.target !== '__skip__';

                  return (
                    <div
                      key={m.source}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '36px 1fr 160px 148px',
                        gap: 0,
                        padding: '8px 20px',
                        borderBottom: `1px solid ${C.border}`,
                        alignItems: 'center',
                        opacity: isIncluded ? 1 : 0.4,
                        background: isIncluded ? 'transparent' : C.bgSurface,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        onChange={e => {
                          const next = [...mappings];
                          next[idx] = { ...m, target: e.target.checked ? '' : '__skip__' };
                          setMappings(next);
                        }}
                        style={{
                          width: 14,
                          height: 14,
                          accentColor: C.accent,
                          cursor: 'pointer',
                          borderRadius: 2,
                        }}
                      />

                      {/* Source column name */}
                      <div>
                        <span style={{ fontFamily: fontMono, fontSize: 12, color: C.text, fontWeight: 500 }}>{m.source}</span>
                        <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginLeft: 8 }}>
                          {field?.type === 'N' || field?.type === 'F' ? 'numérique' : 'texte'}
                        </span>
                      </div>

                      {/* Sample value */}
                      <div style={{ overflow: 'hidden' }}>
                        <span style={{
                          fontFamily: fontMono,
                          fontSize: 11,
                          color: C.textSec,
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {sample != null ? String(sample) : '—'}
                        </span>
                      </div>

                      {/* Target name input */}
                      <input
                        value={m.target === '__skip__' ? '' : m.target}
                        onChange={e => {
                          const next = [...mappings];
                          next[idx] = { ...m, target: e.target.value };
                          setMappings(next);
                        }}
                        disabled={!isIncluded}
                        placeholder="(nom original)"
                        style={{
                          width: 140,
                          background: C.bg,
                          border: `1px solid ${C.border}`,
                          borderRadius: 2,
                          padding: '4px 8px',
                          fontFamily: fontMono,
                          fontSize: 11,
                          color: C.textDim,
                          opacity: isIncluded ? 1 : 0.3,
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary + next */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: fontMono, fontSize: 12, color: C.textDim }}>
                {mappings.filter(m => m.target !== '__skip__').length} / {mappings.length} colonnes sélectionnées
                &nbsp;·&nbsp; {fmtNum(features.length)} features à insérer
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setStep(1)}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 2,
                    background: C.bgElevated,
                    border: `1px solid ${C.border}`,
                    color: C.textDim,
                    fontFamily: fontMichroma,
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  Retour
                </button>
                <button
                  onClick={() => setStep(3)}
                  style={{
                    padding: '10px 24px',
                    borderRadius: 2,
                    background: C.green,
                    border: 'none',
                    color: '#000',
                    fontFamily: fontMichroma,
                    fontWeight: 700,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  Lancer l&apos;import
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════ STEP 3: IMPORT ═══════════════════════ */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Summary card */}
            <div style={{
              background: C.bgElevated,
              border: `1px solid ${C.border}`,
              borderRadius: 2,
              padding: 20,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
                {[
                  { label: 'Features', value: fmtNum(features.length), accent: false },
                  { label: 'Colonnes', value: String(mappings.filter(m => m.target !== '__skip__').length), accent: false },
                  { label: 'Résolution', value: resolution, accent: true },
                  { label: 'Millésime', value: millesime, accent: true },
                ].map(({ label, value, accent }) => (
                  <div key={label}>
                    <p style={{
                      fontFamily: fontMichroma,
                      fontSize: 9,
                      color: C.textSec,
                      textTransform: 'uppercase',
                      letterSpacing: '0.14em',
                      margin: 0,
                    }}>{label}</p>
                    <p style={{
                      fontFamily: fontMono,
                      fontSize: 22,
                      fontWeight: 700,
                      color: accent ? C.green : C.text,
                      margin: '4px 0 0',
                    }}>{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Start button */}
            {!isImporting && !importDone && (
              <button
                onClick={processImport}
                style={{
                  width: '100%',
                  padding: '16px 0',
                  borderRadius: 2,
                  background: C.green,
                  border: 'none',
                  color: '#000',
                  fontFamily: fontMichroma,
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                Lancer l&apos;insertion ({fmtNum(features.length)} features)
              </button>
            )}

            {/* Progress bar */}
            {(isImporting || importDone) && progress && (
              <div style={{
                background: C.bgElevated,
                border: `1px solid ${C.border}`,
                borderRadius: 2,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isImporting && (
                      <svg
                        width="15" height="15" viewBox="0 0 24 24"
                        fill="none" stroke={C.green} strokeWidth="2.5"
                        className="spin"
                        style={{ display: 'inline-block' }}
                      >
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    )}
                    <span style={{
                      fontFamily: fontMono,
                      fontSize: 12,
                      fontWeight: 700,
                      color: importDone ? (importError ? C.red : C.green) : C.warn,
                    }}>
                      {importDone
                        ? (importError ? `! ${importError}` : '✓ Import terminé')
                        : `Insertion en cours — ${fmtNum(progress.current)} / ${fmtNum(progress.total)}`
                      }
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: fontMono, fontSize: 12, color: C.textDim }}>
                    {speed > 0 && <span>{fmtNum(speed)}/s</span>}
                    {isImporting && eta > 0 && <span>ETA ~{fmtTime(eta)}</span>}
                    <span style={{ fontWeight: 700, color: C.text }}>
                      {fmtTime(elapsed)}
                    </span>
                  </div>
                </div>

                <div style={{ position: 'relative' }}>
                  <div style={{ height: 18, borderRadius: 2, background: C.bgSurface, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 2,
                        transition: 'width 0.3s',
                        width: `${pct}%`,
                        background: importDone
                          ? (importError
                            ? `linear-gradient(90deg, ${C.red}, #fb8a8a)`
                            : `linear-gradient(90deg, ${C.green}, ${C.blue})`)
                          : `linear-gradient(90deg, ${C.warn}, #f97316)`,
                        boxShadow: `0 0 10px ${importDone ? (importError ? 'rgba(248,113,113,0.25)' : 'rgba(61,255,160,0.25)') : 'rgba(251,191,36,0.25)'}`,
                      }}
                    />
                  </div>
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <span style={{
                      fontFamily: fontMono,
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#fff',
                      textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                    }}>
                      {pct}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Terminal logs */}
            <div style={{
              background: '#020202',
              border: `1px solid ${C.border}`,
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              {/* Terminal bar */}
              <div style={{
                padding: '8px 14px',
                background: C.bgElevated,
                borderBottom: `1px solid ${C.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  {['#ff5f56', '#ffbd2e', '#27c93f'].map((col, i) => (
                    <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: col }} />
                  ))}
                </div>
                <span style={{ fontFamily: fontMichroma, fontSize: 9, color: C.textSec, marginLeft: 6, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  import-logs
                </span>
                <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted, marginLeft: 'auto' }}>
                  {logs.length} lignes
                </span>
              </div>

              {/* Log output */}
              <div
                ref={logRef}
                style={{
                  padding: '14px 16px',
                  height: 300,
                  overflowY: 'auto',
                  fontFamily: fontMono,
                  fontSize: 11,
                  lineHeight: 1.7,
                }}
              >
                {logs.length === 0 ? (
                  <p style={{ color: C.muted, margin: 0 }}>En attente du lancement…</p>
                ) : (
                  logs.map((line, i) => {
                    let color = C.textDim;
                    if (line.includes('✕') || line.includes('! ') || line.includes('Exception')) color = C.red;
                    else if (line.includes('✓')) color = C.green;
                    else if (line.includes('RAPPORT') || line.includes('═')) color = C.blue;
                    return (
                      <div key={i} style={{ color }}>
                        {line}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Back / Reset */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setStep(2)}
                disabled={isImporting}
                style={{
                  padding: '10px 20px',
                  borderRadius: 2,
                  background: C.bgElevated,
                  border: `1px solid ${C.border}`,
                  color: C.textDim,
                  fontFamily: fontMichroma,
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  cursor: isImporting ? 'not-allowed' : 'pointer',
                  opacity: isImporting ? 0.3 : 1,
                }}
              >
                Retour au mapping
              </button>
              {importDone && (
                <button
                  onClick={() => {
                    setStep(1);
                    setFeatures([]);
                    setFields([]);
                    setBundle(null);
                    setLogs([]);
                    setProgress(null);
                    setImportDone(false);
                    setImportError('');
                  }}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 2,
                    background: 'rgba(59,130,246,0.1)',
                    border: `1px solid rgba(59,130,246,0.3)`,
                    color: C.blue,
                    fontFamily: fontMichroma,
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.18)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
                >
                  Nouvel import
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
