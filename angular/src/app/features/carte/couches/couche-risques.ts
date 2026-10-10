import type maplibregl from 'maplibre-gl';
import { formaterNombre } from '../../../core/format/nombre';
import type { CollectionSitesRisque, ExpositionSite } from '../../risques/data/sites-risque.api';
import { libelleGravite } from '../../risques/logique/gravites';
import { LARGEUR_TRAIT_ZONE, TIRETE_ZONE_CALCULEE, descriptionStatut } from '../../risques/logique/nature-zone';
import { LARGEUR_TRAIT_PPRT, LIBELLE_TYPE_ZONE_PPRT } from '../logique/pprt';
import { JETON_TYPE, LIBELLE_TYPE, type TypeRisque } from '../logique/types-risque';

/**
 * Les couches MapLibre des sites ICPE et des périmètres PPRT de la carte principale — fonctions PURES, portage du
 * rendu de `app/map/_components/RisqueIndustrielLayer.tsx` et `PprtLayer.tsx` (lot 4, T12).
 *
 * ⚠ Jamais `var()` dans `paint` (`addLayer` LÈVE, la couche n'existe pas, et le compte « N sites » resterait juste) :
 * les teintes arrivent RÉSOLUES par `CouleursService`. Les popups, elles, vivent dans le DOM : `var(--x)` y est résolu.
 * Elles sont construites par `textContent` (jamais d'HTML concaténé : noms et adresses viennent de la base).
 */

export const SOURCE_RISQUES_POINTS = 'risques-industriels-src';
export const SOURCE_RISQUES_ZONES = 'risques-industriels-zones-src';
export const COUCHE_RISQUES_ZONE = 'risques-zone';
export const COUCHE_RISQUES_ZONE_CONTOUR = 'risques-zone-contour';
export const COUCHE_RISQUES_HALO = 'risques-halo';
export const COUCHE_RISQUES_POINT = 'risques-point';

export const SOURCE_PPRT = 'pprt-perimetres';
export const COUCHE_PPRT_FOND = 'pprt-fond';
export const COUCHE_PPRT_CONTOUR = 'pprt-contour';

/** Littéraux de `RisqueIndustrielLayer.tsx:349-393`, verrouillés par `tests/unit/angular/carte-couches-paritaire.test.ts`. */
export const OPACITE_ZONE_RISQUE = 0.18;
export const OPACITE_CONTOUR_ZONE_RISQUE = 0.7;
export const RAYON_HALO_RISQUE = ['interpolate', ['linear'], ['zoom'], 4, 6, 8, 14, 12, 26] as const;
export const FLOU_HALO_RISQUE = 1;
export const OPACITE_HALO_RISQUE = 0.35;
export const RAYON_POINT_RISQUE = ['interpolate', ['linear'], ['zoom'], 4, 3, 8, 5, 12, 7] as const;
export const TRAIT_POINT_RISQUE = 1;

/** Les jetons lus par `CouleursService` : un par type de risque, et le cerne du point (INVERSÉ entre thèmes). */
export const JETONS_RISQUES = { ...JETON_TYPE, contour: 'contour-point' } as const;
export type TeintesRisques = Record<keyof typeof JETONS_RISQUES, string>;

/** `expressionCouleurRisque(theme)` (`palette-risques.ts:188-199`), teintes résolues. */
export function expressionCouleurRisque(t: TeintesRisques): unknown[] {
  return [
    'match', ['get', 'type_risque'],
    'toxique', t.toxique,
    'inflammable', t.inflammable,
    'pollution', t.pollution,
    'autres', t.autres,
    t.non_precise,
  ];
}

const VIDE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

type CarteCouches = Pick<maplibregl.Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer' | 'setPaintProperty'>;

/** Les zones calculées : un jeu SÉPARÉ de polygones, pour que le point reste un point (`RisqueIndustrielLayer.tsx:318-327`). */
export function zonesDesSites(charge: CollectionSitesRisque): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: charge.features
      .filter((f) => f.properties['zone'])
      .map((f) => ({
        type: 'Feature' as const,
        geometry: f.properties['zone'] as GeoJSON.Geometry,
        properties: { type_risque: f.properties['type_risque'], id: f.properties['id'] },
      })),
  };
}

