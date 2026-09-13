'use client';

/**
 * MAGELIAN — Overlay "Zones sauvegardées" dans la barre latérale /map.
 *
 * Phase 2 : liste + recherche + filtre par source_type, header avec stats.
 * Phase 3 : clic "Afficher" → fetch geometry + addLayer MapLibre teal + fitBounds.
 * Phase 4 : multi-zones (palette teal/cyan/emerald), Masquer, Supprimer (dialog).
 *
 * Design : OverlayPanel-friendly, dark minimal, teal #4ecdc4.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { Search, X, Eye, EyeOff, Trash2, FileDown, Music2 } from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import { adminFetch } from '@/lib/admin-fetch';
import { getSourceTypeLabel } from '@/lib/custom-geo/source-type-labels';
import { downloadZoneExport } from '@/lib/custom-geo/download-export';
import { ZoneDeleteDialog } from '@/app/map/custom-geo/_components/ZoneDeleteDialog';
import type { CustomGeoZoneSummary } from '@/types/custom-geo';
import { ZonesOperations } from './ZonesOperations';

interface Props {
  mapRef: React.MutableRefObject<MaplibreMap | null>;
  /** Notifie le parent des zones actuellement affichées sur la carte (plan média). */
  onLoadedZonesChange?: (zones: Array<{ id: string; name: string }>) => void;
}

interface ZonesStats {
  total: number;
  total_iris: number;
  total_cp: number;
}

interface LoadedZone {
  id: string;
  name: string;
  color: string;
  bbox: [number, number, number, number] | null;
}

const fInter = "'Inter', system-ui, sans-serif";
const fMono  = "'JetBrains Mono', monospace";

// Palette pour multi-zones (teal/cyan/emerald)
const ZONE_PALETTE = ['#4ecdc4', '#5cc8e0', '#4adfb8', '#7ed6df', '#26c6da'] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function bboxFromGeometry(geom: GeoJSON.Geometry): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      const [x, y] = c as [number, number];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      return;
    }
    c.forEach(walk);
  };
  if ('coordinates' in geom) walk(geom.coordinates as unknown);
  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

const sourceIdOf = (zoneId: string) => `custom-zone-${zoneId}`;
const fillIdOf   = (zoneId: string) => `custom-zone-fill-${zoneId}`;
const lineIdOf   = (zoneId: string) => `custom-zone-line-${zoneId}`;

// ─── Composant principal ──────────────────────────────────────────────────

