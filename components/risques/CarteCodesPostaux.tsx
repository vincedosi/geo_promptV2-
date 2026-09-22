'use client';

/**
 * La carte de DROITE de l'étape ④ : ce qu'on ACHÈTE.
 *
 * ── POURQUOI DEUX CARTES ET NON UNE BASCULE ──────────────────────────────
 *
 * Tout le module existe parce que deux découpages ne coïncident pas : le
 * risque se mesure au carreau de 200 m, le DSP achète au code postal. Une
 * bascule montre l'un PUIS l'autre, et laisse la comparaison à la mémoire de
 * celui qui regarde. Côte à côte, l'écart se voit — un anneau d'un kilomètre
 * posé sur un code postal qui en fait quinze, c'est la dilution, et c'est le
 * chiffre que l'atelier passe son temps à régler.
 *
 * La bascule existe quand même, mais HORS de l'étape ④ : là, il n'y a rien à
 * comparer, et deux cartes prendraient la place d'une.
 *
 * ── CE QU'ELLE NE FAIT PAS ───────────────────────────────────────────────
 *
 * Les codes postaux écartés sont grisés, **pas hachurés**. MapLibre ne sait
 * hachurer qu'avec une image de motif (`fill-pattern`), qu'il faudrait charger,
 * décliner en deux thèmes et redimensionner par zoom — beaucoup de machinerie
 * pour dire « celui-ci ne compte pas », qu'un gris désaturé et un contour
 * tireté disent aussi bien.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { fInter, fMono } from '@/lib/design/polices';
import { formaterNombre } from '@/lib/format/nombre';
import { adminFetch } from '@/lib/admin-fetch';
import { codeZonesRisque } from '@/lib/risques/code-profil';
import { ZONES_RISQUE_ZOOM_PLANCHER, ZONES_RISQUE_ZOOM_LISIBLE } from '@/lib/version';
import { EVENEMENT_JEU_REGLE } from '@/components/risques/use-jeux-zones';

const SOURCE_CP = 'zoneset-cp';
const SOURCE_RAYONS = 'zoneset-rayons';
const ID_FOND = 'zoneset-cp-fond';
const ID_CONTOUR = 'zoneset-cp-contour';
const ID_ECARTES = 'zoneset-cp-ecartes';
const ID_SURBRILLANCE = 'zoneset-cp-surbrillance';
const ID_RAYONS = 'zoneset-rayons-contour';

/** Fond de carte neutre : le même que la carte des rayons, pour que la
 *  comparaison porte sur la donnée et non sur le décor. */
const FOND = 'https://tiles.openfreemap.org/styles/positron';

/**
 * Les trois variables de coloration.
 *
 * ⚠ Elles ne répondent PAS à la même question, et c'est pour cela qu'il y en a
 * trois plutôt qu'une « bonne » :
 * - `plan` : ce que ce code postal va recevoir du budget. C'est le plan.
 * - `exposition` : quelle part de SES habitants est réellement en zone. C'est
 *   la dilution, code postal par code postal — un code postal à 8 % coûte
 *   douze fois ce qu'il vise.
 * - `population` : combien d'exposés il porte. Un code postal peu dilué mais
 *   presque vide ne vaut pas un code postal dilué qui en porte 40 000.
 */
export type ColorationCp = 'plan' | 'exposition' | 'population';

export const LIBELLE_COLORATION: Record<ColorationCp, string> = {
  plan: 'Part du plan',
  exposition: 'Taux d’exposition',
  population: 'Population exposée',
};

/**
 * La rampe séquentielle du produit, en hex littéraux.
 *
 * ⚠ MapLibre ne résout PAS `var()` dans `paint` : `addLayer` LÈVE, la couche
 * n'est jamais ajoutée, et le compteur de la légende continue d'annoncer un
 * chiffre juste pour une carte vide. Défaut déjà payé sur les sites à risque
 * (`COULEUR_NIVEAU` contre `COULEUR_NIVEAU_CSS`). Les mêmes valeurs vivent en
 * jetons CSS (`--seq-1` … `--seq-5`) pour tout ce qui est du DOM.
 */
const RAMPE = ['#132625', '#1b3d3a', '#2a6b62', '#3a9e91', '#4ecdc4'];

/** Le gris NEUTRE d'un code postal écarté — jamais une teinte de la rampe,
 *  qui ferait lire « faible » là où la réponse est « pas acheté ». */
const GRIS_ECARTE = 'rgba(154,160,166,0.28)';

