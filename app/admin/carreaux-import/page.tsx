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

      setParseProgress({ label: `✅ ${fmtNum(feats.length)} features prêtes`, pct: 100 });

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
          addLog(`✅ Lot ${batchIdx + 1}/${totalBatches} inséré (${fmtNum(data.inserted)} lignes) — total: ${fmtNum(inserted)}/${fmtNum(total)}`);
        } else {
          errors++;
          addLog(`❌ Erreur lot ${batchIdx + 1}/${totalBatches} : ${data.error}`);

          // Retry with half batch on 413
          if (data.error?.includes('413') || data.error?.includes('too large') || data.error?.includes('payload')) {
            addLog(`  ↳ Tentative en demi-lots...`);
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
                  addLog(`  ✅ Demi-lot inséré (${subData.inserted} lignes)`);
                } else {
                  addLog(`  ❌ Demi-lot échoué : ${subData.error}`);
                }
              } catch (se: unknown) {
                addLog(`  ❌ Demi-lot exception : ${se instanceof Error ? se.message : 'erreur'}`);
              }
            }
          }
        }
      } catch (e: unknown) {
        errors++;
        const msg = e instanceof Error ? e.message : 'Erreur réseau';
        addLog(`❌ Exception lot ${batchIdx + 1} : ${msg}`);
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
        addLog('📋 Enregistrement de la source dans le back-office...');
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
          addLog(`✅ Source enregistrée (id: ${regData.source_id})`);
        } else {
          addLog(`⚠️ Enregistrement source : ${regData.error}`);
        }
      } catch {
        addLog('⚠️ Impossible d\'enregistrer la source (non bloquant)');
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
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold font-mono tracking-tight">
            <span className="text-[#3dffa0]">admin</span> / import-shapefile
          </h1>
          <p className="text-sm text-gray-500 font-mono mt-1">
            Import de données géographiques — Shapefile → Supabase
          </p>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 mb-8">
          {[
            { n: 1, label: 'Fichiers' },
            { n: 2, label: 'Mapping' },
            { n: 3, label: 'Import' },
          ].map(({ n, label }) => (
            <div key={n} className="flex items-center gap-2">
              {n > 1 && <div className={`w-12 h-0.5 ${step >= n ? 'bg-[#3dffa0]' : 'bg-gray-700'}`} />}
              <button
                onClick={() => n < step && setStep(n as WizardStep)}
                disabled={n > step}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-sm transition-all ${
                  step === n
                    ? 'bg-[#3dffa0]/10 border border-[#3dffa0]/30 text-[#3dffa0] font-bold'
                    : step > n
                    ? 'bg-gray-800/50 border border-gray-700 text-gray-400 cursor-pointer hover:border-gray-500'
                    : 'bg-gray-900/50 border border-gray-800 text-gray-600 cursor-not-allowed'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step > n ? 'bg-[#3dffa0] text-black' : step === n ? 'bg-[#3dffa0]/20 text-[#3dffa0]' : 'bg-gray-800 text-gray-600'
                }`}>
                  {step > n ? '✓' : n}
                </span>
                {label}
              </button>
            </div>
          ))}
        </div>

        {/* ═══════════════════════ STEP 1: FILES ═══════════════════════ */}
        {step === 1 && (
          <div className="space-y-6">
            {/* Dropzone */}
            <div
              ref={dropRef}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-[#3dffa0] bg-[#3dffa0]/5'
                  : 'border-gray-700 hover:border-gray-500 bg-gray-900/30'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".shp,.dbf,.prj,.shx"
                onChange={onFileInput}
                className="hidden"
              />

              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={isDragging ? '#3dffa0' : '#888'} strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-300">
                    Glissez vos fichiers Shapefile ici
                  </p>
                  <p className="text-sm text-gray-500 mt-1 font-mono">
                    .shp + .dbf + .prj + .shx — sélection multiple obligatoire
                  </p>
                </div>
              </div>
            </div>

            {/* Parse progress */}
            {isParsing && parseProgress && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
                <div className="flex justify-between items-center mb-3">
                  <span className="font-mono text-sm text-[#ffc832]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffc832" strokeWidth="2.5" className="inline mr-2 animate-spin">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    {parseProgress.label}
                  </span>
                  <span className="font-mono text-sm text-[#ffc832] font-bold">{parseProgress.pct}%</span>
                </div>
                <div className="h-3 rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#ffc832] to-[#ff9500] transition-all duration-300"
                    style={{ width: `${parseProgress.pct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Parse error */}
            {parseError && (
              <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-4">
                <p className="text-red-400 font-mono text-sm">❌ {parseError}</p>
              </div>
            )}

            {/* File summary (when parsed) */}
            {bundle && features.length > 0 && (
              <div className="bg-gray-900/50 border border-[#3dffa0]/20 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#3dffa0]/10 flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3dffa0" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-mono font-bold text-[#3dffa0]">{bundle.fileName}</p>
                    <p className="font-mono text-xs text-gray-500">
                      {fmtNum(features.length)} features · {fields.length} colonnes · CRS: {crs}
                    </p>
                  </div>
                </div>

                {/* File sizes */}
                <div className="flex gap-3 flex-wrap">
                  {[
                    { ext: '.shp', size: bundle.shp.byteLength },
                    { ext: '.dbf', size: bundle.dbf.byteLength },
                    ...(bundle.prj ? [{ ext: '.prj', size: bundle.prj.length }] : []),
                    ...(bundle.shx ? [{ ext: '.shx', size: bundle.shx.byteLength }] : []),
                  ].map(f => (
                    <span key={f.ext} className="px-3 py-1 rounded-md bg-gray-800 font-mono text-xs text-gray-400">
                      {f.ext} <span className="text-gray-500">{fmtBytes(f.size)}</span>
                    </span>
                  ))}
                </div>

                {/* Column preview */}
                <div>
                  <p className="font-mono text-xs text-gray-500 mb-2">Colonnes détectées :</p>
                  <div className="flex gap-2 flex-wrap">
                    {fields.map(f => (
                      <span key={f.name} className="px-2 py-0.5 rounded bg-gray-800 font-mono text-xs text-gray-300">
                        {f.name}
                        <span className="text-gray-600 ml-1">{f.type === 'N' || f.type === 'F' ? '123' : 'abc'}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setStep(2)}
                  className="w-full py-3 rounded-lg bg-[#3dffa0] text-black font-mono font-bold text-sm hover:bg-[#2de090] transition-colors"
                >
                  Continuer → Mapping des colonnes
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════ STEP 2: MAPPING ═══════════════════════ */}
        {step === 2 && (
          <div className="space-y-6">

            {/* Config cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                <label className="block font-mono text-xs text-gray-500 mb-2">Résolution</label>
                <select
                  value={resolution}
                  onChange={e => setResolution(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-white"
                >
                  <option value="200m">200m × 200m</option>
                  <option value="1km">1km × 1km</option>
                </select>
              </div>
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                <label className="block font-mono text-xs text-gray-500 mb-2">Millésime</label>
                <input
                  value={millesime}
                  onChange={e => setMillesime(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-white"
                  placeholder="2021"
                />
              </div>
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                <label className="block font-mono text-xs text-gray-500 mb-2">Colonne ID (idcar)</label>
                <select
                  value={idColumn}
                  onChange={e => setIdColumn(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-white"
                >
                  <option value="">— Auto-index —</option>
                  {fields.map(f => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Column mapping table */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
                <div>
                  <h3 className="font-mono font-bold text-sm text-white">Mapping des colonnes</h3>
                  <p className="font-mono text-xs text-gray-500 mt-1">
                    Sélectionnez les colonnes à inclure dans les metadata JSONB.
                    Décochez celles à ignorer.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMappings(mappings.map(m => ({ ...m, target: '' })))}
                    className="px-3 py-1 rounded bg-gray-800 font-mono text-xs text-gray-400 hover:bg-gray-700"
                  >
                    Tout inclure
                  </button>
                  <button
                    onClick={() => setMappings(mappings.map(m => ({ ...m, target: '__skip__' })))}
                    className="px-3 py-1 rounded bg-gray-800 font-mono text-xs text-gray-400 hover:bg-gray-700"
                  >
                    Tout exclure
                  </button>
                </div>
              </div>

              <div className="divide-y divide-gray-800/50 max-h-[500px] overflow-y-auto">
                {mappings.map((m, idx) => {
                  const field = fields[idx];
                  const sample = features.length > 0 ? features[0].properties[m.source] : null;
                  const isIncluded = m.target !== '__skip__';

                  return (
                    <div
                      key={m.source}
                      className={`px-6 py-3 flex items-center gap-4 transition-colors ${
                        isIncluded ? 'bg-transparent' : 'bg-gray-900/80 opacity-50'
                      }`}
                    >
                      {/* Checkbox */}
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isIncluded}
                          onChange={e => {
                            const next = [...mappings];
                            next[idx] = { ...m, target: e.target.checked ? '' : '__skip__' };
                            setMappings(next);
                          }}
                          className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-[#3dffa0] focus:ring-[#3dffa0] focus:ring-offset-0"
                        />
                      </label>

                      {/* Source column name */}
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-sm text-white font-medium">{m.source}</span>
                        <span className="font-mono text-xs text-gray-600 ml-2">
                          {field?.type === 'N' || field?.type === 'F' ? 'numérique' : 'texte'}
                        </span>
                      </div>

                      {/* Sample value */}
                      <div className="w-48 truncate">
                        <span className="font-mono text-xs text-gray-500">
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
                        className="w-40 bg-gray-800 border border-gray-700 rounded px-2 py-1 font-mono text-xs text-gray-300 disabled:opacity-30"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary + next */}
            <div className="flex items-center justify-between">
              <div className="font-mono text-sm text-gray-400">
                {mappings.filter(m => m.target !== '__skip__').length} / {mappings.length} colonnes sélectionnées
                · {fmtNum(features.length)} features à insérer
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="px-6 py-2.5 rounded-lg bg-gray-800 text-gray-400 font-mono text-sm hover:bg-gray-700"
                >
                  ← Retour
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="px-6 py-2.5 rounded-lg bg-[#3dffa0] text-black font-mono font-bold text-sm hover:bg-[#2de090] transition-colors"
                >
                  Lancer l&apos;import →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════ STEP 3: IMPORT ═══════════════════════ */}
        {step === 3 && (
          <div className="space-y-6">

            {/* Summary card */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
              <div className="grid grid-cols-4 gap-6">
                <div>
                  <p className="font-mono text-xs text-gray-500">Features</p>
                  <p className="font-mono text-xl font-bold text-white">{fmtNum(features.length)}</p>
                </div>
                <div>
                  <p className="font-mono text-xs text-gray-500">Colonnes</p>
                  <p className="font-mono text-xl font-bold text-white">
                    {mappings.filter(m => m.target !== '__skip__').length}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs text-gray-500">Résolution</p>
                  <p className="font-mono text-xl font-bold text-[#3dffa0]">{resolution}</p>
                </div>
                <div>
                  <p className="font-mono text-xs text-gray-500">Millésime</p>
                  <p className="font-mono text-xl font-bold text-[#3dffa0]">{millesime}</p>
                </div>
              </div>
            </div>

            {/* Start button */}
            {!isImporting && !importDone && (
              <button
                onClick={processImport}
                className="w-full py-4 rounded-xl bg-[#3dffa0] text-black font-mono font-bold text-lg hover:bg-[#2de090] transition-colors"
              >
                ⚡ Lancer l&apos;insertion ({fmtNum(features.length)} features)
              </button>
            )}

            {/* Progress bar */}
            {(isImporting || importDone) && progress && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    {isImporting && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3dffa0" strokeWidth="2.5" className="animate-spin">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    )}
                    <span className="font-mono text-sm font-bold" style={{ color: importDone ? (importError ? '#ff5757' : '#3dffa0') : '#ffc832' }}>
                      {importDone
                        ? (importError ? `⚠️ ${importError}` : '✅ Import terminé')
                        : `💾 Insertion en cours — ${fmtNum(progress.current)} / ${fmtNum(progress.total)}`
                      }
                    </span>
                  </div>
                  <div className="flex items-center gap-4 font-mono text-sm text-gray-400">
                    {speed > 0 && <span>⚡ {fmtNum(speed)}/s</span>}
                    {isImporting && eta > 0 && <span>ETA ~{fmtTime(eta)}</span>}
                    <span className="font-bold text-white">⏱ {fmtTime(elapsed)}</span>
                  </div>
                </div>

                <div className="relative">
                  <div className="h-5 rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        background: importDone
                          ? (importError ? 'linear-gradient(90deg, #ff5757, #ff8888)' : 'linear-gradient(90deg, #3dffa0, #58a6ff)')
                          : 'linear-gradient(90deg, #ffc832, #ff9500)',
                        boxShadow: `0 0 12px ${importDone ? (importError ? '#ff575740' : '#3dffa040') : '#ffc83240'}`,
                      }}
                    />
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-mono text-xs font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                      {pct}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Terminal logs */}
            <div className="bg-[#0d0d14] border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-gray-900/80 border-b border-gray-800 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                  <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
                </div>
                <span className="font-mono text-xs text-gray-500 ml-2">import-logs</span>
                <span className="font-mono text-xs text-gray-600 ml-auto">{logs.length} lignes</span>
              </div>
              <div
                ref={logRef}
                className="p-4 h-80 overflow-y-auto font-mono text-xs leading-relaxed"
              >
                {logs.length === 0 ? (
                  <p className="text-gray-600">En attente du lancement…</p>
                ) : (
                  logs.map((line, i) => (
                    <div key={i} className={
                      line.includes('❌') ? 'text-red-400'
                      : line.includes('✅') ? 'text-[#3dffa0]'
                      : line.includes('RAPPORT') || line.includes('═') ? 'text-[#58a6ff] font-bold'
                      : 'text-gray-400'
                    }>
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Back / Reset */}
            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                disabled={isImporting}
                className="px-6 py-2.5 rounded-lg bg-gray-800 text-gray-400 font-mono text-sm hover:bg-gray-700 disabled:opacity-30"
              >
                ← Retour au mapping
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
                  className="px-6 py-2.5 rounded-lg bg-[#58a6ff]/10 border border-[#58a6ff]/30 text-[#58a6ff] font-mono text-sm hover:bg-[#58a6ff]/20"
                >
                  🔄 Nouvel import
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
