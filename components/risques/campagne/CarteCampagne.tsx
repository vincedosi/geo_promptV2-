'use client';

/**
 * La carte de l'étape ⑤ : ce que la campagne a VRAIMENT diffusé, zone par zone.
 *
 * ── TROIS COUCHES, DE LA PLUS LISIBLE À LA PLUS FINE ──────────────────────
 *
 * 1. **Les bassins colorés par leur indice de pression** — part diffusée ÷
 *    part du plan × 100, sur l'échelle divergente du Suivi : orange en
 *    sous-pression, neutre autour de 100, bleu en sur-pression. On voit d'un
 *    coup d'œil où la campagne pousse trop et où elle ne passe pas.
 * 2. **Un cercle par code postal, proportionnel à ses impressions** — teal
 *    quand il est acheté en zone, gris quand c'est de la fuite. Des cercles et
 *    non un aplat : un aplat peint tout le polygone, alors que les rayons n'en
 *    couvrent souvent qu'une partie, et un grand code postal rural paraîtrait
 *    sur-servi par sa seule surface.
 * 3. **Les sites**, verts, orange ou rouges selon la pression reçue par leur
 *    bassin.
 *
 * La bascule « Codes postaux » remplace les bassins par l'aplat des codes
 * postaux, peint du même indice calculé au code postal.
 *
 * ── CE QUI SE RECHARGE, ET CE QUI NE SE RECHARGE PAS ──────────────────────
 *
 * Les géométries (bassins, sites, contours des codes postaux) sont lues au
 * cadre visible, à `moveend`. Les CHIFFRES viennent du contexte, déjà chargés :
 * changer de période ne fait partir aucune requête, les couleurs changent par
 * `setData` sur les géométries déjà en mémoire.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';
import { fInter, fMono } from '@/lib/design/polices';
import { formaterDecimal, formaterNombre } from '@/lib/format/nombre';
import { RAMPE_MAPLIBRE, RAMPE_CSS, trancheDivergente } from '@/lib/campagne/palette-divergente';
import {
  COULEUR_ETAT_SITE, CONTOUR, CONTOUR_ACTIF, GRIS_FUITE, HALO, HALO_ETIQUETTE, TEAL, TEXTE_ETIQUETTE,
} from '@/lib/simulation/palette-carte';
import { etatSite } from '@/lib/simulation/vue';
import { useSimulation } from '@/components/risques/campagne/ContexteSimulation';

const FOND = 'https://tiles.openfreemap.org/styles/positron';

/** Emprise métropolitaine, la bbox de `CLAUDE.md` : ouest, sud, est, nord. */
const METRO: [number, number, number, number] = [-5.5, 41.2, 9.8, 51.2];

const S_BASSINS = 'sim-bassins';
const S_SITES = 'sim-sites';
const S_CERCLES = 'sim-cercles';
const S_CP = 'sim-cp';
const L_BASSINS = 'sim-bassins-fond';
const L_BASSINS_CONTOUR = 'sim-bassins-contour';
const L_BASSINS_ETIQUETTE = 'sim-bassins-etiquette';
const L_CP = 'sim-cp-fond';
const L_CP_CONTOUR = 'sim-cp-contour';
const L_CERCLES = 'sim-cercles-couche';
const L_SITES = 'sim-sites-couche';

type Vue = 'bassins' | 'cp';
type Collection = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>;

const vide = (): Collection => ({ type: 'FeatureCollection', features: [] });

/** Un indice en tranche 0-6 de l'échelle divergente, ou -1 sans indice. */
const tranche = (indice: number | null | undefined) =>
  (indice == null ? -1 : trancheDivergente(indice - 100));

