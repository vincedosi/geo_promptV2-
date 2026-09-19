'use client';

/**
 * @file CreerZoneRayon — créer une zone circulaire autour d'un point
 * (Tâche 17, 2026-09-13).
 *
 * Clic sur la carte pour poser le centre, curseur de rayon, **aperçu du cercle
 * avant enregistrement**.
 *
 * ── L'aperçu est dessiné localement, pas demandé au serveur ───────────────
 * Le cercle de prévisualisation est calculé en GeoJSON côté client : déplacer
 * le curseur de rayon ne doit pas déclencher un appel par pixel. La géométrie
 * ENREGISTRÉE, elle, vient toujours du serveur — c'est la seule qui soit
 * clippée sur `france_borders` et donc juste.
 *
 * Les deux peuvent différer, et c'est le message important de cet outil :
 * l'aperçu est un disque plein, la zone réelle en est la part terrestre.
 * Mesuré : Marseille 20 km ne retient que 60,5 % du cercle, Saint-Denis de la
 * Réunion 43,9 %. La réponse du serveur porte `part_retenue`, affichée après
 * création — sans elle, on croit acheter 1 257 km² et on en achète 755.
 */
import { useEffect, useRef, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';
import { useSession } from '@/lib/auth-client';
import { formaterNombre } from '@/lib/format/nombre';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

const SOURCE_APERCU = 'apercu-rayon';
const FILL_APERCU = 'apercu-rayon-fill';
const LINE_APERCU = 'apercu-rayon-line';

/**
 * Bornes du CURSEUR. Le maximum est celui de la route (100 km) ; le minimum est
 * volontairement PLUS HAUT que le sien (500 m contre 100 m) — sous 500 m, un
 * cercle ne contient presque jamais un code postal entier et la zone créée
 * serait vide. Le commentaire disait « mêmes bornes que la route » : c'était
 * faux, et un lecteur pressé en aurait conclu que la route refuse 200 m.
 */
const RAYON_MIN_M = 500;
const RAYON_MAX_M = 100_000;

/**
 * Cercle géodésique approché en 64 segments, pour l'APERÇU seulement.
 *
 * La correction en `cos(latitude)` sur la longitude est indispensable : sans
 * elle, le cercle s'étire en ellipse dès qu'on monte vers le nord — un cercle
 * « rond » à Marseille devient franchement ovale à Lille. C'est exactement la
 * raison pour laquelle la géométrie serveur passe par `ST_Buffer` sur
 * `geography` plutôt que sur la géométrie.
 */
function cercleApercu(lon: number, lat: number, rayonM: number): GeoJSON.Feature {
  const points: [number, number][] = [];
  const rayonDegLat = rayonM / 111_320;
  const rayonDegLon = rayonM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI;
    points.push([lon + rayonDegLon * Math.cos(angle), lat + rayonDegLat * Math.sin(angle)]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [points] },
  };
}

export interface CreerZoneRayonProps {
  mapRef: React.MutableRefObject<MaplibreMap | null>;
  onCree?: () => void;
}

