/**
 * Adaptateur `stride-campus` : la liste « LISTING CAMPUS » de Stride, bornes de recharge à écran (spec
 * 2026-10-16-ooh-campagnes § 3) — en-tête sur une ligne (établissement, groupement, type, adresse, CP, ville, zone,
 * écrans, taille d'écran, contacts par semaine, contacts 18-25 par semaine), une ligne par lieu.
 * Identité : établissement normalisé + code postal. Deux lignes du même lieu sont réunies (écrans et contacts additionnés).
 */
import type { AdaptateurPlan, Cellule, Classeur, EmplacementBrut, Feuille, LecturePlan, LigneFeuille } from '@/types/campagnes-media';
import { fusionnerEmplacements } from '../fusion';
import { cellulesNommees, codePostal, entier, nombre, normaliser, texte } from '../texte';

type Champ = 'etablissement' | 'groupement' | 'type' | 'adresse' | 'cp' | 'ville' | 'zone' | 'ecrans' | 'taille' | 'contacts' | 'contacts_18_25';

/** En-tête normalisé → champ ; exact, sauf les deux préfixes de contacts (« CONTACTS 18 » avant « CONTACTS »). */
function champ(entete: string): Champ | null {
  const n = normaliser(entete);
  if (n === 'ETABLISSEMENT') return 'etablissement';
  if (n === 'GROUPEMENT') return 'groupement';
  if (n === 'TYPE') return 'type';
  if (n === 'ADRESSE') return 'adresse';
  if (n === 'CP' || n === 'CODE POSTAL') return 'cp';
  if (n === 'VILLE') return 'ville';
  if (n === 'ZONE') return 'zone';
  if (n === 'ECRANS') return 'ecrans';
  if (n.startsWith('TAILLE')) return 'taille';
  if (n.startsWith('CONTACTS 18')) return 'contacts_18_25';
  if (n.startsWith('CONTACTS')) return 'contacts';
  return null;
}

function trouverFeuille(classeur: Classeur): { feuille: Feuille; iEntete: number; cols: Map<Champ, number> } | null {
  for (const feuille of classeur.feuilles.values()) {
    for (let i = 0; i < feuille.lignes.length; i++) {
      const cols = new Map<Champ, number>();
      feuille.lignes[i].cellules.forEach((c, j) => {
        const ch = champ(texte(c) ?? '');
        if (ch !== null && !cols.has(ch)) cols.set(ch, j);
      });
      if (cols.has('etablissement') && cols.has('groupement')) return { feuille, iEntete: i, cols };
    }
  }
  return null;
}

function typeLieu(brut: string | null): string {
  const n = normaliser(brut ?? '');
  if (n === 'CAMPUS') return 'campus';
  if (n === 'CINEMA') return 'cinéma';
  if (n === 'RESIDENCE') return 'résidence';
  return (brut ?? 'lieu').toLowerCase();
}

function lire(classeur: Classeur): LecturePlan {
  const trouve = trouverFeuille(classeur);
  if (!trouve) return { entete: null, lignes: [], emplacements: [] };
  const { feuille, iEntete, cols } = trouve;
  const entetes = feuille.lignes[iEntete].cellules.map((c) => texte(c) ?? '');
  const val = (l: LigneFeuille, c: Champ): Cellule => {
    const i = cols.get(c);
    return i === undefined ? null : (l.cellules[i] ?? null);
  };
  const lieux: EmplacementBrut[] = [];
  for (const l of feuille.lignes.slice(iEntete + 1)) {
    const etablissement = texte(val(l, 'etablissement'));
    if (etablissement === null) continue;
    const cp = codePostal(val(l, 'cp'));
    const ville = texte(val(l, 'ville'));
    const adresse = texte(val(l, 'adresse'));
    const taille = nombre(val(l, 'taille'));
    const groupement = texte(val(l, 'groupement'));
    lieux.push({
      adaptateur: 'stride-campus',
      cle: `${normaliser(etablissement)}|${cp ?? ''}`,
      nom_lieu: etablissement,
      type_lieu: typeLieu(texte(val(l, 'type'))),
      reseau: 'DOOH borne de recharge',
      numerique: true,
      nb_ecrans: entier(val(l, 'ecrans')),
      formats: taille === null ? [] : [`${taille}"`],
      adresse,
      code_postal: cp,
      ville,
      reference_panneau: null,
      contacts_semaine: entier(val(l, 'contacts')),
      contacts_18_25_semaine: entier(val(l, 'contacts_18_25')),
      recherche: { type: 'adresse', adresse: adresse ?? '', code_postal: cp, ville, commune_seule: false },
      metadata: {
        onglet: feuille.nom,
        groupement: groupement === null || groupement === '0' ? null : groupement,
        zone: texte(val(l, 'zone')),
        taille_ecran_pouces: taille,
        lignes: [{ numero: l.numero, cellules: cellulesNommees(entetes, l.cellules) }],
      },
    });
  }
  return { entete: null, lignes: [], emplacements: fusionnerEmplacements(lieux, (e) => e.cle) };
}

export const ADAPTATEUR_STRIDE: AdaptateurPlan = {
  id: 'stride-campus',
  regies: ['STRIDE'],
  reconnait: (classeur) => trouverFeuille(classeur) !== null,
  lire,
};