/**
 * Sources et couches des sites, IDEMPOTENT (`getSource`/`getLayer` sur l'instance), au SOMMET comme React (aucun
 * `beforeId` : ces couches naissent après le chargement de la carte, hors de `ORDRE_COUCHES`) : zone, contour tireté,
 * halo, point.
 */
export function poserCouchesRisques(carte: CarteCouches, t: TeintesRisques): void {
  const couleur = expressionCouleurRisque(t) as maplibregl.ExpressionSpecification;
  if (!carte.getSource(SOURCE_RISQUES_ZONES)) carte.addSource(SOURCE_RISQUES_ZONES, { type: 'geojson', data: VIDE });
  if (!carte.getSource(SOURCE_RISQUES_POINTS)) carte.addSource(SOURCE_RISQUES_POINTS, { type: 'geojson', data: VIDE });
  if (!carte.getLayer(COUCHE_RISQUES_ZONE)) {
    carte.addLayer({
      id: COUCHE_RISQUES_ZONE, type: 'fill', source: SOURCE_RISQUES_ZONES,
      paint: { 'fill-color': couleur, 'fill-opacity': OPACITE_ZONE_RISQUE },
    });
    carte.addLayer({
      id: COUCHE_RISQUES_ZONE_CONTOUR, type: 'line', source: SOURCE_RISQUES_ZONES,
      paint: {
        'line-color': couleur,
        // TIRETÉ et fin : cette zone est CALCULÉE par nous (`nature-zone.ts`) ; le périmètre PPRT est plein et plus épais.
        'line-width': LARGEUR_TRAIT_ZONE,
        'line-opacity': OPACITE_CONTOUR_ZONE_RISQUE,
        'line-dasharray': [...TIRETE_ZONE_CALCULEE],
      },
    });
  }
  if (!carte.getLayer(COUCHE_RISQUES_HALO)) {
    carte.addLayer({
      id: COUCHE_RISQUES_HALO, type: 'circle', source: SOURCE_RISQUES_POINTS,
      paint: {
        'circle-color': couleur,
        // Rayon en PIXELS : une aide de lecture, pas une mesure (la mesure, c'est la zone).
        'circle-radius': [...RAYON_HALO_RISQUE] as unknown as maplibregl.ExpressionSpecification,
        'circle-blur': FLOU_HALO_RISQUE,
        'circle-opacity': OPACITE_HALO_RISQUE,
      },
    });
  }
  if (!carte.getLayer(COUCHE_RISQUES_POINT)) {
    carte.addLayer({
      id: COUCHE_RISQUES_POINT, type: 'circle', source: SOURCE_RISQUES_POINTS,
      paint: {
        'circle-color': couleur,
        'circle-radius': [...RAYON_POINT_RISQUE] as unknown as maplibregl.ExpressionSpecification,
        'circle-stroke-width': TRAIT_POINT_RISQUE,
        'circle-stroke-color': t.contour,
      },
    });
  }
}

/** Bascule de thème : les quatre couleurs et le cerne REPEINTS, sans recréer ni source ni couche, ni relire. */
export function repeindreCouchesRisques(carte: CarteCouches, t: TeintesRisques): void {
  const couleur = expressionCouleurRisque(t);
  const peindre = (id: string, propriete: string, valeur: unknown) => {
    if (carte.getLayer(id)) carte.setPaintProperty(id, propriete, valeur);
  };
  peindre(COUCHE_RISQUES_ZONE, 'fill-color', couleur);
  peindre(COUCHE_RISQUES_ZONE_CONTOUR, 'line-color', couleur);
  peindre(COUCHE_RISQUES_HALO, 'circle-color', couleur);
  peindre(COUCHE_RISQUES_POINT, 'circle-color', couleur);
  peindre(COUCHE_RISQUES_POINT, 'circle-stroke-color', t.contour);
}

