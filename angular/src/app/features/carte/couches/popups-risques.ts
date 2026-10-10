import { elementTexte } from '../../../carte/contenu-popup';
import { formaterNombre } from '../../../core/format/nombre';
import type { CollectionSitesRisque, ExpositionSite } from '../../risques/data/sites-risque.api';
import { libelleGravite } from '../../risques/logique/gravites';
import { descriptionStatut } from '../../risques/logique/nature-zone';
import { LIBELLE_TYPE_ZONE_PPRT } from '../logique/pprt';
import { LIBELLE_TYPE, type TypeRisque } from '../logique/types-risque';
import type { TeintesRisques } from './couche-risques';

/**
 * Les popups des sites ICPE et des périmètres PPRT de la carte principale — portage de
 * `RisqueIndustrielLayer.tsx:117-178,407-494` et `PprtLayer.tsx:209-235` (lot 4, T12 ; séparées des couches MapLibre
 * à la revue 1). DOM construit par `elementTexte` (`textContent`, jamais d'HTML concaténé : noms et adresses viennent
 * de la base). Styles = ceux des chaînes de React (`lib/map/popup.ts`) ; couleurs en jetons, résolus par le DOM.
 */

const INTER = 'Inter,system-ui,sans-serif';
const MONO = "'JetBrains Mono',monospace";

/** `lignePopup` (`lib/map/popup.ts:28-36`) : `null` si la valeur est absente — jamais « Adresse : — ». */
export function lignePopup(doc: Document, intitule: string, valeur: unknown): HTMLElement | null {
  const v = valeur === null || valeur === undefined ? '' : String(valeur).trim();
  if (!v) return null;
  const ligne = elementTexte(doc, 'div', { display: 'flex', gap: '8px', marginTop: '3px' });
  ligne.append(
    elementTexte(doc, 'span', { color: 'var(--text-tertiary)', flex: '0 0 96px' }, intitule),
    elementTexte(doc, 'span', { color: 'var(--text-secondary)' }, v),
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
  return elementTexte(doc, 'div', { fontFamily: INTER, fontSize: '11px', maxWidth: `${largeurMax - 20}px` });
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

  racine.append(elementTexte(doc, 'div', { fontSize: '12px', fontWeight: '500', color: 'var(--text-primary)' }, String(p['nom'] ?? 'Site sans nom')));
  const typeLigne = elementTexte(doc, 'div', { display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0' });
  typeLigne.append(
    elementTexte(doc, 'span', {
      width: '8px', height: '8px', borderRadius: '50%', flex: '0 0 auto',
      background: teintes[type in LIBELLE_TYPE ? type : 'non_precise'],
    }),
    elementTexte(doc, 'span', { color: 'var(--text-secondary)' }, LIBELLE_TYPE[type] ?? LIBELLE_TYPE.non_precise),
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
  const bloc = elementTexte(doc, 'div', { marginTop: '8px', paddingTop: '6px', borderTop: '0.5px solid var(--border-subtle)' });
  bloc.setAttribute('data-statut-zone', String(p['statut_zone'] ?? ''));
  const tete = elementTexte(doc, 'div', { display: 'flex', alignItems: 'center', gap: '6px' });
  tete.append(
    elementTexte(doc, 'span', {
      width: '14px', height: '0', flex: '0 0 auto',
      borderTop: `1.5px ${statut.reglementaire ? 'solid' : 'dashed'} var(--text-secondary)`,
    }),
    elementTexte(doc, 'span', { color: 'var(--text-primary)', fontWeight: '500' }, statut.libelle),
  );
  if (p['pprt_km2']) tete.append(elementTexte(doc, 'span', { color: 'var(--text-secondary)' }, `— ${formaterNombre(Number(p['pprt_km2']))} km²`));
  bloc.append(tete);
  ajouter(bloc,
    p['pprt_nom'] ? lignePopup(doc, 'Plan', p['pprt_nom']) : null,
    Number(p['pprt_distance_m']) > 0 ? lignePopup(doc, 'Distance au périmètre', `${formaterNombre(Number(p['pprt_distance_m']))} m`) : null,
    elementTexte(doc, 'div', { color: 'var(--text-tertiary)', marginTop: '4px', lineHeight: '1.4' }, statut.explication),
  );
  racine.append(bloc);

  ajouter(racine,
    lignePopup(doc, 'Zone affichée', p['rayon_m'] ? `rayon ${p['rayon_m']} m — calculé, indicatif` : ''),
    lignePopup(doc, 'Donnée du', p['date_maj_source']),
  );

  if (rubriques.length > 0) {
    racine.append(elementTexte(doc, 'div', { marginTop: '6px', color: 'var(--text-tertiary)' }, 'Rubriques ICPE'));
    const liste = elementTexte(doc, 'ul', { margin: '2px 0 0 14px', padding: '0', color: 'var(--text-secondary)' });
    for (const r of rubriques.slice(0, 6)) {
      const q = r['quantite'] ? ` — ${String(r['quantite'])} ${String(r['unite'] ?? '')}` : '';
      liste.append(elementTexte(doc, 'li', { marginTop: '2px' }, `${String(r['numero'] ?? '')} ${String(r['nature'] ?? '')}${q}`));
    }
    racine.append(liste);
    if (rubriques.length > 6) {
      racine.append(elementTexte(doc, 'div', { color: 'var(--text-tertiary)', marginTop: '2px' }, `+ ${rubriques.length - 6} autres`));
    }
  }

  const exposition = elementTexte(doc, 'div', {
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
  bloc.append(elementTexte(doc, 'div', { color: 'var(--text-primary)', fontWeight: '500', marginBottom: '4px' }, 'Population exposée'));
  for (const pa of paliers) {
    const ligne = elementTexte(doc, 'div', { display: 'flex', justifyContent: 'space-between', gap: '10px' });
    ligne.setAttribute('data-palier-exposition', pa.palier);
    const valeur = elementTexte(doc, 'span', { fontFamily: MONO, color: 'var(--text-primary)' }, formaterNombre(pa.pop_exposee));
    // En mode buffer, la couronne dit ce que CE palier ajoute au précédent : trois cumuls ne s'additionnent pas.
    if (charge.mode === 'buffer' && pa.pop_couronne !== pa.pop_exposee) {
      valeur.append(elementTexte(doc, 'span', { color: 'var(--text-tertiary)' }, ` (+${formaterNombre(pa.pop_couronne)})`));
    }
    ligne.append(elementTexte(doc, 'span', { color: 'var(--text-secondary)' }, pa.libelle), valeur);
    bloc.append(ligne);
  }
  bloc.append(elementTexte(doc, 'div', { color: 'var(--text-tertiary)', marginTop: '4px', lineHeight: '1.4' },
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
    elementTexte(doc, 'div', { fontSize: '12px', fontWeight: '500', color: 'var(--text-primary)' }, String(p['nom'] ?? '').trim() || 'Sans nom'),
    elementTexte(doc, 'div', { color: 'var(--text-tertiary)', margin: '4px 0 2px' }, 'Périmètre PPRT — servitude PM3'),
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
  racine.append(elementTexte(doc, 'div', { color: 'var(--text-tertiary)', marginTop: '6px', lineHeight: '1.4' },
    'Périmètre réglementaire opposable, et non le rayon indicatif réglable de la couche « Zones à risque industriel ».'));
  return racine;
}
