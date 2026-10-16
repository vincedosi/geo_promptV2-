/**
 * Adaptateur `basic-fit` : la liste « LISTING BASIC FIT » — une colonne « CLub name », UNE LIGNE PAR LECTEUR, libellé
 * libre (spec 2026-10-16-ooh-campagnes § 3). Formes rencontrées le 16/10 :
 *   « Basic-Fit FR <Ville> <Rue> <code> <type> »          (forme principale)
 *   « FR <Ville> <code> <type>-1 »                          (sans rue : la commune seule sera cherchée → à vérifier)
 *   « FR - <Ville> - <code> - Player 1 - Digital Signage 1 » (lecteur nommé)
 *   « FR <code> <Ville> <Rue> <type> », « <code> <type> <Ville> <Rue> » (code en tête)
 *   sans code club, ou sans type de lecteur.
 * Le code club est un nombre de 4-5 chiffres SUIVI d'un type de lecteur (WW, NC, DS, W), ou en tête, ou en fin : un
 * nombre de la rue (« Rue du 8 Mai 1945 ») n'est jamais pris pour lui. La ville s'arrête au premier mot de voie.
 * Les lecteurs d'un même club sont réunis (`nb_ecrans` = nombre de lecteurs, `formats` = types).
 */
import type { AdaptateurPlan, Classeur, EmplacementBrut, LecturePlan, LigneFeuille } from '@/types/campagnes-media';
import { trouverEntete } from '../classeur';
import { fusionnerEmplacements } from '../fusion';
import { normaliser, sansDiacritiques, texte } from '../texte';

/** Ce que l'on tire d'un libellé de lecteur. */
interface LibelleBasicFit {
  code: string | null;
  type: string | null;
  ville: string;
  rue: string | null;
  lecteur: string | null;
}

const TYPE_LECTEUR = /^(WW|NC|DS|W)(?:-?\d*)$/i;
const CODE_CLUB = /^\d{4,5}$/;
/** Premiers mots d'une voie (minuscules, sans accents ni points : « Z.A. » → `za`). */
const VOIES = new Set([
  'rue', 'avenue', 'av', 'boulevard', 'bd', 'route', 'rte', 'chemin', 'place', 'allee', 'impasse', 'quai', 'cours',
  'zac', 'za', 'zi', 'zone', 'centre', 'parc', 'lieu', 'chaussee', 'voie', 'square', 'esplanade', 'rond-point',
  'promenade', 'faubourg', 'espace', 'mail', 'parvis', 'carrefour', 'lotissement', 'domaine', 'cc', 'traverse', 'lot',
  'lieu-dit',
]);

function plierMot(mot: string): string {
  return sansDiacritiques(mot).toLowerCase().replace(/\./g, '').replace(/,+$/, '');
}