export function ZonesOverlay({ mapRef, onLoadedZonesChange }: Props) {
  const { session, isLoading: sessionLoading } = useSession();
  const orgId = session?.user?.organizationId ?? '';

  const [zones, setZones] = useState<CustomGeoZoneSummary[]>([]);
  // Selection pour les operations booleennes (Tache 14). TABLEAU et non Set :
  // l'ordre de cochage designe la base de la soustraction, qui n'est pas
  // symetrique — un Set perdrait cette information.
  const [selection, setSelection] = useState<string[]>([]);
  const [stats, setStats] = useState<ZonesStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string | null>(null);

  // Map<zoneId, LoadedZone> — sources de vérité de ce qui est sur la carte
  const [loadedZones, setLoadedZones] = useState<Map<string, LoadedZone>>(new Map());

  // État UI : zone en cours de fetch / suppression
  const [pendingZoneId, setPendingZoneId] = useState<string | null>(null);
  const [zoneToDelete, setZoneToDelete] = useState<CustomGeoZoneSummary | null>(null);

  // Remonte au parent la liste des zones affichées (déclenche le plan média)
  useEffect(() => {
    onLoadedZonesChange?.([...loadedZones.values()].map(z => ({ id: z.id, name: z.name })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedZones]);

  // ── Réconciliation au montage : l'overlay se démonte à chaque fermeture,
  // mais les couches custom-zone-* restent sur la carte. On reconstruit
  // loadedZones depuis le style MapLibre pour que Masquer/Afficher et le
  // plan média restent synchrones après réouverture de l'overlay.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const style = map.getStyle();
      const recovered = new Map<string, LoadedZone>();
      for (const [sourceId, source] of Object.entries(style.sources ?? {})) {
        if (!sourceId.startsWith('custom-zone-') || (source as { type?: string }).type !== 'geojson') continue;
        const zoneId = sourceId.slice('custom-zone-'.length);
        if (!map.getLayer(fillIdOf(zoneId))) continue; // source orpheline (tout effacer)
        const data = (source as { data?: GeoJSON.Feature }).data;
        const name = (data?.properties as { name?: string } | undefined)?.name ?? zoneId;
        const paint = map.getPaintProperty(fillIdOf(zoneId), 'fill-color');
        const color = typeof paint === 'string' ? paint : ZONE_PALETTE[recovered.size % ZONE_PALETTE.length];
        const bbox = data?.geometry ? bboxFromGeometry(data.geometry) : null;
        recovered.set(zoneId, { id: zoneId, name, color, bbox });
      }
      if (recovered.size) setLoadedZones(recovered);
    } catch { /* style pas encore prêt — l'état repart à vide comme avant */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch list + stats ────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ org_id: orgId, _t: String(Date.now()) });
      if (sourceTypeFilter) sp.set('source_type', sourceTypeFilter);
      if (searchQuery) sp.set('q', searchQuery);
      const [listRes, statsRes] = await Promise.all([
        adminFetch(`/api/custom-geo/list?${sp}`, { cache: 'no-store' }),
        adminFetch(`/api/custom-geo/stats?org_id=${orgId}&_t=${Date.now()}`, { cache: 'no-store' }),
      ]);
      if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
      const listData = await listRes.json();
      setZones(listData.zones ?? []);
      if (statsRes.ok) {
        const s = await statsRes.json();
        setStats({
          total: s.total ?? 0,
          total_iris: s.total_iris ?? 0,
          total_cp: s.total_cp ?? 0,
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [orgId, sourceTypeFilter, searchQuery]);

  // Initial fetch + debounce sur recherche
  useEffect(() => {
    const t = setTimeout(fetchAll, searchQuery ? 200 : 0);
    return () => clearTimeout(t);
  }, [fetchAll, searchQuery]);

  // ── Source types disponibles (pour le filtre dropdown) ────────────────
  const availableSourceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const z of zones) set.add(z.source_type);
    return Array.from(set).sort();
  }, [zones]);

  // ── Affichage carte : addSource + 2 layers ───────────────────────────
  const showZoneOnMap = useCallback(async (zone: CustomGeoZoneSummary) => {
    const map = mapRef.current;
    if (!map) return;
    if (loadedZones.has(zone.id)) return; // déjà affichée
    setPendingZoneId(zone.id);
    try {
      const res = await adminFetch(`/api/custom-geo/${zone.id}/geometry`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const feature = await res.json() as { type: 'Feature'; geometry: GeoJSON.Geometry; properties?: Record<string, unknown> };

      // Couleur : prochaine dans la palette en cycle
      const color = ZONE_PALETTE[loadedZones.size % ZONE_PALETTE.length];

      const sourceId = sourceIdOf(zone.id);
      const fillId   = fillIdOf(zone.id);
      const lineId   = lineIdOf(zone.id);

      // Cleanup défensif si reste d'un précédent affichage
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: { name: zone.name, source_type: zone.source_type, ...feature.properties },
          geometry: feature.geometry,
        },
      });
      map.addLayer({
        id: fillId, type: 'fill', source: sourceId,
        paint: { 'fill-color': color, 'fill-opacity': 0.25 },
      });
      map.addLayer({
        id: lineId, type: 'line', source: sourceId,
        paint: { 'line-color': color, 'line-width': 2.5 },
      });

      // Bbox pour zoom
      const bbox = zone.bbox && zone.bbox.length === 4 ? zone.bbox : bboxFromGeometry(feature.geometry);
      if (bbox) {
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 50, duration: 800 });
      }

      setLoadedZones(prev => {
        const next = new Map(prev);
        next.set(zone.id, { id: zone.id, name: zone.name, color, bbox });
        return next;
      });
    } catch (e: unknown) {
      console.error('[ZonesOverlay] showZoneOnMap', e);
      setError(e instanceof Error ? e.message : 'Erreur affichage zone');
    } finally {
      setPendingZoneId(null);
    }
  }, [mapRef, loadedZones]);

  const hideZoneFromMap = useCallback((zoneId: string) => {
    const map = mapRef.current;
    if (!map) return;
    const fillId = fillIdOf(zoneId);
    const lineId = lineIdOf(zoneId);
    const sourceId = sourceIdOf(zoneId);
    if (map.getLayer(fillId)) map.removeLayer(fillId);
    if (map.getLayer(lineId)) map.removeLayer(lineId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    setLoadedZones(prev => {
      const next = new Map(prev);
      next.delete(zoneId);
      return next;
    });
  }, [mapRef]);

  // Cleanup au unmount : retire toutes les zones de la carte
  useEffect(() => {
    return () => {
      // ATTENTION — cette cleanup capture le `loadedZones` du premier render
      // (deps []), donc elle n'itere jamais rien : les zones affichees restent
      // sur la carte apres fermeture de l'overlay. Comportement actuel en prod,
      // laisse tel quel : le corriger ferait disparaitre les zones a la
      // fermeture, ce qui est une decision produit, pas un correctif de lint.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- voir ci-dessus
      const map = mapRef.current;
      if (!map) return;
      for (const id of loadedZones.keys()) {
        const fillId = fillIdOf(id);
        const lineId = lineIdOf(id);
        const sourceId = sourceIdOf(id);
        if (map.getLayer(fillId)) map.removeLayer(fillId);
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Suppression zone ──────────────────────────────────────────────────
  const handleDelete = useCallback(async (zone: CustomGeoZoneSummary) => {
    const res = await adminFetch(`/api/custom-geo/${zone.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Si la zone était affichée → retirer de la carte
    if (loadedZones.has(zone.id)) hideZoneFromMap(zone.id);
    setZoneToDelete(null);
    fetchAll();
  }, [loadedZones, hideZoneFromMap, fetchAll]);

  // ── Loading / no-org states ───────────────────────────────────────────
  if (sessionLoading) {
    return <div style={padded}>Chargement…</div>;
  }
  if (!orgId) {
    return <div style={padded}>Aucun workspace actif.</div>;
  }

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px 16px', fontFamily: fInter }}>

      {/* Header stats */}
      {stats && (
        <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-tertiary)' }}>
          <span>
            <strong style={{ color: 'var(--text-primary)', fontFamily: fMono }}>{stats.total}</strong> zone{stats.total > 1 ? 's' : ''}
          </span>
          <span>
            <strong style={{ color: 'var(--brand-teal)', fontFamily: fMono }}>{stats.total_iris.toLocaleString('fr-FR')}</strong> IRIS
          </span>
          <span>
            <strong style={{ fontFamily: fMono }}>{stats.total_cp.toLocaleString('fr-FR')}</strong> CP
          </span>
        </div>
      )}

      {/* Search bar */}
      <div style={{ position: 'relative' }}>
        <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Rechercher…"
          style={{
            width: '100%', padding: '6px 26px 6px 26px', borderRadius: 6,
            background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
            color: 'var(--text-primary)', fontFamily: fInter, fontSize: 12, outline: 'none',
          }}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex',
          }}><X size={11} /></button>
        )}
      </div>

      {/* Filter by source_type */}
      {availableSourceTypes.length > 1 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <FilterChip
            label="Tous"
            active={sourceTypeFilter === null}
            onClick={() => setSourceTypeFilter(null)}
          />
          {availableSourceTypes.map(st => (
            <FilterChip
              key={st}
              label={getSourceTypeLabel(st).label}
              isMono={!getSourceTypeLabel(st).isReadable}
              active={sourceTypeFilter === st}
              onClick={() => setSourceTypeFilter(st)}
            />
          ))}
        </div>
      )}

      {/* Liste zones / loading / empty / error */}
      {error && (
        <div style={{ fontSize: 11, color: 'var(--danger)', padding: 8, background: 'rgba(255,87,87,0.08)', borderRadius: 4 }}>
          {error}
        </div>
      )}
      {loading && zones.length === 0 && (
        <div style={padded}>Chargement…</div>
      )}
      {!loading && zones.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '12px 4px', lineHeight: 1.6 }}>
          Aucune zone sauvegardée. Utilise le bouton « Sauvegarder la vue » pour créer ta première zone.
        </div>
      )}
      <ZonesOperations
        selection={selection}
        nomsParId={new Map(zones.map(z => [z.id, z.name]))}
        orgId={orgId}
        onTermine={() => { setSelection([]); void fetchAll(); }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {zones.map(zone => (
          <ZoneCard
            key={zone.id}
            zone={zone}
            loaded={loadedZones.get(zone.id) ?? null}
            pending={pendingZoneId === zone.id}
            onShow={() => showZoneOnMap(zone)}
            onHide={() => hideZoneFromMap(zone.id)}
            onDelete={() => setZoneToDelete(zone)}
            rangSelection={selection.indexOf(zone.id)}
            onBasculerSelection={() => setSelection(prev => (
              prev.includes(zone.id) ? prev.filter(id => id !== zone.id) : [...prev, zone.id]
            ))}
          />
        ))}
      </div>

      {/* Delete dialog */}
      {zoneToDelete && (
        <ZoneDeleteDialog
          zoneName={zoneToDelete.name}
          onConfirm={() => handleDelete(zoneToDelete)}
          onClose={() => setZoneToDelete(null)}
        />
      )}
    </div>
  );
}

// ─── ZoneCard ─────────────────────────────────────────────────────────────

function ZoneCard({
  zone, loaded, pending, onShow, onHide, onDelete, rangSelection, onBasculerSelection,
}: {
  zone: CustomGeoZoneSummary;
  loaded: LoadedZone | null;
  pending: boolean;
  onShow: () => void;
  onHide: () => void;
  onDelete: () => void;
  /** Position dans la selection (0 = base d'une soustraction), -1 si non cochee. */
  rangSelection: number;
  onBasculerSelection: () => void;
}) {
  const sourceLabel = getSourceTypeLabel(zone.source_type);
  const dept = zone.dept_codes ?? [];
  const region = zone.region_codes ?? [];

  return (
    <div style={{
      padding: 10,
      background: 'var(--bg-level-2)',
      border: `0.5px solid ${loaded ? loaded.color : 'var(--border-subtle)'}`,
      borderRadius: 8,
      display: 'flex', flexDirection: 'column', gap: 6,
      transition: 'border-color 150ms var(--ease-hover)',
    }}>
      {/* Title + status dot — la case a cocher precede le titre : elle sert les
          operations booleennes (Tache 14), et son RANG est affiche parce que
          l'ordre de cochage designe la base d'une soustraction. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={rangSelection >= 0}
            onChange={onBasculerSelection}
            aria-label={`Selectionner ${zone.name} pour une operation`}
            style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
          />
          {rangSelection >= 0 && (
            <span style={{
              fontFamily: fMono, fontSize: 9, color: 'var(--brand-teal)',
              minWidth: 10, textAlign: 'center',
            }}>{rangSelection + 1}</span>
          )}
        </label>
        {loaded && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: loaded.color, flexShrink: 0,
          }} />
        )}
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {zone.name}
        </span>
      </div>

      {/* Source type + counts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
        <span style={{
          padding: '1px 6px', borderRadius: 3,
          background: 'var(--bg-level-2)', color: 'var(--text-secondary)',
          fontFamily: sourceLabel.isReadable ? fInter : fMono, fontSize: 9,
        }}>
          {sourceLabel.label}
        </span>
        <span style={{ color: 'var(--text-tertiary)', fontFamily: fMono }}>
          {zone.feature_count_iris} IRIS · {zone.feature_count_cp} CP
        </span>
      </div>

      {/* Dept + Region */}
      {(dept.length > 0 || region.length > 0) && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {dept.length > 0 && (
            <span><span style={{ color: 'var(--text-secondary)' }}>Dept:</span> <span style={{ fontFamily: fMono }}>{dept.join(', ')}</span></span>
          )}
          {dept.length > 0 && region.length > 0 && <span style={{ margin: '0 6px' }}>·</span>}
          {region.length > 0 && (
            <span><span style={{ color: 'var(--text-secondary)' }}>Région:</span> <span style={{ fontFamily: fMono }}>{region.join(', ')}</span></span>
          )}
        </div>
      )}

      {/* Date */}
      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: fMono }}>
        {fmtDate(zone.created_at)}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {loaded ? (
          <button
            onClick={onHide}
            style={ghostBtn('var(--text-secondary)')}
          >
            <EyeOff size={11} /> Masquer
          </button>
        ) : (
          <button
            onClick={onShow}
            disabled={pending}
            style={{
              ...ghostBtn('var(--brand-teal)'),
              border: '0.5px solid var(--brand-teal)',
              color: 'var(--brand-teal)',
              cursor: pending ? 'wait' : 'pointer',
              opacity: pending ? 0.6 : 1,
            }}
          >
            <Eye size={11} /> {pending ? 'Chargement…' : 'Afficher'}
          </button>
        )}
        <button
          onClick={() => { void downloadZoneExport(zone.id, 'bidding_script').catch(err => console.error('[ZonesOverlay] export', err)); }}
          title="Générer le script custom bidding DV360 (fichier à coller dans DV360)"
          style={{
            ...ghostBtn('var(--brand-teal)'),
            padding: '4px 8px', flex: 'none',
            border: '0.5px solid var(--brand-teal)',
          }}
        >
          <FileDown size={11} />
        </button>
        <button
          onClick={() => { void downloadZoneExport(zone.id, 'tiktok_geo').catch(err => console.error('[ZonesOverlay] export', err)); }}
          title="Exporter le ciblage géo TikTok Ads (régions + départements de la zone)"
          style={{
            ...ghostBtn('var(--text-secondary)'),
            padding: '4px 8px', flex: 'none',
          }}
        >
          <Music2 size={11} />
        </button>
        <button
          onClick={onDelete}
          title="Supprimer la zone"
          style={{
            ...ghostBtn('var(--text-tertiary)'),
            padding: '4px 8px',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.borderColor = 'rgba(255,87,87,0.3)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

// ─── FilterChip ───────────────────────────────────────────────────────────

function FilterChip({ label, active, onClick, isMono }: { label: string; active: boolean; onClick: () => void; isMono?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px', borderRadius: 4,
        background: active ? 'rgba(78,205,196,0.1)' : 'transparent',
        border: `0.5px solid ${active ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
        color: active ? 'var(--brand-teal)' : 'var(--text-tertiary)',
        fontFamily: isMono ? fMono : fInter, fontSize: 10,
        cursor: 'pointer',
        transition: 'all 150ms var(--ease-hover)',
      }}
    >{label}</button>
  );
}

// ─── Styles partagés ──────────────────────────────────────────────────────

const padded: React.CSSProperties = {
  padding: 16, fontSize: 12, color: 'var(--text-tertiary)', fontFamily: fInter,
};

const ghostBtn = (color: string): React.CSSProperties => ({
  flex: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '5px 8px', borderRadius: 4,
  background: 'transparent',
  border: '0.5px solid var(--border-subtle)',
  color, fontFamily: fInter, fontSize: 10,
  cursor: 'pointer',
  transition: 'all 150ms var(--ease-hover)',
});
