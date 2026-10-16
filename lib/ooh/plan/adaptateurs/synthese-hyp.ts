/**
 * Adaptateur `synthese-hyp` : l'onglet de synthèse d'un plan de régie → l'en-tête de campagne et ses lignes
 * (spec 2026-10-16-ooh-campagnes § 3 et § 7). Reconnu par son EN-TÊTE (« AFFICHEURS », « RESEAUX »…), pas par le nom
 * de l'onglet (« HYP1 » aujourd'hui, « HYP2 » à la vague suivante).
 *
 * Structure lue, du haut vers le bas : titre et hypothèse au-dessus de l'en-tête ; des lignes de SECTION (une seule
 * cellule courte : « METROPOLE », « DROM TOM ») ; les lignes de réseau ; une ligne de coût sans écrans ni départ
 * (« IMPRESSION JUSQU'À 5 VISUELS ») ; la ligne « TOTAL » ; des NOTES (une seule cellule longue « RÉGIE : … ») qui
 * portent la plage horaire et les contacts 15+ / 18-24 de chaque réseau.
 * Dans la section DROM, la colonne « RESEAUX » porte le TERRITOIRE (« LA REUNION ») : `territoire` et non `reseau`.
 */
import type {
  AdaptateurPlan, Cellule, Classeur, CoutAnnexe, Feuille, LecturePlan, LigneFeuille, LignePlan,
} from '@/types/campagnes-media';
import { dateFinLigne, lireDuree, periodeDuTitre } from '../durees';
import { cellulesNommees, entier, nombre, normaliser, texte } from '../texte';

type Champ =
  | 'regie' | 'reseau' | 'nb_ecrans' | 'format' | 'nb_diffusions' | 'depart' | 'duree' | 'rang_option'
  | 'montant_brut' | 'montant_net' | 'frais' | 'honoraires' | 'total_ttc';

/** Préfixe normalisé d'un en-tête → champ. Premier préfixe qui convient : « TARIF NET » n'est pas « TARIF BRUT ». */
const ENTETES: ReadonlyArray<readonly [string, Champ]> = [
  ['AFFICHEUR', 'regie'], ['RESEAU', 'reseau'], ['NBRE', 'nb_ecrans'], ['FORMAT', 'format'], ['LOGS', 'nb_diffusions'],
  ['DEPART', 'depart'], ['DUREE', 'duree'], ['RANG', 'rang_option'], ['TARIF BRUT', 'montant_brut'],
  ['TARIF NET', 'montant_net'], ['FRAIS', 'frais'], ['HONO', 'honoraires'], ['TOTAL', 'total_ttc'],
];

