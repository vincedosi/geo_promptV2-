'use client';

/**
 * La carte du module de risque — permanente, une seule instance.
 *
 * ── POURQUOI ELLE EXISTE ──────────────────────────────────────────────────
 *
 * L'onglet Zones était une pile de bandeaux : des rayons candidats, des zooms
 * de référence, un tableau de classes, une bibliothèque. Un atelier de ZONES
 * qui ne montrait aucune zone, et où « adopter 2 km » se décidait sur un
 * chiffre sans jamais voir ce que ces 2 km recouvrent.
 *
 * La carte devient donc le centre de l'écran, et les réglages passent à côté.
 *
 * ── ELLE ÉTAIT `CarteZones`, ET NE L'EST PLUS (2026-09-21) ────────────────
 *
 * Elle ne vivait que dans l'étape ④, alors que la carte EST l'objet du
 * module : on choisit des sites, on règle un rayon, on lit une couverture —
 * les trois se regardent sur une carte, et il fallait atteindre la dernière
 * étape pour en voir une.
 *
 * ⚠ **Une seule instance MapLibre, montée au niveau de l'overlay et JAMAIS
 * démontée entre les étapes** : seules les couches et la caméra changent. La
 * démonter et la remonter à chaque étape coûterait un rechargement complet du
 * fond, de la position et des tuiles — et surtout, on perdrait la vue de
 * l'utilisateur à chaque aller-retour entre ② et ③, qui est le geste le plus
 * fréquent du module.
 *
 * ── DEUX COUCHES, DEUX SOURCES, DEUX RAISONS ──────────────────────────────
 *
 * Les ZONES viennent des tuiles MVT déjà servies par `/api/tiles/zones-risque`
 * (sql/205) : géométries exclusives, découpées par `ST_Difference`, donc ce
 * qu'on voit à un endroit est la couleur d'UNE seule bande. Les peindre depuis
 * un GeoJSON chargé à la volée aurait demandé de refaire ce découpage côté
 * client, et de le refaire à chaque panoramique.
 *
 * Les SITES viennent de `/api/map/risques-industriels`, en GeoJSON sur la bbox
 * visible. Il n'existe pas de tuile pour eux, et il n'en faut pas : on n'en
 * affiche que quelques centaines à la fois, jamais les 99 152.
 *
 * ── LE PLANCHER DE ZOOM N'EST PAS UNE COQUETTERIE ─────────────────────────
 *
 * Sous `ZONES_RISQUE_ZOOM_PLANCHER`, MapLibre ne demande AUCUNE tuile et
 * n'émet aucune erreur — c'est ce qui a rendu la couche IRIS muette pendant
 * des mois. À l'échelle de la France, une zone de 2 km fait d'ailleurs moins
 * d'un pixel. La carte ouvre donc au-dessus du plancher, et le dit quand on
 * passe dessous.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { adminFetch } from '@/lib/admin-fetch';
import { ZONES_RISQUE_ZOOM_PLANCHER } from '@/lib/version';
import {
  expressionCouleurNiveau, expressionOpaciteBande,
  COULEUR_NIVEAU, COULEUR_NIVEAU_CSS, OPACITE_BANDE,
} from '@/lib/carte/palette-zones-risque';
import { TIRETE_ZONE_CALCULEE, LARGEUR_TRAIT_ZONE } from '@/lib/carte/nature-zone';
import { CONTOUR_POINT } from '@/lib/carte/palette-risques';
import { codeProfil, codeZonesRisque } from '@/lib/risques/code-profil';
import { LIBELLE_NIVEAU, anneauxDuNiveau, NIVEAUX, libelleRayon, type Niveau, type ProfilRayons } from '@/lib/risques/profil';
import { formaterNombre } from '@/lib/format/nombre';
import { fInter, fMono } from '@/lib/design/polices';

const SOURCE_ZONES = 'atelier-zones';
const SOURCE_SITES = 'atelier-sites';
const ID_FOND = 'atelier-zones-fond';
const ID_CONTOUR = 'atelier-zones-contour';
const ID_PPRT = 'atelier-zones-pprt';
const ID_SITES = 'atelier-sites-points';

/** Fond de carte neutre : la donnée doit dominer, pas le décor. */
const FONDS: Record<'dark' | 'light', string> = {
  dark: 'https://tiles.openfreemap.org/styles/positron',
  light: 'https://tiles.openfreemap.org/styles/positron',
};

