'use client';

/**
 * SuiviDeriveMap — carte de dérive du sous-onglet Suivi (spec 2026-07-24).
 *
 * Carte MapLibre EMBARQUÉE dans un panneau (pas la carte /map) : fond plein
 * sombre + fills GeoJSON uniquement, ZÉRO tuile externe (fond propre pour
 * l'export PNG de la Task 7, zéro I/O tuiles Nano). `preserveDrawingBuffer:
 * true` est actif dès l'init pour permettre `map.getCanvas().toDataURL()`
 * plus tard sans recréer la carte.
 *
 * Seul un changement de maille / score / acteurs déclenche un appel réseau
 * (débounce 300 ms, caché par `campaignId|mesh|metric|actorsKey(actors)` dans
 * un `useRef(Map)`, `AbortController` sur changement — cf. règles Nano). Le
 * CURSEUR DE SEUIL recolore la carte et recompte le compteur CÔTÉ CLIENT
 * (`setPaintProperty` + `countDecroche`), SANS refetch.
 *
 * Sous filtre acteur PARTIEL (`actors.length > 0`), l'option « Atteinte
 * absolue » est indisponible (la valeur lirait l'objectif global, trompeuse
 * en contribution — même règle que SuiviTable/SuiviMapLayer).
 */
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { adminFetch } from '@/lib/admin-fetch';
import {
  actorsKey, countDecroche, meshLabel,
  type DeriveFeature, type DeriveMesh, type DeriveMetric,
} from '@/lib/campaigns/derive-metrics';
import { MeshSelector } from './MeshSelector';
import { DeriveTable } from './DeriveTable';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const SOURCE_ID = 'derive-src';
const FILL_ID = 'derive-fill';
const LINE_ID = 'derive-line';
const TRANSPARENT = 'rgba(0,0,0,0)';

type Tone = { ok: string; warn: string; bad: string; teal: string };

/** Couleurs lues des tokens CSS au runtime (MapLibre ne résout pas var()) —
 *  même pattern que `SuiviMapLayer.readToneColors`. Appelée uniquement côté
 *  client (effets / handlers), jamais au premier rendu serveur. */
function readTones(): Tone {
  const style = getComputedStyle(document.documentElement);
  return {
    ok: style.getPropertyValue('--success').trim() || '#3dffa0',
    warn: style.getPropertyValue('--warning').trim() || '#f7b731',
    bad: style.getPropertyValue('--danger').trim() || '#ff5757',
    teal: style.getPropertyValue('--brand-teal').trim() || '#4ecdc4',
  };
}

/** Expression divergente paramétrée par le seuil (verbatim du plan Task 6). */
function fillExpr(threshold: number): maplibregl.ExpressionSpecification {
  const c = readTones();
  const V: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'value'], -1];
  return ['case',
    ['<', V, 0], TRANSPARENT,
    ['<', V, threshold], c.bad,
    ['<', V, 100], c.warn,
    ['<=', V, 110], c.ok,
    c.teal];
}

/** Aplatit récursivement les coordonnées d'une géométrie GeoJSON (Polygon/MultiPolygon). */
function collectCoords(geom: GeoJSON.Geometry): [number, number][] {
  const out: [number, number][] = [];
  const walk = (arr: unknown): void => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    if (typeof arr[0] === 'number' && typeof arr[1] === 'number') {
      out.push([arr[0] as number, arr[1] as number]);
      return;
    }
    for (const item of arr) walk(item);
  };
  if ('coordinates' in geom) walk((geom as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates);
  return out;
}

interface DerivePayload {
  mesh: DeriveMesh; metric: DeriveMetric; headline: number | null; features: DeriveFeature[];
}

/** Mailles supportées par la RPC/route (le national n'a pas de géométrie dédiée —
 *  résolu à la région pour l'affichage carte, cf. commentaire dans l'effet de fetch). */
type FetchMesh = 'region' | 'departement' | 'cp';

const METRIC_OPTIONS: { key: DeriveMetric; label: string }[] = [
  { key: 'hold', label: 'Dérive relative' },
  { key: 'objectif', label: 'Atteinte absolue' },
];

export interface SuiviDeriveMapHandle {
  /** Recentre la carte sur une zone par code (mesh courante). Task 7 : clic ligne tableau. */
  flyToCode: (code: string) => void;
  /** Instance MapLibre sous-jacente — Task 7 : export PNG (`getCanvas().toDataURL()`). */
  getMap: () => maplibregl.Map | null;
}

export interface SuiviDeriveMapProps {
  campaignId: string;
  actors: string[];
}