/** Retrait dans l'ordre inverse de l'ajout (`RisqueIndustrielLayer.tsx:228-239`). */
export function retirerCouchesRisques(carte: Pick<maplibregl.Map, 'getLayer' | 'removeLayer' | 'getSource' | 'removeSource'>): void {
  for (const id of [COUCHE_RISQUES_POINT, COUCHE_RISQUES_HALO, COUCHE_RISQUES_ZONE_CONTOUR, COUCHE_RISQUES_ZONE]) {
    if (carte.getLayer(id)) carte.removeLayer(id);
  }
  for (const s of [SOURCE_RISQUES_POINTS, SOURCE_RISQUES_ZONES]) if (carte.getSource(s)) carte.removeSource(s);
}

/** Les teintes du périmètre PPRT (`--pprt-contour`, `--pprt-fond`) : ACHROMATIQUES, le trait porte l'autorité. */
export interface TeintesPprt {
  contour: string;
  fond: string;
}

/** `line-width` du périmètre (`PprtLayer.tsx:190-200`) : plein, et le plus épais des deux traits. */
export const LARGEUR_CONTOUR_PPRT = [
  'interpolate', ['linear'], ['zoom'],
  8, LARGEUR_TRAIT_PPRT * 0.8,
  12, LARGEUR_TRAIT_PPRT,
  16, LARGEUR_TRAIT_PPRT * 1.4,
] as const;

/** Source et couches des périmètres, IDEMPOTENT, au sommet (`PprtLayer.tsx:161-203`). */
export function poserCouchesPprt(carte: CarteCouches, t: TeintesPprt): void {
  if (!carte.getSource(SOURCE_PPRT)) carte.addSource(SOURCE_PPRT, { type: 'geojson', data: VIDE });
  if (!carte.getLayer(COUCHE_PPRT_FOND)) {
    carte.addLayer({
      id: COUCHE_PPRT_FOND, type: 'fill', source: SOURCE_PPRT,
      // Le fond n'est presque pas visible : il sert surtout de cible de clic.
      paint: { 'fill-color': t.fond, 'fill-opacity': 1 },
    });
  }
  if (!carte.getLayer(COUCHE_PPRT_CONTOUR)) {
    carte.addLayer({
      id: COUCHE_PPRT_CONTOUR, type: 'line', source: SOURCE_PPRT,
      paint: {
        'line-color': t.contour,
        'line-width': [...LARGEUR_CONTOUR_PPRT] as unknown as maplibregl.ExpressionSpecification,
      },
    });
  }
}

export function repeindreCouchesPprt(carte: CarteCouches, t: TeintesPprt): void {
  if (carte.getLayer(COUCHE_PPRT_FOND)) carte.setPaintProperty(COUCHE_PPRT_FOND, 'fill-color', t.fond);
  if (carte.getLayer(COUCHE_PPRT_CONTOUR)) carte.setPaintProperty(COUCHE_PPRT_CONTOUR, 'line-color', t.contour);
}

export function retirerCouchesPprt(carte: Pick<maplibregl.Map, 'getLayer' | 'removeLayer' | 'getSource' | 'removeSource'>): void {
  for (const id of [COUCHE_PPRT_CONTOUR, COUCHE_PPRT_FOND]) if (carte.getLayer(id)) carte.removeLayer(id);
  if (carte.getSource(SOURCE_PPRT)) carte.removeSource(SOURCE_PPRT);
}

/* ─────────────────────────────────────────────────────────────────────────
   Popups — DOM construit par `textContent`. Styles = ceux des chaînes de React (`lib/map/popup.ts`,
   `RisqueIndustrielLayer.tsx:435-494`, `PprtLayer.tsx:217-235`), couleurs en jetons.
   ───────────────────────────────────────────────────────────────────────── */

const INTER = 'Inter,system-ui,sans-serif';
const MONO = "'JetBrains Mono',monospace";

function el(doc: Document, balise: string, style: Partial<CSSStyleDeclaration>, texte?: string): HTMLElement {
  const e = doc.createElement(balise);
  Object.assign(e.style, style);
  if (texte !== undefined) e.textContent = texte;
  return e;
}