export function CreerZoneRayon({ mapRef, onCree }: CreerZoneRayonProps) {
  const { session } = useSession();
  const orgId = session?.user?.organizationId ?? '';

  const [ouvert, setOuvert] = useState(false);
  const [enPose, setEnPose] = useState(false);
  const [centre, setCentre] = useState<{ lon: number; lat: number } | null>(null);
  const [rayonM, setRayonM] = useState(10_000);
  const [nom, setNom] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Refs lues par le gestionnaire de clic, qui n'est posé qu'une fois : sans
  // elles, il capturerait l'état du rendu où il a été créé.
  const enPoseRef = useRef(enPose);
  enPoseRef.current = enPose;

  // ── Pose du centre au clic ────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!enPoseRef.current) return;
      setCentre({ lon: e.lngLat.lng, lat: e.lngLat.lat });
      setEnPose(false);
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [mapRef]);

  // Curseur « viseur » tant qu'on attend le clic.
  //
  // Le CANEVAS est capturé, et non `mapRef.current` relu au nettoyage : c'est
  // l'élément qu'on a modifié, et le relire risquerait de rendre une AUTRE
  // carte (useMapInit détruit et recrée l'instance à chaque changement de
  // fond) — on remettrait alors le curseur d'une carte qu'on n'a jamais
  // touchée, en laissant l'ancienne en viseur.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canevas = map.getCanvas();
    canevas.style.cursor = enPose ? 'crosshair' : '';
    return () => { canevas.style.cursor = ''; };
  }, [enPose, mapRef]);

  // ── Aperçu : local, jamais une requête par pixel de curseur ───────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const retirer = () => {
      const m = mapRef.current;
      if (!m) return;
      if (m.getLayer(LINE_APERCU)) m.removeLayer(LINE_APERCU);
      if (m.getLayer(FILL_APERCU)) m.removeLayer(FILL_APERCU);
      if (m.getSource(SOURCE_APERCU)) m.removeSource(SOURCE_APERCU);
    };

    if (!ouvert || !centre) { retirer(); return; }

    const data = cercleApercu(centre.lon, centre.lat, rayonM);

    // MapLibre NE RESOUT PAS `var()` : un `fill-color: var(--brand-teal)` rend
    // la couche invisible, sans erreur. Le token se lit donc au runtime, comme
    // le fait `SuiviMapLayer` — avec un repli en dur pour le cas ou la
    // variable ne serait pas encore posee.
    const teal = getComputedStyle(document.documentElement)
      .getPropertyValue('--brand-teal').trim() || '#4ecdc4';

    const source = map.getSource(SOURCE_APERCU) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(SOURCE_APERCU, { type: 'geojson', data });
      map.addLayer({
        id: FILL_APERCU, type: 'fill', source: SOURCE_APERCU,
        paint: { 'fill-color': teal, 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: LINE_APERCU, type: 'line', source: SOURCE_APERCU,
        paint: { 'line-color': teal, 'line-width': 1.5, 'line-dasharray': [2, 2] },
      });
    }
    return retirer;
  }, [ouvert, centre, rayonM, mapRef]);

  const creer = async () => {
    if (enCours || !centre || !orgId) return;
    setEnCours(true);
    setErreur(null);
    setMessage(null);
    try {
      const geoRes = await adminFetch('/api/custom-geo/source/rayon', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lon: centre.lon, lat: centre.lat, rayon_m: rayonM }),
      });
      const geo = await geoRes.json();
      if (!geoRes.ok) throw new Error(geo.message ?? geo.error ?? `Erreur ${geoRes.status}`);

      const rayonKm = Math.round(rayonM / 100) / 10;
      const saveRes = await adminFetch('/api/custom-geo/save', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: (nom || `Rayon de ${rayonKm} km`).slice(0, 200),
          source_type: 'rayon',
          source_metadata: {
            rayon_m: rayonM,
            centre: { lon: centre.lon, lat: centre.lat },
            surface_km2: geo.surface_km2,
            part_retenue: geo.part_retenue,
          },
          geometry: geo.geometry,
          org_id: orgId,
        }),
      });
      if (!saveRes.ok) throw new Error('Sauvegarde de la zone échouée.');
      const sauve = await saveRes.json();

      // La part retenue est dite ICI : c'est le chiffre qu'on reportera.
      const part = Math.round((geo.part_retenue ?? 1) * 100);
      setMessage(
        `Zone créée : ${formaterNombre(geo.surface_km2)} km²`
        + ` · ${formaterNombre(sauve.count_cp ?? 0)} codes postaux`
        + (part < 98 ? ` · ${part} % du cercle retenus (le reste est hors territoire)` : ''),
      );
      setCentre(null);
      setNom('');
      onCree?.();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };

  const inactif = enCours || !centre || !orgId;

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        style={{
          width: '100%', background: 'transparent', border: '0.5px solid var(--border-default)',
          color: 'var(--text-secondary)', borderRadius: 6, padding: '8px 16px',
          fontFamily: fInter, fontSize: 12, cursor: 'pointer', textAlign: 'left',
        }}
      >
        Zone par rayon {ouvert ? '▲' : '▼'}
      </button>

      {ouvert && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            onClick={() => setEnPose((p) => !p)}
            style={{
              width: '100%', background: enPose ? 'rgba(78,205,196,0.1)' : 'transparent',
              border: `0.5px solid ${enPose ? 'var(--brand-teal)' : 'var(--border-default)'}`,
              color: enPose ? 'var(--brand-teal)' : 'var(--text-secondary)',
              borderRadius: 6, padding: '7px 10px', fontFamily: fInter, fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {enPose ? 'Cliquez sur la carte…' : centre ? 'Déplacer le centre' : 'Poser le centre sur la carte'}
          </button>

          {centre && (
            <div style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
              {centre.lat.toFixed(4)}, {centre.lon.toFixed(4)}
            </div>
          )}

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range"
                min={RAYON_MIN_M} max={RAYON_MAX_M} step={500}
                value={rayonM}
                onChange={(e) => setRayonM(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--brand-teal)' }}
              />
              <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-secondary)', width: 56, textAlign: 'right' }}>
                {rayonM >= 1000 ? `${Math.round(rayonM / 100) / 10} km` : `${rayonM} m`}
              </span>
            </div>
            {/* L'aperçu est un disque plein ; la zone réelle en est la part
                terrestre. Le dire ici évite la surprise après création. */}
            <div style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.5 }}>
              L’aperçu montre le cercle entier. La zone enregistrée est clippée sur le
              territoire — un centre proche de la côte en perd une partie.
            </div>
          </div>

          <input
            type="text"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Nom de la zone"
            style={{
              width: '100%', background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
              borderRadius: 6, padding: '7px 10px', fontFamily: fInter, fontSize: 12,
              color: 'var(--text-primary)',
            }}
          />

          <button
            type="button"
            onClick={creer}
            disabled={inactif}
            style={{
              width: '100%', background: 'transparent', border: '0.5px solid var(--brand-teal)',
              color: 'var(--brand-teal)', borderRadius: 6, padding: '8px 16px',
              fontFamily: fInter, fontSize: 12, fontWeight: 500,
              cursor: inactif ? 'not-allowed' : 'pointer', opacity: inactif ? 0.4 : 1,
            }}
          >
            {enCours ? 'Création…' : 'Créer la zone'}
          </button>

          {erreur && (
            <div style={{
              padding: '7px 9px', borderRadius: 4, background: 'rgba(255,87,87,0.08)',
              border: '0.5px solid rgba(255,87,87,0.25)', color: 'var(--danger)',
              fontFamily: fInter, fontSize: 11, lineHeight: 1.5,
            }}>{erreur}</div>
          )}
          {message && (
            <div style={{
              padding: '7px 9px', borderRadius: 4, background: 'rgba(61,255,160,0.08)',
              border: '0.5px solid rgba(61,255,160,0.2)', color: 'var(--success)',
              fontFamily: fInter, fontSize: 11, lineHeight: 1.5,
            }}>{message}</div>
          )}
        </div>
      )}
    </div>
  );
}
