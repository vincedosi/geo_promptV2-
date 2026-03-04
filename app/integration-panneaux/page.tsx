'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ColumnInfo, ParseResult } from '@/lib/import/types';

// ============================================================
// Constants
// ============================================================

type GeoMode = 'gps' | 'lambert93';

const GEO_MODES: { val: GeoMode; label: string; desc: string }[] = [
  { val: 'gps', label: '🌍 GPS (Lat/Lng)', desc: 'Colonnes latitude / longitude WGS84 déjà présentes' },
  { val: 'lambert93', label: '📐 Lambert 93 (X/Y)', desc: 'Coordonnées projetées EPSG:2154 → transformées WGS84' },
];

// Panneaux field definitions — displayed in the Smart Mapping UI
const PANNEAU_FIELDS: {
  key: string;
  label: string;
  required: boolean;
  group: 'geo' | 'id' | 'desc' | 'perf';
  hint?: string;
}[] = [
  // Geo
  { key: 'colLat',  label: 'Latitude (Y)',  required: true,  group: 'geo', hint: 'ex. latitude, lat, coord_lat' },
  { key: 'colLng',  label: 'Longitude (X)', required: true,  group: 'geo', hint: 'ex. longitude, lng, coord_lng' },
  { key: 'colX',    label: 'Coord X — Longitude (Est)',  required: true,  group: 'geo', hint: 'Lambert 93 Easting (ex. 700 000)' },
  { key: 'colY',    label: 'Coord Y — Latitude (Nord)', required: true,  group: 'geo', hint: 'Lambert 93 Northing (ex. 6 600 000)' },
  // Identity
  { key: 'reference_panneau', label: 'Référence',  required: false, group: 'id',   hint: 'ID unique du panneau' },
  { key: 'nom_regie',         label: 'Régie',       required: false, group: 'id',   hint: 'Afficheur / exploitant' },
  { key: 'nom_reseau',        label: 'Réseau',      required: false, group: 'id',   hint: 'Circuit / produit' },
  // Description
  { key: 'type_panneau',  label: 'Format',        required: false, group: 'desc', hint: 'Type de panneau (4x3, 2x3…)' },
  { key: 'nb_faces',      label: 'Nb faces',      required: false, group: 'desc', hint: 'Nombre de faces' },
  { key: 'format_digital',label: 'Digital',       required: false, group: 'desc', hint: 'Colonne booléenne (oui/non)' },
  { key: 'eclaire',       label: 'Éclairé',       required: false, group: 'desc', hint: 'Colonne booléenne (oui/non)' },
  // Performance
  { key: 'audience_vac',  label: 'Audience VAC',  required: false, group: 'perf', hint: 'Contacts / GRP' },
  // Admin
  { key: 'ville',        label: 'Ville',          required: false, group: 'id' },
  { key: 'code_postal',  label: 'Code postal',    required: false, group: 'id' },
  { key: 'departement',  label: 'Département',    required: false, group: 'id' },
  { key: 'region',       label: 'Région',         required: false, group: 'id' },
];

const GROUP_LABELS: Record<string, string> = {
  geo:  '📍 Coordonnées',
  id:   '🏷️ Identifiant',
  desc: '📋 Description',
  perf: '📊 Performance',
};

// ============================================================
// State types
// ============================================================

type Step = 'upload' | 'mapping' | 'importing' | 'done';

interface MappingState {
  geoMode: GeoMode;
  // GPS
  colLat: string;
  colLng: string;
  // Lambert93
  colX: string;
  colY: string;
  // Panneaux attributes
  reference_panneau: string;
  nom_regie: string;
  nom_reseau: string;
  type_panneau: string;
  nb_faces: string;
  format_digital: string;
  eclaire: string;
  audience_vac: string;
  ville: string;
  code_postal: string;
  departement: string;
  region: string;
}

interface LogLine {
  level: 'info' | 'warn' | 'error';
  text: string;
}

interface ImportReport {
  inserted: number;
  ignored: number;
  errors: number;
  jobId?: string;
}

// ============================================================
// Helpers
// ============================================================