/** `lignePopup` (`lib/map/popup.ts:28-36`) : `null` si la valeur est absente — jamais « Adresse : — ». */
export function lignePopup(doc: Document, intitule: string, valeur: unknown): HTMLElement | null {
  const v = valeur === null || valeur === undefined ? '' : String(valeur).trim();
  if (!v) return null;
  const ligne = el(doc, 'div', { display: 'flex', gap: '8px', marginTop: '3px' });
  ligne.append(
    el(doc, 'span', { color: 'var(--text-tertiary)', flex: '0 0 96px' }, intitule),
    el(doc, 'span', { color: 'var(--text-secondary)' }, v),
  );
  return ligne;
}

/**
 * `cadrePopup` : police, taille, largeur maximale. SANS la marge interne `8px 10px` de React : côté Angular, la bulle
 * MapLibre la porte déjà (`styles.css`, arbitrage 3 du lot Rendu, alors que React la met à 0) — la doubler décalait le
 * contenu de 8 px par rapport à React (constaté au navigateur). La largeur suit : React borne à 320 px marge comprise
 * (`box-sizing: border-box` du préflight), donc 300 px de contenu ici, sous les 2 × 10 px de la bulle.
 */
function cadre(doc: Document, largeurMax = 320): HTMLElement {
  return el(doc, 'div', { fontFamily: INTER, fontSize: '11px', maxWidth: `${largeurMax - 20}px` });
}

function ajouter(parent: HTMLElement, ...enfants: (HTMLElement | null)[]): void {
  for (const e of enfants) if (e) parent.append(e);
}

/** Les données riches d'un site, gardées À CÔTÉ de la source (MapLibre aplatit les propriétés imbriquées). */
export interface DonneesRichesSite {
  natures: string[];
  rubriques: Array<Record<string, unknown>>;
}

export function donneesRiches(charge: CollectionSitesRisque): Map<string, DonneesRichesSite> {
  return new Map(charge.features.map((f) => [
    String(f.properties['id']),
    {
      natures: (f.properties['natures_risque'] as string[] | undefined) ?? [],
      rubriques: (f.properties['rubriques'] as Array<Record<string, unknown>> | undefined) ?? [],
    },
  ]));
}

/**
 * La popup d'un site (`RisqueIndustrielLayer.tsx:407-494`) : tout ce dont on dispose, la réponse à « calculée ou
 * réelle ? » (`statut_zone`, calculé en base), les rubriques ICPE, et l'emplacement de la population exposée (rempli
 * APRÈS l'ouverture : le calcul prend ~300 ms). Rend la racine et ce bloc.
 */