/**
 * Les trois grappes industrielles denses.
 *
 * Densité mesurée le 2026-09-20, sites Seveso haut / bas dans chaque cadre :
 * Fos 41/14, Le Havre 22/12, vallée de la chimie 17/8. Elles existent parce
 * qu'une vue France entière ne montre JAMAIS l'objet de l'atelier : à cette
 * échelle une zone de 2 km fait moins d'un pixel.
 *
 * NON exportée : les boutons qui s'en servent vivent DANS cette carte. Un
 * export sans consommateur est du code mort que `npm run catalogue` compte,
 * et qui laisse croire qu'un autre écran s'en sert.
 */
const GRAPPES: Array<{ nom: string; bbox: [number, number, number, number] }> = [
  { nom: 'Vallée de la chimie', bbox: [4.75, 45.6, 5.05, 45.75] },
  { nom: 'Estuaire de la Seine', bbox: [0.05, 49.4, 0.55, 49.55] },
  { nom: 'Étang de Berre', bbox: [4.75, 43.35, 5.3, 43.6] },
];

/** Vue d'ouverture : l'Étang de Berre, la grappe la plus dense. */
const VUE_INITIALE = GRAPPES[2].bbox;

interface Props {
  profil: ProfilRayons;
  gravites: string[];
  /**
   * Natures de risque retenues. Vide = toutes.
   *
   * ⚠ Elles pilotent TROIS choses à la fois — les sites affichés, la clé de
   * cache des zones, et donc les tuiles demandées. Les oublier sur l'une des
   * trois donnerait une carte qui se contredit : des anneaux autour de sites
   * qu'elle n'affiche pas, ou l'inverse.
   */
  natures: string[];
}

