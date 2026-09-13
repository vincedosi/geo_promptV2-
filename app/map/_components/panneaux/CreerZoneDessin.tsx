'use client';

/**
 * @file CreerZoneDessin — créer une zone en la traçant à la main
 * (Tâche 18, 2026-09-13).
 *
 * Orchestre `DessinLibre` (le moteur `terra-draw`) et la route
 * `/api/custom-geo/source/dessin`, puis sauvegarde par `/api/custom-geo/save`
 * (`source_type: 'dessin'`).
 *
 * **`DessinLibre` est chargé en `dynamic(..., { ssr: false })`**, et pas par
 * confort : `terra-draw` s'attache au DOM et à l'instance MapLibre dès son
 * constructeur. Le charger côté serveur ferait échouer le rendu. Il n'est en
 * outre chargé QU'À l'ouverture de cet outil — la librairie ne pèse donc rien
 * dans le paquet initial de `/map`, ce qui est la moindre des choses pour une
 * dépendance ajoutée à une page déjà lourde.
 *
 * **Deux faits sont affichés APRÈS création, et ils comptent** : `corrige` dit
 * que le tracé a dû être réparé — la zone n'est alors pas exactement celle qui
 * a été dessinée —, et `part_retenue` dit ce que le clip sur le territoire a
 * retiré. Les découvrir sur la carte serait pire que les lire.
 */
import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';
import { useSession } from '@/lib/auth-client';
import { retryImport } from '@/lib/dynamic-with-retry';
import { formaterNombre } from '@/lib/format/nombre';

const fInter = "'Inter', system-ui, sans-serif";

const DessinLibre = dynamic(
  retryImport(() => import('../DessinLibre').then((m) => ({ default: m.DessinLibre }))),
  { ssr: false, loading: () => null },
);

export interface CreerZoneDessinProps {
  mapRef: React.MutableRefObject<MaplibreMap | null>;
  onCree?: () => void;
}

export function CreerZoneDessin({ mapRef, onCree }: CreerZoneDessinProps) {
  const { session } = useSession();
  const orgId = session?.user?.organizationId ?? '';

  const [ouvert, setOuvert] = useState(false);
  const [trace, setTrace] = useState<GeoJSON.Polygon | null>(null);
  // Incrémentée après une création : efface le tracé de la carte et désactive
  // le bouton. Sans cela, deux clics créaient deux zones identiques.
  const [effacerCle, setEffacerCle] = useState(0);
  const [nom, setNom] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const creer = async () => {
    if (enCours || !trace || !orgId) return;
    setEnCours(true);
    setErreur(null);
    setMessage(null);
    try {
      const geoRes = await adminFetch('/api/custom-geo/source/dessin', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry: trace }),
      });
      const geo = await geoRes.json();
      if (!geoRes.ok) throw new Error(geo.message ?? geo.error ?? `Erreur ${geoRes.status}`);

      const saveRes = await adminFetch('/api/custom-geo/save', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: (nom || `Tracé de ${formaterNombre(geo.surface_km2)} km²`).slice(0, 200),
          source_type: 'dessin',
          source_metadata: {
            surface_km2: geo.surface_km2,
            corrige: geo.corrige,
            part_retenue: geo.part_retenue,
            n_sommets: Math.max(0, (trace.coordinates[0]?.length ?? 1) - 1),
          },
          geometry: geo.geometry,
          org_id: orgId,
        }),
      });
      if (!saveRes.ok) throw new Error('Sauvegarde de la zone échouée.');
      const sauve = await saveRes.json();

      const remarques: string[] = [];
      if (geo.corrige) remarques.push('tracé réparé (il se croisait lui-même)');
      const part = Math.round((geo.part_retenue ?? 1) * 100);
      if (part < 98) remarques.push(`${part} % retenus, le reste est hors territoire`);

      setMessage(
        `Zone créée : ${formaterNombre(geo.surface_km2)} km²`
        + ` · ${formaterNombre(sauve.count_cp ?? 0)} codes postaux`
        + (remarques.length ? ` · ${remarques.join(' · ')}` : ''),
      );
      setNom('');
      setTrace(null);
      setEffacerCle((n) => n + 1);
      onCree?.();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };

  const inactif = enCours || !trace || !orgId;

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
        Dessiner une zone {ouvert ? '▲' : '▼'}
      </button>

      {ouvert && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <DessinLibre
            mapRef={mapRef}
            onTrace={setTrace}
            onFermer={() => setOuvert(false)}
            effacerCle={effacerCle}
          />

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