export const SuiviDeriveMap = forwardRef<SuiviDeriveMapHandle, SuiviDeriveMapProps>(
  function SuiviDeriveMap({ campaignId, actors }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const mapReadyRef = useRef(false);

    const [mesh, setMesh] = useState<DeriveMesh>('departement');
    const [metric, setMetricState] = useState<DeriveMetric>('hold');
    const [threshold, setThreshold] = useState(80);
    const [features, setFeatures] = useState<DeriveFeature[]>([]);
    const [headline, setHeadline] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [tones, setTones] = useState<Tone | null>(null);

    const featureByCodeRef = useRef<Map<string, DeriveFeature>>(new Map());
    const cacheRef = useRef<Map<string, DerivePayload>>(new Map());
    const abortRef = useRef<AbortController | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const boundedMeshesRef = useRef<Set<DeriveMesh>>(new Set());

    const partialActors = actors.length > 0;
    const actorsK = actorsKey(actors);

    // Palette (client uniquement — évite getComputedStyle en SSR).
    useEffect(() => { setTones(readTones()); }, []);

    // Règle : sous filtre acteur partiel, « Atteinte absolue » indisponible.
    useEffect(() => {
      if (partialActors && metric === 'objectif') setMetricState('hold');
    }, [partialActors, metric]);

    const setMetric = useCallback((m: DeriveMetric) => {
      if (partialActors && m === 'objectif') return;
      setMetricState(m);
    }, [partialActors]);

    // Init carte MapLibre — une fois. Fond plein, aucune tuile externe.
    useEffect(() => {
      if (!containerRef.current || mapRef.current) return;
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#050505';
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {},
          layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }],
        },
        center: [2, 47],
        zoom: 4.4,
        attributionControl: false,
        // Export PNG (Task 7) : le buffer WebGL doit rester lisible après le rendu.
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
      mapRef.current = map;
      map.once('load', () => { mapReadyRef.current = true; });
      return () => {
        map.remove();
        mapRef.current = null;
        mapReadyRef.current = false;
        // Ref lue au demontage a dessein : on vide le cache des mailles deja
        // cadrees, quelle que soit l'instance de carte courante.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- voir ci-dessus
        boundedMeshesRef.current.clear();
      };
    }, []);

    // Fetch débouncé + caché — mesh/metric/actors seulement (JAMAIS le seuil).
    useEffect(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      // Le national n'a pas de granularité dédiée côté RPC (region|departement|cp
      // uniquement) : on résout à la région pour peupler la carte — le score de
      // tête (headline) reste le score national quelle que soit la maille demandée.
      const fetchMesh: FetchMesh = mesh === 'national' ? 'region' : mesh;
      const key = `${campaignId}|${fetchMesh}|${metric}|${actorsK}`;

      const cached = cacheRef.current.get(key);
      if (cached) {
        setFeatures(cached.features);
        setHeadline(cached.headline);
        return;
      }

      debounceRef.current = setTimeout(() => {
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        setLoading(true);
        const actorsQ = actors.length ? `&actors=${encodeURIComponent(actors.join(','))}` : '';
        adminFetch(
          `/api/digital/${campaignId}/derive/map?mesh=${fetchMesh}&metric=${metric}${actorsQ}`,
          { cache: 'no-store', signal: ac.signal },
        )
          .then((res) => (res.ok ? res.json() : null))
          .then((d: DerivePayload | null) => {
            if (ac.signal.aborted || !d) return;
            cacheRef.current.set(key, d);
            setFeatures(d.features ?? []);
            setHeadline(d.headline ?? null);
          })
          .catch((err: unknown) => {
            if ((err as { name?: string })?.name !== 'AbortError') {
              // Réseau instable : la carte garde le dernier état rendu, pas de crash.
            }
          })
          .finally(() => { if (!ac.signal.aborted) setLoading(false); });
      }, 300);

      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        abortRef.current?.abort();
      };
    }, [campaignId, mesh, metric, actors, actorsK]);

    // Rendu des features sur la carte (source/layers créés une fois, puis setData).
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      const apply = () => {
        const fc: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: features.map((f) => ({
            type: 'Feature',
            geometry: f.geometry,
            properties: { code: f.code, nom: f.nom, in_target: f.in_target, value: f.value },
          })),
        };
        const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(fc);
        } else {
          map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
          map.addLayer({
            id: FILL_ID, type: 'fill', source: SOURCE_ID,
            paint: { 'fill-color': fillExpr(threshold), 'fill-opacity': 0.6 },
          });
          map.addLayer({
            id: LINE_ID, type: 'line', source: SOURCE_ID,
            paint: { 'line-color': 'rgba(255,255,255,0.15)', 'line-width': 0.5 },
          });
        }

        featureByCodeRef.current = new Map(features.map((f) => [f.code, f]));

        // fitBounds sur l'enveloppe des features au premier chargement de cette maille.
        if (!boundedMeshesRef.current.has(mesh) && features.length) {
          const bounds = new maplibregl.LngLatBounds();
          let has = false;
          for (const f of features) {
            for (const c of collectCoords(f.geometry)) { bounds.extend(c); has = true; }
          }
          if (has) {
            map.fitBounds(bounds, { padding: 32, duration: 0 });
            boundedMeshesRef.current.add(mesh);
          }
        }
      };

      if (mapReadyRef.current) apply(); else map.once('load', apply);
    // `threshold` volontairement hors deps : le seuil recolore la carte via
    // l'effet suivant, sans refetch ni recadrage. L'inclure ici relancerait
    // un fitBounds a chaque cran de seuil.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- voir ci-dessus
    }, [features, mesh]);

    // Seuil : recolore la carte SANS refetch (fillExpr recalculée, pas d'appel réseau).
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapReadyRef.current || !map.getLayer(FILL_ID)) return;
      map.setPaintProperty(FILL_ID, 'fill-color', fillExpr(threshold));
    }, [threshold, tones]);

    const decrocheCount = useMemo(() => countDecroche(features, threshold), [features, threshold]);

    const flyToCode = useCallback((code: string) => {
      const map = mapRef.current;
      const feature = featureByCodeRef.current.get(code);
      if (!map || !feature) return;
      const coords = collectCoords(feature.geometry);
      if (!coords.length) return;
      const bounds = new maplibregl.LngLatBounds();
      coords.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds, { padding: 80, duration: 600, maxZoom: 9 });
    }, []);

    useImperativeHandle(ref, () => ({ flyToCode, getMap: () => mapRef.current }), [flyToCode]);

    // Export PNG (Task 7) — verbatim du plan : le buffer WebGL est préservé
    // (canvasContextAttributes.preserveDrawingBuffer posé à l'init, Task 6),
    // `once('render')` garantit un canvas à jour avant la capture.
    const exportPng = useCallback(() => {
      const map = mapRef.current;
      if (!map) return;
      map.once('render', () => {
        const url = map.getCanvas().toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `derive-${mesh}-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
      });
      map.triggerRepaint();
    }, [mesh]);

    const fetchMesh: FetchMesh = mesh === 'national' ? 'region' : mesh;
    const meshWord = fetchMesh === 'cp' ? 'CP' : meshLabel(fetchMesh).toLowerCase();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <MeshSelector mesh={mesh} onChange={setMesh} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {METRIC_OPTIONS.map((opt) => {
                const disabled = partialActors && opt.key === 'objectif';
                const active = metric === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => setMetric(opt.key)}
                    title={disabled ? 'Indisponible sous filtre acteur partiel' : undefined}
                    style={{
                      background: 'transparent', borderRadius: 6, padding: '6px 12px',
                      border: `0.5px solid ${active ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                      color: disabled ? 'var(--text-tertiary)' : (active ? 'var(--brand-teal)' : 'var(--text-secondary)'),
                      fontFamily: fInter, fontSize: 12, fontWeight: 500,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.5 : 1,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {headline != null && (
              <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}>
                Score national : <span style={{ color: 'var(--text-secondary)' }}>{headline} %</span>
              </span>
            )}
            {loading && (
              <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>chargement…</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
              Seuil de décrochage
            </span>
            <input
              type="range"
              min={50}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--brand-teal)' }}
              aria-label="Seuil de décrochage (%)"
            />
            <span style={{ fontFamily: fMono, fontSize: 12, color: 'var(--text-primary)', minWidth: 34, textAlign: 'right' }}>
              {threshold} %
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)' }}>
              {decrocheCount} {meshWord}{decrocheCount > 1 && mesh !== 'cp' ? 's' : ''} en dérive
              <span style={{ color: 'var(--text-tertiary)' }}> (&lt; {threshold} %)</span>
            </span>

            {tones && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {([
                  [tones.bad, `< ${threshold} %`],
                  [tones.warn, `${threshold}–100 %`],
                  [tones.ok, '100–110 %'],
                  [tones.teal, '> 110 %'],
                ] as [string, string][]).map(([color, label]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: color, display: 'inline-block' }} />
                    <span style={{ fontFamily: fMono, fontSize: 10.5, color: 'var(--text-tertiary)' }}>{label}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={exportPng}
              style={{
                background: 'transparent', border: '0.5px solid var(--brand-teal)',
                color: 'var(--brand-teal)', borderRadius: 6, padding: '5px 12px',
                fontFamily: fInter, fontSize: 11, fontWeight: 500, cursor: 'pointer',
              }}
            >
              Exporter en PNG
            </button>
          </div>
        </div>

        <div
          ref={containerRef}
          style={{
            position: 'relative', flex: 1, minHeight: 320, borderRadius: 8,
            overflow: 'hidden', border: '0.5px solid var(--border-subtle)',
          }}
        />

        {/* Task 7 : tableau classé des zones (get_campaign_derive_ranked), synchronisé
            sur { mesh, metric, threshold, actors } déjà levés par ce composant. Le clic
            ligne recentre la carte via `flyToCode` (même instance, pas de ref externe
            nécessaire ici) — Task 8 lève l'état si le tableau doit vivre hors panneau. */}
        <DeriveTable
          campaignId={campaignId}
          mesh={mesh}
          metric={metric}
          actors={actors}
          threshold={threshold}
          onRowClick={flyToCode}
        />
      </div>
    );
  },
);
