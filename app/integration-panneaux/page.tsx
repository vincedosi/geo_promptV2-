'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ColumnInfo, ParseResult } from '@/lib/import/types';

// ============================================================
// Design tokens
// ============================================================

const C = {
  bg: '#050505', bgElevated: '#111111', bgSurface: '#111111',
  border: '#1a1a1a', borderLight: 'rgba(78,205,196,0.2)',
  accent: '#4ecdc4', accentDim: 'rgba(78,205,196,0.1)',
  text: '#f0f0f0', textDim: '#a0a0a0', textSec: '#666666', muted: '#666666',
  green: '#3dffa0', greenDim: 'rgba(61,255,160,0.10)',
  red: '#ff5757', redDim: 'rgba(255,87,87,0.1)',
  warn: '#f7b731', warnDim: 'rgba(247,183,49,0.1)', blue: '#5b9bd5',
};
const fontOrbitron = "'Inter',system-ui,sans-serif";
const fontMichroma = "'Inter',system-ui,sans-serif";
const fontMono = "'JetBrains Mono',monospace";
const fontInter = "'Inter',system-ui,sans-serif";

// ============================================================
// Constants
// ============================================================

type GeoMode = 'gps' | 'lambert93';

const GEO_MODES: { val: GeoMode; label: string; desc: string }[] = [
  { val: 'gps',       label: 'GPS (Lat/Lng)',      desc: 'Colonnes latitude / longitude WGS84 déjà présentes' },
  { val: 'lambert93', label: 'Lambert 93 (X/Y)',   desc: 'Coordonnées projetées EPSG:2154 → transformées WGS84' },
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
  { key: 'type_panneau',   label: 'Format',   required: false, group: 'desc', hint: 'Type de panneau (4x3, 2x3…)' },
  { key: 'nb_faces',       label: 'Nb faces', required: false, group: 'desc', hint: 'Nombre de faces' },
  { key: 'format_digital', label: 'Digital',  required: false, group: 'desc', hint: 'Colonne booléenne (oui/non)' },
  { key: 'eclaire',        label: 'Éclairé',  required: false, group: 'desc', hint: 'Colonne booléenne (oui/non)' },
  // Performance
  { key: 'audience_vac', label: 'Audience VAC', required: false, group: 'perf', hint: 'Contacts / GRP' },
  // Admin
  { key: 'ville',       label: 'Ville',       required: false, group: 'id' },
  { key: 'code_postal', label: 'Code postal', required: false, group: 'id' },
  { key: 'departement', label: 'Département', required: false, group: 'id' },
  { key: 'region',      label: 'Région',      required: false, group: 'id' },
];