export function CarteCampagne() {
  const { vue, zoneActive, setZoneActive, jeuId } = useSimulation();
  /*
   * ⚠ La palette CLAIRE dans les deux thèmes : le fond Positron est clair quel
   * que soit le thème de l'application (même choix que la carte des codes
   * postaux). Le vert fluo du thème sombre y serait illisible.
   */
  const t = 'light' as const;
  const conteneur = useRef<HTMLDivElement | null>(null);
  const carte = useRef<maplibregl.Map | null>(null);
  const [prete, setPrete] = useState(false);
  const [mode, setMode] = useState<Vue>('bassins');
  const [cercles, setCercles] = useState(true);
  const [geo, setGeo] = useState<{ bassins: Collection; sites: Collection; cp: Collection }>(
    { bassins: vide(), sites: vide(), cp: vide() },
  );
  const lecture = useRef(0);

  /* ── Montage, une fois ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (!conteneur.current || carte.current) return;
    const m = new maplibregl.Map({
      container: conteneur.current, style: FOND, center: [2.4, 46.6], zoom: 5,
      attributionControl: false,
    });
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    carte.current = m;
    // MapLibre ne redimensionne pas son canevas quand son conteneur change sans
    // que la fenêtre bouge — ce qui arrive en entrant dans l'étape ⑤.
    const obs = new ResizeObserver(() => m.resize());
    obs.observe(conteneur.current);
    m.on('load', () => {
      for (const s of [S_BASSINS, S_SITES, S_CERCLES, S_CP]) {
        m.addSource(s, { type: 'geojson', data: vide() });
      }
      m.addLayer({ id: L_CP, type: 'fill', source: S_CP, paint: { 'fill-color': ['get', 'couleur'], 'fill-opacity': 0.72 } });
      m.addLayer({ id: L_CP_CONTOUR, type: 'line', source: S_CP, paint: { 'line-color': ['get', 'contour'], 'line-width': 0.5 } });
      m.addLayer({ id: L_BASSINS, type: 'fill', source: S_BASSINS, paint: { 'fill-color': ['get', 'couleur'], 'fill-opacity': 0.8 } });
      m.addLayer({ id: L_BASSINS_CONTOUR, type: 'line', source: S_BASSINS, paint: { 'line-color': ['get', 'contour'], 'line-width': ['get', 'epaisseur'] } });
      m.addLayer({
        id: L_CERCLES, type: 'circle', source: S_CERCLES,
        paint: {
          'circle-color': ['get', 'couleur'],
          'circle-opacity': 0.72,
          'circle-stroke-color': ['get', 'halo'],
          'circle-stroke-width': 0.8,
          // Surface ∝ impressions : rayon ∝ racine. Le facteur suit le zoom pour
          // que les cercles restent lisibles sans se couvrir.
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            5, ['*', 10, ['get', 'r']], 9, ['*', 24, ['get', 'r']], 12, ['*', 40, ['get', 'r']]],
        },
      });
      m.addLayer({
        id: L_SITES, type: 'circle', source: S_SITES,
        paint: {
          'circle-color': ['get', 'couleur'], 'circle-radius': 3.5,
          'circle-stroke-color': ['get', 'halo'], 'circle-stroke-width': 1,
        },
      });
      m.addLayer({
        id: L_BASSINS_ETIQUETTE, type: 'symbol', source: S_BASSINS,
        layout: {
          'text-field': ['get', 'etiquette'], 'text-font': ['Noto Sans Regular'],
          'text-size': 11, 'text-allow-overlap': false,
        },
        paint: { 'text-color': TEXTE_ETIQUETTE, 'text-halo-color': HALO_ETIQUETTE, 'text-halo-width': 1.4 },
      });
      setPrete(true);
    });
    return () => { obs.disconnect(); m.remove(); carte.current = null; };
  }, []);

  /* ── Géométries au cadre visible ────────────────────────────────────────── */
  const chargerGeo = useCallback(async () => {
    const m = carte.current;
    if (!m || !jeuId) return;
    const b = m.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((x) => x.toFixed(4)).join(',');
    const n = ++lecture.current;
    try {
      const r = await adminFetch(`/api/zones/jeux/${jeuId}/simulation/carte?bbox=${bbox}`);
      const fc = (await r.json()) as Collection;
      let cp: Collection = vide();
      if (mode === 'cp') {
        const r2 = await adminFetch(`/api/zones/jeux/${jeuId}/cp-geo?bbox=${bbox}`);
        if (r2.ok) cp = (await r2.json()) as Collection;
      }
      // ⚠ Même garde que la carte des codes postaux : une réponse arrivée pour
      // une carte détruite ou pour un cadre dépassé est périmée.
      if (n !== lecture.current || carte.current !== m || !r.ok) return;
      setGeo({
        bassins: { type: 'FeatureCollection', features: (fc.features ?? []).filter((f) => f.properties?.type === 'bassin') },
        sites: { type: 'FeatureCollection', features: (fc.features ?? []).filter((f) => f.properties?.type === 'site') },
        cp,
      });
    } catch { /* la carte garde ses géométries précédentes : mieux qu'une carte vide */ }
  }, [jeuId, mode]);

  useEffect(() => {
    const m = carte.current;
    if (!m || !prete) return;
    void chargerGeo();
    // `moveend` et JAMAIS `move` : une requête par image de panoramique est la
    // famille de l'incident du 28/03.
    m.on('moveend', chargerGeo);
    return () => { m.off('moveend', chargerGeo); };
  }, [prete, chargerGeo]);

  /* ── Premier cadrage sur les zones du jeu ───────────────────────────────── */
  const cadre = useMemo(() => {
    // La métropole seule : un bassin de Guyane étirerait le cadre jusqu'à
    // l'Atlantique et la France entière tiendrait dans un timbre-poste.
    const bs = (vue?.zones ?? []).map((z) => z.bbox)
      .filter((b): b is [number, number, number, number] => !!b)
      .filter((b) => b[0] >= METRO[0] && b[2] <= METRO[2] && b[1] >= METRO[1] && b[3] <= METRO[3]);
    if (bs.length === 0) return null;
    return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])),
      Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))] as [number, number, number, number];
  }, [vue?.zones]);
  const cadre1 = useRef(false);
  useEffect(() => {
    const m = carte.current;
    if (!m || !prete || !cadre || cadre1.current) return;
    cadre1.current = true;
    m.fitBounds(cadre, { padding: 40, duration: 0, maxZoom: 9 });
  }, [prete, cadre]);

  /* ── Recadrage sur la zone choisie dans le tableau ──────────────────────── */
  useEffect(() => {
    const m = carte.current;
    const z = vue?.zones.find((x) => x.id === zoneActive);
    if (!m || !prete || !z?.bbox) return;
    const [o, s, e, n] = z.bbox;
    const pad = Math.max(e - o, n - s) * 0.4 + 0.08;
    m.fitBounds([o - pad, s - pad, e + pad, n + pad], { padding: 40, duration: 600, maxZoom: 11 });
  }, [zoneActive, prete, vue?.zones]);

  /* ── Les chiffres, fusionnés dans les géométries ────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m || !prete || !vue) return;
    const rampe = RAMPE_MAPLIBRE[t];
    const couleur = (i: number) => (i < 0 ? GRIS_FUITE[t] : rampe[i]);
    const parZone = new Map(vue.zones.map((z) => [z.id, z]));

    (m.getSource(S_BASSINS) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: geo.bassins.features.map((f) => {
        const z = parZone.get(String(f.properties.id));
        const actif = zoneActive === f.properties.id;
        return {
          ...f,
          properties: {
            ...f.properties,
            couleur: couleur(tranche(z?.indice)),
            contour: actif ? CONTOUR_ACTIF[t] : CONTOUR[t],
            epaisseur: actif ? 2.5 : 0.8,
            indice: z?.indice ?? null,
            etiquette: `${f.properties.nom} ${z?.indice == null ? '' : Math.round(z.indice)}`,
          },
        };
      }),
    });

    (m.getSource(S_SITES) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: geo.sites.features.map((f) => {
        const z = parZone.get(String(f.properties.cluster_id));
        return {
          ...f,
          properties: { ...f.properties, couleur: COULEUR_ETAT_SITE[t][etatSite(z?.indice ?? null)], halo: HALO[t] },
        };
      }),
    });

    // Un cercle par POSITION : les codes postaux d'un même groupe partagent
    // un centroïde (sql/228), et quatre cercles superposés feraient passer
    // Nantes pour un seul code postal quatre fois plus foncé.
    const parPosition = new Map<string, { x: number; y: number; imps: number; achete: boolean; codes: string[] }>();
    for (const c of vue.cps) {
      if (c.x == null || c.y == null || c.impressions <= 0) continue;
      const cle = `${c.x}|${c.y}`;
      const o = parPosition.get(cle) ?? { x: c.x, y: c.y, imps: 0, achete: false, codes: [] };
      o.imps += c.impressions; o.achete = o.achete || c.achete; o.codes.push(c.code_postal);
      parPosition.set(cle, o);
    }
    const max = Math.max(1, ...[...parPosition.values()].map((o) => o.imps));
    (m.getSource(S_CERCLES) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: cercles ? [...parPosition.values()].map((o) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [o.x, o.y] },
        properties: {
          r: Math.sqrt(o.imps / max), couleur: o.achete ? TEAL : GRIS_FUITE[t], halo: HALO[t],
          imps: o.imps, achete: o.achete, codes: o.codes.join(', '),
        },
      })) : [],
    });

    const parCp = new Map(vue.cps.map((c) => [c.code_postal, c]));
    (m.getSource(S_CP) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: mode === 'cp' ? geo.cp.features.map((f) => {
        const c = parCp.get(String(f.properties.code_postal));
        return {
          ...f,
          properties: {
            ...f.properties,
            couleur: couleur(tranche(c?.indice)),
            contour: CONTOUR[t],
            indice_cp: c?.indice ?? null,
            imps: c?.impressions ?? 0,
          },
        };
      }) : [],
    });

    for (const id of [L_BASSINS, L_BASSINS_CONTOUR, L_BASSINS_ETIQUETTE]) {
      m.setLayoutProperty(id, 'visibility', mode === 'bassins' ? 'visible' : 'none');
    }
    for (const id of [L_CP, L_CP_CONTOUR]) {
      m.setLayoutProperty(id, 'visibility', mode === 'cp' ? 'visible' : 'none');
    }
  }, [prete, vue, geo, zoneActive, mode, cercles, t]);

  /* ── Infobulle et clic ──────────────────────────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m || !prete) return;
    const bulle = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '260px' });
    const ligne = (a: string, b: string) =>
      `<div style="display:flex;justify-content:space-between;gap:14px"><span style="color:var(--text-tertiary)">${a}</span><span style="font-family:${fMono}">${b}</span></div>`;
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const survol = (e: maplibregl.MapMouseEvent) => {
      const f = m.queryRenderedFeatures(e.point, { layers: [L_SITES, L_CERCLES, L_BASSINS, L_CP] })[0];
      if (!f) { bulle.remove(); m.getCanvas().style.cursor = ''; return; }
      m.getCanvas().style.cursor = f.layer.id === L_BASSINS ? 'pointer' : '';
      const p = f.properties as Record<string, unknown>;
      let html = '';
      if (f.layer.id === L_BASSINS) {
        const z = vue?.zones.find((x) => x.id === p.id);
        if (!z) return;
        html = `<strong>${esc(z.nom)}</strong>`
          + ligne('Sites', formaterNombre(z.n_sites))
          + ligne('Exposés', formaterNombre(z.pop_exposee))
          + ligne('Part du plan', `${formaterDecimal(z.part_plan * 100, 1)} %`)
          + ligne('Part diffusée', `${formaterDecimal(z.part_diffusee * 100, 1)} %`)
          + ligne('Indice', z.indice == null ? '—' : String(Math.round(z.indice)))
          + ligne('Impressions', formaterNombre(Math.round(z.impressions)))
          + ligne('dont utiles', formaterNombre(Math.round(z.utiles)));
      } else if (f.layer.id === L_CERCLES) {
        html = `<strong>${esc(p.codes)}</strong>`
          + ligne('Impressions', formaterNombre(Number(p.imps)))
          + ligne('Statut', p.achete ? 'acheté en zone' : 'fuite hors plan');
      } else if (f.layer.id === L_SITES) {
        html = `<strong>${esc(p.nom ?? 'Site')}</strong>${p.ville ? `<div>${esc(p.ville)}</div>` : ''}`;
      } else {
        html = `<strong>${esc(p.code_postal)}</strong>`
          + ligne('Impressions', formaterNombre(Number(p.imps)))
          + ligne('Indice', p.indice_cp == null ? '—' : String(Math.round(Number(p.indice_cp))));
      }
      bulle.setLngLat(e.lngLat)
        .setHTML(`<div style="font-family:${fInter};font-size:11px;color:var(--text-primary);display:flex;flex-direction:column;gap:2px">${html}</div>`)
        .addTo(m);
    };
    const clic = (e: maplibregl.MapMouseEvent) => {
      const f = m.queryRenderedFeatures(e.point, { layers: [L_BASSINS] })[0];
      if (f) setZoneActive(String(f.properties?.id));
    };
    const sortie = () => { bulle.remove(); m.getCanvas().style.cursor = ''; };
    m.on('mousemove', survol);
    m.on('click', clic);
    m.getCanvas().addEventListener('mouseleave', sortie);
    return () => {
      m.off('mousemove', survol); m.off('click', clic);
      m.getCanvas().removeEventListener('mouseleave', sortie);
      bulle.remove();
    };
  }, [prete, vue, setZoneActive]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={conteneur} style={{ position: 'absolute', inset: 0 }} />

      <div style={{
        position: 'absolute', top: 10, left: 10, zIndex: 3, display: 'flex', gap: 6, flexWrap: 'wrap',
      }}>
        <div role="group" aria-label="Lecture de la carte" style={groupe}>
          {(['bassins', 'cp'] as Vue[]).map((v) => (
            <button key={v} type="button" onClick={() => setMode(v)} aria-pressed={mode === v} style={bascule(mode === v)}>
              {v === 'bassins' ? 'Zones' : 'Codes postaux'}
            </button>
          ))}
        </div>
        <label style={{ ...groupe, padding: '4px 8px', gap: 6, fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={cercles} onChange={(e) => setCercles(e.target.checked)} />
          Impressions
        </label>
      </div>

      {!vue && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <p style={{ ...groupe, padding: '8px 12px', fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)' }}>
            Lancez une simulation pour voir la diffusion dans les zones.
          </p>
        </div>
      )}

      <Legende />
    </div>
  );
}

function Legende() {
  const bornes = ['50', '75', '90', '110', '125', '150'];
  return (
    <div style={{
      position: 'absolute', left: 10, bottom: 10, zIndex: 3,
      background: 'var(--card-overlay)', border: '0.5px solid var(--border-default)', borderRadius: 8,
      padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 'calc(100% - 20px)',
    }}>
      <span style={{ fontFamily: fInter, fontSize: 10, color: 'var(--text-secondary)', fontWeight: 500 }}>
        Indice de pression · part diffusée ÷ part du plan
      </span>
      <div>
        <div style={{ display: 'flex', gap: 2 }}>
          {RAMPE_CSS.map((c) => <span key={c} style={{ width: 22, height: 8, borderRadius: 2, background: c }} />)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)', padding: '0 14px' }}>
          {bornes.map((b) => <span key={b}>{b}</span>)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
        <span><Point couleur="var(--brand-teal)" />Impressions, CP acheté</span>
        <span><Point couleur="var(--text-tertiary)" />Fuite hors plan</span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)' }}>
        <span><Point couleur="var(--success)" petit />Site servi</span>
        <span><Point couleur="var(--warning)" petit />Partiel</span>
        <span><Point couleur="var(--danger)" petit />Sous-servi</span>
      </div>
    </div>
  );
}

function Point({ couleur, petit }: { couleur: string; petit?: boolean }) {
  const d = petit ? 7 : 9;
  return <span aria-hidden style={{ display: 'inline-block', width: d, height: d, borderRadius: '50%', background: couleur, marginRight: 4, verticalAlign: '-1px' }} />;
}

const groupe: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 2, padding: 2, borderRadius: 6,
  background: 'var(--card-overlay)', border: '0.5px solid var(--border-default)',
};

function bascule(actif: boolean): React.CSSProperties {
  return {
    padding: '4px 9px', borderRadius: 4, border: 'none', cursor: 'pointer',
    fontFamily: fInter, fontSize: 11,
    background: actif ? 'var(--brand-teal-10)' : 'transparent',
    color: actif ? 'var(--brand-teal)' : 'var(--text-secondary)',
  };
}