/** Découpe un libellé de lecteur ; `null` s'il ne reste rien après les préfixes « Basic-Fit » et « FR ». */
export function decouperLibelleBasicFit(libelle: string): LibelleBasicFit | null {
  const propre = libelle.replace(/[\u2019\u2018]/g, "'").replace(/\s+/g, ' ').trim();
  // « FR » en MAJUSCULES suivi d'un espace, d'un tiret ou de la fin : jamais le début d'une ville (« Fréjus », « Frouard »).
  const t = propre.replace(/^basic-?fit\s+/i, '').replace(/^FR(?:\s*-\s*|\s+|$)/, '').trim();
  if (t === '') return null;

  const lecteurNomme = /^(.+?)\s*-\s*(\d{4,5})\s*-\s*(.+)$/.exec(t);
  if (lecteurNomme) {
    const lecteur = lecteurNomme[3].trim();
    const type = /digital signage/i.test(lecteur) ? 'DS' : /welcome wall/i.test(lecteur) ? 'WW' : null;
    return { code: lecteurNomme[2], type, ville: lecteurNomme[1].trim(), rue: null, lecteur };
  }

  const mots = t.split(' ');
  let iCode = -1;
  mots.forEach((m, i) => {
    if (!CODE_CLUB.test(m)) return;
    const suiviDunType = i + 1 < mots.length && TYPE_LECTEUR.test(mots[i + 1]);
    if (suiviDunType || i === 0 || (i === mots.length - 1 && iCode < 0)) iCode = i;
  });

  let code: string | null = null;
  let type: string | null = null;
  if (iCode >= 0) {
    code = mots[iCode];
    const suivant = mots[iCode + 1];
    if (suivant !== undefined && TYPE_LECTEUR.test(suivant)) {
      type = suivant;
      mots.splice(iCode, 2);
    } else {
      mots.splice(iCode, 1);
    }
  }
  if (type === null && mots.length > 1 && TYPE_LECTEUR.test(mots[mots.length - 1])) type = mots.pop() ?? null;
  if (mots.length === 0) return null;

  // La ville s'arrête au premier mot de voie, ou à la répétition de son premier mot (« Villetest Villetest Gare » :
  // le nom du club reprend la ville) ; la répétition elle-même n'entre pas dans la rue.
  const iVoie = mots.findIndex((m, i) => i > 0 && VOIES.has(plierMot(m)));
  const iRepete = mots.findIndex((m, i) => i > 0 && plierMot(m) === plierMot(mots[0]));
  const finVille = iRepete > 0 && (iVoie < 0 || iRepete < iVoie) ? iRepete : iVoie;
  let debutRue = finVille;
  if (finVille === iRepete && finVille > 0) {
    for (let j = 0; j < finVille && plierMot(mots[debutRue] ?? '') === plierMot(mots[j]); j++) debutRue++;
  }
  const rue = finVille > 0 ? mots.slice(debutRue).join(' ') : '';
  return {
    code,
    type: type === null ? null : type.toUpperCase().replace(/-?\d*$/, ''),
    ville: (finVille > 0 ? mots.slice(0, finVille) : mots).join(' '),
    rue: rue === '' ? null : rue,
    lecteur: null,
  };
}

/** La colonne « CLub name » d'une ligne, ou `null`. */
function colonneClub(ligne: LigneFeuille): number | null {
  const colonne = ligne.cellules.findIndex((c) => normaliser(texte(c) ?? '') === 'CLUB NAME');
  return colonne >= 0 ? colonne : null;
}

function lire(classeur: Classeur): LecturePlan {
  const trouve = trouverEntete(classeur, colonneClub);
  if (!trouve) return { entete: null, lignes: [], emplacements: [] };
  const { feuille, iEntete, entete: colonne } = trouve;
  const entete = texte(feuille.lignes[iEntete].cellules[colonne]) ?? 'CLub name';
  const lecteurs: EmplacementBrut[] = [];
  for (const l of feuille.lignes.slice(iEntete + 1)) {
    const libelle = texte(l.cellules[colonne]);
    if (libelle === null) continue;
    const d = decouperLibelleBasicFit(libelle);
    if (d === null) continue;
    lecteurs.push({
      adaptateur: 'basic-fit',
      cle: d.code ?? `sans-code:${normaliser(d.ville)}|${normaliser(d.rue ?? '')}`,
      nom_lieu: `Basic-Fit ${d.ville}${d.rue === null ? '' : ` ${d.rue}`}`,
      type_lieu: 'salle de sport',
      reseau: 'DOOH salle de sport',
      numerique: true,
      nb_ecrans: 1,
      formats: d.type === null ? [] : [d.type],
      adresse: d.rue,
      code_postal: null,
      ville: d.ville,
      reference_panneau: d.code,
      contacts_semaine: null,
      contacts_18_25_semaine: null,
      recherche: { type: 'adresse', adresse: d.rue ?? '', code_postal: null, ville: d.ville, commune_seule: d.rue === null },
      metadata: { onglet: feuille.nom, club: d.code, lignes: [{ numero: l.numero, cellules: { [entete]: libelle }, decoupe: { ...d } }] },
    });
  }
  return { entete: null, lignes: [], emplacements: fusionnerEmplacements(lecteurs, (e) => e.cle) };
}

export const ADAPTATEUR_BASIC_FIT: AdaptateurPlan = {
  id: 'basic-fit',
  regies: ['BASIC FIT', 'BASICFIT'],
  reconnait: (classeur) => trouverEntete(classeur, colonneClub) !== null,
  lire,
};