export function CarteRisque({ profil, gravites, natures }: Props) {
  const conteneur = useRef<HTMLDivElement | null>(null);
  const carte = useRef<maplibregl.Map | null>(null);
  const { theme } = useTheme();
  const [zoom, setZoom] = useState(9);
  const [nSites, setNSites] = useState<number | null>(null);
  const [preparation, setPreparation] = useState(false);

  // ⚠ Les formes SÉRIALISÉES, jamais les tableaux : recréés à chaque rendu du
  // parent, ils relanceraient les effets indéfiniment.
  const cleGravites = gravites.join(',');
  const cleNatures = natures.join(',');
  /*
   * La clé de cache des ZONES porte le profil ET les natures, par la même
   * fonction que les deux routes serveur (préparation et tuiles). Sans les
   * natures, un filtre changeait le tableau et laissait la carte sur les
   * anneaux de tous les sites — la forme exacte du défaut que ce chantier
   * corrige, en plus visible.
   */
  const codeSeul = useMemo(() => codeProfil(profil), [profil]);
  const code = useMemo(
    () => codeZonesRisque(codeSeul, cleNatures ? cleNatures.split(',') : []),
    [codeSeul, cleNatures],
  );

  /* ── Montage ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!conteneur.current || carte.current) return;
    const m = new maplibregl.Map({
      container: conteneur.current,
      style: FONDS[theme],
      bounds: VUE_INITIALE,
      fitBoundsOptions: { padding: 40 },
      attributionControl: false,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    m.on('zoom', () => setZoom(m.getZoom()));
    carte.current = m;

    /*
     * ⚠ MapLibre ne redimensionne PAS son canevas tout seul quand son conteneur
     * change de taille sans que la fenêtre bouge — et c'est exactement ce qui
     * arrive ici : la poignée du panneau et le bouton « carte seule » changent
     * la largeur du conteneur, pas celle de la fenêtre. Sans cet observateur,
     * la carte garde ses anciennes dimensions : la moitié droite reste grise et
     * les clics tombent à côté des points.
     */
    const observateur = new ResizeObserver(() => m.resize());
    observateur.observe(conteneur.current);

    return () => { observateur.disconnect(); m.remove(); carte.current = null; };
    // Le thème est relu par l'effet suivant : le remonter ici détruirait la
    // carte à chaque bascule, donc la position de l'utilisateur avec elle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Les zones ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m) return;
    let annule = false;

    const poser = () => {
      if (annule) return;
      for (const id of [ID_FOND, ID_CONTOUR, ID_PPRT]) {
        if (m.getLayer(id)) m.removeLayer(id);
      }
      if (m.getSource(SOURCE_ZONES)) m.removeSource(SOURCE_ZONES);

      /*
       * ⚠ La source porte le profil dans son URL, donc changer de profil impose
       * de la RECRÉER : MapLibre ne permet pas de réécrire l'URL d'une source
       * vectorielle, et la garder servirait indéfiniment les tuiles de l'ancien
       * profil — une carte qui contredit sa propre légende.
       */
      m.addSource(SOURCE_ZONES, {
        type: 'vector',
        tiles: [
          `${window.location.origin}/api/tiles/zones-risque/{z}/{x}/{y}`
          /*
           * ⚠ `codeProfil(profil)` et non `code` : la route valide ce paramètre
           * par `profilDepuisCode`, qui ne sait relire qu'un profil. Les
           * natures voyagent à part, et le serveur recompose la MÊME clé.
           */
          + `?profil=${encodeURIComponent(codeSeul)}`
          + (cleNatures ? `&natures=${encodeURIComponent(cleNatures)}` : ''),
        ],
        minzoom: ZONES_RISQUE_ZOOM_PLANCHER,
        maxzoom: 14,
      });

      m.addLayer({
        id: ID_FOND,
        type: 'fill',
        source: SOURCE_ZONES,
        'source-layer': 'zones_risque',
        paint: {
          'fill-color': expressionCouleurNiveau(theme) as never,
          'fill-opacity': expressionOpaciteBande() as never,
        },
      });

      // Tireté = zone CALCULÉE par nous. La convention vit une seule fois,
      // dans `lib/carte/nature-zone.ts`, et vaut sur toutes les couches.
      m.addLayer({
        id: ID_CONTOUR,
        type: 'line',
        source: SOURCE_ZONES,
        'source-layer': 'zones_risque',
        filter: ['!=', ['get', 'bande'], null],
        paint: {
          'line-color': expressionCouleurNiveau(theme) as never,
          'line-width': LARGEUR_TRAIT_ZONE,
          'line-dasharray': TIRETE_ZONE_CALCULEE as never,
          'line-opacity': 0.9,
        },
      });

      // Plein = servitude PUBLIÉE par l'État. Un lecteur doit distinguer
      // l'opposable du calculé sans lire la légende.
      m.addLayer({
        id: ID_PPRT,
        type: 'line',
        source: SOURCE_ZONES,
        'source-layer': 'zones_risque',
        filter: ['==', ['get', 'bande'], null],
        paint: {
          'line-color': expressionCouleurNiveau(theme) as never,
          'line-width': LARGEUR_TRAIT_ZONE + 0.5,
          'line-opacity': 1,
        },
      });
    };

    /*
     * ⚠ La géométrie est PRÉPARÉE avant qu'on pose la source.
     *
     * Sans cela, MapLibre demanderait ses tuiles sous une clé que personne n'a
     * construite et échouerait en SILENCE sur une source vide — le défaut exact
     * qui a rendu la couche IRIS muette pendant des mois. L'appel est
     * idempotent (`deja_construit: true`) et mesuré à 1 326 ms pour les sept
     * classes du profil par défaut sur la France entière.
     */
    const preparerPuisPoser = async () => {
      setPreparation(true);
      try {
        await adminFetch('/api/risques/zones/preparer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Le PROFIL seul dans `profil`, les natures à part : le serveur
          // recompose la clé, pour qu'elle ne puisse pas diverger de celle
          // sous laquelle la couche demandera ses tuiles.
          body: JSON.stringify({
            profil: codeSeul,
            // Reconstruit depuis la forme sérialisée : l'effet ne dépend ainsi
            // que de chaînes, et le linter peut vérifier ses dépendances.
            natures: cleNatures ? cleNatures.split(',') : [],
          }),
        });
      } catch {
        // La carte reste utilisable : le fond et les sites s'affichent, et
        // l'absence de zones se voit. Masquer la carte serait pire.
      }
      if (annule) return;
      setPreparation(false);
      if (m.isStyleLoaded()) poser();
      else m.once('load', poser);
    };

    void preparerPuisPoser();
    return () => { annule = true; };
  }, [code, codeSeul, cleNatures, theme]);

  /* ── Les sites ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m) return;
    let annule = false;
    let minuteur: ReturnType<typeof setTimeout> | null = null;

    const charger = async () => {
      const b = m.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
        .map((v) => v.toFixed(4)).join(',');
      try {
        const p = new URLSearchParams({ bbox, limite: '800' });
        if (cleGravites) p.set('gravites', cleGravites);
        if (cleNatures) p.set('natures', cleNatures);
        const r = await adminFetch(`/api/map/risques-industriels?${p}`);
        if (!r.ok || annule) return;
        const j = await r.json();
        // La route rend une FeatureCollection telle quelle.
        const fc = j as GeoJSON.FeatureCollection;
        if (annule || !m.getStyle()) return;

        const src = m.getSource(SOURCE_SITES) as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(fc);
        } else {
          m.addSource(SOURCE_SITES, { type: 'geojson', data: fc });
          m.addLayer({
            id: ID_SITES,
            type: 'circle',
            source: SOURCE_SITES,
            paint: {
              // Le point grossit avec le zoom : à z8 il ne doit pas masquer la
              // zone qu'il engendre, à z13 il doit rester cliquable.
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 13, 5.5],
              /*
               * ⚠ `COULEUR_NIVEAU[theme]` et NON `COULEUR_NIVEAU_CSS`.
               *
               * MapLibre ne résout PAS `var()` dans `paint` — c'est la raison
               * d'être des deux constantes, et de la duplication des palettes
               * divergente et séquentielle (`DESIGN_SYSTEM.md`). Avec les
               * jetons CSS, `addLayer` LÈVE : « Could not parse color from
               * value 'var(--niveau-haut)' », la couche n'est jamais ajoutée,
               * et la légende annonçait pourtant « 58 sites affichés » —
               * `setNSites` ayant réussi, lui. Un compte juste pour des points
               * absents.
               *
               * La légende, elle, est du DOM : elle garde les jetons CSS et
               * suit donc le thème sans recopier une teinte.
               */
              'circle-color': [
                'match', ['get', 'gravite'],
                'seveso_haut', COULEUR_NIVEAU[theme].haut,
                'seveso_bas', COULEUR_NIVEAU[theme].bas,
                COULEUR_NIVEAU[theme].autres,
              ] as never,
              // Cerne INVERSÉ entre thèmes : un cerne blanc sur fond clair ne
              // détoure plus rien, et le point perd ce qui le rend lisible
              // au-dessus d'une zone colorée (`DESIGN_SYSTEM.md`).
              'circle-stroke-color': CONTOUR_POINT[theme],
              'circle-stroke-width': 1,
            },
          });
        }
        setNSites(Array.isArray(fc?.features) ? fc.features.length : null);
      } catch {
        // Une carte sans ses points reste lisible : les zones sont l'objet.
        // Effacer la couche ferait croire qu'il n'y a plus de site.
      }
    };

    const differer = () => {
      if (minuteur) clearTimeout(minuteur);
      // Un panoramique émet des dizaines d'événements : sans ce délai, chacun
      // partirait en requête et le quota mordrait sur l'usage normal.
      minuteur = setTimeout(() => void charger(), 350);
    };

    /*
     * Une infobulle au clic, et non au survol : sur une grappe dense les
     * points se touchent, et un survol ferait clignoter l'écran au moindre
     * déplacement de souris.
     */
    const surClic = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, unknown>;
      const niveau = p.gravite === 'seveso_haut' ? 'haut'
        : p.gravite === 'seveso_bas' ? 'bas' : 'autres';
      // `textContent` plutôt qu'une chaîne HTML : les noms de sites viennent
      // d'un import tiers, et un `<` y suffirait à casser le contenu — ou pire.
      const bloc = document.createElement('div');
      bloc.style.fontFamily = fInter;
      bloc.style.fontSize = '11.5px';
      bloc.style.lineHeight = '1.55';
      const titre = document.createElement('div');
      titre.style.fontWeight = '500';
      titre.style.marginBottom = '2px';
      titre.textContent = String(p.nom ?? 'Site sans nom');
      const detail = document.createElement('div');
      detail.style.color = 'var(--text-tertiary)';
      detail.textContent = [
        p.statut_seveso, p.ville, p.libelle_nature,
      ].filter(Boolean).map(String).join(' · ');
      bloc.append(titre, detail);

      new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setDOMContent(bloc)
        .addTo(m);
      void niveau;
    };
    m.on('click', ID_SITES, surClic);
    m.on('mouseenter', ID_SITES, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', ID_SITES, () => { m.getCanvas().style.cursor = ''; });

    m.on('moveend', differer);
    if (m.isStyleLoaded()) void charger();
    else m.once('load', () => void charger());

    return () => {
      annule = true;
      if (minuteur) clearTimeout(minuteur);
      m.off('moveend', differer);
      m.off('click', ID_SITES, surClic);
    };
  }, [cleGravites, cleNatures, theme]);

  const sousLePlancher = zoom < ZONES_RISQUE_ZOOM_PLANCHER;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
      <div ref={conteneur} style={{ position: 'absolute', inset: 0 }} />

      {/* ── Aller voir une grappe ─────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute', top: 10, left: 10, zIndex: 2,
          display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 'calc(100% - 100px)',
        }}
      >
        {GRAPPES.map((g) => (
          <button
            key={g.nom}
            type="button"
            onClick={() => carte.current?.fitBounds(
              [[g.bbox[0], g.bbox[1]], [g.bbox[2], g.bbox[3]]],
              { padding: 40, duration: 800 },
            )}
            style={{
              padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
              fontFamily: fInter, fontSize: 11,
              background: 'var(--card-overlay)',
              border: '0.5px solid var(--border-default)',
              color: 'var(--text-secondary)',
            }}
          >
            {g.nom}
          </button>
        ))}
      </div>

      {/* ── Légende ──────────────────────────────────────────────────────
          Elle ne liste QUE les niveaux qui portent un anneau : une entrée
          vide se lirait « aucun habitant à ce niveau », alors qu'elle
          signifie « ce niveau n'est pas calculé ». */}
      <div
        style={{
          position: 'absolute', bottom: 10, left: 10, zIndex: 2,
          padding: '9px 11px', borderRadius: 8, maxWidth: 260,
          background: 'var(--card-overlay)',
          border: '0.5px solid var(--border-subtle)',
        }}
      >
        {NIVEAUX.map((n) => {
          const anneaux = anneauxDuNiveau(profil, n as Niveau);
          if (anneaux.length === 0) return null;
          return (
            <div key={n} style={{ marginBottom: 6 }}>
              <div style={{ fontFamily: fInter, fontSize: 10.5, color: 'var(--text-secondary)', marginBottom: 3 }}>
                {LIBELLE_NIVEAU[n as Niveau]}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {anneaux.map((r, i) => (
                  <span key={r} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 13, height: 13, borderRadius: 3,
                        background: COULEUR_NIVEAU_CSS[n as Niveau],
                        opacity: OPACITE_BANDE[Math.min(i, OPACITE_BANDE.length - 1)],
                        border: `0.5px solid ${COULEUR_NIVEAU_CSS[n as Niveau]}`,
                      }}
                    />
                    <span style={{ fontFamily: fMono, fontSize: 9.5, color: 'var(--text-tertiary)' }}>
                      {libelleRayon(r)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        <div style={{ fontFamily: fInter, fontSize: 9.5, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 2 }}>
          Trait plein : périmètre publié par l’État. Tireté : rayon que nous
          calculons.
          {nSites !== null && ` · ${formaterNombre(nSites)} sites affichés`}
        </div>
      </div>

      {/* ── Sous le plancher ─────────────────────────────────────────────
          MapLibre ne demande AUCUNE tuile sous le minzoom d'une source, et
          n'émet aucune erreur : sans ce bandeau, la carte paraîtrait vide
          alors qu'elle n'a simplement rien demandé. */}
      {sousLePlancher && (
        <div
          style={{
            position: 'absolute', top: 50, left: 10, zIndex: 2,
            padding: '7px 11px', borderRadius: 6, maxWidth: 300,
            background: 'rgba(247,183,49,0.12)',
            border: '0.5px solid rgba(247,183,49,0.25)',
            fontFamily: fInter, fontSize: 11, color: 'var(--warning)', lineHeight: 1.5,
          }}
        >
          Zoomez pour voir les zones : à cette échelle, un rayon de 2 km fait
          moins d’un pixel.
        </div>
      )}

      {preparation && (
        <div
          style={{
            position: 'absolute', top: 10, right: 56, zIndex: 2,
            padding: '6px 10px', borderRadius: 6,
            background: 'var(--card-overlay)',
            border: '0.5px solid var(--border-subtle)',
            fontFamily: fInter, fontSize: 10.5, color: 'var(--text-secondary)',
          }}
        >
          Découpage des zones…
        </div>
      )}

      {/*
        ⚠ Le bandeau « construisez le jeu pour en tirer des codes postaux »
        vivait ICI et a rejoint le panneau de l'étape ④ (2026-09-21). C'est une
        consigne sur le geste suivant, et le bouton qui l'exécute est dans ce
        panneau : la carte est désormais commune aux quatre étapes, et elle
        aurait porté sur les trois autres un conseil sans rapport avec ce qu'on
        y fait.
      */}
    </div>
  );
}
