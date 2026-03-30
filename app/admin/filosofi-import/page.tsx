'use client';

import { useState, useRef, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
// @ts-ignore — hyparquet has no TypeScript type definitions (no @types/hyparquet package)
import { parquetRead, parquetMetadata } from 'hyparquet';
import { decompress } from 'fzstd';
import proj4 from 'proj4';

// Projections INSEE (Lambert 93 + LAEA Europe)
proj4.defs('EPSG:2154', '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:          '#050505',
  bgElevated:  '#0a0a0a',
  bgCard:      '#111111',
  border:      '#1a1a1a',
  borderLight: 'rgba(78,205,196,0.2)',
  accent:      '#4ecdc4',
  accentDim:   'rgba(78,205,196,0.08)',
  text:        '#f0f0f0',
  textDim:     '#a0a0a0',
  textSec:     '#666666',
  green:       '#3dffa0',
  red:         '#f87171',
  yellow:      '#f59e0b',
};
const fontMono     = "'JetBrains Mono', monospace";
const fontInter    = "'Inter', system-ui, sans-serif";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LogLine {
  id:   number;
  text: string;
  kind: 'info' | 'ok' | 'error' | 'progress' | 'head';
}

interface DbfField { name: string; type: string; length: number; decimal: number; }
interface DbfMeta  { fields: DbfField[]; headerSize: number; recordSize: number; }

type FileType = 'parquet' | 'dbf' | 'shp';

interface FileInfo {
  file:       File;
  buffer:     ArrayBuffer;  // DBF buffer (toujours présent)
  columns:    string[];
  rowCount:   number;
  sampleRow:  Record<string, unknown>;
  resolution: string;
  millesime:  string;
  fileType:   FileType;
  dbfMeta?:   DbfMeta;
  shpGeoms?:  any[];  // GeoJSON geometry objects indexés par ligne
  shpSrcProj?: string; // 'EPSG:3035' | 'EPSG:2154'
}

// ─── Conversion GeoJSON geometry → WKT WGS84 ─────────────────────────────────

function geomToWKT(geom: any, srcProj: string): string | null {
  if (!geom) return null;
  const reproject = ([x, y]: number[]) => {
    const [lon, lat] = proj4(srcProj, 'WGS84', [x, y]);
    return `${lon.toFixed(8)} ${lat.toFixed(8)}`;
  };
  const ringWkt = (ring: number[][]) => `(${ring.map(reproject).join(', ')})`;
  if (geom.type === 'Polygon') {
    return `POLYGON(${geom.coordinates.map(ringWkt).join(', ')})`;
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates.map((p: number[][][]) => `(${p.map(ringWkt).join(', ')})`);
    return `MULTIPOLYGON(${polys.join(', ')})`;
  }
  return null;
}

function detectProj(geoms: any[]): string {
  // Détecte EPSG:3035 ou EPSG:2154 selon l'ordre de grandeur des coords
  const first = geoms.find(g => g?.coordinates?.[0]?.[0]);
  if (!first) return 'EPSG:3035';
  const [x] = first.coordinates[0][0];
  return x > 2_000_000 ? 'EPSG:3035' : 'EPSG:2154';
}

const fmtNum = (n: number) => n.toLocaleString('fr-FR');

// Colonnes géo/admin à exclure automatiquement des métadonnées
const GEO_COLS = new Set([
  'xmin', 'ymin', 'xmax', 'ymax', 'geometry', 'geom',
  'x_wgs84', 'y_wgs84', 'x_lam', 'y_lam', 'lat', 'lon', 'lng',
  'i_est_200', 'i_est_1km',
]);

// ─── Parseur DBF pur TS ───────────────────────────────────────────────────────

function parseDbfHeader(buf: ArrayBuffer): DbfMeta & { recordCount: number } {
  const view  = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const recordCount = view.getUint32(4, true);
  const headerSize  = view.getUint16(8, true);
  const recordSize  = view.getUint16(10, true);
  const dec = new TextDecoder('ascii');
  const fields: DbfField[] = [];
  let offset = 32;
  while (offset + 32 <= headerSize) {
    if (bytes[offset] === 0x0D) break;
    const nameRaw = bytes.slice(offset, offset + 11);
    const nullIdx = nameRaw.indexOf(0);
    const name = dec.decode(nullIdx === -1 ? nameRaw : nameRaw.slice(0, nullIdx)).trim();
    if (!name) break;
    const type    = String.fromCharCode(bytes[offset + 11]);
    const length  = bytes[offset + 16];
    const decimal = bytes[offset + 17];
    fields.push({ name, type, length, decimal });
    offset += 32;
  }
  return { fields, headerSize, recordSize, recordCount };
}

function parseDbfRows(
  buf: ArrayBuffer,
  meta: DbfMeta,
  startRow: number,
  endRow: number,
): Record<string, unknown>[] {
  const { fields, headerSize, recordSize } = meta;
  const bytes = new Uint8Array(buf);
  const dec   = new TextDecoder('latin1');
  const rows: Record<string, unknown>[] = [];
  for (let i = startRow; i < endRow; i++) {
    const base = headerSize + i * recordSize;
    if (base + recordSize > bytes.length) break;
    if (bytes[base] === 0x2A) continue; // deleted
    const row: Record<string, unknown> = {};
    let off = base + 1;
    for (const f of fields) {
      const raw = dec.decode(bytes.slice(off, off + f.length)).trim();
      if (f.type === 'N' || f.type === 'F') {
        const n = parseFloat(raw);
        row[f.name] = isNaN(n) ? null : n;
      } else if (f.type === 'L') {
        row[f.name] = /^[TYty]$/.test(raw) ? true : /^[FNfn]$/.test(raw) ? false : null;
      } else {
        row[f.name] = raw || null;
      }
      off += f.length;
    }
    rows.push(row);
  }
  return rows;
}

// ─── Btn ──────────────────────────────────────────────────────────────────────
function Btn({ onClick, disabled, children, variant = 'primary' }: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode; variant?: 'primary' | 'ghost';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '9px 22px',
        background: variant === 'primary' ? C.accent : 'transparent',
        color: variant === 'primary' ? '#050505' : C.textDim,
        border: variant === 'ghost' ? `1px solid ${C.border}` : 'none',
        borderRadius: 2,
        fontFamily: fontInter,
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ─── ÉTAPE 1 : Sélection fichier ──────────────────────────────────────────────
function StepUpload({ onLoaded, addLog }: {
  onLoaded: (info: FileInfo) => void;
  addLog: (t: string, k: LogLine['kind']) => void;
}) {
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase,    setPhase]    = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const log = (msg: string) => { addLog(msg, 'info'); setPhase(msg.slice(0, 70)); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    addLog(`${files.length} fichier(s) sélectionné(s) : ${files.map(f => f.name).join(', ')}`, 'info');
    if (!files.length) { setError('Aucun fichier reçu'); return; }
    setLoading(true);
    setError(null);
    setProgress(0);
    try {
      const shpFile  = files.find(f => f.name.toLowerCase().endsWith('.shp'));
      const dbfFile  = files.find(f => f.name.toLowerCase().endsWith('.dbf'));
      const parqFile = files.find(f => f.name.toLowerCase().endsWith('.parquet'));
      const refFile  = shpFile ?? dbfFile ?? parqFile ?? files[0];

      const resolution = refFile.name.includes('1km') ? '1km' : '200m';
      const millesimeM = refFile.name.match(/(20\d{2}|19\d{2})/);
      const millesime  = millesimeM ? millesimeM[1] : '2021';

      if (shpFile && dbfFile) {
        // ── Mode SHP ────────────────────────────────────────────────────────
        log(`Mode SHP — lecture ${shpFile.name} (${(shpFile.size / 1024 / 1024).toFixed(1)} Mo) + ${dbfFile.name}...`);
        const [shpBuffer, dbfBuffer] = await Promise.all([shpFile.arrayBuffer(), dbfFile.arrayBuffer()]);
        setProgress(15);
        log('Parsing DBF header...');
        const { fields, headerSize, recordSize, recordCount } = parseDbfHeader(dbfBuffer);
        log(`DBF OK — ${recordCount.toLocaleString('fr-FR')} enregistrements, ${fields.length} colonnes`);
        setProgress(30);
        log('Parsing géométries SHP (298 Mo — environ 30-60 sec)...');
        await new Promise(r => setTimeout(r, 50)); // flush UI avant parsing lourd
        // @ts-ignore — shpjs dynamic import: the package types don't expose parseShp on the default export
        const shpjsMod = await import('shpjs');
        // shpjs exporte parseShp(buffer) → GeoJSON geometry[]
        const parseShp = shpjsMod.parseShp ?? shpjsMod.default?.parseShp;
        if (!parseShp) throw new Error('shpjs.parseShp introuvable');
        const shpGeoms: any[] = parseShp(shpBuffer);
        setProgress(60);
        const srcProj = detectProj(shpGeoms);
        log(`SHP OK — ${shpGeoms.length.toLocaleString('fr-FR')} géométries, projection détectée : ${srcProj}`);
        const sampleRows = parseDbfRows(dbfBuffer, { fields, headerSize, recordSize }, 0, 1);
        setProgress(100);
        const columns = fields.map(f => f.name);
        onLoaded({
          file: dbfFile, buffer: dbfBuffer, columns, rowCount: recordCount,
          sampleRow: sampleRows[0] ?? {}, resolution, millesime,
          fileType: 'shp', dbfMeta: { fields, headerSize, recordSize },
          shpGeoms, shpSrcProj: srcProj,
        });

      } else if (dbfFile) {
        // ── Mode DBF ────────────────────────────────────────────────────────
        log(`Mode DBF — lecture ${dbfFile.name} (${(dbfFile.size / 1024 / 1024).toFixed(1)} Mo)...`);
        const buffer = await dbfFile.arrayBuffer();
        log(`Buffer OK (${(buffer.byteLength / 1024 / 1024).toFixed(1)} Mo) — parsing header...`);
        setProgress(10);
        const { fields, headerSize, recordSize, recordCount } = parseDbfHeader(buffer);
        log(`Header OK — ${recordCount.toLocaleString('fr-FR')} enregistrements, ${fields.length} colonnes, rec=${recordSize}o`);
        setProgress(30);
        log(`Colonnes : ${fields.slice(0, 10).map(f => f.name).join(', ')}${fields.length > 10 ? ' …' : ''}`);
        log('Lecture aperçu (ligne 1)...');
        const sampleRows = parseDbfRows(buffer, { fields, headerSize, recordSize }, 0, 1);
        setProgress(50);
        log(`Aperçu OK — ${JSON.stringify(sampleRows[0]).slice(0, 200)}`);
        setProgress(100);
        const columns = fields.map(f => f.name);
        onLoaded({
          file: dbfFile, buffer, columns, rowCount: recordCount,
          sampleRow: sampleRows[0] ?? {}, resolution, millesime,
          fileType: 'dbf', dbfMeta: { fields, headerSize, recordSize },
        });

      } else if (parqFile) {
        // ── Mode Parquet ─────────────────────────────────────────────────────
        log(`Mode Parquet — lecture ${parqFile.name} (${(parqFile.size / 1024 / 1024).toFixed(1)} Mo)...`);
        const buffer = await parqFile.arrayBuffer();
        const meta   = parquetMetadata(buffer);
        const columns: string[] = meta.schema
          .filter((s: any) => s.num_children === undefined || s.num_children === null)
          .map((s: any) => s.name)
          .filter((n: string) => n !== 'schema');
        const rowCount = Number(meta.num_rows);
        log(`Parquet — ${rowCount.toLocaleString('fr-FR')} lignes, ${columns.length} colonnes`);
        setProgress(50);
        let sampleRow: Record<string, unknown> = {};
        await parquetRead({
          file: buffer,
          compressors: { ZSTD: (d: any) => decompress(d) },
          rowStart: 0, rowEnd: 1,
          onComplete: (rawRows: any[]) => {
            if (rawRows[0]) columns.forEach((col, idx) => { sampleRow[col] = rawRows[0][idx]; });
          },
        });
        setProgress(100);
        log(`Aperçu OK — colonnes : ${columns.slice(0, 8).join(', ')}${columns.length > 8 ? ' …' : ''}`);
        onLoaded({ file: parqFile, buffer, columns, rowCount, sampleRow, resolution, millesime, fileType: 'parquet' });

      } else {
        throw new Error('Sélectionne un .parquet, ou un .dbf seul, ou un .shp + .dbf ensemble');
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'Erreur lecture fichier';
      setError(errMsg);
      addLog(`! ${errMsg}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 32, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 2 }}>
      <input ref={inputRef} type="file" accept=".dbf,.parquet,.shp" multiple style={{ display: 'none' }} onChange={handleFile} />
      <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 16 }}>
        Étape 1 — Sélection fichier
      </div>
      <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textSec, marginBottom: 16, lineHeight: 1.9 }}>
        Mode A : <span style={{ color: C.accent }}>.shp + .dbf</span> — géométrie réelle + attributs (sélectionner les 2 fichiers)<br/>
        Mode B : <span style={{ color: C.accent }}>.dbf</span> — attributs seuls (géométrie reconstruite depuis idcar)<br/>
        Mode C : <span style={{ color: C.accent }}>.parquet</span> — fichier Parquet INSEE
      </div>
      <Btn onClick={() => { if (inputRef.current) { inputRef.current.value = ''; inputRef.current.click(); } }} disabled={loading}>
        {loading ? 'Analyse en cours...' : 'Charger fichier'}
      </Btn>
      {loading && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fontMono, fontSize: 10, marginBottom: 4, color: C.textDim }}>
            <span style={{ maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{phase || 'Lecture...'}</span>
            <span style={{ color: C.accent }}>{progress}%</span>
          </div>
          <div style={{ width: '100%', height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: C.accent, transition: 'width 0.3s ease' }} />
          </div>
        </div>
      )}
      {error && <div style={{ marginTop: 12, color: C.red, fontFamily: fontMono, fontSize: 11 }}>! {error}</div>}
    </div>
  );
}

// ─── ÉTAPE 2 : Configuration colonnes ─────────────────────────────────────────
function StepConfig({ info, onStart }: {
  info:    FileInfo;
  onStart: (idcarCol: string, selectedCols: string[], resolution: string, millesime: string) => void;
}) {
  const isDbf = info.fileType === 'dbf';
  const isShp = info.fileType === 'shp';

  const guessIdcar =
    info.columns.find(c => c.toLowerCase() === 'idcar') ??
    info.columns.find(c => c.toLowerCase().startsWith('idcar')) ??
    info.columns.find(c => c.toLowerCase().includes('idcar')) ??
    info.columns[0];

  const [idcarCol,   setIdcarCol]   = useState(guessIdcar ?? '');
  const [resolution, setResolution] = useState(info.resolution);
  const [millesime,  setMillesime]  = useState(info.millesime);

  const metaCols = info.columns.filter(c => !GEO_COLS.has(c.toLowerCase()) && c !== guessIdcar);
  const [selected, setSelected] = useState<Set<string>>(new Set(metaCols));
  const toggle     = (col: string) => setSelected(prev => { const s = new Set(prev); s.has(col) ? s.delete(col) : s.add(col); return s; });
  const selectAll  = () => setSelected(new Set(metaCols));
  const selectNone = () => setSelected(new Set());

  const sampleVal = (col: string) => {
    const v = info.sampleRow[col];
    if (v === null || v === undefined) return '—';
    return String(v).slice(0, 24);
  };

  const handleStart = () => {
    const cols = [idcarCol, ...Array.from(selected).filter(c => c !== idcarCol)];
    onStart(idcarCol, cols, resolution, millesime);
  };

  return (
    <div style={{ padding: 24, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 2 }}>
      <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 20 }}>
        Étape 2 — Configuration — {info.file.name} — {fmtNum(info.rowCount)} lignes
        {isShp  && <span style={{ marginLeft: 12, color: C.green  }}>[ SHP ]</span>}
        {isDbf  && <span style={{ marginLeft: 12, color: C.accent }}>[ DBF ]</span>}
        {!isDbf && !isShp && <span style={{ marginLeft: 12, color: C.yellow }}>[ PARQUET ]</span>}
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: C.text }}>Colonne idcar *</span>
          <select
            value={idcarCol}
            onChange={e => setIdcarCol(e.target.value)}
            style={{ background: C.bgElevated, color: C.text, border: `1px solid ${C.borderLight}`, borderRadius: 2, padding: '6px 10px', fontFamily: fontMono, fontSize: 11 }}
          >
            {info.columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: C.text }}>Résolution</span>
          <select
            value={resolution}
            onChange={e => setResolution(e.target.value)}
            style={{ background: C.bgElevated, color: C.text, border: `1px solid ${C.borderLight}`, borderRadius: 2, padding: '6px 10px', fontFamily: fontMono, fontSize: 11 }}
          >
            <option value="200m">200m</option>
            <option value="1km">1km</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: C.text }}>Millésime</span>
          <input
            type="text"
            value={millesime}
            onChange={e => setMillesime(e.target.value)}
            maxLength={4}
            style={{ background: C.bgElevated, color: C.text, border: `1px solid ${C.borderLight}`, borderRadius: 2, padding: '6px 10px', fontFamily: fontMono, fontSize: 11, width: 70 }}
          />
        </label>
      </div>

      {isShp && (
        <div style={{ marginBottom: 16, padding: '8px 12px', background: 'rgba(61,255,160,0.06)', border: `1px solid rgba(61,255,160,0.25)`, borderRadius: 2, fontFamily: fontMono, fontSize: 10, color: C.green }}>
          Geometrie reelle depuis .shp ({info.shpSrcProj ?? 'auto'} → WGS84) — {(info.shpGeoms?.length ?? 0).toLocaleString('fr-FR')} polygones charges
        </div>
      )}
      {isDbf && (
        <div style={{ marginBottom: 16, padding: '8px 12px', background: 'rgba(78,205,196,0.06)', border: `1px solid ${C.borderLight}`, borderRadius: 2, fontFamily: fontMono, fontSize: 10, color: C.textDim }}>
          Geometrie reconstruite depuis idcar (Lambert 93 / ETRS89 → WGS84) — .shp non requis
        </div>
      )}

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: C.text }}>
          Colonnes métadonnées ({selected.size} / {metaCols.length})
        </span>
        <button onClick={selectAll}  style={{ background: 'none', border: 'none', color: C.accent, fontFamily: fontMono, fontSize: 10, cursor: 'pointer', padding: 0 }}>tout</button>
        <button onClick={selectNone} style={{ background: 'none', border: 'none', color: C.textSec, fontFamily: fontMono, fontSize: 10, cursor: 'pointer', padding: 0 }}>aucun</button>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 4, maxHeight: 280, overflowY: 'auto',
        border: `1px solid ${C.border}`, borderRadius: 2, padding: 10, marginBottom: 20,
      }}>
        {metaCols.map(col => (
          <label key={col} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
            background: selected.has(col) ? C.accentDim : 'transparent',
            border: `1px solid ${selected.has(col) ? C.borderLight : 'transparent'}`,
            borderRadius: 2, cursor: 'pointer',
          }}>
            <input type="checkbox" checked={selected.has(col)} onChange={() => toggle(col)} style={{ accentColor: C.accent, cursor: 'pointer' }} />
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontFamily: fontMono, fontSize: 10, color: C.text }}>{col}</span>
              <span style={{ fontFamily: fontMono, fontSize: 9, color: C.textSec }}>{sampleVal(col)}</span>
            </span>
          </label>
        ))}
      </div>

      <div style={{ marginBottom: 20, padding: '10px 12px', background: C.bgElevated, borderRadius: 2, border: `1px solid ${C.border}` }}>
        <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 6 }}>Aperçu ligne 1</div>
        <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textDim, wordBreak: 'break-all' }}>
          {JSON.stringify(info.sampleRow).slice(0, 400)}
        </div>
      </div>

      <Btn onClick={handleStart}>
        Lancer l'import — {fmtNum(info.rowCount)} lignes
      </Btn>
    </div>
  );
}

// ─── ÉTAPE 3 : Import ─────────────────────────────────────────────────────────
function StepImport({ info, idcarCol, selectedCols, resolution, millesime, addLog }: {
  info:         FileInfo;
  idcarCol:     string;
  selectedCols: string[];
  resolution:   string;
  millesime:    string;
  addLog:       (t: string, k: LogLine['kind']) => void;
}) {
  const [progress, setProgress] = useState(0);
  const [done,     setDone]     = useState(false);
  const isDbf = info.fileType === 'dbf';
  const isShp = info.fileType === 'shp';

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const CHUNK_SIZE  = 1500;
      const CONCURRENCY = 3;
      const rowCount    = info.rowCount;
      const totalChunks = Math.ceil(rowCount / CHUNK_SIZE);
      let totalInserted = 0;
      let totalErrors   = 0;
      let totalSkipped  = 0;
      let doneChunks    = 0;

      addLog(`Import ${isShp ? 'SHP' : isDbf ? 'DBF' : 'PARQUET'} — ${fmtNum(rowCount)} lignes, ${totalChunks} lots`, 'head');
      addLog(`idcar: ${idcarCol} | résolution: ${resolution} | millésime: ${millesime}`, 'info');
      addLog(`Colonnes sélectionnées (${selectedCols.length}) : ${selectedCols.slice(0, 8).join(', ')}${selectedCols.length > 8 ? ' …' : ''}`, 'info');

      // ── Lecture d'un chunk ────────────────────────────────────────────────
      const readChunk = (startRow: number, endRow: number): Promise<Record<string, unknown>[]> => {
        if (isDbf || isShp) {
          const meta = info.dbfMeta!;
          const allRows = parseDbfRows(info.buffer, meta, startRow, endRow);
          return Promise.resolve(allRows.map((row, i) => {
            const out: Record<string, unknown> = {};
            selectedCols.forEach(col => { out[col] = row[col]; });
            if (isShp && info.shpGeoms && info.shpSrcProj) {
              out.__geom_wkt__ = geomToWKT(info.shpGeoms[startRow + i], info.shpSrcProj) ?? null;
            }
            return out;
          }));
        }
        return new Promise(resolve => {
          const rows: Record<string, unknown>[] = [];
          parquetRead({
            file: info.buffer,
            compressors: { ZSTD: (d: any) => decompress(d) },
            rowStart: startRow, rowEnd: endRow,
            onComplete: (rawRows: any[]) => {
              for (const row of rawRows) {
                const obj: Record<string, unknown> = {};
                selectedCols.forEach(col => {
                  const idx = info.columns.indexOf(col);
                  if (idx !== -1) obj[col] = row[idx];
                });
                rows.push(obj);
              }
              resolve(rows);
            },
          });
        });
      };

      // ── Envoi d'un chunk ──────────────────────────────────────────────────
      const sendChunk = async (chunkIdx: number, rows: Record<string, unknown>[]) => {
        if (cancelled) return;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 55_000);
        try {
          const res = await adminFetch('/api/admin/filosofi-import', {
            method: 'POST',
            body: JSON.stringify({
              data: rows,
              columns: isShp ? [...selectedCols, '__geom_wkt__'] : selectedCols,
              idcar_col: idcarCol,
              geom_col: isShp ? '__geom_wkt__' : undefined,
              resolution, millesime,
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) {
            let detail = `Erreur lot ${chunkIdx + 1}`;
            try { const j = await res.json(); if (j.error) detail = j.error; } catch {}
            throw new Error(detail);
          }
          try {
            const j = await res.json();
            totalInserted += j.inserted ?? 0;
            totalErrors   += j.errors   ?? 0;
            totalSkipped  += j.skipped  ?? 0;
          } catch {}
        } catch (err: unknown) {
          clearTimeout(timer);
          const msg = err instanceof Error ? err.message : String(err);
          addLog(`! Lot ${chunkIdx + 1} échoué : ${msg}`, 'error');
          totalErrors += rows.length;
        }
        doneChunks++;
        if (!cancelled) {
          setProgress(Math.round((doneChunks / totalChunks) * 100));
          if (doneChunks % 5 === 0 || doneChunks === totalChunks) {
            addLog(`Lot ${doneChunks}/${totalChunks} — insérés: ${fmtNum(totalInserted)} | erreurs: ${fmtNum(totalErrors)} | ignorés: ${fmtNum(totalSkipped)}`, 'progress');
          }
        }
      };

      // ── Pipeline ──────────────────────────────────────────────────────────
      try {
        for (let wave = 0; wave < totalChunks; wave += CONCURRENCY) {
          if (cancelled) break;
          const tasks = [];
          for (let i = wave; i < Math.min(wave + CONCURRENCY, totalChunks); i++) {
            const startRow = i * CHUNK_SIZE;
            const endRow   = Math.min(startRow + CHUNK_SIZE, rowCount);
            tasks.push(readChunk(startRow, endRow).then(rows => sendChunk(i, rows)));
          }
          await Promise.all(tasks);
        }

        addLog(`Terminé — ${fmtNum(totalInserted)} insérés, ${fmtNum(totalErrors)} erreurs, ${fmtNum(totalSkipped)} ignorés.`, 'ok');

        const srcRes = await adminFetch('/api/admin/sources', {
          method: 'POST',
          body: JSON.stringify({
            name:              `Filosofi ${millesime} — Carreaux ${resolution}`,
            type:              'carreaux', category: 'carreaux',
            original_filename: info.file.name,
            file_format:       isShp ? 'shp' : isDbf ? 'dbf' : 'parquet',
            row_count:         rowCount,
            valid_count:       totalInserted,
            error_count:       totalErrors,
            mapping:           { resolution, millesime, idcarCol, columns: selectedCols },
            geo_config:        { table_name: 'carreaux_filosofi', resolution, millesime },
          }),
        });
        if (srcRes.ok) addLog('Source enregistrée dans l\'onglet Données.', 'ok');
        if (!cancelled) setDone(true);
      } catch (e: unknown) {
        addLog(`Erreur : ${e instanceof Error ? e.message : 'Erreur inconnue'}`, 'error');
      }
    };

    run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 24, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 2 }}>
      <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 16 }}>
        Étape 3 — Import en cours
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fontMono, fontSize: 10, marginBottom: 6, color: C.textDim }}>
        <span>{done ? 'Terminé' : 'Avancement'}</span>
        <span style={{ color: done ? C.green : C.accent }}>{progress}%</span>
      </div>
      <div style={{ width: '100%', height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${progress}%`, height: '100%', background: done ? C.green : C.accent, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function FilosofiImportPage() {
  const [step,      setStep]      = useState<1 | 2 | 3>(1);
  const [fileInfo,  setFileInfo]  = useState<FileInfo | null>(null);
  const [importCfg, setImportCfg] = useState<{ idcarCol: string; selectedCols: string[]; resolution: string; millesime: string } | null>(null);
  const [logs,      setLogs]      = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (text: string, kind: LogLine['kind'] = 'info') =>
    setLogs(prev => [...prev, { id: Date.now() + Math.random(), text, kind }]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const handleLoaded = (info: FileInfo) => { setFileInfo(info); setStep(2); };
  const handleStart  = (idcarCol: string, selectedCols: string[], resolution: string, millesime: string) => {
    setImportCfg({ idcarCol, selectedCols, resolution, millesime });
    setStep(3);
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: fontInter, color: C.text }}>
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <a href="/dashboard" style={{ color: C.textSec, fontFamily: fontMono, fontSize: 10, textDecoration: 'none' }}>←</a>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ fontFamily: fontInter, fontSize: 18, fontWeight: 500, margin: 0 }}>Import Filosofi</h1>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {([1, 2, 3] as const).map(s => (
            <div key={s} style={{
              width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: step >= s ? C.accent : C.border,
              fontFamily: fontMono, fontSize: 10, color: step >= s ? '#fff' : C.textSec, fontWeight: 700,
            }}>{s}</div>
          ))}
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontFamily: fontMono, fontSize: 10, color: C.textSec }}>
          Formats : <span style={{ color: C.accent }}>.dbf</span> (shapefile attributs, idcar → géométrie auto) · <span style={{ color: C.accent }}>.parquet</span>
        </div>

        {step === 1 && <StepUpload onLoaded={handleLoaded} addLog={addLog} />}
        {step === 2 && fileInfo && <StepConfig info={fileInfo} onStart={handleStart} />}
        {step === 3 && fileInfo && importCfg && (
          <StepImport
            info={fileInfo}
            idcarCol={importCfg.idcarCol}
            selectedCols={importCfg.selectedCols}
            resolution={importCfg.resolution}
            millesime={importCfg.millesime}
            addLog={addLog}
          />
        )}

        {logs.length > 0 && (
          <>
            <div style={{ fontFamily: fontInter, fontSize: 11, color: C.textDim }}>TERMINAL //</div>
            <div
              ref={logRef}
              style={{
                background: '#0a0a0a', border: `1px solid ${C.border}`, borderRadius: 2,
                height: 320, overflowY: 'auto', padding: '12px 14px',
                fontFamily: fontMono, fontSize: 10, lineHeight: 1.7,
              }}
            >
              {logs.map(l => (
                <div key={l.id} style={{
                  color: l.kind === 'head'     ? C.accent
                       : l.kind === 'ok'       ? C.green
                       : l.kind === 'error'    ? C.red
                       : l.kind === 'progress' ? C.textSec
                       : C.text,
                  fontWeight: l.kind === 'head' ? 700 : undefined,
                }}>{l.text}</div>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <Btn variant="ghost" onClick={() => { setStep(1); setFileInfo(null); setImportCfg(null); setLogs([]); }}>
            Nouvel import
          </Btn>
        )}

        <RefreshVilleStats />
      </main>
    </div>
  );
}

// ─── Bouton recalcul cache villes ─────────────────────────────────────────────
function RefreshVilleStats() {
  const [status,   setStatus]   = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [msg,      setMsg]      = useState('');
  const [progress, setProgress] = useState(0);
  const [total,    setTotal]    = useState(0);

  async function run() {
    setStatus('running');
    setProgress(0);

    // Étape 1 : vider le cache + récupérer nb chunks
    const initRes  = await fetch('/api/admin/refresh-ville-stats', { method: 'POST' });
    const initJson = await initRes.json() as { total_chunks: number };
    const nChunks  = initJson.total_chunks;
    setTotal(nChunks);
    setMsg(`0 / ${nChunks} chunks traités…`);

    let inserted = 0;
    for (let i = 0; i < nChunks; i++) {
      const res  = await fetch(`/api/admin/refresh-ville-stats?chunk=${i}`, { method: 'POST' });
      const json = await res.json() as { ok: boolean; inserted?: number; error?: string };
      if (!res.ok || !json.ok) {
        setStatus('error');
        setMsg(`! Erreur chunk ${i} : ${json.error}`);
        return;
      }
      inserted += json.inserted ?? 0;
      setProgress(i + 1);
      setMsg(`${i + 1} / ${nChunks} chunks — ${inserted} lignes insérées`);
    }

    setStatus('done');
    setMsg(`✓ Cache complet — ${inserted} lignes`);
  }

  return (
    <div style={{ marginTop: 32, padding: '16px 20px', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 2 }}>
      <div style={{ fontFamily: fontInter, fontSize: 12, fontWeight: 500, color: '#a0a0a0', marginBottom: 10 }}>
        Cache smart prompt — classement villes
      </div>
      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: '#a0a0a0', marginBottom: 12 }}>
        Pré-calcule les totaux Filosofi par ville (contours IRIS). A lancer après chaque import de carreaux.
      </div>
      <button
        onClick={run}
        disabled={status === 'running'}
        style={{
          fontFamily: fontInter, fontSize: 12, fontWeight: 500,
          padding: '8px 16px', borderRadius: 2, border: '1px solid #4ecdc4',
          background: status === 'running' ? 'rgba(78,205,196,0.05)' : 'rgba(78,205,196,0.08)',
          color: status === 'running' ? '#666666' : '#050505',
          cursor: status === 'running' ? 'not-allowed' : 'pointer',
        }}
      >
        {status === 'running' ? 'Calcul en cours...' : 'Recalculer cache villes'}
      </button>
      {status === 'running' && total > 0 && (
        <div style={{ marginTop: 10, height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: '#4ecdc4', width: `${(progress/total)*100}%`, transition: 'width 0.3s' }} />
        </div>
      )}
      {msg && (
        <div style={{
          marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: status === 'error' ? '#f87171' : status === 'done' ? '#3dffa0' : '#a0a0a0',
        }}>
          {msg}
        </div>
      )}
    </div>
  );
}
