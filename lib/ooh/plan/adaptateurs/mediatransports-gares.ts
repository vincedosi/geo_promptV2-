/**
 * Adaptateur `mediatransports-gares` : la liste « LISTING GARE » d'un plan Mediatransports (spec 2026-10-16-ooh-campagnes
 * § 3) — DEUX blocs côte à côte, Île-de-France puis province, chacun avec son en-tête sur deux lignes (« SOLO » /
 * « 9/16ème »…), ses lignes de gare, puis « Total Paris » / « Total Région » / « Total sites … » (ignorés).
 * Un emplacement par gare ; la géolocalisation (référentiel SNCF) vient après, et donne l'identité définitive (UIC).
 */
import type { AdaptateurPlan, BlocGares, Cellule, Classeur, EmplacementBrut, LecturePlan, LigneFeuille } from '@/types/campagnes-media';
import { trouverEntete } from '../classeur';
import { fusionnerEmplacements } from '../fusion';
import { nombre, normaliser, texte } from '../texte';

const FORMATS = new Set(['SOLO', 'DUO', 'TRIO', 'QUATRO']);

interface Colonne {
  i: number;
  h1: string;
  h2: string;
  nom: string;
}

function contientEnTete(l: LigneFeuille, valeur: string): boolean {
  return l.cellules.some((c) => normaliser(texte(c) ?? '') === valeur);
}

/** Vrai (sinon `null`) pour la ligne d'en-tête qui porte « SITES » et « GARE ». */
function enteteGares(l: LigneFeuille): true | null {
  return contientEnTete(l, 'SITES') && contientEnTete(l, 'GARE') ? true : null;
}

/** « SOLO » + « 9/16ème » → `solo 9/16` ; « DUO » + « compacte » → `duo`. */
function libelleFormat(h1: string, h2: string): string {
  const ratio = /(\d+)\s*\/\s*(\d+)/.exec(h2);
  return ratio ? `${h1.toLowerCase()} ${ratio[1]}/${ratio[2]}` : h1.toLowerCase();
}

/** Le bloc d'après le titre au-dessus de sa colonne SITES : « DOOH GARE IDF », « DOOH GARE PROVINCE ». */
function blocDuTitre(titres: readonly LigneFeuille[], debut: number): BlocGares {
  for (const l of titres) {
    const t = normaliser(texte(l.cellules[debut]) ?? '');
    if (/\bIDF\b|ILE DE FRANCE|\bPARIS\b/.test(t)) return 'idf';
    if (/PROVINCE|REGION/.test(t)) return 'province';
  }
  return 'inconnu';
}

const cel = (l: LigneFeuille, i: number | undefined): Cellule => (i === undefined ? null : (l.cellules[i] ?? null));

function lire(classeur: Classeur): LecturePlan {
  const trouve = trouverEntete(classeur, enteteGares);
  if (!trouve) return { entete: null, lignes: [], emplacements: [] };
  const { feuille, iEntete } = trouve;
  const entete = feuille.lignes[iEntete];
  const sous = feuille.lignes[iEntete + 1];
  const titres = feuille.lignes.slice(0, iEntete);
  const debuts = entete.cellules.map((c, i) => (normaliser(texte(c) ?? '') === 'SITES' ? i : -1)).filter((i) => i >= 0);
  const emplacements: EmplacementBrut[] = [];

  debuts.forEach((debut, k) => {
    const fin = debuts[k + 1] ?? entete.cellules.length;
    const bloc = blocDuTitre(titres, debut);
    const cols: Colonne[] = [];
    for (let i = debut; i < fin; i++) {
      const h1 = texte(entete.cellules[i]) ?? '';
      const h2 = sous ? (texte(sous.cellules[i]) ?? '') : '';
      if (h1 === '' && h2 === '') continue;
      cols.push({ i, h1, h2, nom: `${h1} ${h2}`.trim() });
    }
    const iGare = cols.find((c) => normaliser(c.h1) === 'GARE')?.i;
    const iTotal = cols.find((c) => normaliser(c.h1).startsWith('TOTAL'))?.i;
    const iPatrimoine = cols.find((c) => normaliser(c.h1).startsWith('PATRIMOINE'))?.i;
    const formats = cols.filter((c) => FORMATS.has(normaliser(c.h1))).map((c) => ({ i: c.i, libelle: libelleFormat(c.h1, c.h2) }));

    for (const l of feuille.lignes.slice(iEntete + 2)) {
      const nom = texte(l.cellules[debut]);
      if (nom === null || normaliser(nom).startsWith('TOTAL')) continue;
      const nb = nombre(cel(l, iTotal)) ?? nombre(cel(l, iGare));
      if (nb === null) continue;
      const parFormat: Record<string, number> = {};
      for (const f of formats) {
        const v = nombre(cel(l, f.i));
        if (v) parFormat[f.libelle] = v;
      }
      emplacements.push({
        adaptateur: 'mediatransports-gares',
        cle: normaliser(nom),
        nom_lieu: nom,
        type_lieu: 'gare',
        reseau: 'DOOH gare',
        numerique: true,
        nb_ecrans: Math.round(nb),
        formats: Object.keys(parFormat),
        adresse: null,
        code_postal: null,
        ville: null,
        reference_panneau: null,
        contacts_semaine: null,
        contacts_18_25_semaine: null,
        recherche: { type: 'gare', nom, bloc },
        metadata: {
          onglet: feuille.nom,
          bloc,
          ecrans_par_format: parFormat,
          patrimoine_max: nombre(cel(l, iPatrimoine)),
          lignes: [{ numero: l.numero, cellules: Object.fromEntries(cols.map((c) => [c.nom, cel(l, c.i)])) }],
        },
      });
    }
  });

  return { entete: null, lignes: [], emplacements: fusionnerEmplacements(emplacements, (e) => e.cle) };
}

export const ADAPTATEUR_GARES: AdaptateurPlan = {
  id: 'mediatransports-gares',
  regies: ['MEDIATRANSPORTS'],
  reconnait: (classeur) => trouverEntete(classeur, enteteGares) !== null,
  lire,
};