interface Props {
  /** Le jeu à afficher, ou `null` tant qu'aucun n'est construit. */
  jeuId: string | null;
  /** Le code de profil des zones, pour la surimpression des rayons. */
  codeProfilZones: string;
  natures: string[];
  coloration: ColorationCp;
  /**
   * Le seuil courant. Il ne sert PAS au dessin : il sert à savoir qu'il faut
   * relire. Le serveur décide de `retenu`, l'écran ne le recalcule jamais —
   * deux règles de rétention divergeraient au premier correctif.
   */
  seuil: number;
  /** Les codes postaux à mettre en évidence (survol d'une grappe à gauche). */
  surbrillance?: string[] | null;
  /** Remonte l'instance pour la synchronisation des caméras. */
  onCarte?: (m: maplibregl.Map | null) => void;
  /** Remonte les compteurs du bandeau. */
  onChiffres?: (c: { n_total: number; n_affiches: number; n_retenus: number;
                     taux_utile: number | null } | null) => void;
}

interface Chargement {
  type: 'FeatureCollection';
  features: Array<{ properties: Record<string, unknown> }>;
  n_total: number;
  n_affiches: number;
  n_retenus: number;
  taux_utile: number | null;
  error?: string;
}

export function CarteCodesPostaux({
  jeuId, codeProfilZones, natures, coloration, seuil, surbrillance, onCarte, onChiffres,
}: Props) {
  const conteneur = useRef<HTMLDivElement | null>(null);
  const carte = useRef<maplibregl.Map | null>(null);
  const { theme } = useTheme();
  const [etat, setEtat] = useState<'vide' | 'chargement' | 'echec' | 'pret'>('vide');
  const [message, setMessage] = useState<string | null>(null);

  /* ── Montage ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!conteneur.current || carte.current) return;
    const m = new maplibregl.Map({
      container: conteneur.current,
      style: FOND,
      center: [2.4, 46.6],
      zoom: 5,
      attributionControl: false,
    });
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    carte.current = m;
    onCarte?.(m);

    // ⚠ Même raison que sur la carte des rayons : MapLibre ne redimensionne pas
    // son canevas quand son conteneur change sans que la fenêtre bouge — et
    // cette carte apparaît en entrant dans l'étape ④, donc son conteneur passe
    // de zéro à la moitié de l'écran sans qu'aucun événement `resize` ne parte.
    const observateur = new ResizeObserver(() => m.resize());
    observateur.observe(conteneur.current);

    return () => {
      observateur.disconnect();
      onCarte?.(null);
      m.remove();
      carte.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Le fond suit le thème ─────────────────────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m) return;
    // Positron dans les deux thèmes, comme la carte des rayons : on ne change
    // que ce qu'on peint par-dessus.
    void theme;
  }, [theme]);

  /* ── Les couches, posées une fois ──────────────────────────────────────── */
  const poserCouches = useCallback((m: maplibregl.Map) => {
    // Les ÉCARTÉS d'abord, sous les retenus : ils sont le fond de tableau sur
    // lequel se lit ce qu'on achète.
    m.addLayer({
      id: ID_ECARTES,
      type: 'fill',
      source: SOURCE_CP,
      filter: ['!', ['get', 'retenu']],
      paint: { 'fill-color': GRIS_ECARTE },
    });
    m.addLayer({
      id: ID_FOND,
      type: 'fill',
      source: SOURCE_CP,
      filter: ['get', 'retenu'],
      paint: { 'fill-color': '#2a6b62', 'fill-opacity': 0.75 },
    });
    m.addLayer({
      id: ID_CONTOUR,
      type: 'line',
      source: SOURCE_CP,
      paint: {
        'line-color': 'rgba(120,120,120,0.55)',
        'line-width': 0.5,
        // Tireté sur les écartés : la couleur dit « pas acheté », le trait le
        // redit — lisible en niveaux de gris et pour un daltonisme.
        'line-dasharray': ['case', ['get', 'retenu'], ['literal', [1, 0]], ['literal', [2, 2]]],
      },
    });
    m.addLayer({
      id: ID_SURBRILLANCE,
      type: 'line',
      source: SOURCE_CP,
      filter: ['in', ['get', 'code_postal'], ['literal', []]],
      paint: { 'line-color': '#4ecdc4', 'line-width': 2.5 },
    });
  }, []);

  /* ── Les codes postaux ─────────────────────────────────────────────────── */
  const charger = useCallback(async () => {
    const m = carte.current;
    if (!m || !jeuId) return;

    const b = m.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
      .map((x) => x.toFixed(4)).join(',');

    setEtat('chargement');
    try {
      // ⚠ `adminFetch` et non `fetch` : `requireAuth` lit le jeton porteur
      // de la session Supabase, que `fetch` n'envoie pas. Sans lui, la route
      // répond 401 et la carte reste vide — sans rien dire de plus utile que
      // « Codes postaux illisibles ».
      const r = await adminFetch(`/api/zones/jeux/${jeuId}/cp-geo?bbox=${bbox}`);
      const data = (await r.json()) as Chargement;
      if (!r.ok || data.error) {
        setEtat('echec');
        setMessage(data.error ?? 'Codes postaux illisibles.');
        onChiffres?.(null);
        return;
      }

      const src = m.getSource(SOURCE_CP) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data as unknown as GeoJSON.FeatureCollection);
      } else {
        m.addSource(SOURCE_CP, {
          type: 'geojson',
          data: data as unknown as GeoJSON.FeatureCollection,
        });
        poserCouches(m);
      }
      setEtat('pret');
      setMessage(null);
      onChiffres?.({
        n_total: data.n_total, n_affiches: data.n_affiches,
        n_retenus: data.n_retenus, taux_utile: data.taux_utile,
      });
    } catch (e) {
      setEtat('echec');
      setMessage(e instanceof Error ? e.message : 'Chargement interrompu.');
      onChiffres?.(null);
    }
  }, [jeuId, onChiffres, poserCouches]);

  /* ── Le dessin suit la variable choisie ────────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m || !m.getLayer(ID_FOND)) return;

    /*
     * ⚠ Les bornes sont FIXES par variable, jamais dérivées de ce qui est à
     * l'écran. Une échelle recalculée à chaque panoramique fait changer la
     * couleur d'un code postal qui n'a pas bougé — et fait croire qu'il a
     * bougé. Le plan est une part (0 à ~0,5 % par code postal sur un plan
     * national), l'exposition un pourcentage, la population un effectif.
     */
    const echelle: Record<ColorationCp, [string, number[]]> = {
      plan: ['part_plan', [0, 0.0005, 0.001, 0.002, 0.004]],
      exposition: ['taux_exposition', [0, 20, 40, 60, 80]],
      population: ['pop_en_zone', [0, 2000, 8000, 20000, 50000]],
    };
    const [champ, bornes] = echelle[coloration];

    const expression: maplibregl.ExpressionSpecification = [
      'interpolate', ['linear'], ['coalesce', ['get', champ], 0],
      bornes[0], RAMPE[0], bornes[1], RAMPE[1], bornes[2], RAMPE[2],
      bornes[3], RAMPE[3], bornes[4], RAMPE[4],
    ] as maplibregl.ExpressionSpecification;

    m.setPaintProperty(ID_FOND, 'fill-color', expression);
  }, [coloration, etat]);

  /* ── La surimpression des rayons ───────────────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m) return;
    const cle = codeZonesRisque(codeProfilZones, natures);

    const poser = () => {
      if (m.getLayer(ID_RAYONS)) m.removeLayer(ID_RAYONS);
      if (m.getSource(SOURCE_RAYONS)) m.removeSource(SOURCE_RAYONS);
      if (!codeProfilZones) return;

      /*
       * ⚠ Les MÊMES tuiles que la carte des rayons, en CONTOUR seulement.
       * Refaire un aplat ici doublerait la carte de gauche sans rien ajouter ;
       * le contour, lui, répond à la seule question que cette carte pose :
       * « jusqu'où va la zone, et de combien le code postal la déborde ».
       */
      m.addSource(SOURCE_RAYONS, {
        type: 'vector',
        tiles: [`${window.location.origin}/api/tiles/zones-risque/{z}/{x}/{y}`
          + `?profil=${encodeURIComponent(codeProfilZones)}`
          + (natures.length ? `&natures=${encodeURIComponent(natures.join(','))}` : '')],
        minzoom: ZONES_RISQUE_ZOOM_PLANCHER,
        maxzoom: 14,
      });
      m.addLayer({
        id: ID_RAYONS,
        type: 'line',
        source: SOURCE_RAYONS,
        'source-layer': 'zones_risque',
        minzoom: ZONES_RISQUE_ZOOM_LISIBLE,
        paint: { 'line-color': '#e0603f', 'line-width': 1, 'line-opacity': 0.9 },
      });
      void cle;
    };

    if (m.isStyleLoaded()) poser();
    else m.once('load', poser);
  }, [codeProfilZones, natures]);

  /* ── La surbrillance venue de l'autre carte ────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m || !m.getLayer(ID_SURBRILLANCE)) return;
    m.setFilter(ID_SURBRILLANCE,
      ['in', ['get', 'code_postal'], ['literal', surbrillance ?? []]]);
  }, [surbrillance, etat]);

  /* ── Chargement au montage, au déplacement, au re-réglage du jeu ───────── */
  useEffect(() => {
    const m = carte.current;
    if (!m || !jeuId) return;
    const relire = () => { void charger(); };
    if (m.isStyleLoaded()) relire(); else m.once('load', relire);
    // ⚠ `moveend` et JAMAIS `move` : une requête par image de panoramique est
    // la famille de l'incident du 28/03. On relit quand la carte s'arrête.
    m.on('moveend', relire);
    // Le seuil se règle dans le panneau, qui vit dans une AUTRE branche de
    // l'arbre React : il ne peut prévenir que par un événement.
    window.addEventListener(EVENEMENT_JEU_REGLE, relire);
    return () => {
      m.off('moveend', relire);
      window.removeEventListener(EVENEMENT_JEU_REGLE, relire);
    };
  }, [jeuId, seuil, charger]);

  /* ── L'infobulle ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m) return;
    const bulle = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

    const survol = (e: maplibregl.MapMouseEvent) => {
      if (!m.getLayer(ID_FOND)) return;
      const f = m.queryRenderedFeatures(e.point, { layers: [ID_FOND, ID_ECARTES] })[0];
      if (!f) { bulle.remove(); m.getCanvas().style.cursor = ''; return; }
      m.getCanvas().style.cursor = 'pointer';
      const p = f.properties as Record<string, unknown>;
      const membres = Number(p.n_membres ?? 1);
      bulle.setLngLat(e.lngLat).setHTML(
        `<div style="font-family:${fInter};font-size:11px;line-height:1.5">`
        + `<div style="font-weight:500">${String(p.code_postal)}`
        + (membres > 1
          // ⚠ Le polygone dessiné est celui de la COMMUNE : le référentiel ne
          // distingue pas les contours des codes postaux d'une même ville
          // (sql/228). Le taire ferait lire « 44000 » comme un quartier.
          ? ` <span style="opacity:.7">+ ${membres - 1} code(s) indissociable(s)</span>`
          : '')
        + `</div>`
        + `<div>Exposés : ${formaterNombre(Number(p.pop_en_zone ?? 0))}`
        + ` / ${formaterNombre(Number(p.pop_totale ?? 0))} habitants</div>`
        + `<div>Taux d’exposition : ${p.taux_exposition ?? '—'} %</div>`
        + `<div>Part du plan : ${(Number(p.part_plan ?? 0) * 100).toFixed(3)} %</div>`
        + `<div style="opacity:.75">${p.retenu ? 'Acheté' : 'Écarté par le seuil'}</div>`
        + `</div>`,
      ).addTo(m);
    };

    m.on('mousemove', survol);
    return () => { m.off('mousemove', survol); bulle.remove(); };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={conteneur} style={{ position: 'absolute', inset: 0 }} />

      {/* Le bandeau d'état : un chargement muet se lit « il n'y a rien ». */}
      {(etat === 'chargement' || etat === 'echec' || !jeuId) && (
        <div style={{
          position: 'absolute', top: 10, left: 10, zIndex: 3,
          padding: '5px 10px', borderRadius: 6,
          background: 'var(--card-overlay)',
          border: '0.5px solid var(--border-default)',
          fontFamily: fInter, fontSize: 11,
          color: etat === 'echec' ? 'var(--danger)' : 'var(--text-secondary)',
        }}>
          {!jeuId ? 'Aucun jeu construit — réglez les anneaux, puis construisez.'
            : etat === 'chargement' ? 'Chargement des codes postaux…'
            : message}
        </div>
      )}

      {/* La légende : sans elle, une choroplèthe est un dessin. */}
      {etat === 'pret' && (
        <div style={{
          position: 'absolute', bottom: 24, left: 10, zIndex: 3,
          padding: '7px 10px', borderRadius: 6,
          background: 'var(--card-overlay)',
          border: '0.5px solid var(--border-default)',
          fontFamily: fInter, fontSize: 10, color: 'var(--text-secondary)',
        }}>
          <div style={{ marginBottom: 4, color: 'var(--text-primary)' }}>
            {LIBELLE_COLORATION[coloration]}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {RAMPE.map((c) => (
              <span key={c} style={{ width: 22, height: 8, background: c, display: 'block' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono }}>
            <span>faible</span><span>fort</span>
          </div>
          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 22, height: 8, background: GRIS_ECARTE, display: 'block' }} />
            <span>écarté par le seuil</span>
          </div>
        </div>
      )}
    </div>
  );
}