/** Une ligne qui porte l'un de ces champs est une ligne chiffrée (réseau, coût ou total), pas une section ni une note. */
const CHAMPS_CHIFFRES: readonly Champ[] = ['nb_ecrans', 'depart', 'montant_brut', 'montant_net', 'frais', 'honoraires', 'total_ttc'];
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const CONTACTS_15 = /contacts?\s*15\s*\+\s*:\s*([\d\s\u00a0\u202f.]+)/i;
const CONTACTS_18_24 = /contacts?\s*18\s*-\s*24\s*:\s*([\d\s\u00a0\u202f.]+)/i;
/** « diffusion d'un spot de 10" <PLAGE>, au sein… » ou « …<PLAGE>, sur les écrans… ». */
const PLAGE = /diffusion d['’]un spot de \S+\s+(.+?)(?=,\s*sur les|,?\s+au sein)/i;
const LIEUX = /(\d[\d\s\u00a0\u202f]*)\s*(gares?|clubs?|[ée]tablissements?)/i;

function colonnes(ligne: LigneFeuille): Map<Champ, number> | null {
  const m = new Map<Champ, number>();
  ligne.cellules.forEach((c, i) => {
    const t = normaliser(texte(c) ?? '');
    if (t === '') return;
    const trouve = ENTETES.find(([prefixe]) => t.startsWith(prefixe));
    if (trouve && !m.has(trouve[1])) m.set(trouve[1], i);
  });
  return m.has('regie') && m.has('reseau') ? m : null;
}

function trouverSynthese(classeur: Classeur): { feuille: Feuille; iEntete: number; cols: Map<Champ, number> } | null {
  for (const feuille of classeur.feuilles.values()) {
    for (let i = 0; i < feuille.lignes.length; i++) {
      const cols = colonnes(feuille.lignes[i]);
      if (cols) return { feuille, iEntete: i, cols };
    }
  }
  return null;
}

function uniteLieux(mot: string): string {
  const n = normaliser(mot);
  if (n.startsWith('GARE')) return 'gares';
  if (n.startsWith('CLUB')) return 'clubs';
  return 'établissements';
}

function contacts(note: string, motif: RegExp): number | null {
  const m = motif.exec(note);
  const chiffres = m ? m[1].replace(/\D/g, '') : '';
  return chiffres === '' ? null : Number(chiffres);
}

function lignePlan(
  feuille: Feuille, l: LigneFeuille, entetes: readonly string[], val: (l: LigneFeuille, c: Champ) => Cellule,
  regie: string, section: string | null, ordre: number,
): LignePlan {
  const brut = texte(val(l, 'reseau')) ?? '';
  const drom = section !== null && normaliser(section).includes('DROM');
  const premiere = brut.split(/\r?\n/)[0].replace(/\s*-\s*$/, '').trim();
  const lieux = LIEUX.exec(brut);
  const departBrut = texte(val(l, 'depart'));
  const depart = departBrut !== null && DATE_ISO.test(departBrut) ? departBrut : null;
  const dureeLibelle = texte(val(l, 'duree'));
  const duree = lireDuree(dureeLibelle);
  const details: Record<string, unknown> = {
    onglet: feuille.nom, ligne: l.numero, section, reseau_origine: brut === '' ? null : brut,
    cellules: cellulesNommees(entetes, l.cellules),
  };
  if (lieux) {
    details.nb_lieux_plan = Number(lieux[1].replace(/\D/g, ''));
    details.unite_lieux_plan = uniteLieux(lieux[2]);
  }
  if (duree) details.jours_diffusion = duree.jours_diffusion;
  return {
    ordre, media: 'ooh', regie,
    reseau: drom || premiere === '' ? null : premiere,
    territoire: drom && premiere !== '' ? premiere : null,
    nb_ecrans: entier(val(l, 'nb_ecrans')), format: texte(val(l, 'format')), nb_diffusions: entier(val(l, 'nb_diffusions')),
    date_debut: depart, date_fin: dateFinLigne(depart, dureeLibelle), duree_libelle: dureeLibelle,
    rang_option: texte(val(l, 'rang_option')), plage_horaire: null,
    montant_brut: nombre(val(l, 'montant_brut')), montant_net: nombre(val(l, 'montant_net')), frais: nombre(val(l, 'frais')),
    honoraires: nombre(val(l, 'honoraires')), total_ttc: nombre(val(l, 'total_ttc')),
    contacts_15_plus: null, contacts_18_24: null, details,
  };
}

function lire(classeur: Classeur): LecturePlan {
  const trouve = trouverSynthese(classeur);
  if (!trouve) return { entete: null, lignes: [], emplacements: [] };
  const { feuille, iEntete, cols } = trouve;
  const entetes = feuille.lignes[iEntete].cellules.map((c) => texte(c) ?? '');
  const val = (l: LigneFeuille, champ: Champ): Cellule => {
    const i = cols.get(champ);
    return i === undefined ? null : (l.cellules[i] ?? null);
  };
  const titres = feuille.lignes.slice(0, iEntete)
    .map((l) => l.cellules.map((c) => texte(c)).find((t): t is string => t !== null))
    .filter((t): t is string => t !== undefined);

  const lignes: LignePlan[] = [];
  const couts: CoutAnnexe[] = [];
  const notes: string[] = [];
  let section: string | null = null;
  let budget: number | null = null;

  for (const l of feuille.lignes.slice(iEntete + 1)) {
    const regie = texte(val(l, 'regie'));
    if (regie === null) continue;
    const remplies = l.cellules.filter((c) => texte(c) !== null).length;
    const chiffree = CHAMPS_CHIFFRES.some((c) => val(l, c) !== null);
    if (!chiffree && remplies === 1) {
      if (regie.length > 60 || regie.includes(':')) notes.push(regie);
      else section = regie;
      continue;
    }
    if (normaliser(regie).startsWith('TOTAL')) {
      budget = nombre(val(l, 'total_ttc'));
      continue;
    }
    if (val(l, 'nb_ecrans') === null && val(l, 'depart') === null) {
      couts.push({ libelle: regie, frais: nombre(val(l, 'frais')), honoraires: nombre(val(l, 'honoraires')), total_ttc: nombre(val(l, 'total_ttc')) });
      continue;
    }
    lignes.push(lignePlan(feuille, l, entetes, val, regie, section, lignes.length + 1));
  }

  // Chaque note « RÉGIE : … » complète les lignes de cette régie : plage horaire et contacts 15+ / 18-24.
  for (const note of notes) {
    const m = /^([^:]+?)\s*:\s*([\s\S]+)$/.exec(note);
    if (!m) continue;
    const cle = normaliser(m[1]);
    for (const lp of lignes) {
      if (normaliser(lp.regie) !== cle) continue;
      lp.details.note_plan = note;
      lp.contacts_15_plus ??= contacts(note, CONTACTS_15);
      lp.contacts_18_24 ??= contacts(note, CONTACTS_18_24);
      lp.plage_horaire ??= PLAGE.exec(note)?.[1]?.trim() ?? null;
    }
  }

  const debuts = lignes.map((l) => l.date_debut).filter((d): d is string => d !== null).sort();
  const fins = lignes.map((l) => l.date_fin).filter((d): d is string => d !== null).sort();
  const titre = titres[0] ?? null;
  const periode = titre !== null && debuts.length > 0 ? periodeDuTitre(titre, Number(debuts[0].slice(0, 4))) : null;
  return {
    entete: {
      titre,
      hypothese: titres[1] ?? null,
      date_debut: periode?.debut ?? debuts[0] ?? null,
      date_fin: periode?.fin ?? fins[fins.length - 1] ?? null,
      budget_total_ttc: budget,
      couts_annexes: couts,
      notes,
    },
    lignes,
    emplacements: [],
  };
}

export const ADAPTATEUR_SYNTHESE: AdaptateurPlan = {
  id: 'synthese-hyp',
  regies: [],
  reconnait: (classeur) => trouverSynthese(classeur) !== null,
  lire,
};
