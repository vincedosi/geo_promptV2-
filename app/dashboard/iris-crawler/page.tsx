'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { IRIS_CATALOG } from '@/lib/iris-crawler/catalog';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/iris-crawler/types';
import { autoMap } from '@/lib/iris-crawler/auto-map';
import { IRIS_DB_COLUMNS, CORE_COLUMN_NAMES } from '@/lib/iris-crawler/db-columns';
import { adminFetch } from '@/lib/admin-fetch';
import type {
  CatalogStatus, DiscoverResponse, PreviewResponse,
  DownloadStreamEvent, IrisCatalogCategory,
} from '@/lib/iris-crawler/types';

// ── Design tokens (GEO.PROMPT terminal dark) ─────────────────────────────────
const C = {
  bg:          '#050505',
  bgElevated:  '#111111',
  bgSurface:   '#111111',
  bgRow:       '#0a0a0a',
  border:      '#1a1a1a',
  borderLight: 'rgba(78,205,196,0.2)',
  accent:      '#4ecdc4',
  accentDim:   'rgba(78,205,196,0.1)',
  text:        '#f0f0f0',
  textDim:     '#a0a0a0',
  textSec:     '#666666',
  muted:       '#666666',
  green:       '#3dffa0',
  greenDim:    'rgba(61,255,160,0.10)',
  red:         '#ff5757',
  redDim:      'rgba(255,87,87,0.10)',
  warn:        '#f7b731',
  warnDim:     'rgba(247,183,49,0.10)',
  blue:        '#5b9bd5',
  blueDim:     'rgba(91,155,213,0.10)',
} as const;
const fOrbitron = "'Inter', system-ui, sans-serif";
const fMichroma = "'Inter', system-ui, sans-serif";
const fMono     = "'JetBrains Mono', monospace";
const fInter    = "'Inter', system-ui, sans-serif";

// ── Types locaux ──────────────────────────────────────────────────────────────
interface EntryState {
  discovering:      boolean;
  discoverError?:   string;
  foundUrls:        Array<{ url: string; name: string }>;
  selectedUrl:      string;
  downloading:      boolean;
  downloadError?:   string;
  downloadMsg?:     string;
  // Mapping & upload
  showMapping:      boolean;
  irisKeyCol:       string;
  mapping:          Record<string, string>; // csvCol → irisDbCol
  uploading:        boolean;
  uploadProgress:   number;
  uploadMsg?:       string;
}