function emptyMapping(): MappingState {
  return {
    geoMode: 'gps',
    colLat: '', colLng: '',
    colX: '', colY: '',
    reference_panneau: '', nom_regie: '', nom_reseau: '',
    type_panneau: '', nb_faces: '', format_digital: '', eclaire: '',
    audience_vac: '', ville: '', code_postal: '', departement: '', region: '',
  };
}

function applyAutoSuggestions(
  suggested: Record<string, string | null>,
  current: MappingState
): MappingState {
  const s = { ...current };

  // Geo mode: prefer Lambert93 if _shp_x detected or x/y found
  if (suggested._shp_coords === 'true' || suggested.x || suggested.y) {
    s.geoMode = 'lambert93';
  }

  // GPS columns
  if (suggested.lat) s.colLat = suggested.lat;
  if (suggested.lng) s.colLng = suggested.lng;

  // Lambert93 columns
  if (suggested.x) s.colX = suggested.x;
  if (suggested.y) s.colY = suggested.y;

  // Panneaux attributes
  const fields: Array<keyof Omit<MappingState, 'geoMode'>> = [
    'reference_panneau', 'nom_regie', 'nom_reseau', 'type_panneau',
    'nb_faces', 'format_digital', 'eclaire', 'audience_vac',
    'ville', 'code_postal', 'departement', 'region',
  ];
  for (const f of fields) {
    const val = suggested[f];
    if (val) s[f] = val;
  }

  return s;
}

function geoColumnsValid(m: MappingState): boolean {
  if (m.geoMode === 'gps') return !!m.colLat && !!m.colLng;
  return !!m.colX && !!m.colY;
}

/** First non-empty value of a column in the preview rows */
function getColSample(
  preview: Record<string, string | null>[],
  colName: string
): string | null {
  if (!colName) return null;
  for (const row of preview) {
    const v = row[colName];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v);
  }
  return null;
}

/** Real-time coordinate column validation */
function checkGeoColumns(
  mode: GeoMode,
  m: MappingState,
  preview: Record<string, string | null>[]
): { status: 'ok' | 'warn' | 'error' | 'pending'; message: string } {
  const colA = mode === 'gps' ? m.colLat : m.colX;
  const colB = mode === 'gps' ? m.colLng : m.colY;

  if (!colA || !colB) return { status: 'pending', message: 'Sélectionnez les deux colonnes de coordonnées' };

  const sA = getColSample(preview, colA);
  const sB = getColSample(preview, colB);
  if (!sA || !sB) return { status: 'warn', message: 'Aucune valeur trouvée dans l\'aperçu' };

  const vA = parseFloat(sA);
  const vB = parseFloat(sB);
  if (isNaN(vA) || isNaN(vB)) {
    return { status: 'error', message: `Valeurs non numériques : "${sA}", "${sB}"` };
  }

  if (mode === 'lambert93') {
    // Lambert 93 (EPSG:2154) : X Easting 100k–1300k, Y Northing 5800k–7200k
    if (vA >= 5_800_000 && vA <= 7_200_000 && vB >= 100_000 && vB <= 1_300_000) {
      return { status: 'warn', message: `⚠ Colonnes probablement inversées — X=${sB}, Y=${sA} (X=Easting ~700000, Y=Northing ~6600000)` };
    }
    if (vA < 100_000 || vA > 1_300_000) {
      return { status: 'error', message: `Coord X hors plage Lambert 93 : ${vA.toFixed(0)} (attendu 100 000–1 300 000)` };
    }
    if (vB < 5_800_000 || vB > 7_200_000) {
      return { status: 'error', message: `Coord Y hors plage Lambert 93 : ${vB.toFixed(0)} (attendu 5 800 000–7 200 000)` };
    }
    return { status: 'ok', message: `Exemple Lambert 93 valide : X=${vA.toFixed(0)}, Y=${vB.toFixed(0)} ✓` };
  } else {
    // WGS84 — France métropolitaine
    if (vA >= -5.5 && vA <= 10 && vB >= 41 && vB <= 51.5) {
      return { status: 'warn', message: `⚠ Colonnes probablement inversées — lat=${sB}, lng=${sA}` };
    }
    if (vA < 41 || vA > 51.5) {
      return { status: 'error', message: `Latitude hors France : ${vA} (attendu 41–51.5)` };
    }
    if (vB < -5.5 || vB > 10) {
      return { status: 'error', message: `Longitude hors France : ${vB} (attendu -5.5–10)` };
    }
    return { status: 'ok', message: `Exemple GPS valide : lat=${vA.toFixed(5)}, lng=${vB.toFixed(5)} ✓` };
  }
}