export function contenuPopupSite(
  p: Record<string, unknown>, riches: DonneesRichesSite | undefined, teintes: TeintesRisques, doc: Document,
): { racine: HTMLElement; exposition: HTMLElement } {
  const type = String(p['type_risque'] ?? 'non_precise') as TypeRisque;
  const natures = riches?.natures ?? [];
  const rubriques = riches?.rubriques ?? [];
  const statut = descriptionStatut(p['statut_zone'] as string | null | undefined);
  const racine = cadre(doc);
  racine.setAttribute('data-popup-site', '');

  racine.append(el(doc, 'div', { fontSize: '12px', fontWeight: '500', color: 'var(--text-primary)' }, String(p['nom'] ?? 'Site sans nom')));
  const typeLigne = el(doc, 'div', { display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0' });
  typeLigne.append(
    el(doc, 'span', {
      width: '8px', height: '8px', borderRadius: '50%', flex: '0 0 auto',
      background: teintes[type in LIBELLE_TYPE ? type : 'non_precise'],
    }),
    el(doc, 'span', { color: 'var(--text-secondary)' }, LIBELLE_TYPE[type] ?? LIBELLE_TYPE.non_precise),
  );
  racine.append(typeLigne);

  const nb = p['nb_inspections'];
  ajouter(racine,
    lignePopup(doc, 'Niveau', libelleGravite(String(p['gravite'] ?? ''))),
    lignePopup(doc, 'Adresse', p['adresse']),
    lignePopup(doc, 'Commune', [p['code_postal'], p['ville']].filter(Boolean).join(' ')),
    lignePopup(doc, 'Département', p['departement']),
    lignePopup(doc, 'Coordonnées', `${Number(p['lat']).toFixed(5)}, ${Number(p['lng']).toFixed(5)}`),
    lignePopup(doc, 'Risque principal', p['libelle_nature']),
    natures.length > 1 ? lignePopup(doc, 'Autres risques', natures.slice(1).join(', ')) : null,
    lignePopup(doc, 'Statut Seveso', p['statut_seveso']),
    lignePopup(doc, 'Régime', p['regime']),
    lignePopup(doc, 'Directive IED', p['ied'] ? 'oui' : ''),
    lignePopup(doc, 'Priorité nationale', p['priorite_nationale'] ? 'oui' : ''),
    lignePopup(doc, 'Activité', p['etat_activite']),
    lignePopup(doc, 'DREAL', p['dreal']),
    lignePopup(doc, 'SIRET', p['siret']),
    lignePopup(doc, 'Code NAF', p['code_naf']),
    lignePopup(doc, 'Code AIOT', p['code_aiot']),
    lignePopup(doc, 'Dernière inspection', p['derniere_inspection']),
    lignePopup(doc, 'Inspections', nb ? `${nb} au total` : ''),
  );

  // La réponse à « calculée ou réelle ? », toujours affichée : un site sans périmètre doit le DIRE.
  const bloc = el(doc, 'div', { marginTop: '8px', paddingTop: '6px', borderTop: '0.5px solid var(--border-subtle)' });
  bloc.setAttribute('data-statut-zone', String(p['statut_zone'] ?? ''));
  const tete = el(doc, 'div', { display: 'flex', alignItems: 'center', gap: '6px' });
  tete.append(
    el(doc, 'span', {
      width: '14px', height: '0', flex: '0 0 auto',
      borderTop: `1.5px ${statut.reglementaire ? 'solid' : 'dashed'} var(--text-secondary)`,
    }),
    el(doc, 'span', { color: 'var(--text-primary)', fontWeight: '500' }, statut.libelle),
  );
  if (p['pprt_km2']) tete.append(el(doc, 'span', { color: 'var(--text-secondary)' }, `— ${formaterNombre(Number(p['pprt_km2']))} km²`));
  bloc.append(tete);
  ajouter(bloc,
    p['pprt_nom'] ? lignePopup(doc, 'Plan', p['pprt_nom']) : null,
    Number(p['pprt_distance_m']) > 0 ? lignePopup(doc, 'Distance au périmètre', `${formaterNombre(Number(p['pprt_distance_m']))} m`) : null,
    el(doc, 'div', { color: 'var(--text-tertiary)', marginTop: '4px', lineHeight: '1.4' }, statut.explication),
  );
  racine.append(bloc);

  ajouter(racine,
    lignePopup(doc, 'Zone affichée', p['rayon_m'] ? `rayon ${p['rayon_m']} m — calculé, indicatif` : ''),
    lignePopup(doc, 'Donnée du', p['date_maj_source']),
  );

  if (rubriques.length > 0) {
    racine.append(el(doc, 'div', { marginTop: '6px', color: 'var(--text-tertiary)' }, 'Rubriques ICPE'));
    const liste = el(doc, 'ul', { margin: '2px 0 0 14px', padding: '0', color: 'var(--text-secondary)' });
    for (const r of rubriques.slice(0, 6)) {
      const q = r['quantite'] ? ` — ${String(r['quantite'])} ${String(r['unite'] ?? '')}` : '';
      liste.append(el(doc, 'li', { marginTop: '2px' }, `${String(r['numero'] ?? '')} ${String(r['nature'] ?? '')}${q}`));
    }
    racine.append(liste);
    if (rubriques.length > 6) {
      racine.append(el(doc, 'div', { color: 'var(--text-tertiary)', marginTop: '2px' }, `+ ${rubriques.length - 6} autres`));
    }
  }

  const exposition = el(doc, 'div', {
    marginTop: '8px', paddingTop: '6px', borderTop: '0.5px solid var(--border-subtle)', color: 'var(--text-tertiary)',
  }, 'Population exposée — calcul…');
  exposition.setAttribute('data-exposition', '');
  racine.append(exposition);
  return { racine, exposition };
}

/**
 * Remplit le bloc de population exposée (`remplirExposition`, `RisqueIndustrielLayer.tsx:117-178`). `indicatif` ne doit
 * jamais se perdre : le même nombre d'habitants ne vaut pas la même chose sur un rayon choisi et sur la servitude PPRT.
 */
export function remplirExposition(bloc: HTMLElement, charge: ExpositionSite | null, erreur: string | null): void {
  const doc = bloc.ownerDocument;
  bloc.replaceChildren();
  if (erreur !== null || !charge) {
    bloc.textContent = erreur ?? 'Population exposée indisponible.';
    return;
  }
  const paliers = charge.paliers ?? [];
  if (paliers.length === 0) {
    bloc.textContent = 'Population exposée non calculable.';
    return;
  }
  const indicatif = charge.indicatif !== false;
  bloc.append(el(doc, 'div', { color: 'var(--text-primary)', fontWeight: '500', marginBottom: '4px' }, 'Population exposée'));
  for (const pa of paliers) {
    const ligne = el(doc, 'div', { display: 'flex', justifyContent: 'space-between', gap: '10px' });
    ligne.setAttribute('data-palier-exposition', pa.palier);
    const valeur = el(doc, 'span', { fontFamily: MONO, color: 'var(--text-primary)' }, formaterNombre(pa.pop_exposee));
    // En mode buffer, la couronne dit ce que CE palier ajoute au précédent : trois cumuls ne s'additionnent pas.
    if (charge.mode === 'buffer' && pa.pop_couronne !== pa.pop_exposee) {
      valeur.append(el(doc, 'span', { color: 'var(--text-tertiary)' }, ` (+${formaterNombre(pa.pop_couronne)})`));
    }
    ligne.append(el(doc, 'span', { color: 'var(--text-secondary)' }, pa.libelle), valeur);
    bloc.append(ligne);
  }
  bloc.append(el(doc, 'div', { color: 'var(--text-tertiary)', marginTop: '4px', lineHeight: '1.4' },
    (indicatif
      ? 'Estimée sur des rayons choisis dans le panneau — aucune valeur réglementaire.'
      : 'Estimée sur le périmètre PPRT publié par l’État.')
    + ' Répartition au prorata de surface des carreaux INSEE de 200 m.'));
}

/** La popup d'un périmètre PPRT (`PprtLayer.tsx:209-235`). La dernière phrase n'est PAS conditionnelle. */
export function contenuPopupPprt(p: Record<string, unknown>, doc: Document): HTMLElement {
  const type = String(p['type_zone'] ?? '');
  const km2 = Number(p['superficie_km2']);
  const date = p['date_source'] ? String(p['date_source']).slice(0, 10) : '';
  const racine = cadre(doc);
  racine.setAttribute('data-popup-pprt', '');
  racine.append(
    el(doc, 'div', { fontSize: '12px', fontWeight: '500', color: 'var(--text-primary)' }, String(p['nom'] ?? '').trim() || 'Sans nom'),
    el(doc, 'div', { color: 'var(--text-tertiary)', margin: '4px 0 2px' }, 'Périmètre PPRT — servitude PM3'),
  );
  ajouter(racine,
    lignePopup(doc, 'Nature', LIBELLE_TYPE_ZONE_PPRT[type] ?? type),
    lignePopup(doc, 'Département', [p['code_departement'], p['nom_departement']].filter(Boolean).join(' — ')),
    // `p.superficie_km2` absent → `Number(undefined)` = NaN → ligne omise, comme React.
    lignePopup(doc, 'Superficie', Number.isFinite(km2) ? `${formaterNombre(km2)} km²` : ''),
    lignePopup(doc, 'Acte', p['fichier_acte']),
    lignePopup(doc, 'Tracé', p['mode_geometrie']),
    lignePopup(doc, 'Déposé le', date),
    lignePopup(doc, 'Générateur', p['id_generateur']),
  );
  racine.append(el(doc, 'div', { color: 'var(--text-tertiary)', marginTop: '6px', lineHeight: '1.4' },
    'Périmètre réglementaire opposable, et non le rayon indicatif réglable de la couche « Zones à risque industriel ».'));
  return racine;
}