type PreviewTab = 'data' | 'columns' | 'stats';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtBytes(b: number): string {
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} Mo`;
  return `${(b / 1024).toFixed(0)} Ko`;
}

function ts(): string {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Micro composant : badge EN BASE ───────────────────────────────────────────
function InDbBadge() {
  return (
    <span style={{ fontFamily: fMono, fontSize: 8, color: C.accent, background: C.accentDim, border: `1px solid rgba(168,85,247,0.35)`, borderRadius: 2, padding: '1px 5px', letterSpacing: '0.06em', marginLeft: 4, verticalAlign: 'middle' }}>
      EN BASE
    </span>
  );
}

// ── Micro composant : badge catégorie ────────────────────────────────────────
const CAT_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  rp:          { color: C.blue,  bg: C.blueDim,   border: 'rgba(96,165,250,0.3)' },
  filosofi:    { color: C.warn,  bg: C.warnDim,   border: 'rgba(251,191,36,0.3)' },
  carreaux:    { color: '#34d399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.3)' },
  bpe:         { color: '#f472b6', bg: 'rgba(244,114,182,0.1)', border: 'rgba(244,114,182,0.3)' },
  referentiel: { color: C.textDim, bg: 'rgba(100,100,120,0.12)', border: 'rgba(100,100,120,0.3)' },
};

function SourceBadge({ source, category }: { source: string; category: string }) {
  const col = CAT_COLORS[category] ?? CAT_COLORS.rp;
  const label = source === 'filosofi' ? 'FILOSOFI' : source === 'bpe' ? 'BPE' : 'RP';
  return (
    <span style={{ fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.1em', color: col.color, background: col.bg, border: `1px solid ${col.border}`, borderRadius: 2, padding: '2px 5px' }}>
      {label}
    </span>
  );
}

// ── Micro composant : badge statut ────────────────────────────────────────────
function StatusBadge({ status, downloading }: { status: CatalogStatus | undefined; downloading: boolean }) {
  if (downloading) {
    return (
      <span style={{ fontFamily: fMono, fontSize: 9, color: C.warn, background: C.warnDim, border: `1px solid rgba(251,191,36,0.3)`, borderRadius: 2, padding: '2px 7px', letterSpacing: '0.06em' }}>
        ⏳ EN COURS
      </span>
    );
  }
  if (!status || !status.downloaded) {
    return (
      <span style={{ fontFamily: fMono, fontSize: 9, color: C.textSec, background: 'rgba(75,85,99,0.15)', border: `1px solid rgba(75,85,99,0.3)`, borderRadius: 2, padding: '2px 7px', letterSpacing: '0.06em' }}>
        ✕ NON TÉLÉCHARGÉ
      </span>
    );
  }
  return (
    <span style={{ fontFamily: fMono, fontSize: 9, color: C.green, background: C.greenDim, border: `1px solid rgba(61,255,160,0.25)`, borderRadius: 2, padding: '2px 7px', letterSpacing: '0.06em' }}>
      ✓ TÉLÉCHARGÉ
    </span>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function IrisCrawlerPage() {
  const [statusMap,    setStatusMap]    = useState<Record<string, CatalogStatus>>({});
  const [entryStates,  setEntryStates]  = useState<Record<string, EntryState>>(() =>
    Object.fromEntries(IRIS_CATALOG.map(e => [e.id, {
      discovering: false, foundUrls: [], selectedUrl: '', downloading: false,
      showMapping: false, irisKeyCol: 'IRIS', mapping: {}, uploading: false, uploadProgress: 0,
    }]))
  );
  const [mainTab,          setMainTab]          = useState<'crawler' | 'import' | 'upload'>('crawler');
  const [loadingStatus,   setLoadingStatus]   = useState(true);
  const [downloadingAll,  setDownloadingAll]  = useState(false);
  const [previewData,     setPreviewData]     = useState<PreviewResponse | null>(null);
  const [previewId,       setPreviewId]       = useState<string | null>(null);
  const [previewTab,      setPreviewTab]      = useState<PreviewTab>('data');
  const [previewLoading,  setPreviewLoading]  = useState(false);
  const [consoleLogs,     setConsoleLogs]     = useState<string[]>([]);
  const [consoleOpen,     setConsoleOpen]     = useState(true);
  const consoleRef = useRef<HTMLDivElement>(null);

  const log = useCallback((msg: string) => {
    setConsoleLogs(prev => [...prev.slice(-199), `[${ts()}] ${msg}`]);
  }, []);

  // Scroll console vers le bas
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleLogs]);

  // ── Charger le statut ───────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    log('Vérification du statut des bases…');
    try {
      const res = await fetch('/api/iris-crawler/status');
      const data = await res.json() as Record<string, CatalogStatus>;
      setStatusMap(data);
      const dl = Object.values(data).filter(s => s.downloaded).length;
      log(`Statut : ${dl}/${IRIS_CATALOG.length} bases téléchargées`);
    } catch (e) {
      log(`! Erreur statut : ${String(e)}`);
    } finally {
      setLoadingStatus(false);
    }
  }, [log]);

  useEffect(() => {
    setConsoleLogs([`[${ts()}] GENESIS IRIS Crawler prêt`]);
    loadStatus();
  }, [loadStatus]);

  // ── Discover ────────────────────────────────────────────────────────────────
  const handleDiscover = useCallback(async (catalogId: string) => {
    const entry = IRIS_CATALOG.find(e => e.id === catalogId)!;
    setEntryStates(prev => ({
      ...prev,
      [catalogId]: { ...prev[catalogId], discovering: true, discoverError: undefined, foundUrls: [] },
    }));
    log(`Discover ${catalogId} (pageId=${entry.inseePageId})…`);

    try {
      const pageType = entry.inseePageUrl.includes('/information/') ? 'information' : 'statistiques';
      const res = await fetch(`/api/iris-crawler/discover?pageId=${entry.inseePageId}&pageType=${pageType}`);
      const data = await res.json() as DiscoverResponse;

      if (data.error) {
        setEntryStates(prev => ({
          ...prev,
          [catalogId]: { ...prev[catalogId], discovering: false, discoverError: data.error },
        }));
        log(`! Discover ${catalogId} : ${data.error}`);
        return;
      }

      const urls = data.urls;
      log(`Discover ${catalogId} : ${urls.length} URL(s) trouvée(s)${data.pageTitle ? ` — "${data.pageTitle}"` : ''}`);
      urls.forEach(u => log(`  → ${u.name}`));

      setEntryStates(prev => ({
        ...prev,
        [catalogId]: {
          ...prev[catalogId],
          discovering: false,
          foundUrls: urls,
          selectedUrl: urls[0]?.url ?? '',
          discoverError: urls.length === 0 ? 'Aucune URL trouvée. Vérifier la page INSEE.' : undefined,
        },
      }));
    } catch (e) {
      setEntryStates(prev => ({
        ...prev,
        [catalogId]: { ...prev[catalogId], discovering: false, discoverError: String(e) },
      }));
      log(`! Discover ${catalogId} erreur : ${String(e)}`);
    }
  }, [log]);

  // ── Download (streaming NDJSON) ─────────────────────────────────────────────
  const handleDownload = useCallback(async (catalogId: string, csvUrl?: string) => {
    const state = entryStates[catalogId];
    const url = csvUrl ?? state.selectedUrl;
    if (!url) { log(`! ${catalogId} : aucune URL sélectionnée`); return; }

    setEntryStates(prev => ({
      ...prev,
      [catalogId]: { ...prev[catalogId], downloading: true, downloadError: undefined },
    }));
    log(`Téléchargement ${catalogId} depuis ${url.split('/').pop()}…`);

    try {
      const res = await fetch('/api/iris-crawler/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogId, csvUrl: url }),
      });

      if (!res.body) throw new Error('Pas de réponse streaming');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as DownloadStreamEvent;
            if (event.type === 'status') {
              log(`  ${catalogId} : ${event.message}`);
              setEntryStates(prev => ({ ...prev, [catalogId]: { ...prev[catalogId], downloadMsg: event.message } }));
            }
            if (event.type === 'error') {
              log(`! ${catalogId} : ${event.message}`);
              setEntryStates(prev => ({
                ...prev,
                [catalogId]: { ...prev[catalogId], downloadError: event.message, downloadMsg: undefined },
              }));
            }
            if (event.type === 'done') {
              log(`✓ ${catalogId} terminé — ${event.message}`);
              setEntryStates(prev => ({ ...prev, [catalogId]: { ...prev[catalogId], downloadMsg: undefined } }));
            }
          } catch { /* ligne mal formée */ }
        }
      }

      // Rafraîchir le statut
      await loadStatus();
    } catch (e) {
      log(`! ${catalogId} erreur : ${String(e)}`);
      setEntryStates(prev => ({
        ...prev,
        [catalogId]: { ...prev[catalogId], downloadError: String(e) },
      }));
    } finally {
      setEntryStates(prev => ({
        ...prev,
        [catalogId]: { ...prev[catalogId], downloading: false },
      }));
    }
  }, [entryStates, log, loadStatus]);

  // ── Télécharger tout ────────────────────────────────────────────────────────
  const handleDownloadAll = useCallback(async () => {
    setDownloadingAll(true);
    log('Démarrage téléchargement séquentiel de toutes les bases…');

    for (const entry of IRIS_CATALOG) {
      const status = statusMap[entry.id];
      if (status?.downloaded) {
        log(`  ${entry.id} : déjà téléchargé — ignoré`);
        continue;
      }

      // Discover d'abord
      log(`  Discover ${entry.id}…`);
      const pageType = entry.inseePageUrl.includes('/information/') ? 'information' : 'statistiques';
      let csvUrl = '';
      try {
        const res = await fetch(`/api/iris-crawler/discover?pageId=${entry.inseePageId}&pageType=${pageType}`);
        const data = await res.json() as DiscoverResponse;
        csvUrl = data.urls[0]?.url ?? '';
        if (!csvUrl) {
          log(`  ! ${entry.id} : aucune URL trouvée — ignoré`);
          continue;
        }
      } catch (e) {
        log(`  ! ${entry.id} discover erreur : ${String(e)}`);
        continue;
      }

      await handleDownload(entry.id, csvUrl);
    }

    setDownloadingAll(false);
    log('Téléchargement tout : terminé');
  }, [statusMap, handleDownload, log]);

  // ── Ouvrir le panel de mapping ───────────────────────────────────────────────
  const handleShowMapping = useCallback(async (catalogId: string) => {
    const es = entryStates[catalogId];
    if (es.showMapping) {
      setEntryStates(prev => ({ ...prev, [catalogId]: { ...prev[catalogId], showMapping: false } }));
      return;
    }
    // Charger les colonnes depuis le preview pour construire l'auto-map
    try {
      const res = await fetch(`/api/iris-crawler/preview?catalogId=${catalogId}&limit=1`);
      if (!res.ok) return;
      const data = await res.json() as { headers: string[]; geoColumns: string[] };
      const csvDataCols = data.headers.filter(h => !data.geoColumns.includes(h));
      const { irisKeyCol, mapping } = autoMap(data.headers);
      setEntryStates(prev => ({
        ...prev,
        [catalogId]: { ...prev[catalogId], showMapping: true, irisKeyCol, mapping },
      }));
      log(`Mapping ${catalogId} : ${Object.keys(mapping).length} colonnes auto-détectées`);
    } catch (e) {
      log(`! Erreur mapping ${catalogId} : ${String(e)}`);
    }
  }, [entryStates, log]);

  // ── Upload vers Supabase (streaming) ─────────────────────────────────────────
  const handleUpload = useCallback(async (catalogId: string) => {
    const es = entryStates[catalogId];
    if (Object.keys(es.mapping).length === 0) {
      log(`! ${catalogId} : aucun mapping défini`);
      return;
    }
    setEntryStates(prev => ({
      ...prev,
      [catalogId]: { ...prev[catalogId], uploading: true, uploadProgress: 0, uploadMsg: undefined },
    }));
    log(`Upload ${catalogId} → Supabase (${Object.keys(es.mapping).length} colonnes)…`);

    try {
      const res = await fetch('/api/iris-crawler/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogId, irisKeyCol: es.irisKeyCol, mapping: es.mapping }),
      });
      if (!res.body) throw new Error('Pas de stream');

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as { type: string; message: string; percent?: number };
            log(`  ${catalogId} upload : ${evt.message}`);
            if (evt.type === 'progress') {
              setEntryStates(prev => ({
                ...prev,
                [catalogId]: { ...prev[catalogId], uploadProgress: evt.percent ?? 0 },
              }));
            } else if (evt.type === 'done') {
              setEntryStates(prev => ({
                ...prev,
                [catalogId]: { ...prev[catalogId], uploading: false, uploadProgress: 100, uploadMsg: evt.message },
              }));
              await loadStatus();
            } else if (evt.type === 'error') {
              setEntryStates(prev => ({
                ...prev,
                [catalogId]: { ...prev[catalogId], uploading: false, uploadMsg: `! ${evt.message}` },
              }));
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e) {
      log(`! Upload ${catalogId} erreur : ${String(e)}`);
      setEntryStates(prev => ({
        ...prev,
        [catalogId]: { ...prev[catalogId], uploading: false, uploadMsg: `! ${String(e)}` },
      }));
    }
  }, [entryStates, log, loadStatus]);

  // ── Preview ─────────────────────────────────────────────────────────────────
  const handlePreview = useCallback(async (catalogId: string) => {
    if (previewId === catalogId) {
      setPreviewId(null);
      setPreviewData(null);
      return;
    }
    setPreviewId(catalogId);
    setPreviewLoading(true);
    setPreviewTab('data');
    log(`Chargement preview ${catalogId}…`);
    try {
      const res = await fetch(`/api/iris-crawler/preview?catalogId=${catalogId}&limit=20`);
      if (!res.ok) {
        const err = await res.json() as { error: string };
        log(`! Preview ${catalogId} : ${err.error}`);
        setPreviewId(null);
        return;
      }
      const data = await res.json() as PreviewResponse;
      setPreviewData(data);
      log(`Preview ${catalogId} : ${data.totalRows} lignes × ${data.headers.length} colonnes`);
    } catch (e) {
      log(`! Preview erreur : ${String(e)}`);
      setPreviewId(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [previewId, log]);

  // ── Render — groupement par catégorie, tri par année desc ────────────────
  const totalDl = Object.values(statusMap).filter(s => s.downloaded).length;
  const inDbCount = IRIS_CATALOG.filter(e => e.inDatabase).length;

  const groupedCatalog: Array<{ category: IrisCatalogCategory; entries: typeof IRIS_CATALOG }> =
    CATEGORY_ORDER.map(cat => ({
      category: cat,
      entries: IRIS_CATALOG
        .filter(e => e.category === cat)
        .sort((a, b) => b.year - a.year),
    })).filter(g => g.entries.length > 0);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: fInter, color: C.text }}>
      <style>{`@keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }`}</style>

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/dashboard" style={{ fontFamily: fOrbitron, fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textDecoration: 'none' }}>
            <span style={{ color: C.textDim }}>geo</span><span style={{ color: C.accent }}>.</span><span style={{ color: C.text }}>prompt</span>
          </a>
          <span style={{ color: C.border }}>›</span>
          <span style={{ fontFamily: fMichroma, fontSize: 9, color: C.textDim, letterSpacing: '0.14em' }}>IRIS CRAWLER</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: fMono, fontSize: 9, color: C.textSec }}>
            {loadingStatus ? '…' : `${totalDl}/${IRIS_CATALOG.length} bases`}
          </span>
          <span style={{ fontFamily: fMono, fontSize: 9, color: C.accent }}>
            {inDbCount} en base
          </span>
          <button onClick={loadStatus} disabled={loadingStatus}
            style={btnStyle(C.textDim, 'rgba(100,100,120,0.15)', 'rgba(100,100,120,0.4)')}>
            {loadingStatus ? '…' : '↻ Rafraîchir'}
          </button>
          <button onClick={handleDownloadAll} disabled={downloadingAll || loadingStatus}
            style={btnStyle(C.accent, C.accentDim, C.borderLight)}>
            {downloadingAll ? '⏳ En cours…' : '⬇ Tout télécharger'}
          </button>
        </div>
      </header>

      {/* ─── Onglets ─── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 0, padding: '0 28px', background: C.bgElevated }}>
        {(['crawler', 'import', 'upload'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setMainTab(tab)}
            style={{
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${mainTab === tab ? C.accent : 'transparent'}`,
              color: mainTab === tab ? C.accent : C.textDim,
              fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.12em',
              padding: '10px 18px', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {tab === 'crawler' ? 'CRAWLER AUTO' : tab === 'import' ? 'IMPORT INSEE' : 'UPLOAD FICHIER'}
          </button>
        ))}
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>

        {mainTab === 'crawler' && <>

        {/* ─── Titre ────────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: fOrbitron, fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', margin: 0, color: C.text }}>
            Crawler INSEE — Données IRIS
          </h1>
          <p style={{ fontFamily: fMono, fontSize: 10, color: C.textDim, margin: '6px 0 0', letterSpacing: '0.04em' }}>
            Téléchargement et intégration des bases infracommunales · ~51 000 IRIS · France métropolitaine
          </p>
        </div>

        {/* ─── Tableau des bases ─────────────────────────────────────────────── */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden', marginBottom: 20 }}>

          {/* En-tête tableau */}
          <div style={gridRow(C.bgElevated)}>
            <ColHead w={180}>THÈME</ColHead>
            <ColHead w={80}>SOURCE</ColHead>
            <ColHead w={60}>ANNÉE</ColHead>
            <ColHead w={160}>STATUT</ColHead>
            <ColHead w={90}>LIGNES</ColHead>
            <ColHead w={80}>COLONNES</ColHead>
            <ColHead flex>ACTIONS</ColHead>
          </div>

          {groupedCatalog.map(({ category, entries }) => {
            const catColor = CAT_COLORS[category] ?? CAT_COLORS.rp;
            const catInDb  = entries.filter(e => e.inDatabase).length;

            return (
              <div key={category}>

                {/* ── Séparateur de catégorie ── */}
                <div style={{
                  borderTop: `1px solid ${C.border}`,
                  background: `linear-gradient(90deg, ${catColor.bg} 0%, transparent 60%)`,
                  padding: '7px 14px',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{ fontFamily: fMichroma, fontSize: 9, letterSpacing: '0.14em', color: catColor.color }}>
                    {CATEGORY_LABELS[category].toUpperCase()}
                  </span>
                  <span style={{ fontFamily: fMono, fontSize: 8, color: C.textSec }}>
                    {entries.length} jeux · {entries.map(e => e.year).filter((v, i, a) => a.indexOf(v) === i).sort((a,b) => b-a).join(', ')}
                  </span>
                  {catInDb > 0 && (
                    <span style={{ fontFamily: fMono, fontSize: 8, color: C.accent, marginLeft: 4 }}>
                      {catInDb} en base
                    </span>
                  )}
                </div>

                {entries.map((entry, idx) => {
                  const status = statusMap[entry.id];
                  const es     = entryStates[entry.id];
                  const isDl   = es.downloading;
                  const hasDl  = status?.downloaded;

                  return (
                    <div key={entry.id}>
                      {/* Ligne principale */}
                      <div style={{
                        ...gridRow(idx % 2 === 0 ? C.bgRow : C.bg),
                        borderTop: `1px solid ${C.border}`,
                        borderBottom: es.foundUrls.length > 0 ? 'none' : undefined,
                      }}>
                        {/* Thème */}
                        <div style={{ width: 180, flexShrink: 0, padding: '10px 12px' }}>
                          <div style={{ fontFamily: fMono, fontSize: 10, color: entry.inDatabase ? C.accent : C.text, fontWeight: 600 }}>
                            {entry.theme}
                            {entry.inDatabase && <InDbBadge />}
                          </div>
                          <div style={{ fontFamily: fInter, fontSize: 9, color: C.textSec, marginTop: 2, lineHeight: 1.4 }}>{entry.description}</div>
                        </div>
                        {/* Source */}
                        <div style={{ width: 80, flexShrink: 0, padding: '10px 12px' }}>
                          <SourceBadge source={entry.source} category={entry.category} />
                        </div>
                        {/* Année */}
                        <div style={{ width: 60, flexShrink: 0, padding: '10px 12px', fontFamily: fMono, fontSize: 10, color: C.textDim }}>
                          {entry.year}
                        </div>
                        {/* Statut */}
                        <div style={{ width: 160, flexShrink: 0, padding: '10px 12px' }}>
                          <StatusBadge status={status} downloading={isDl} />
                          {hasDl && status.downloadedAt && (
                            <div style={{ fontFamily: fMono, fontSize: 8, color: C.textSec, marginTop: 3 }}>
                              {fmtDate(status.downloadedAt)}
                            </div>
                          )}
                        </div>
                  {/* Lignes */}
                  <div style={{ width: 90, flexShrink: 0, padding: '10px 12px', fontFamily: fMono, fontSize: 10, color: hasDl ? C.green : C.muted }}>
                    {hasDl ? (status.rowCount?.toLocaleString('fr-FR') ?? '—') : '—'}
                  </div>
                  {/* Colonnes */}
                  <div style={{ width: 80, flexShrink: 0, padding: '10px 12px', fontFamily: fMono, fontSize: 10, color: hasDl ? C.textDim : C.muted }}>
                    {hasDl ? (status.columnCount ?? '—') : '—'}
                  </div>
                  {/* Actions */}
                  <div style={{ flex: 1, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {/* Discover */}
                    <button onClick={() => handleDiscover(entry.id)}
                      disabled={es.discovering || isDl}
                      style={btnSmall(C.textDim, 'transparent', C.border)}>
                      {es.discovering ? '…' : '⟳ Discover'}
                    </button>

                    {/* Télécharger (si URL sélectionnée) */}
                    {es.foundUrls.length > 0 && (
                      <button
                        onClick={() => handleDownload(entry.id)}
                        disabled={!es.selectedUrl || isDl}
                        style={btnSmall(C.green, C.greenDim, 'rgba(61,255,160,0.3)')}>
                        {isDl ? '⏳…' : '⬇ Télécharger'}
                      </button>
                    )}

                    {/* Supprimer le téléchargement */}
                    {hasDl && !isDl && (
                      <button
                        onClick={async () => {
                          await fetch('/api/iris-crawler/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalogId: entry.id }) });
                          await loadStatus();
                          setEntryStates(prev => ({ ...prev, [entry.id]: { ...prev[entry.id], showMapping: false, mapping: {}, uploadMsg: undefined } }));
                        }}
                        style={btnSmall(C.red, C.redDim, `${C.red}44`)}>
                        ✕ Supprimer
                      </button>
                    )}

                    {/* Preview */}
                    {hasDl && (
                      <button onClick={() => handlePreview(entry.id)}
                        disabled={previewLoading}
                        style={btnSmall(
                          previewId === entry.id ? C.accent : C.textDim,
                          previewId === entry.id ? C.accentDim : 'transparent',
                          previewId === entry.id ? C.borderLight : C.border,
                        )}>
                        {previewId === entry.id ? '▲ Fermer' : '▼ Preview'}
                      </button>
                    )}

                    {/* Mapping & Upload Supabase */}
                    {hasDl && (
                      <button
                        onClick={() => handleShowMapping(entry.id)}
                        disabled={es.uploading}
                        style={btnSmall(
                          es.showMapping ? C.accent : C.textDim,
                          es.showMapping ? C.accentDim : 'transparent',
                          es.showMapping ? C.borderLight : C.border,
                        )}>
                        {es.showMapping ? '▲ Mapper' : '▼ Mapper'}
                      </button>
                    )}
                    {hasDl && es.showMapping && Object.keys(es.mapping).length > 0 && (
                      <button
                        onClick={() => handleUpload(entry.id)}
                        disabled={es.uploading}
                        style={btnSmall('#4ecdc4', 'rgba(78,205,196,0.1)', 'rgba(78,205,196,0.3)')}>
                        {es.uploading ? `⏳ ${es.uploadProgress}%` : `↑ Importer ${Object.keys(es.mapping).length} col.`}
                      </button>
                    )}
                    {es.uploadMsg && (
                      <span style={{ fontFamily: fMono, fontSize: 8, color: es.uploadMsg.startsWith('!') ? C.red : C.green, maxWidth: 240 }}>
                        {es.uploadMsg}
                      </span>
                    )}

                    {/* Lien INSEE */}
                    <a href={entry.inseePageUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontFamily: fMono, fontSize: 8, color: C.textSec, textDecoration: 'none', letterSpacing: '0.05em' }}>
                      ↗ INSEE
                    </a>

                    {/* Erreur discover */}
                    {es.discoverError && (
                      <span style={{ fontFamily: fMono, fontSize: 8, color: C.red, maxWidth: 200 }}>
                        ! {es.discoverError}
                      </span>
                    )}
                    {es.downloadError && (
                      <span style={{ fontFamily: fMono, fontSize: 8, color: C.red, maxWidth: 200 }}>
                        ! {es.downloadError}
                      </span>
                    )}
                  </div>
                </div>

                {/* Barre de progression téléchargement */}
                {isDl && (
                  <div style={{ borderTop: `1px solid ${C.border}`, padding: '6px 14px', background: '#06060f' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 3, background: C.bgSurface, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: '100%', background: `linear-gradient(90deg, transparent, ${C.green}, transparent)`, backgroundSize: '200% 100%', animation: 'shimmer 1.2s infinite linear' }} />
                      </div>
                      <span style={{ fontFamily: fMono, fontSize: 8, color: C.green, flexShrink: 0 }}>
                        {es.downloadMsg ?? 'Téléchargement…'}
                      </span>
                    </div>
                  </div>
                )}

                {/* URLs trouvées (dropdown inline) */}
                {es.foundUrls.length > 0 && (
                  <div style={{
                    background: '#080810',
                    borderTop: `1px solid ${C.border}`,
                    padding: '8px 12px 10px 180px',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.textSec, letterSpacing: '0.12em', marginBottom: 4 }}>
                      URLS DISPONIBLES — sélectionner puis télécharger
                    </div>
                    {es.foundUrls.map(({ url, name }) => (
                      <label key={url} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`url-${entry.id}`}
                          value={url}
                          checked={es.selectedUrl === url}
                          onChange={() => setEntryStates(prev => ({
                            ...prev,
                            [entry.id]: { ...prev[entry.id], selectedUrl: url },
                          }))}
                          style={{ accentColor: C.accent, cursor: 'pointer' }}
                        />
                        <span style={{ fontFamily: fMono, fontSize: 9, color: es.selectedUrl === url ? C.text : C.textDim }}>
                          {name}
                        </span>
                        <span style={{ fontFamily: fMono, fontSize: 8, color: C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                          {url}
                        </span>
                      </label>
                    ))}
                      </div>
                    )}

                    {/* ── Panel mapping colonnes ── */}
                    {es.showMapping && (
                      <div style={{ background: '#06060f', borderTop: `1px solid ${C.borderLight}`, padding: '12px 14px 14px' }}>
                        <div style={{ fontFamily: fMichroma, fontSize: 8, color: C.accent, letterSpacing: '0.14em', marginBottom: 10 }}>
                          MAPPING COLONNES CSV → BASE IRIS
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '6px 16px' }}>
                          {IRIS_DB_COLUMNS.map(dbCol => {
                            const csvCol = Object.entries(es.mapping).find(([, v]) => v === dbCol.name)?.[0] ?? '';
                            // Computed columns : détection des colonnes dérivées (__src_*)
                            const mappingVals = Object.values(es.mapping);
                            const computedLabel: string | null =
                              dbCol.name === 'taux_chomage'    && mappingVals.includes('__src_chom')  ? 'calculé CHOM/ACT'      :
                              dbCol.name === 'taux_proprio'    && mappingVals.includes('__src_prop')  ? 'calculé PROP/RP'       :
                              dbCol.name === 'nb_diplome_sup'  && mappingVals.includes('__src_sup2')  ? 'calculé SUP2+SUP34+5'  :
                              dbCol.name === 'taux_diplome_sup'&& mappingVals.includes('__src_sup2')  ? 'calculé SUP/total'     :
                              null;
                            const isActive   = !!csvCol || !!computedLabel;
                            const labelColor = csvCol ? C.green : computedLabel ? C.warn : C.muted;
                            const indicator  = csvCol ? '✓' : computedLabel ? '≈' : '–';
                            return (
                              <div key={dbCol.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontFamily: fMono, fontSize: 9, color: labelColor, width: 140, flexShrink: 0 }}>
                                  {indicator} {dbCol.label}
                                </span>
                                <input
                                  type="text"
                                  value={csvCol}
                                  placeholder={computedLabel ?? 'col. CSV…'}
                                  onChange={e => {
                                    const val = e.target.value.trim();
                                    setEntryStates(prev => {
                                      const cur = { ...prev[entry.id].mapping };
                                      for (const k of Object.keys(cur)) {
                                        if (cur[k] === dbCol.name) delete cur[k];
                                      }
                                      if (val) cur[val] = dbCol.name;
                                      return { ...prev, [entry.id]: { ...prev[entry.id], mapping: cur } };
                                    });
                                  }}
                                  style={{
                                    flex: 1, background: '#0a0a14',
                                    border: `1px solid ${csvCol ? 'rgba(61,255,160,0.3)' : computedLabel ? 'rgba(251,191,36,0.3)' : C.border}`,
                                    borderRadius: 2, padding: '3px 7px', fontFamily: fMono, fontSize: 9,
                                    color: csvCol ? C.green : computedLabel ? C.warn : C.textDim, outline: 'none',
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ marginTop: 10, fontFamily: fMono, fontSize: 8, color: C.textSec }}>
                          {Object.keys(es.mapping).length} colonnes mappées · clé IRIS : <span style={{ color: C.blue }}>{es.irisKeyCol}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ─── Preview ──────────────────────────────────────────────────────── */}
        {previewId && (
          <div style={{ border: `1px solid ${C.borderLight}`, borderRadius: 2, marginBottom: 20, overflow: 'hidden' }}>
            {/* Header preview */}
            <div style={{ background: C.bgElevated, borderBottom: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontFamily: fMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.12em' }}>
                PREVIEW — {IRIS_CATALOG.find(e => e.id === previewId)?.theme?.toUpperCase()}
              </span>
              {previewData && (
                <span style={{ fontFamily: fMono, fontSize: 9, color: C.textSec }}>
                  {previewData.totalRows.toLocaleString('fr-FR')} lignes · {previewData.headers.length} colonnes · {fmtBytes(previewData.fileSizeBytes)}
                </span>
              )}
              {/* Tabs */}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                {(['data', 'columns', 'stats'] as PreviewTab[]).map(tab => (
                  <button key={tab} onClick={() => setPreviewTab(tab)}
                    style={{
                      background: previewTab === tab ? C.accentDim : 'transparent',
                      border: `1px solid ${previewTab === tab ? C.accent : C.border}`,
                      borderRadius: 2, padding: '3px 10px', cursor: 'pointer',
                      fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.1em',
                      color: previewTab === tab ? C.accent : C.textDim,
                      textTransform: 'uppercase',
                    }}>
                    {tab === 'data' ? 'Données' : tab === 'columns' ? 'Colonnes' : 'Stats'}
                  </button>
                ))}
              </div>
            </div>

            {previewLoading && (
              <div style={{ padding: 32, textAlign: 'center', fontFamily: fMono, fontSize: 10, color: C.textDim }}>
                Chargement preview…
              </div>
            )}

            {!previewLoading && previewData && (
              <>
                {/* ─── Tab Données ─── */}
                {previewTab === 'data' && (
                  <div style={{ overflowX: 'auto', maxHeight: 420 }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 9, fontFamily: fMono, width: 'max-content', minWidth: '100%' }}>
                      <thead>
                        <tr style={{ background: '#0d0d18', position: 'sticky', top: 0 }}>
                          {previewData.headers.map(h => (
                            <th key={h} style={{
                              padding: '6px 10px', textAlign: 'left', whiteSpace: 'nowrap',
                              borderBottom: `1px solid ${C.border}`,
                              borderRight: `1px solid ${C.border}`,
                              color: previewData.geoColumns.includes(h) ? C.blue : C.textDim,
                              fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.08em', fontWeight: 400,
                            }}>
                              {h}
                              {previewData.geoColumns.includes(h) && (
                                <span style={{ marginLeft: 3, opacity: 0.5, fontSize: 6 }}>GEO</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.rows.map((row, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? C.bg : C.bgRow }}>
                            {previewData.headers.map(h => {
                              const v = row[h];
                              const isGeo = previewData.geoColumns.includes(h);
                              return (
                                <td key={h} style={{
                                  padding: '4px 10px', whiteSpace: 'nowrap',
                                  borderRight: `1px solid rgba(38,26,53,0.5)`,
                                  color: v === null ? C.muted : isGeo ? C.blue : typeof v === 'number' ? C.green : C.text,
                                  fontSize: 9,
                                }}>
                                  {v === null ? <span style={{ color: C.muted, fontSize: 8 }}>null</span> : String(v)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ─── Tab Colonnes ─── */}
                {previewTab === 'columns' && (
                  <div style={{ overflowY: 'auto', maxHeight: 420 }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 9, fontFamily: fMono }}>
                      <thead>
                        <tr style={{ background: '#0d0d18' }}>
                          {['COLONNE', 'TYPE', 'NULL %', 'MIN', 'MAX', 'ÉCHANTILLONS'].map(h => (
                            <th key={h} style={{ padding: '6px 12px', textAlign: 'left', borderBottom: `1px solid ${C.border}`, fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.1em', color: C.textDim, fontWeight: 400 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.columnStats.map((col, i) => (
                          <tr key={col.name} style={{ background: i % 2 === 0 ? C.bg : C.bgRow, borderBottom: `1px solid rgba(38,26,53,0.4)` }}>
                            <td style={{ padding: '4px 12px', color: col.type === 'geo' ? C.blue : C.text, fontWeight: 600 }}>{col.name}</td>
                            <td style={{ padding: '4px 12px' }}>
                              <span style={{ color: col.type === 'geo' ? C.blue : C.accent, fontSize: 8 }}>
                                {col.type === 'geo' ? 'GEO' : 'DATA'}
                              </span>
                            </td>
                            <td style={{ padding: '4px 12px', color: col.nullPct > 50 ? C.warn : col.nullPct > 0 ? C.textDim : C.green }}>
                              {col.nullPct}%
                            </td>
                            <td style={{ padding: '4px 12px', color: C.textDim }}>
                              {col.min != null ? col.min.toLocaleString('fr-FR') : '—'}
                            </td>
                            <td style={{ padding: '4px 12px', color: C.textDim }}>
                              {col.max != null ? col.max.toLocaleString('fr-FR') : '—'}
                            </td>
                            <td style={{ padding: '4px 12px', color: C.textSec, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {col.samples.filter(s => s !== null).slice(0, 3).join(' · ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ─── Tab Stats ─── */}
                {previewTab === 'stats' && (
                  <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                    {[
                      { label: 'Lignes totales',     value: previewData.totalRows.toLocaleString('fr-FR'), color: C.green },
                      { label: 'Colonnes',            value: previewData.headers.length, color: C.accent },
                      { label: 'Colonnes géo',        value: previewData.geoColumns.length, color: C.blue },
                      { label: 'Colonnes data',       value: previewData.dataColumns.length, color: C.textDim },
                      { label: 'Taille fichier ZIP',  value: fmtBytes(previewData.fileSizeBytes), color: C.warn },
                      { label: 'Fichier CSV',         value: previewData.csvFileName, color: C.textDim },
                      { label: 'Téléchargé le',       value: fmtDate(previewData.downloadedAt), color: C.textSec },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 2, padding: '12px 16px' }}>
                        <div style={{ fontFamily: fMichroma, fontSize: 7, color: C.textSec, letterSpacing: '0.12em', marginBottom: 6 }}>{label}</div>
                        <div style={{ fontFamily: fMono, fontSize: 13, color, fontWeight: 700 }}>{String(value)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        </>}

        {mainTab === 'import' && <IrisInseeImportTab />}
        {mainTab === 'upload' && <LocalFileUploadTab />}

        {/* ─── Console ──────────────────────────────────────────────────────── */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
          <div
            onClick={() => setConsoleOpen(v => !v)}
            style={{ background: C.bgElevated, borderBottom: consoleOpen ? `1px solid ${C.border}` : 'none', padding: '7px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
            <span style={{ fontFamily: fMichroma, fontSize: 7, color: C.textSec, letterSpacing: '0.14em' }}>CONSOLE</span>
            <span style={{ fontFamily: fMono, fontSize: 8, color: C.muted }}>{consoleLogs.length} lignes</span>
            <span style={{ marginLeft: 'auto', fontFamily: fMono, fontSize: 10, color: C.muted }}>{consoleOpen ? '▲' : '▼'}</span>
          </div>
          {consoleOpen && (
            <div
              ref={consoleRef}
              style={{ background: '#020205', height: 160, overflowY: 'auto', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {consoleLogs.map((line, i) => (
                <div key={i} style={{
                  fontFamily: fMono, fontSize: 9, letterSpacing: '0.03em', lineHeight: 1.6,
                  color: line.includes('!') ? C.red : line.includes('✓') ? C.green : C.textSec,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>{/* /maxWidth */}
    </div>
  );
}

// ── Upload fichier local ──────────────────────────────────────────────────────

function LocalFileUploadTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging,     setDragging]     = useState(false);
  const [uploading,    setUploading]    = useState(false);
  const [importing,    setImporting]    = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    sessionId: string; filename: string; totalRows: number;
    headers: string[]; previewRows: Array<Record<string,string>>;
    autoMapResult: { irisKeyCol: string; mapping: Record<string,string>; coreCols: string[]; jsonbCols: string[] };
    parseWarnings: string[];
  } | null>(null);
  const [mapping,  setMapping]  = useState<Record<string,string>>({});
  const [keyCol,   setKeyCol]   = useState('IRIS');
  const [logs,     setLogs]     = useState<Array<{ msg: string; kind: 'log'|'error'|'success' }>>([]);
  const [done,     setDone]     = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const addLog = (msg: string, kind: 'log'|'error'|'success' = 'log') =>
    setLogs(prev => [...prev.slice(-299), { msg, kind }]);

  const handleFile = async (file: File) => {
    setUploadResult(null);
    setLogs([]);
    setDone(false);
    setUploading(true);
    addLog(`Upload de ${file.name} (${(file.size/1024/1024).toFixed(1)} Mo)…`);

    const form = new FormData();
    form.append('file', file);
    form.append('encoding', 'utf-8');
    form.append('separator', 'auto');

    try {
      const res = await fetch('/api/iris-crawler/manual-upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { addLog(`! ${data.error ?? 'Erreur upload'}`, 'error'); return; }
      setUploadResult(data);
      setMapping(data.autoMapResult.mapping);
      setKeyCol(data.autoMapResult.irisKeyCol);
      addLog(`✓ ${data.totalRows.toLocaleString('fr-FR')} lignes — ${data.autoMapResult.coreCols.length} colonnes mappées`, 'success');
      if (data.parseWarnings?.length) data.parseWarnings.forEach((w: string) => addLog(`! ${w}`, 'error'));
    } catch (e) {
      addLog(`! ${String(e)}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleImport = async () => {
    if (!uploadResult) return;
    setImporting(true);
    setDone(false);
    addLog('Lancement de l\'import…');

    try {
      const res = await fetch('/api/iris-crawler/manual-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: uploadResult.sessionId, irisKeyCol: keyCol, mapping }),
      });

      if (!res.ok) {
        const err = await res.json();
        addLog(`! ${err.error ?? `HTTP ${res.status}`}`, 'error');
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done: rdone, value } = await reader.read();
        if (rdone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'log')      addLog(evt.message, 'log');
            if (evt.type === 'status')   addLog(evt.message, 'log');
            if (evt.type === 'progress') addLog(evt.message, 'log');
            if (evt.type === 'error')    addLog(`! ${evt.message}`, 'error');
            if (evt.type === 'done') {
              const n = evt.totalInserted ?? 0;
              addLog(`✓ Import terminé — ${n} lignes traitées`, 'success');
              setDone(true);
            }
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      addLog(`! ${String(e)}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const coreMapped = uploadResult
    ? Object.entries(mapping).filter(([, v]) => v !== 'ignore' && v !== '' && !uploadResult.autoMapResult.jsonbCols.includes(Object.entries(mapping).find(([,val])=>val===v)?.[0]??''))
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Zone drop */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? C.accent : C.border}`,
          borderRadius: 2,
          padding: '40px 20px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? C.accentDim : C.bgElevated,
          transition: 'all 0.15s',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <div style={{ fontFamily: fMichroma, fontSize: 10, color: dragging ? C.accent : C.textDim, letterSpacing: '0.12em', marginBottom: 8 }}>
          {uploading ? 'UPLOAD EN COURS…' : 'GLISSER UN FICHIER CSV / CLIQUER POUR PARCOURIR'}
        </div>
        <div style={{ fontFamily: fMono, fontSize: 9, color: C.textSec }}>
          Formats acceptés : .csv, .tsv · Taille max : 50 Mo
        </div>
        <div style={{ fontFamily: fMono, fontSize: 9, color: C.textSec, marginTop: 4 }}>
          Ex: BASE_TD_FILO_IRIS_2021_DEC.csv · Séparateur auto-détecté (;  ou ,)
        </div>
      </div>

      {/* Résultat upload + mapping */}
      {uploadResult && (
        <div style={{ border: `1px solid ${C.borderLight}`, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ background: C.bgElevated, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontFamily: fMichroma, fontSize: 9, color: C.accent, letterSpacing: '0.12em' }}>
              {uploadResult.filename}
            </span>
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.textSec }}>
              {uploadResult.totalRows.toLocaleString('fr-FR')} lignes · {uploadResult.headers.length} colonnes
            </span>
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.green }}>
              {uploadResult.autoMapResult.coreCols.length} colonnes IRIS mappées
            </span>
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.textSec }}>
              {uploadResult.autoMapResult.jsonbCols.length} colonnes JSONB
            </span>
          </div>

          {/* Mapping colonnes core */}
          <div style={{ padding: '12px 16px', background: C.bgSurface }}>
            <div style={{ fontFamily: fMichroma, fontSize: 7.5, color: C.textSec, letterSpacing: '0.14em', marginBottom: 8 }}>
              COLONNES MAPPÉES → TABLE IRIS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(mapping)
                .filter(([, v]) => v !== 'ignore' && v !== '')
                .map(([csvCol, dbCol]) => (
                  <div key={csvCol} style={{
                    background: C.bgElevated, border: `1px solid ${C.border}`,
                    borderRadius: 2, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>{csvCol}</span>
                    <span style={{ fontFamily: fMono, fontSize: 9, color: C.muted }}>→</span>
                    <span style={{ fontFamily: fMono, fontSize: 9, color: C.green, fontWeight: 700 }}>{dbCol}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Bouton import */}
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={handleImport}
              disabled={importing || done}
              style={{
                padding: '8px 20px', borderRadius: 2,
                background: done ? C.greenDim : C.accentDim,
                border: `1px solid ${done ? `${C.green}66` : C.borderLight}`,
                color: done ? C.green : C.accent,
                fontFamily: fMichroma, fontSize: 9, letterSpacing: '0.12em',
                cursor: importing || done ? 'not-allowed' : 'pointer',
              }}
            >
              {importing ? 'IMPORT EN COURS…' : done ? '✓ IMPORT TERMINÉ' : `IMPORTER ${Object.entries(mapping).filter(([,v])=>v!=='ignore'&&v!=='').length} COLONNES`}
            </button>
            {done && (
              <button
                onClick={() => { setUploadResult(null); setLogs([]); setDone(false); }}
                style={{ padding: '8px 14px', borderRadius: 2, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontFamily: fMichroma, fontSize: 8, letterSpacing: '0.1em', cursor: 'pointer' }}
              >
                NOUVEAU FICHIER
              </button>
            )}
          </div>
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div ref={logRef} style={{ background: '#020205', border: `1px solid ${C.border}`, borderRadius: 2, padding: '10px 14px', height: 180, overflowY: 'auto' }}>
          {logs.map((l, i) => (
            <div key={i} style={{ fontFamily: fMono, fontSize: 9, lineHeight: 1.7, color: l.kind === 'error' ? C.red : l.kind === 'success' ? C.green : C.textSec }}>
              {l.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Import IRIS INSEE ──────────────────────────────────────────────────────────

interface IImportHistoryEntry {
  id:            string;
  created_at:    string;
  filename:      string;
  total_rows:    number;
  inserted_rows: number;
  updated_rows:  number;
  error_rows:    number;
  status:        'pending' | 'processing' | 'success' | 'partial' | 'error';
}

const HISTORY_STATUS_COLORS: Record<string, string> = {
  success: '#3dffa0', partial: '#fbbf24', error: '#f87171', processing: '#60a5fa', pending: '#6b7280',
};
const HISTORY_STATUS_LABELS: Record<string, string> = {
  success: '✓ OK', partial: '! Partiel', error: '✕ Erreur', processing: '⏳ En cours', pending: '○ Attente',
};

const IRIS_SOURCES = [
  { key: 'pop', label: 'POP', desc: "Population · tranches d'âge · CSP" },
  { key: 'men', label: 'MEN', desc: 'Ménages' },
  { key: 'dip', label: 'DIP', desc: 'Diplômes & formation' },
  { key: 'log', label: 'LOG', desc: 'Logement · propriétaires' },
  { key: 'act', label: 'ACT', desc: 'Activité · chômage' },
] as const;

type IrisSourceKey = typeof IRIS_SOURCES[number]['key'];
type RunPhase = 'idle' | 'running' | 'done' | 'error';

interface LogLine { time: string; source?: string; msg: string; kind: 'log' | 'error' | 'success' }
interface SourceStatus { phase: 'waiting' | 'running' | 'done' | 'error'; count?: number }

function IrisInseeImportTab() {
  const [selected,    setSelected]    = useState<Set<IrisSourceKey>>(new Set(['pop','men','dip','log','act']));
  const [year,        setYear]        = useState('2022');
  const [dept,        setDept]        = useState('');
  const [dryRun,      setDryRun]      = useState(false);
  const [phase,       setPhase]       = useState<RunPhase>('idle');
  const [lines,       setLines]       = useState<LogLine[]>([]);
  const [progress,    setProgress]    = useState({ done: 0, total: 0 });
  const [srcStatus,   setSrcStatus]   = useState<Record<string, SourceStatus>>({});
  const [history,     setHistory]     = useState<IImportHistoryEntry[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const logRef   = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLine = (source: string | undefined, msg: string, kind: LogLine['kind'] = 'log') => {
    const time = new Date().toLocaleTimeString('fr-FR');
    setLines(prev => [...prev.slice(-299), { time, source, msg, kind }]);
  };

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await adminFetch('/api/iris-crawler/import-history');
      if (res.ok) {
        const data = await res.json() as { entries: IImportHistoryEntry[] };
        setHistory(data.entries);
      }
    } catch { /* silent */ } finally { setHistLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const toggleSource = (key: IrisSourceKey) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleRun = async () => {
    if (phase === 'running') { abortRef.current?.abort(); setPhase('idle'); return; }
    setPhase('running');
    setLines([]);
    setProgress({ done: 0, total: 0 });
    setSrcStatus({});

    const sources = [...selected];
    const initStatus: Record<string, SourceStatus> = {};
    sources.forEach(s => { initStatus[s] = { phase: 'waiting' }; });
    setSrcStatus(initStatus);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await adminFetch('/api/iris-import/insee', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sources, year, dept: dept.trim() || undefined, dryRun }),
        signal:  ctrl.signal,
      });

      if (!resp.ok) {
        const err = await resp.json() as { error?: string };
        addLine(undefined, err.error ?? `HTTP ${resp.status}`, 'error');
        setPhase('error');
        return;
      }

      const reader  = resp.body!.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n');
        buf = chunks.pop() ?? '';

        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(chunk); } catch { continue; }

          const type = evt.type as string;
          if (type === 'log') {
            const src = evt.source as string | undefined;
            if (src) setSrcStatus(p => ({ ...p, [src]: { ...p[src], phase: 'running' } }));
            addLine(src, evt.message as string, 'log');
          }
          if (type === 'error') {
            const src = evt.source as string | undefined;
            if (src) setSrcStatus(p => ({ ...p, [src]: { ...p[src], phase: 'error' } }));
            addLine(src, evt.message as string, 'error');
          }
          if (type === 'source_done') {
            const src = evt.source as string;
            setSrcStatus(p => ({ ...p, [src]: { phase: 'done', count: evt.count as number } }));
          }
          if (type === 'progress') {
            setProgress({ done: evt.done as number, total: evt.total as number });
          }
          if (type === 'done') {
            const total = evt.total as number;
            const dry   = evt.dryRun as boolean;
            addLine(undefined, `✓ ${total.toLocaleString('fr-FR')} IRIS${dry ? ' [DRY RUN — aucune écriture]' : ' mis à jour'}`, 'success');
            setPhase('done');
            if (!dry) loadHistory();
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        addLine(undefined, 'Import annulé', 'log');
        setPhase('idle');
      } else {
        addLine(undefined, String(e), 'error');
        setPhase('error');
      }
    }
  };

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Titre ─────────────────────────────────────────────────────────── */}
      <div>
        <h1 style={{ fontFamily: fOrbitron, fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', margin: 0, color: C.text }}>
          Import IRIS INSEE
        </h1>
        <p style={{ fontFamily: fMono, fontSize: 10, color: C.textDim, margin: '6px 0 0', letterSpacing: '0.04em' }}>
          Données démographiques INSEE · téléchargement automatique · ~51 000 IRIS · France métropolitaine
        </p>
      </div>

      {/* ── Panneau principal ─────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>

        {/* Sources */}
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: '14px 18px' }}>
          <div style={{ fontFamily: fMichroma, fontSize: 8, color: C.textSec, letterSpacing: '0.14em', marginBottom: 12 }}>
            SOURCES À IMPORTER
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {IRIS_SOURCES.map(src => {
              const st  = srcStatus[src.key];
              const sel = selected.has(src.key);
              const statusColor = st?.phase === 'done' ? C.green : st?.phase === 'error' ? C.red : st?.phase === 'running' ? C.warn : C.textSec;
              return (
                <label key={src.key} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={() => toggleSource(src.key)}
                    disabled={phase === 'running'}
                    style={{ accentColor: C.accent, cursor: 'pointer', width: 13, height: 13 }}
                  />
                  <span style={{ fontFamily: fMono, fontSize: 10, fontWeight: 700, color: sel ? C.accent : C.muted, width: 36, letterSpacing: '0.06em' }}>
                    {src.label}
                  </span>
                  <span style={{ fontFamily: fInter, fontSize: 11, color: sel ? C.text : C.textSec, flex: 1 }}>
                    {src.desc}
                  </span>
                  {st && (
                    <span style={{ fontFamily: fMono, fontSize: 8, color: statusColor, letterSpacing: '0.05em' }}>
                      {st.phase === 'done'    ? `✓ ${(st.count ?? 0).toLocaleString('fr-FR')} IRIS`
                       : st.phase === 'error'   ? '✕ erreur'
                       : st.phase === 'running' ? '⏳ …'
                       : '○ attente'}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* Config */}
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: fMichroma, fontSize: 8, color: C.textSec, letterSpacing: '0.12em' }}>MILLÉSIME</span>
            <select
              value={year}
              onChange={e => setYear(e.target.value)}
              disabled={phase === 'running'}
              style={{ background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 2, padding: '4px 8px', fontFamily: fMono, fontSize: 10, color: C.text, outline: 'none', cursor: 'pointer' }}
            >
              <option value="2022">2022</option>
              <option value="2021">2021</option>
              <option value="2020">2020</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: fMichroma, fontSize: 8, color: C.textSec, letterSpacing: '0.12em' }}>DÉPARTEMENT</span>
            <input
              type="text"
              value={dept}
              onChange={e => setDept(e.target.value)}
              disabled={phase === 'running'}
              placeholder="tous"
              maxLength={3}
              style={{ background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 2, padding: '4px 8px', fontFamily: fMono, fontSize: 10, color: C.text, outline: 'none', width: 60 }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={e => setDryRun(e.target.checked)}
              disabled={phase === 'running'}
              style={{ accentColor: C.warn, cursor: 'pointer' }}
            />
            <span style={{ fontFamily: fMichroma, fontSize: 8, color: dryRun ? C.warn : C.textSec, letterSpacing: '0.1em' }}>DRY RUN</span>
          </label>
        </div>

        {/* Action */}
        <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleRun}
            disabled={selected.size === 0}
            style={{
              background: phase === 'running' ? C.redDim : C.accentDim,
              border: `1px solid ${phase === 'running' ? 'rgba(248,113,113,0.4)' : C.borderLight}`,
              borderRadius: 2, padding: '8px 20px', cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
              fontFamily: fMichroma, fontSize: 9, letterSpacing: '0.12em',
              color: phase === 'running' ? C.red : C.accent,
            }}
          >
            {phase === 'running'
              ? '✕ ANNULER'
              : phase === 'done'
              ? '\u21ba RELANCER'
              : `\u2b07 LANCER L'IMPORT${dryRun ? ' (DRY RUN)' : ''}`}
          </button>

          {phase === 'running' && progress.total > 0 && (
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.textDim }}>
              {pct}% · {progress.done.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')} IRIS
            </span>
          )}
          {phase === 'done' && (
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.green }}>✓ Import terminé</span>
          )}
          {phase === 'error' && (
            <span style={{ fontFamily: fMono, fontSize: 9, color: C.red }}>✕ Erreur — voir le log</span>
          )}
        </div>

        {/* Barre de progression */}
        {(phase === 'running' || phase === 'done') && progress.total > 0 && (
          <div style={{ padding: '0 18px 12px' }}>
            <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: phase === 'done' ? C.green : C.accent,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Log ───────────────────────────────────────────────────────────── */}
      {lines.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ background: C.bgElevated, borderBottom: `1px solid ${C.border}`, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: fMichroma, fontSize: 8, color: C.textSec, letterSpacing: '0.14em' }}>LOG</span>
            <span style={{ fontFamily: fMono, fontSize: 8, color: C.muted }}>{lines.length} lignes</span>
            <button onClick={() => setLines([])} style={btnSmall(C.muted, 'transparent', C.border)}>✕ Vider</button>
          </div>
          <div
            ref={logRef}
            style={{ background: '#020205', maxHeight: 280, overflowY: 'auto', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            {lines.map((l, i) => (
              <div key={i} style={{ fontFamily: fMono, fontSize: 9, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                color: l.kind === 'error' ? C.red : l.kind === 'success' ? C.green : C.textSec }}>
                <span style={{ color: C.muted, marginRight: 6 }}>{l.time}</span>
                {l.source && <span style={{ color: C.accent, marginRight: 6 }}>[{l.source}]</span>}
                {l.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Historique ────────────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ background: C.bgElevated, borderBottom: `1px solid ${C.border}`, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: fMichroma, fontSize: 8, color: C.textDim, letterSpacing: '0.14em' }}>HISTORIQUE DES IMPORTS</span>
          <button onClick={loadHistory} disabled={histLoading} style={btnSmall(C.textSec, 'transparent', C.border)}>
            {histLoading ? '…' : '↻'}
          </button>
        </div>
        {history.length === 0 && !histLoading ? (
          <div style={{ padding: '20px', fontFamily: fMono, fontSize: 9, color: C.textSec }}>Aucun import pour l'instant</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 9, fontFamily: fMono }}>
              <thead>
                <tr style={{ background: '#0d0d18' }}>
                  {['DATE', 'FICHIER', 'TOTAL', 'INSÉRÉES', 'ERREURS', 'STATUT'].map(h => (
                    <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontFamily: fMichroma, fontSize: 7, letterSpacing: '0.1em', color: C.textDim, borderBottom: `1px solid ${C.border}`, fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((entry, i) => (
                  <tr key={entry.id} style={{ background: i % 2 === 0 ? C.bg : C.bgRow, borderBottom: `1px solid rgba(38,26,53,0.4)` }}>
                    <td style={{ padding: '5px 12px', color: C.textSec, whiteSpace: 'nowrap' }}>{fmtDate(entry.created_at)}</td>
                    <td style={{ padding: '5px 12px', color: C.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.filename}</td>
                    <td style={{ padding: '5px 12px', color: C.textDim }}>{entry.total_rows.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '5px 12px', color: C.green }}>{entry.inserted_rows.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '5px 12px', color: entry.error_rows > 0 ? C.red : C.muted }}>{entry.error_rows > 0 ? entry.error_rows : '—'}</td>
                    <td style={{ padding: '5px 12px' }}>
                      <span style={{ fontFamily: fMono, fontSize: 8, color: HISTORY_STATUS_COLORS[entry.status] ?? C.textSec }}>
                        {HISTORY_STATUS_LABELS[entry.status] ?? entry.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}



// ── Style helpers ─────────────────────────────────────────────────────────────
function btnStyle(color: string, bg: string, border: string): React.CSSProperties {
  return {
    background: bg, border: `1px solid ${border}`, borderRadius: 2,
    color, padding: '5px 12px', cursor: 'pointer',
    fontFamily: "'Michroma', sans-serif", fontSize: 8, letterSpacing: '0.1em',
    textTransform: 'uppercase', whiteSpace: 'nowrap',
  };
}

function btnSmall(color: string, bg: string, border: string): React.CSSProperties {
  return {
    background: bg, border: `1px solid ${border}`, borderRadius: 2,
    color, padding: '3px 8px', cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace", fontSize: 8, whiteSpace: 'nowrap',
  };
}

function gridRow(bg: string): React.CSSProperties {
  return { display: 'flex', alignItems: 'stretch', background: bg };
}

function ColHead({ w, flex, children }: { w?: number; flex?: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      width: w, flex: flex ? 1 : undefined, flexShrink: 0,
      padding: '7px 12px', fontFamily: "'Michroma', sans-serif",
      fontSize: 7, letterSpacing: '0.12em', color: '#6b7280',
      borderRight: '1px solid #261a35', textTransform: 'uppercase',
    }}>
      {children}
    </div>
  );
}
