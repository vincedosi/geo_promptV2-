'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { IRIS_CATALOG } from '@/lib/iris-crawler/catalog';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/iris-crawler/types';
import type {
  CatalogStatus, DiscoverResponse, PreviewResponse,
  DownloadStreamEvent, IrisCatalogCategory,
} from '@/lib/iris-crawler/types';

// ── Design tokens (GEO.PROMPT terminal dark) ─────────────────────────────────
const C = {
  bg:          '#050505',
  bgElevated:  '#0d0d0d',
  bgSurface:   '#111118',
  bgRow:       '#0a0a10',
  border:      '#261a35',
  borderLight: 'rgba(168,85,247,0.2)',
  accent:      '#a855f7',
  accentDim:   'rgba(168,85,247,0.12)',
  text:        '#e2e8f0',
  textDim:     '#94a3b8',
  textSec:     '#6b7280',
  muted:       '#4b5563',
  green:       '#3dffa0',
  greenDim:    'rgba(61,255,160,0.10)',
  red:         '#f87171',
  redDim:      'rgba(248,113,113,0.10)',
  warn:        '#fbbf24',
  warnDim:     'rgba(251,191,36,0.10)',
  blue:        '#60a5fa',
  blueDim:     'rgba(96,165,250,0.10)',
} as const;
const fOrbitron = "'Orbitron', sans-serif";
const fMichroma = "'Michroma', 'Orbitron', sans-serif";
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
    }]))
  );
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
            if (event.type === 'status') log(`  ${catalogId} : ${event.message}`);
            if (event.type === 'error') {
              log(`! ${catalogId} : ${event.message}`);
              setEntryStates(prev => ({
                ...prev,
                [catalogId]: { ...prev[catalogId], downloadError: event.message },
              }));
            }
            if (event.type === 'done') {
              log(`✓ ${catalogId} terminé — ${event.message}`);
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

      <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>

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

                    {/* Upload Supabase (stub) */}
                    {hasDl && (
                      <button
                        disabled
                        title="Schéma de mapping à définir"
                        style={{ ...btnSmall(C.muted, 'transparent', 'rgba(75,85,99,0.2)'), cursor: 'not-allowed', opacity: 0.5 }}>
                        ↑ Supabase
                      </button>
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