// ============================================================
// Main component
// ============================================================

export default function IntegrationPanneauxPage() {
  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [fileFormat, setFileFormat] = useState<string>('');
  const [mapping, setMapping] = useState<MappingState>(emptyMapping());
  const [limit, setLimit] = useState('');
  const [regieNom, setRegieNom] = useState('');
  const [enrichDeptRegion, setEnrichDeptRegion] = useState(true);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [globalError, setGlobalError] = useState('');
  const [isParsing, setIsParsing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const shpRef = useRef<File | null>(null);
  const dbfRef = useRef<File | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── File upload handling ──────────────────────────────────

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    setGlobalError('');
    setIsParsing(true);

    try {
      const formData = new FormData();

      const shp = arr.find((f) => f.name.toLowerCase().endsWith('.shp'));
      const dbf = arr.find((f) => f.name.toLowerCase().endsWith('.dbf'));
      const single = arr.find((f) =>
        /\.(csv|txt|tsv|xlsx|xls|xlsm)$/i.test(f.name)
      );

      if (shp && dbf) {
        formData.append('shp', shp);
        formData.append('dbf', dbf);
        shpRef.current = shp;
        dbfRef.current = dbf;
      } else if (single) {
        formData.append('file', single);
      } else {
        throw new Error(
          'Format non reconnu. Déposez un fichier CSV, Excel (.xlsx) ou un Shapefile (.shp + .dbf).'
        );
      }

      const res = await adminFetch('/api/integration-panneaux/parse', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur parsing');

      setParseResult(data as ParseResult);
      setFileFormat(data.format);
      setMapping((prev) => applyAutoSuggestions(data.suggestedMapping ?? {}, prev));
      setStep('mapping');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGlobalError(msg);
    } finally {
      setIsParsing(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles]
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) uploadFiles(e.target.files);
    },
    [uploadFiles]
  );

  // ── Import execution ──────────────────────────────────────

  const startImport = useCallback(async () => {
    if (!parseResult) return;
    setStep('importing');
    setLogs([]);
    setProgress(null);
    setReport(null);

    const body = {
      fileId: parseResult.fileId,
      regie: regieNom || 'Inconnu',
      enrichDeptRegion,
      mapping: {
        reference_panneau:  mapping.reference_panneau  || undefined,
        type_panneau:       mapping.type_panneau       || undefined,
        ville:              mapping.ville              || undefined,
        code_postal:        mapping.code_postal        || undefined,
        departement:        mapping.departement        || undefined,
        region:             mapping.region             || undefined,
      },
      geolocation: {
        mode: mapping.geoMode,
        colLat: mapping.colLat   || undefined,
        colLng: mapping.colLng   || undefined,
        colX:   mapping.colX    || undefined,
        colY:   mapping.colY    || undefined,
      },
      limit: limit ? parseInt(limit, 10) : undefined,
      fileName: parseResult.fileName,
      fileFormat: fileFormat || parseResult.format,
    };

    try {
      setLogs([{ level: 'info', text: 'Connexion au serveur…' }]);

      // adminFetch injecte automatiquement le Bearer token Supabase
      const res = await adminFetch('/api/integration-panneaux/execute', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      // Catch HTTP errors (auth, 500…) before attempting to read SSE
      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(
          res.status === 401
            ? 'Non autorisé — connectez-vous avec un compte admin.'
            : `Erreur serveur ${res.status} : ${errText.slice(0, 200)}`
        );
      }

      if (!res.body) throw new Error('Pas de stream SSE — réponse vide');

      setLogs([{ level: 'info', text: 'Connexion établie, démarrage…' }]);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let lastEventAt = Date.now();

      // Watchdog: if no event received in 90s, show a warning
      const watchdog = setInterval(() => {
        if (Date.now() - lastEventAt > 90_000) {
          setLogs((prev) => [
            ...prev,
            { level: 'warn', text: '⚠ Aucune réponse depuis 90s — le serveur traite toujours (BAN / Supabase)…' },
          ]);
          lastEventAt = Date.now(); // reset to avoid spam
        }
      }, 10_000);

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          lastEventAt = Date.now();

          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;
            try {
              const event = JSON.parse(line.slice(5).trim());
              lastEventAt = Date.now();

              if (event.type === 'log') {
                setLogs((prev) => [...prev, { level: event.logLevel ?? 'info', text: event.logLine ?? '' }]);
              } else if (event.type === 'progress') {
                setProgress({ done: event.processed ?? 0, total: event.total ?? 0 });
              } else if (event.type === 'geocode') {
                setProgress({ done: event.processed ?? 0, total: event.total ?? 0 });
                setLogs((prev) => [
                  ...prev.filter((l) => !l.text.startsWith('↻')),
                  { level: 'info', text: `↻ Reverse geocoding : ${event.processed}/${event.total} points…` },
                ]);
              } else if (event.type === 'complete') {
                setReport(event.report as ImportReport);
                setStep('done');
              } else if (event.type === 'error') {
                setLogs((prev) => [...prev, { level: 'error', text: event.message ?? 'Erreur inconnue' }]);
                setGlobalError(event.message ?? 'Erreur inconnue');
              }
            } catch { /* ignore malformed JSON */ }
          }
        }
      } finally {
        clearInterval(watchdog);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
      console.error('[startImport] catch:', err);
      setGlobalError(msg);
      setLogs((prev) => [...prev, { level: 'error', text: msg }]);
    }
  }, [parseResult, fileFormat, mapping, limit, regieNom, enrichDeptRegion]);

  // ── Derived state ─────────────────────────────────────────

  const columns: ColumnInfo[] = parseResult?.columns ?? [];
  const colOptions = ['', ...columns.map((c) => c.name)];
  const geoValid = geoColumnsValid(mapping);

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ background: '#1a1d26', borderBottom: '1px solid #2d3748', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 22 }}>📋</span>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Intégration Panneaux</h1>
          <p style={{ margin: 0, fontSize: 12, color: '#718096' }}>Import CSV · Excel · Shapefile → Supabase</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {(['upload', 'mapping', 'importing', 'done'] as Step[]).map((s, i) => (
            <div key={s} style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
              color: step === s ? '#63b3ed' : '#4a5568',
              fontWeight: step === s ? 600 : 400,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: step === s ? '#2b6cb0' : i < ['upload','mapping','importing','done'].indexOf(step) ? '#276749' : '#2d3748',
                fontSize: 10, fontWeight: 700,
              }}>{i + 1}</span>
              {['Fichier', 'Mapping', 'Import', 'Terminé'][i]}
              {i < 3 && <span style={{ color: '#2d3748' }}>›</span>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>

        {/* ── STEP 1: Upload ─────────────────────────────── */}
        {step === 'upload' && (
          <div>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? '#63b3ed' : '#2d3748'}`,
                borderRadius: 12,
                padding: '64px 32px',
                textAlign: 'center',
                cursor: 'pointer',
                background: isDragging ? 'rgba(99,179,237,0.05)' : '#1a1d26',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 16 }}>
                {isParsing ? '⏳' : '📂'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                {isParsing ? 'Analyse du fichier…' : 'Déposez votre fichier ici'}
              </div>
              <div style={{ fontSize: 13, color: '#718096', lineHeight: 1.6 }}>
                CSV · Excel (.xlsx) · Shapefile (.shp + .dbf + .prj)
                <br />
                <span style={{ fontSize: 12, color: '#4a5568' }}>
                  Pour un Shapefile, sélectionnez les 3 fichiers simultanément
                </span>
              </div>
              {!isParsing && (
                <div style={{
                  marginTop: 20, display: 'inline-block',
                  background: '#2b6cb0', color: '#fff', padding: '8px 20px',
                  borderRadius: 6, fontSize: 13, fontWeight: 600,
                }}>
                  Choisir un fichier
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm,.shp,.dbf,.prj"
              multiple
              style={{ display: 'none' }}
              onChange={onFileInput}
            />
            {globalError && (
              <div style={{ marginTop: 16, background: 'rgba(252,129,74,0.1)', border: '1px solid #c05621', borderRadius: 8, padding: 12, color: '#fc814a', fontSize: 13 }}>
                ⚠ {globalError}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Smart Mapping ──────────────────────── */}
        {step === 'mapping' && parseResult && (
          <div>
            {/* File info badge */}
            <div style={{ background: '#1a1d26', border: '1px solid #2d3748', borderRadius: 8, padding: '10px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <div>
                <span style={{ fontWeight: 600 }}>{parseResult.fileName}</span>
                <span style={{ color: '#718096', marginLeft: 12 }}>
                  {parseResult.totalRows.toLocaleString('fr-FR')} lignes · {parseResult.columns.length} colonnes
                </span>
                <span style={{ marginLeft: 12, background: '#2d3748', padding: '2px 8px', borderRadius: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {fileFormat}
                </span>
              </div>
              <button
                onClick={() => { setStep('upload'); setParseResult(null); setMapping(emptyMapping()); setGlobalError(''); }}
                style={{ marginLeft: 'auto', background: 'none', border: '1px solid #4a5568', borderRadius: 6, color: '#a0aec0', padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}
              >
                ↩ Changer
              </button>
            </div>

            {/* Geo mode selector */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                Mode de coordonnées
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {GEO_MODES.map((m) => (
                  <button
                    key={m.val}
                    onClick={() => setMapping((prev) => ({ ...prev, geoMode: m.val }))}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                      border: `2px solid ${mapping.geoMode === m.val ? '#3182ce' : '#2d3748'}`,
                      background: mapping.geoMode === m.val ? 'rgba(49,130,206,0.1)' : '#1a1d26',
                      color: mapping.geoMode === m.val ? '#63b3ed' : '#a0aec0',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{m.label}</div>
                    <div style={{ fontSize: 11, marginTop: 2, opacity: 0.7 }}>{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Smart Mapping fields */}
            {(['geo', 'id', 'desc', 'perf'] as const).map((group) => {
              const fields = PANNEAU_FIELDS.filter((f) => {
                if (f.group !== group) return false;
                // Show only relevant geo fields for the selected mode
                if (group === 'geo') {
                  if (mapping.geoMode === 'gps') return f.key === 'colLat' || f.key === 'colLng';
                  return f.key === 'colX' || f.key === 'colY';
                }
                return true;
              });
              if (fields.length === 0) return null;

              return (
                <div key={group} style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#718096', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {GROUP_LABELS[group]}
                  </div>
                  {group === 'geo' && parseResult && (() => {
                    const chk = checkGeoColumns(mapping.geoMode, mapping, parseResult.preview);
                    const palette = {
                      ok:      { color: '#68d391', bg: 'rgba(56,161,105,0.08)',  border: '#276749' },
                      warn:    { color: '#f6e05e', bg: 'rgba(214,158,46,0.08)',  border: '#975a16' },
                      error:   { color: '#fc8181', bg: 'rgba(229,62,62,0.08)',   border: '#9b2c2c' },
                      pending: { color: '#718096', bg: 'transparent',            border: '#2d3748' },
                    }[chk.status];
                    const icon = { ok: '✓', warn: '⚠', error: '✗', pending: 'ℹ' }[chk.status];
                    return (
                      <div style={{ marginBottom: 10, padding: '7px 12px', borderRadius: 6, background: palette.bg, border: `1px solid ${palette.border}`, fontSize: 12, color: palette.color }}>
                        {icon} {chk.message}
                      </div>
                    );
                  })()}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    {fields.map((field) => {
                      const val = (mapping as unknown as Record<string, string>)[field.key] ?? '';
                      const isMissing = field.required && !val;
                      return (
                        <div key={field.key}>
                          <label style={{ fontSize: 12, color: isMissing ? '#fc8181' : '#a0aec0', display: 'block', marginBottom: 4 }}>
                            {field.label}
                            {field.required && <span style={{ color: '#fc8181', marginLeft: 4 }}>*</span>}
                            {field.hint && <span style={{ color: '#4a5568', fontSize: 10, marginLeft: 6 }}>({field.hint})</span>}
                          </label>
                          <select
                            value={val}
                            onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              background: '#0f1117',
                              border: `1px solid ${isMissing ? '#c53030' : '#2d3748'}`,
                              borderRadius: 6,
                              color: val ? '#e2e8f0' : '#4a5568',
                              fontSize: 13,
                              outline: 'none',
                              boxShadow: isMissing ? '0 0 0 2px rgba(252,129,74,0.2)' : 'none',
                            }}
                          >
                            <option value="">— Non mappé —</option>
                            {colOptions.slice(1).map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          {val && parseResult && (() => {
                            const s = getColSample(parseResult.preview, val);
                            return s ? (
                              <div style={{ fontSize: 10, color: '#4a9eca', marginTop: 2, paddingLeft: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                ↳ {s}
                              </div>
                            ) : null;
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Enrichment option */}
            <div style={{ marginBottom: 20, background: 'rgba(66,153,225,0.06)', border: '1px solid #2b6cb0', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                id="enrich-toggle"
                type="checkbox"
                checked={enrichDeptRegion}
                onChange={(e) => setEnrichDeptRegion(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#3182ce' }}
              />
              <label htmlFor="enrich-toggle" style={{ cursor: 'pointer', fontSize: 13, color: '#90cdf4' }}>
                <strong>Enrichir automatiquement département &amp; région</strong>
                <span style={{ color: '#4a9eca', marginLeft: 6, fontSize: 12 }}>
                  (via API BAN reverse — lat/lng → "67, Bas-Rhin, Grand Est")
                </span>
              </label>
            </div>

            {/* Options */}
            <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>
                  Nom de la régie <span style={{ color: '#4a5568' }}>(utilisé comme valeur par défaut si non mappé)</span>
                </label>
                <input
                  type="text"
                  placeholder="ex: Clear Channel, JCDecaux…"
                  value={regieNom}
                  onChange={(e) => setRegieNom(e.target.value)}
                  style={{ padding: '8px 10px', background: '#0f1117', border: '1px solid #2d3748', borderRadius: 6, color: '#e2e8f0', fontSize: 13, width: 220 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#a0aec0', display: 'block', marginBottom: 4 }}>
                  Limiter à N lignes <span style={{ color: '#4a5568' }}>(vide = tout importer)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder="ex: 1000"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  style={{ padding: '8px 10px', background: '#0f1117', border: '1px solid #2d3748', borderRadius: 6, color: '#e2e8f0', fontSize: 13, width: 130 }}
                />
              </div>
            </div>

            {/* Column preview */}
            <details style={{ marginBottom: 24 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: '#718096', userSelect: 'none' }}>
                Aperçu colonnes ({columns.length})
              </summary>
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {columns.map((c) => (
                  <span key={c.name} style={{
                    background: '#1a1d26', border: '1px solid #2d3748',
                    borderRadius: 4, padding: '3px 8px', fontSize: 11, color: '#a0aec0',
                  }} title={`Exemples: ${c.sampleValues.join(', ')}`}>
                    {c.name}
                    {c.sampleValues[0] && <span style={{ color: '#4a5568', marginLeft: 4 }}>({c.sampleValues[0]})</span>}
                  </span>
                ))}
              </div>
            </details>

            {/* CTA */}
            {!geoValid && (
              <div style={{ background: 'rgba(252,129,74,0.08)', border: '1px solid #c05621', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#fc8181' }}>
                ⚠ Mappez les colonnes de coordonnées obligatoires avant de continuer.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                disabled={!geoValid}
                onClick={startImport}
                style={{
                  flex: 1, padding: '12px 20px', borderRadius: 8, cursor: geoValid ? 'pointer' : 'not-allowed',
                  background: geoValid ? '#2b6cb0' : '#2d3748', color: geoValid ? '#fff' : '#4a5568',
                  border: 'none', fontSize: 15, fontWeight: 700, transition: 'background 0.2s',
                }}
              >
                🚀 Importer les panneaux
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Importing ──────────────────────────── */}
        {(step === 'importing' || (step === 'done' && logs.length > 0)) && (
          <div>
            <div style={{ background: '#1a1d26', border: '1px solid #2d3748', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #2d3748', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{step === 'importing' ? '⚙️' : '✅'}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {step === 'importing' ? 'Import en cours…' : 'Import terminé'}
                </span>
                {progress && progress.total > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: step === 'done' ? '#68d391' : '#63b3ed', fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round((progress.done / progress.total) * 100)} %
                    <span style={{ fontWeight: 400, color: '#718096', fontSize: 11, marginLeft: 6 }}>
                      ({progress.done.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')})
                    </span>
                  </span>
                )}
              </div>

              {/* Progress bar */}
              {progress && progress.total > 0 && (
                <div style={{ height: 6, background: '#2d3748', position: 'relative' }}>
                  <div style={{
                    height: '100%',
                    background: step === 'done' ? '#38a169' : '#3182ce',
                    width: `${Math.round((progress.done / progress.total) * 100)}%`,
                    transition: 'width 0.4s ease-out',
                  }} />
                </div>
              )}

              {/* Log terminal */}
              <div style={{
                fontFamily: 'monospace', fontSize: 12, padding: 12,
                maxHeight: 360, overflowY: 'auto',
                background: '#0d0f16',
              }}>
                {logs.map((l, i) => (
                  <div key={i} style={{
                    color: l.level === 'error' ? '#fc8181' : l.level === 'warn' ? '#f6e05e' : '#68d391',
                    paddingBottom: 2, lineHeight: 1.5,
                  }}>
                    <span style={{ opacity: 0.5 }}>{l.level === 'error' ? '✖' : l.level === 'warn' ? '⚠' : '✔'} </span>
                    {l.text}
                  </div>
                ))}
                {step === 'importing' && (
                  <div style={{ color: '#4a5568', animation: 'pulse 1.5s infinite' }}>▋</div>
                )}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* Done report */}
            {step === 'done' && report && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {[
                    { label: 'Insérés', value: report.inserted, color: '#38a169' },
                    { label: 'Doublons ignorés', value: report.ignored, color: '#d69e2e' },
                    { label: 'Erreurs', value: report.errors, color: report.errors > 0 ? '#e53e3e' : '#4a5568' },
                  ].map((s) => (
                    <div key={s.label} style={{
                      background: '#1a1d26', border: '1px solid #2d3748', borderRadius: 8,
                      padding: '16px 20px', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value.toLocaleString('fr-FR')}</div>
                      <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => { setStep('upload'); setParseResult(null); setMapping(emptyMapping()); setLogs([]); setReport(null); setProgress(null); setGlobalError(''); }}
                    style={{ flex: 1, padding: '12px 20px', borderRadius: 8, cursor: 'pointer', background: '#2d3748', color: '#e2e8f0', border: 'none', fontSize: 14, fontWeight: 600 }}
                  >
                    ↩ Nouvel import
                  </button>
                  <a
                    href="/admin"
                    style={{ flex: 1, padding: '12px 20px', borderRadius: 8, cursor: 'pointer', background: '#2b6cb0', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    → Tableau de bord admin
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Global error outside of import step */}
        {globalError && step !== 'importing' && (
          <div style={{ marginTop: 16, background: 'rgba(252,129,74,0.1)', border: '1px solid #c05621', borderRadius: 8, padding: 12, color: '#fc814a', fontSize: 13 }}>
            ⚠ {globalError}
          </div>
        )}
      </div>
    </div>
  );
}