const GROUP_LABELS: Record<string, string> = {
  geo:  'Coordonnées',
  id:   'Identifiant',
  desc: 'Description',
  perf: 'Performance',
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
  if (!sA || !sB) return { status: 'warn', message: "Aucune valeur trouvée dans l'aperçu" };

  const vA = parseFloat(sA);
  const vB = parseFloat(sB);
  if (isNaN(vA) || isNaN(vB)) {
    return { status: 'error', message: `Valeurs non numériques : "${sA}", "${sB}"` };
  }

  if (mode === 'lambert93') {
    // Lambert 93 (EPSG:2154) : X Easting 100k–1300k, Y Northing 5800k–7200k
    if (vA >= 5_800_000 && vA <= 7_200_000 && vB >= 100_000 && vB <= 1_300_000) {
      return { status: 'warn', message: `! Colonnes probablement inversées — X=${sB}, Y=${sA} (X=Easting ~700000, Y=Northing ~6600000)` };
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
      return { status: 'warn', message: `! Colonnes probablement inversées — lat=${sB}, lng=${sA}` };
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

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload',    label: 'Fichier' },
  { key: 'mapping',   label: 'Mapping' },
  { key: 'importing', label: 'Import' },
  { key: 'done',      label: 'Terminé' },
];

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
            { level: 'warn', text: '! Aucune réponse depuis 90s — le serveur traite toujours (BAN / Supabase)…' },
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

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: fontInter }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>

      {/* ── Header ───────────────────────────────────────────── */}
      <div style={{
        background: C.bgElevated,
        borderBottom: `1px solid ${C.border}`,
        padding: '14px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <div>
          <div style={{ fontFamily: fontMichroma, fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>
            GEO.PROMPT — Data Pipeline
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontFamily: fontOrbitron, fontWeight: 700, color: C.text }}>
            INTÉGRATION PANNEAUX
          </h1>
          <div style={{ fontSize: 11, color: C.textSec, marginTop: 2, fontFamily: fontMono }}>
            Import CSV · Excel · Shapefile → Supabase
          </div>
        </div>

        {/* Step indicators */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {STEPS.map((s, i) => {
            const isActive = step === s.key;
            const isDone = i < stepIndex;
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  opacity: isActive || isDone ? 1 : 0.35,
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isDone ? C.greenDim : isActive ? C.accentDim : 'transparent',
                    border: `1px solid ${isDone ? C.green : isActive ? C.accent : C.border}`,
                    fontSize: 10, fontFamily: fontMichroma,
                    color: isDone ? C.green : isActive ? C.accent : C.muted,
                    fontWeight: 700,
                  }}>
                    {isDone ? '✓' : i + 1}
                  </div>
                  <span style={{
                    fontFamily: fontMichroma, fontSize: 9, textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                    color: isDone ? C.green : isActive ? C.accent : C.muted,
                  }}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <span style={{ color: C.border, fontSize: 12, marginLeft: 2 }}>›</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────── */}
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 24px' }}>

        {/* ── STEP 1: Upload ──────────────────────────────────── */}
        {step === 'upload' && (
          <div>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? C.accent : C.border}`,
                borderRadius: 2,
                padding: '64px 32px',
                textAlign: 'center',
                cursor: 'pointer',
                background: isDragging ? C.accentDim : C.bgElevated,
                transition: 'all 0.2s',
              }}
            >
              {isParsing ? (
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  border: `2px solid ${C.border}`,
                  borderTopColor: C.accent,
                  animation: 'spin 0.8s linear infinite',
                  margin: '0 auto 20px',
                }} />
              ) : (
                <div style={{
                  width: 48, height: 48, borderRadius: 2,
                  border: `1px solid ${C.borderLight}`,
                  background: C.accentDim,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 20px',
                  fontFamily: fontMichroma, fontSize: 18, color: C.accent,
                }}>
                  +
                </div>
              )}
              <div style={{ fontSize: 15, fontFamily: fontMichroma, fontWeight: 600, marginBottom: 8, color: isDragging ? C.accent : C.text, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {isParsing ? 'Analyse du fichier…' : 'Déposez votre fichier ici'}
              </div>
              <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.7, fontFamily: fontMono }}>
                CSV · Excel (.xlsx) · Shapefile (.shp + .dbf + .prj)
                <br />
                <span style={{ fontSize: 11, color: C.muted }}>
                  Pour un Shapefile, sélectionnez les 3 fichiers simultanément
                </span>
              </div>
              {!isParsing && (
                <div style={{
                  marginTop: 24, display: 'inline-block',
                  background: C.accentDim,
                  border: `1px solid ${C.accent}`,
                  color: C.accent, padding: '8px 24px',
                  borderRadius: 2, fontSize: 11,
                  fontFamily: fontMichroma, textTransform: 'uppercase',
                  letterSpacing: '0.14em',
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
              <div style={{
                marginTop: 16,
                background: C.redDim,
                border: `1px solid ${C.red}`,
                borderRadius: 2, padding: '10px 14px',
                color: C.red, fontSize: 12, fontFamily: fontMono,
              }}>
                ! {globalError}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Smart Mapping ───────────────────────────── */}
        {step === 'mapping' && parseResult && (
          <div>
            {/* File info badge */}
            <div style={{
              background: C.bgElevated, border: `1px solid ${C.border}`,
              borderRadius: 2, padding: '10px 16px', marginBottom: 24,
              display: 'flex', alignItems: 'center', gap: 12, fontSize: 13,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 2,
                background: C.accentDim, border: `1px solid ${C.borderLight}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: fontMichroma, fontSize: 9, color: C.accent,
                textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>
                {fileFormat || 'FILE'}
              </div>
              <div>
                <span style={{ fontWeight: 600, color: C.text }}>{parseResult.fileName}</span>
                <span style={{ color: C.textSec, marginLeft: 12, fontFamily: fontMono, fontSize: 11 }}>
                  {parseResult.totalRows.toLocaleString('fr-FR')} lignes · {parseResult.columns.length} colonnes
                </span>
                <span style={{
                  marginLeft: 10, background: C.bgSurface,
                  border: `1px solid ${C.border}`,
                  padding: '2px 8px', borderRadius: 2,
                  fontSize: 9, fontFamily: fontMichroma, textTransform: 'uppercase',
                  letterSpacing: '0.12em', color: C.textDim,
                }}>
                  {fileFormat}
                </span>
              </div>
              <button
                onClick={() => { setStep('upload'); setParseResult(null); setMapping(emptyMapping()); setGlobalError(''); }}
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: `1px solid ${C.border}`,
                  borderRadius: 2, color: C.textDim,
                  padding: '4px 12px', cursor: 'pointer',
                  fontSize: 11, fontFamily: fontMichroma,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                }}
              >
                ↩ Changer
              </button>
            </div>

            {/* Geo mode selector */}
            <div style={{ marginBottom: 28 }}>
              <div style={{
                fontFamily: fontMichroma, fontSize: 9, color: C.accent,
                textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 10,
              }}>
                Mode de coordonnées
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {GEO_MODES.map((m) => {
                  const active = mapping.geoMode === m.val;
                  return (
                    <button
                      key={m.val}
                      onClick={() => setMapping((prev) => ({ ...prev, geoMode: m.val }))}
                      style={{
                        flex: 1, padding: '10px 14px', borderRadius: 2, cursor: 'pointer', textAlign: 'left',
                        border: `1px solid ${active ? C.accent : C.border}`,
                        background: active ? C.accentDim : C.bgElevated,
                        color: active ? C.accent : C.textDim,
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontFamily: fontMichroma, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                        {m.label}
                      </div>
                      <div style={{ fontSize: 11, color: active ? C.textDim : C.muted, fontFamily: fontInter }}>
                        {m.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Smart Mapping fields */}
            {(['geo', 'id', 'desc', 'perf'] as const).map((group) => {
              const fields = PANNEAU_FIELDS.filter((f) => {
                if (f.group !== group) return false;
                if (group === 'geo') {
                  if (mapping.geoMode === 'gps') return f.key === 'colLat' || f.key === 'colLng';
                  return f.key === 'colX' || f.key === 'colY';
                }
                return true;
              });
              if (fields.length === 0) return null;

              return (
                <div key={group} style={{ marginBottom: 24 }}>
                  <div style={{
                    fontFamily: fontMichroma, fontSize: 9, color: C.accent,
                    textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 10,
                  }}>
                    {GROUP_LABELS[group]}
                  </div>

                  {group === 'geo' && parseResult && (() => {
                    const chk = checkGeoColumns(mapping.geoMode, mapping, parseResult.preview);
                    const palette = {
                      ok:      { color: C.green,    bg: C.greenDim,              border: C.green },
                      warn:    { color: C.warn,     bg: C.warnDim,               border: C.warn },
                      error:   { color: C.red,      bg: C.redDim,                border: C.red },
                      pending: { color: C.textSec,  bg: 'transparent',           border: C.border },
                    }[chk.status];
                    const icon = { ok: '✓', warn: '!', error: '✕', pending: 'i' }[chk.status];
                    return (
                      <div style={{
                        marginBottom: 10, padding: '7px 12px', borderRadius: 2,
                        background: palette.bg, border: `1px solid ${palette.border}`,
                        fontSize: 11, color: palette.color, fontFamily: fontMono,
                        display: 'flex', gap: 8, alignItems: 'flex-start',
                      }}>
                        <span style={{ fontWeight: 700 }}>{icon}</span>
                        <span>{chk.message}</span>
                      </div>
                    );
                  })()}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    {fields.map((field) => {
                      const val = (mapping as unknown as Record<string, string>)[field.key] ?? '';
                      const isMissing = field.required && !val;
                      return (
                        <div key={field.key}>
                          <label style={{
                            fontSize: 11, fontFamily: fontMichroma,
                            color: isMissing ? C.red : C.textDim,
                            display: 'block', marginBottom: 4,
                            textTransform: 'uppercase', letterSpacing: '0.1em',
                          }}>
                            {field.label}
                            {field.required && <span style={{ color: C.red, marginLeft: 4 }}>*</span>}
                            {field.hint && (
                              <span style={{ color: C.muted, fontSize: 9, marginLeft: 6, textTransform: 'none', letterSpacing: 0, fontFamily: fontMono }}>
                                ({field.hint})
                              </span>
                            )}
                          </label>
                          <select
                            value={val}
                            onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              background: C.bg,
                              border: `1px solid ${isMissing ? C.red : C.border}`,
                              borderRadius: 2,
                              color: val ? C.text : C.muted,
                              fontSize: 12,
                              outline: 'none',
                              fontFamily: fontMono,
                              boxShadow: isMissing ? `0 0 0 1px ${C.red}` : 'none',
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
                              <div style={{
                                fontSize: 10, color: C.blue, marginTop: 3, paddingLeft: 4,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                fontFamily: fontMono,
                              }}>
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
            <div style={{
              marginBottom: 20,
              background: 'rgba(59,130,246,0.07)',
              border: `1px solid rgba(59,130,246,0.3)`,
              borderRadius: 2, padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <input
                id="enrich-toggle"
                type="checkbox"
                checked={enrichDeptRegion}
                onChange={(e) => setEnrichDeptRegion(e.target.checked)}
                style={{ width: 15, height: 15, cursor: 'pointer', accentColor: C.blue }}
              />
              <label htmlFor="enrich-toggle" style={{ cursor: 'pointer', fontSize: 12, color: C.textDim, fontFamily: fontInter }}>
                <strong style={{ color: C.text }}>Enrichir automatiquement département &amp; région</strong>
                <span style={{ color: C.blue, marginLeft: 8, fontSize: 11, fontFamily: fontMono }}>
                  (via API BAN reverse — lat/lng → "67, Bas-Rhin, Grand Est")
                </span>
              </label>
            </div>

            {/* Options row */}
            <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', gap: 16 }}>
              <div>
                <label style={{
                  fontSize: 9, fontFamily: fontMichroma, color: C.textDim,
                  display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.14em',
                }}>
                  Nom de la régie
                  <span style={{ color: C.muted, fontSize: 9, marginLeft: 6, textTransform: 'none' }}>
                    (valeur par défaut si non mappé)
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="ex: Clear Channel, JCDecaux…"
                  value={regieNom}
                  onChange={(e) => setRegieNom(e.target.value)}
                  style={{
                    padding: '7px 10px',
                    background: C.bg,
                    border: `1px solid ${C.border}`,
                    borderRadius: 2,
                    color: C.text, fontSize: 12, width: 220,
                    fontFamily: fontMono, outline: 'none',
                  }}
                />
              </div>
              <div>
                <label style={{
                  fontSize: 9, fontFamily: fontMichroma, color: C.textDim,
                  display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.14em',
                }}>
                  Limiter à N lignes
                  <span style={{ color: C.muted, fontSize: 9, marginLeft: 6, textTransform: 'none' }}>(vide = tout)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder="ex: 1000"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  style={{
                    padding: '7px 10px',
                    background: C.bg,
                    border: `1px solid ${C.border}`,
                    borderRadius: 2,
                    color: C.text, fontSize: 12, width: 130,
                    fontFamily: fontMono, outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Column preview */}
            <details style={{ marginBottom: 24 }}>
              <summary style={{
                cursor: 'pointer', fontSize: 11, color: C.textSec,
                userSelect: 'none', fontFamily: fontMichroma,
                textTransform: 'uppercase', letterSpacing: '0.12em',
              }}>
                Aperçu colonnes ({columns.length})
              </summary>
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {columns.map((c) => (
                  <span key={c.name} style={{
                    background: C.bgSurface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 2, padding: '3px 8px',
                    fontSize: 10, color: C.textDim, fontFamily: fontMono,
                  }} title={`Exemples: ${c.sampleValues.join(', ')}`}>
                    {c.name}
                    {c.sampleValues[0] && (
                      <span style={{ color: C.muted, marginLeft: 4 }}>({c.sampleValues[0]})</span>
                    )}
                  </span>
                ))}
              </div>
            </details>

            {/* CTA */}
            {!geoValid && (
              <div style={{
                background: C.warnDim,
                border: `1px solid ${C.warn}`,
                borderRadius: 2, padding: '10px 14px',
                marginBottom: 14, fontSize: 12,
                color: C.warn, fontFamily: fontMono,
              }}>
                ! Mappez les colonnes de coordonnées obligatoires avant de continuer.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                disabled={!geoValid}
                onClick={startImport}
                style={{
                  flex: 1, padding: '12px 20px', borderRadius: 2,
                  cursor: geoValid ? 'pointer' : 'not-allowed',
                  background: geoValid ? C.accentDim : 'transparent',
                  color: geoValid ? C.accent : C.muted,
                  border: `1px solid ${geoValid ? C.accent : C.border}`,
                  fontSize: 11, fontFamily: fontMichroma,
                  fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  transition: 'all 0.2s',
                }}
              >
                Importer les panneaux
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3 & 4: Importing / Done ───────────────────── */}
        {(step === 'importing' || (step === 'done' && logs.length > 0)) && (
          <div>
            <div style={{
              background: C.bgElevated,
              border: `1px solid ${C.border}`,
              borderRadius: 2, overflow: 'hidden',
            }}>
              {/* Terminal header */}
              <div style={{
                padding: '10px 16px',
                borderBottom: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', gap: 10,
                background: C.bgSurface,
              }}>
                {step === 'importing' && (
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%',
                    border: `2px solid ${C.border}`,
                    borderTopColor: C.accent,
                    animation: 'spin 0.8s linear infinite',
                    flexShrink: 0,
                  }} />
                )}
                {step === 'done' && (
                  <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>✓</span>
                )}
                <span style={{
                  fontFamily: fontMichroma, fontSize: 10, textTransform: 'uppercase',
                  letterSpacing: '0.14em',
                  color: step === 'importing' ? C.accent : C.green,
                }}>
                  {step === 'importing' ? 'Import en cours…' : 'Import terminé'}
                </span>
                {progress && progress.total > 0 && (
                  <span style={{
                    marginLeft: 'auto', fontSize: 13, fontWeight: 700,
                    color: step === 'done' ? C.green : C.accent,
                    fontFamily: fontMono,
                  }}>
                    {Math.round((progress.done / progress.total) * 100)}%
                    <span style={{ fontWeight: 400, color: C.textSec, fontSize: 11, marginLeft: 6 }}>
                      ({progress.done.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')})
                    </span>
                  </span>
                )}
              </div>

              {/* Progress bar */}
              {progress && progress.total > 0 && (
                <div style={{ height: 3, background: C.bgSurface }}>
                  <div style={{
                    height: '100%',
                    background: step === 'done' ? C.green : C.accent,
                    width: `${Math.round((progress.done / progress.total) * 100)}%`,
                    transition: 'width 0.4s ease-out',
                    boxShadow: step === 'done' ? `0 0 6px ${C.green}` : `0 0 6px ${C.accent}`,
                  }} />
                </div>
              )}

              {/* Log terminal */}
              <div style={{
                fontFamily: fontMono, fontSize: 11, padding: '12px 14px',
                maxHeight: 360, overflowY: 'auto',
                background: C.bg,
              }}>
                {logs.map((l, i) => (
                  <div key={i} style={{
                    color: l.level === 'error' ? C.red : l.level === 'warn' ? C.warn : C.green,
                    paddingBottom: 3, lineHeight: 1.55, display: 'flex', gap: 8,
                  }}>
                    <span style={{ opacity: 0.6, flexShrink: 0 }}>
                      {l.level === 'error' ? '✕' : l.level === 'warn' ? '!' : '✓'}
                    </span>
                    <span>{l.text}</span>
                  </div>
                ))}
                {step === 'importing' && (
                  <div style={{ color: C.accent, animation: 'blink 1.2s step-start infinite', marginTop: 2 }}>▋</div>
                )}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* Done report */}
            {step === 'done' && report && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {[
                    { label: 'Insérés',          value: report.inserted, color: C.green,  dimColor: C.greenDim,  borderColor: C.green },
                    { label: 'Doublons ignorés', value: report.ignored,  color: C.warn,   dimColor: C.warnDim,   borderColor: C.warn  },
                    { label: 'Erreurs',          value: report.errors,   color: report.errors > 0 ? C.red : C.muted, dimColor: report.errors > 0 ? C.redDim : 'transparent', borderColor: report.errors > 0 ? C.red : C.border },
                  ].map((s) => (
                    <div key={s.label} style={{
                      background: s.dimColor,
                      border: `1px solid ${s.borderColor}`,
                      borderRadius: 2,
                      padding: '18px 20px', textAlign: 'center',
                    }}>
                      <div style={{
                        fontSize: 30, fontWeight: 800, color: s.color,
                        fontFamily: fontOrbitron, fontVariantNumeric: 'tabular-nums',
                      }}>
                        {s.value.toLocaleString('fr-FR')}
                      </div>
                      <div style={{
                        fontSize: 9, color: C.textSec, marginTop: 6,
                        fontFamily: fontMichroma, textTransform: 'uppercase', letterSpacing: '0.14em',
                      }}>
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => {
                      setStep('upload');
                      setParseResult(null);
                      setMapping(emptyMapping());
                      setLogs([]);
                      setReport(null);
                      setProgress(null);
                      setGlobalError('');
                    }}
                    style={{
                      flex: 1, padding: '12px 20px', borderRadius: 2, cursor: 'pointer',
                      background: 'transparent',
                      border: `1px solid ${C.border}`,
                      color: C.textDim,
                      fontSize: 10, fontFamily: fontMichroma,
                      textTransform: 'uppercase', letterSpacing: '0.14em',
                    }}
                  >
                    ↩ Nouvel import
                  </button>
                  <a
                    href="/admin"
                    style={{
                      flex: 1, padding: '12px 20px', borderRadius: 2, cursor: 'pointer',
                      background: C.accentDim,
                      border: `1px solid ${C.accent}`,
                      color: C.accent,
                      fontSize: 10, fontFamily: fontMichroma,
                      textTransform: 'uppercase', letterSpacing: '0.14em',
                      textDecoration: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
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
          <div style={{
            marginTop: 16,
            background: C.redDim,
            border: `1px solid ${C.red}`,
            borderRadius: 2, padding: '10px 14px',
            color: C.red, fontSize: 12, fontFamily: fontMono,
          }}>
            ! {globalError}
          </div>
        )}
      </div>
    </div>
  );
}
