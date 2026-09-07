'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import {
  parseSHP,
  parseDBF,
  detectCRS,
  reprojectCoords,
  polygonToEWKT,
  detectIdColumn,
  type ShapefileBundle,
  type DbfField,
  type Feature,
} from './_lib/shapefile';
import {
  C,
  fontInter,
  fontMono,
  fmtNum,
  type ColumnMapping,
  type WizardStep,
} from './_components/shared';
import { Stepper } from './_components/Stepper';
import { FilesStep } from './_components/FilesStep';
import { MappingStep } from './_components/MappingStep';
import { ImportStep } from './_components/ImportStep';

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

  /** Remet le wizard à zéro pour enchaîner sur un autre bundle. */
  const resetImport = useCallback(() => {
    setStep(1);
    setFeatures([]);
    setFields([]);
    setBundle(null);
    setLogs([]);
    setProgress(null);
    setImportDone(false);
    setImportError('');
  }, []);

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
        ::-webkit-scrollbar-track { background: var(--bg-surface); }
        ::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(78,205,196,0.4); }
      `}</style>

      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: fontInter, fontSize: 18, fontWeight: 500, margin: 0, color: C.text }}>
            Import shapefile
          </h1>
          <p style={{ fontFamily: fontMono, fontSize: 12, color: C.textSec, marginTop: 6 }}>
            Import de données géographiques — Shapefile &rarr; Supabase
          </p>
        </div>

        <Stepper step={step} setStep={setStep} />

        {/* ═══════════════════════ STEP 1: FILES ═══════════════════════ */}
        {step === 1 && (
          <FilesStep
            bundle={bundle}
            features={features}
            fields={fields}
            crs={crs}
            parseError={parseError}
            isParsing={isParsing}
            parseProgress={parseProgress}
            dropRef={dropRef}
            inputRef={inputRef}
            isDragging={isDragging}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onFileInput={onFileInput}
            setStep={setStep}
          />
        )}

        {/* ═══════════════════════ STEP 2: MAPPING ═══════════════════════ */}
        {step === 2 && (
          <MappingStep
            features={features}
            fields={fields}
            mappings={mappings}
            setMappings={setMappings}
            resolution={resolution}
            setResolution={setResolution}
            millesime={millesime}
            setMillesime={setMillesime}
            idColumn={idColumn}
            setIdColumn={setIdColumn}
            setStep={setStep}
          />
        )}

        {/* ═══════════════════════ STEP 3: IMPORT ═══════════════════════ */}
        {step === 3 && (
          <ImportStep
            features={features}
            mappings={mappings}
            resolution={resolution}
            millesime={millesime}
            processImport={processImport}
            isImporting={isImporting}
            importDone={importDone}
            importError={importError}
            progress={progress}
            elapsed={elapsed}
            logs={logs}
            logRef={logRef}
            setStep={setStep}
            onReset={resetImport}
          />
        )}
      </div>
    </div>
  );
}
