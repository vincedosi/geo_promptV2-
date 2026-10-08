/**
 * Le classeur Excel INTERACTIF de l'onglet Rayon.
 *
 * ── CE QUE L'UTILISATEUR MANIPULE DANS EXCEL ──────────────────────────────
 *
 * - le seuil Seveso (haut, bas, ou les deux), par un menu ;
 * - le territoire (France, région, département), par un menu ;
 * - le rayon, par une VRAIE barre de défilement, de 100 m à 10 km ;
 * - les natures affichées, par des cases à cocher ;
 * - les étiquettes du graphique, par une case.
 *
 * Tout le reste — chiffres clés, graphique, tableaux par région et par
 * département — est FORMULE : `SOMME.SI.ENS` sur la feuille « Données », qui
 * porte la table de couverture entière. Aucun chiffre n'est figé à l'export,
 * sauf les données elles-mêmes.
 *
 * ── LA DISPOSITION EST UN CONTRAT ─────────────────────────────────────────
 *
 * Les formules, le graphique et les contrôles se désignent par ADRESSE. Les
 * adresses sont donc des constantes nommées ci-dessous, et non des chaînes
 * éparpillées : déplacer une ligne sans les suivre ferait lire au graphique la
 * mauvaise colonne, sans erreur — un graphique plausible et faux.
 */
import ExcelJS from 'exceljs';
import {
  CHOIX_GRAVITE, N_PALIERS, NATURE_TOUTES,
  cleGraviteInitiale, palierDuRayon,
  type DonneesExportRayon, type EtatInitialExport,
} from '@/lib/risques/export-rayon/donnees';
import { injecter, type Controle, type SerieGraphique } from '@/lib/risques/export-rayon/ooxml';
import { COULEUR_TOTALE, COULEURS_NATURES } from '@/lib/risques/export-rayon/couleurs';

/**
 * Lettre(s) d'une colonne Excel.
 *
 * @param col - Numéro de colonne, 1-indexé.
 * @returns Les lettres de la colonne.
 *
 * @example
 * lettre(1);   // 'A'
 * lettre(27);  // 'AA'
 * lettre(105); // 'DA' — la dernière colonne de cumuls de « Données »
 */
export function lettre(col: number): string {
  let n = col;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ── Les adresses ──────────────────────────────────────────────────────────

const F_RAYON = 'Rayon';
const F_REGIONS = 'Régions';
const F_DEPTS = 'Départements';
const F_COURBES = 'Courbes';
const F_DONNEES = 'Données';
const F_METHODE = 'Méthode et limites';
const F_LISTES = 'Listes';

/** Référence à une autre feuille, avec les apostrophes qu'exigent les accents et espaces. */
const ref = (feuille: string, adresse: string) => `'${feuille}'!${adresse}`;

/**
 * Feuille « Rayon » : cellules de saisie et cellules techniques (colonnes
 * masquées). Adresses RELATIVES : exceljs les veut ainsi pour désigner une
 * cellule ; les formules passent par {@link abs}.
 */
const CELLULES = {
  titreGraphique: 'A2',
  gravite: 'B5',
  territoire: 'B6',
  rayonKm: 'B7',
  cleGravite: 'Z5',
  typeTerritoire: 'Z6',
  codeTerritoire: 'AA6',
  regionDuTerritoire: 'AB6',
  popTerritoire: 'AC6',
  palier: 'Z7',
  etiquettes: 'Z9',
} as const;

/**
 * Rend une adresse de cellule absolue, pour une formule.
 *
 * @param adresse - Adresse relative (`B7`).
 * @returns L'adresse absolue ; une adresse qui n'a pas la forme lettres +
 *   chiffres est rendue telle quelle.
 *
 * @example
 * abs('AB6'); // '$AB$6'
 */
export function abs(adresse: string): string {
  return adresse.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
}

/** Première ligne des cases de nature sur la feuille « Rayon ». */
const LIGNE_NATURES = 20;

/** Première colonne des cumuls sur « Données » (F) : cumul i en colonne F + i. */
const COL_CUMUL0 = 6;

// ── Plages partagées ──────────────────────────────────────────────────────

/** Un territoire du menu : France, région ou département. */
interface Territoire {
  libelle: string;
  type: 'france' | 'region' | 'departement';
  code: string;
  pop: number;
  region: string;
}

/**
 * Les références que toutes les feuilles partagent, calculées UNE fois : la
 * taille de « Données » et celle de la liste des territoires décident des
 * bornes de toutes les plages.
 */
interface Plages {
  /** Une colonne de « Données », lignes 2 à la dernière. */
  donnees: (col: string) => string;
  /** Le bloc des cent cumuls de « Données ». */
  cumuls: string;
  /** Une colonne de la liste des territoires. */
  territoires: (col: string) => string;
  /** `MATCH` du territoire choisi dans sa liste. */
  matchTerritoire: string;
}

/** Une cellule de la feuille « Rayon », en adresse absolue, vue d'une autre feuille. */
const R = (c: string): string => ref(F_RAYON, abs(c));

/** La colonne de « Données » qui porte le cumul d'indice i. */
const colCumul = (i: number): string => lettre(COL_CUMUL0 + i);

/** Une colonne de « Courbes », lignes 2 à 101. */
const plageCourbe = (col: string): string => ref(F_COURBES, `$${col}$2:$${col}$${N_PALIERS + 1}`);

/**
 * Le test « cette ligne de Données compte-t-elle dans le territoire ? »,
 * calculé UNE fois par ligne puis repris comme simple critère `=1`.
 */
function formuleDansTerritoire(n: number): string {
  const type = R(CELLULES.typeTerritoire);
  const code = R(CELLULES.codeTerritoire);
  return `IF(${type}="france",1,IF(${type}="region",IF(B${n}=${code},1,0),IF(A${n}=${code},1,0)))`;
}

// ── Construction ──────────────────────────────────────────────────────────

/**
 * Construit le classeur et y injecte graphique et contrôles.
 *
 * @param d - Les données préparées (`preparerDonnees`).
 * @param etat - L'état de l'écran à l'export : valeurs initiales des contrôles.
 * @param editeLe - Date d'édition (paramètre pour des tests déterministes).
 * @returns Le fichier .xlsx.
 * @throws {Error} Si l'injection du graphique échoue (feuille introuvable,
 *   dessin déjà présent) — une erreur de construction, jamais de donnée.
 *
 * @example
 * const xlsx = await construireClasseurRayon(preparerDonnees(reponse), {
 *   gravites: ['seveso_haut'], natures: [], perim: null, rayonM: 5000,
 * });
 */
export async function construireClasseurRayon(
  d: DonneesExportRayon,
  etat: EtatInitialExport,
  editeLe: Date = new Date(),
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'dentsu.explore';
  wb.created = editeLe;
  // Les formules sont écrites SANS résultat : Excel doit tout calculer à
  // l'ouverture, graphique compris, sinon il afficherait des cellules vides.
  wb.calcProperties.fullCalcOnLoad = true;

  const wsRayon = wb.addWorksheet(F_RAYON, { views: [{ showGridLines: false }] });
  const wsRegions = wb.addWorksheet(F_REGIONS, { views: [{ state: 'frozen', ySplit: 4 }] });
  const wsDepts = wb.addWorksheet(F_DEPTS, { views: [{ state: 'frozen', ySplit: 4 }] });
  const wsCourbes = wb.addWorksheet(F_COURBES, { views: [{ state: 'frozen', ySplit: 1 }] });
  const wsDonnees = wb.addWorksheet(F_DONNEES, { views: [{ state: 'frozen', ySplit: 1, xSplit: 4 }] });
  const wsMethode = wb.addWorksheet(F_METHODE);
  const wsListes = wb.addWorksheet(F_LISTES, { state: 'hidden' });

  const territoires = ecrireListes(wsListes, d);
  const plages = calculerPlages(d.lignes.length + 1, territoires.length + 1);
  const cochees = new Set(etat.natures.length > 0 ? etat.natures : d.natures);

  ecrireDonnees(wsDonnees, d);
  ecrireSaisies(wsRayon, d, etat, territoires, plages, editeLe);
  ecrireChiffresCles(wsRayon);
  ecrireNatures(wsRayon, d.natures, cochees);
  const aux = ecrireCourbes(wsCourbes, d.natures, plages);
  ecrireTableauxUnites(wsRegions, wsDepts, d, plages);
  ecrireMethode(wsMethode);

  const brut = await wb.xlsx.writeBuffer();
  return injecter(Buffer.from(brut as ArrayBuffer), {
    feuille: F_RAYON,
    graphique: {
      titre: R(CELLULES.titreGraphique),
      series: seriesDuGraphique(d.natures, aux),
      xMin: 0, xMax: 10, xPas: 1,
      formatX: '0" km"',
      formatY: '[>=1000000]0,," M";[>=1000]0," k";0',
    },
    ancreGraphique: { de: { col: 3, ligne: 3 }, a: { col: 16, ligne: 34 } },
    controles: controlesDuFormulaire(d.natures, cochees, etat.rayonM),
  });
}

/** Les plages partagées, bornées par la dernière ligne de « Données » et de la liste des territoires. */
function calculerPlages(derniereLigne: number, finTerritoires: number): Plages {
  const territoiresCol = (col: string): string => ref(F_LISTES, `$${col}$2:$${col}$${finTerritoires}`);
  return {
    donnees: (col) => ref(F_DONNEES, `$${col}$2:$${col}$${derniereLigne}`),
    cumuls: ref(F_DONNEES, `$${colCumul(0)}$2:$${colCumul(N_PALIERS - 1)}$${derniereLigne}`),
    territoires: territoiresCol,
    matchTerritoire: `MATCH(${abs(CELLULES.territoire)},${territoiresCol('D')},0)`,
  };
}

/** Feuille « Listes » (masquée) : les choix des deux menus. Rend les territoires, dans l'ordre du menu. */
function ecrireListes(ws: ExcelJS.Worksheet, d: DonneesExportRayon): Territoire[] {
  ws.getCell('A1').value = 'Seuil';
  ws.getCell('B1').value = 'Clé';
  CHOIX_GRAVITE.forEach((c, i) => {
    ws.getCell(`A${i + 2}`).value = c.libelle;
    ws.getCell(`B${i + 2}`).value = c.cle;
  });

  const territoires = listeTerritoires(d);
  ['Territoire', 'Type', 'Code', 'Population', 'Région'].forEach((t, i) => {
    ws.getCell(1, 4 + i).value = t;
  });
  territoires.forEach((t, i) => {
    const l = i + 2;
    ws.getCell(l, 4).value = t.libelle;
    ws.getCell(l, 5).value = t.type;
    ws.getCell(l, 6).value = t.code;
    ws.getCell(l, 7).value = t.pop;
    ws.getCell(l, 8).value = t.region;
  });
  return territoires;
}

/** France, puis les régions, puis les départements — l'ordre du menu Territoire. */
function listeTerritoires(d: DonneesExportRayon): Territoire[] {
  return [
    {
      libelle: 'France entière', type: 'france', code: '', region: '',
      pop: d.regions.reduce((s, r) => s + (r.pop ?? 0), 0),
    },
    ...d.regions.map((r): Territoire => ({
      libelle: `${r.nom} (région)`, type: 'region', code: r.code, pop: r.pop ?? 0, region: r.code,
    })),
    ...d.departements.map((dp): Territoire => ({
      libelle: `${dp.code} — ${dp.nom}`, type: 'departement', code: dp.code, pop: dp.pop ?? 0, region: dp.region,
    })),
  ];
}

/** Feuille « Données » : une ligne par (département × seuil × nature), cent cumuls chacune. */
function ecrireDonnees(ws: ExcelJS.Worksheet, d: DonneesExportRayon): void {
  ws.getRow(1).values = [
    'Département', 'Région', 'Seuil', 'Nature', 'Dans le territoire',
    ...Array.from({ length: N_PALIERS }, (_, i) => `< ${((i + 1) / 10).toFixed(1).replace('.', ',')} km`),
  ];
  ws.getRow(1).font = { bold: true };
  d.lignes.forEach((l, i) => {
    const n = i + 2;
    const row = ws.getRow(n);
    row.getCell(1).value = l.departement;
    row.getCell(2).value = l.region;
    row.getCell(3).value = l.gravite;
    row.getCell(4).value = l.nature;
    row.getCell(5).value = { formula: formuleDansTerritoire(n) };
    l.cumuls.forEach((v, k) => { row.getCell(COL_CUMUL0 + k).value = Math.round(v * 100) / 100; });
  });
  ws.getColumn(4).width = 36;
  for (let k = 0; k < N_PALIERS; k++) ws.getColumn(COL_CUMUL0 + k).numFmt = '#,##0';
}

/** Libellé en gras d'une ligne de réglage. */
function libelle(ws: ExcelJS.Worksheet, c: string, texte: string): void {
  ws.getCell(c).value = texte;
  ws.getCell(c).font = { bold: true };
}

/** Habillage d'une cellule à saisir : fond turquoise pâle, soulignée. */
function habillerSaisie(ws: ExcelJS.Worksheet, c: string): void {
  ws.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF7F5' } };
  ws.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FF4ECDC4' } } };
}

/** Feuille « Rayon », en-tête et réglages : titre, menus, rayon, cellules techniques. */
function ecrireSaisies(
  ws: ExcelJS.Worksheet,
  d: DonneesExportRayon,
  etat: EtatInitialExport,
  territoires: Territoire[],
  plages: Plages,
  editeLe: Date,
): void {
  ws.columns = [
    { width: 46 }, { width: 24 }, { width: 3 },
    ...Array.from({ length: 13 }, () => ({ width: 11 })),
  ];
  for (const c of ['Z', 'AA', 'AB', 'AC']) ws.getColumn(c).hidden = true;
  ecrireEntete(ws, d, editeLe);
  ecrireMenus(ws, etat, territoires, plages);
  ecrireCellulesTechniques(ws, etat, plages);
}

/** Titre, titre dynamique du graphique, et ligne de provenance. */
function ecrireEntete(ws: ExcelJS.Worksheet, d: DonneesExportRayon, editeLe: Date): void {
  ws.getCell('A1').value = 'Population à proximité des sites Seveso — rayon d’influence';
  ws.getCell('A1').font = { bold: true, size: 14 };
  // Le titre du graphique : une cellule, pour qu'il suive les trois menus.
  ws.getCell(CELLULES.titreGraphique).value = {
    formula: `"Population à moins de "&FIXED(${abs(CELLULES.rayonKm)},1)&" km — "&${abs(CELLULES.gravite)}&" — "&${abs(CELLULES.territoire)}`,
  };
  ws.getCell(CELLULES.titreGraphique).font = { italic: true, color: { argb: 'FF595959' } };
  ws.getCell('A3').value = `Cible : population totale (ménages fiscaux, carroyage INSEE Filosofi 2021 à 200 m)`
    + ` · pré-calcul du ${d.calculeLe ? new Date(d.calculeLe).toLocaleDateString('fr-FR') : 'date inconnue'}`
    + ` · édité le ${editeLe.toLocaleDateString('fr-FR')}`;
  ws.getCell('A3').font = { size: 9, color: { argb: 'FF8A8A8A' } };
}

/** Les deux menus (seuil, territoire) et l'affichage du rayon, sur les valeurs de l'écran. */
function ecrireMenus(ws: ExcelJS.Worksheet, etat: EtatInitialExport, territoires: Territoire[], plages: Plages): void {
  const perim = etat.perim;
  const territoireInitial = (perim
    && territoires.find((t) => t.type === perim.niveau && t.code === perim.code)) || territoires[0];
  const graviteInitiale = CHOIX_GRAVITE.find((c) => c.cle === cleGraviteInitiale(etat.gravites)) ?? CHOIX_GRAVITE[0];

  libelle(ws, 'A5', 'Seuil Seveso');
  ws.getCell(CELLULES.gravite).value = graviteInitiale.libelle;
  ws.getCell(CELLULES.gravite).dataValidation = {
    type: 'list', allowBlank: false, formulae: [ref(F_LISTES, '$A$2:$A$4')],
    showErrorMessage: true, errorTitle: 'Seuil', error: 'Choisissez un seuil dans la liste.',
  };
  habillerSaisie(ws, CELLULES.gravite);

  libelle(ws, 'A6', 'Territoire');
  ws.getCell(CELLULES.territoire).value = territoireInitial.libelle;
  ws.getCell(CELLULES.territoire).dataValidation = {
    type: 'list', allowBlank: false, formulae: [plages.territoires('D')],
    showErrorMessage: true, errorTitle: 'Territoire', error: 'Choisissez un territoire dans la liste.',
  };
  habillerSaisie(ws, CELLULES.territoire);

  libelle(ws, 'A7', 'Rayon — glissez la barre ci-dessous');
  ws.getCell(CELLULES.rayonKm).value = { formula: `${abs(CELLULES.palier)}/10` };
  ws.getCell(CELLULES.rayonKm).numFmt = '0.0" km"';
  ws.getCell(CELLULES.rayonKm).font = { bold: true, size: 13, color: { argb: 'FF1F8A7C' } };
  ws.getRow(8).height = 22;
}

/** Cellules techniques, masquées : les clés que toutes les formules relisent. */
function ecrireCellulesTechniques(ws: ExcelJS.Worksheet, etat: EtatInitialExport, plages: Plages): void {
  ws.getCell(CELLULES.cleGravite).value = {
    formula: `INDEX(${ref(F_LISTES, '$B$2:$B$4')},MATCH($B$5,${ref(F_LISTES, '$A$2:$A$4')},0))`,
  };
  const depuisListe = (col: string): { formula: string } =>
    ({ formula: `INDEX(${plages.territoires(col)},${plages.matchTerritoire})` });
  ws.getCell(CELLULES.typeTerritoire).value = depuisListe('E');
  ws.getCell(CELLULES.codeTerritoire).value = depuisListe('F');
  ws.getCell(CELLULES.regionDuTerritoire).value = depuisListe('H');
  ws.getCell(CELLULES.popTerritoire).value = depuisListe('G');
  ws.getCell(CELLULES.palier).value = palierDuRayon(etat.rayonM);
  ws.getCell(CELLULES.etiquettes).value = true;
}

/** Titre de section souligné de turquoise, sur les colonnes A et B. */
function section(ws: ExcelJS.Worksheet, ligne: number, texte: string): void {
  const c = ws.getCell(`A${ligne}`);
  c.value = texte;
  c.font = { bold: true, size: 11 };
  ws.getRow(ligne).getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FF4ECDC4' } } };
  ws.getRow(ligne).getCell(2).border = { bottom: { style: 'thin', color: { argb: 'FF4ECDC4' } } };
}

/** Population de la courbe totale au palier donné (une expression Excel), arrondie à l'habitant. */
const popAu = (palier: string): string => `ROUND(INDEX(${plageCourbe('B')},${palier}),0)`;

/** Les cinq chiffres clés, toutes natures, au rayon de la réglette. */
function ecrireChiffresCles(ws: ExcelJS.Worksheet): void {
  section(ws, 10, 'Au rayon choisi — toutes natures');
  const kpi = (ligne: number, texte: string, formule: string, format: string): void => {
    ws.getCell(`A${ligne}`).value = texte;
    const c = ws.getCell(`B${ligne}`);
    c.value = { formula: formule };
    c.numFmt = format;
    c.font = { bold: true };
  };
  const palier = abs(CELLULES.palier);
  const popTerr = abs(CELLULES.popTerritoire);
  kpi(11, 'Habitants à moins du rayon', popAu(palier), '#,##0');
  kpi(12, 'Part des habitants du territoire', `IF(${popTerr}>0,B11/${popTerr},0)`, '0.0 %');
  kpi(13, 'Part du total à 10 km', `IF(B15>0,B11/B15,0)`, '0.0 %');
  kpi(14, 'Gagnés par les 100 derniers mètres', `B11-IF(${palier}>1,${popAu(`${palier}-1`)},0)`, '#,##0');
  kpi(15, 'Habitants à moins de 10 km', popAu(String(N_PALIERS)), '#,##0');
}

/** Une ligne par nature : sa case (cellule liée masquée) et ses habitants au rayon ; puis l'avertissement. */
function ecrireNatures(ws: ExcelJS.Worksheet, natures: string[], cochees: Set<string>): void {
  section(ws, LIGNE_NATURES - 2, 'Natures de risque affichées sur le graphique');
  ws.getCell(`B${LIGNE_NATURES - 1}`).value = 'habitants au rayon';
  ws.getCell(`B${LIGNE_NATURES - 1}`).font = { size: 9, color: { argb: 'FF8A8A8A' } };
  natures.forEach((nat, j) => {
    const ligne = LIGNE_NATURES + j;
    ws.getCell(`Z${ligne}`).value = cochees.has(nat);
    ws.getCell(`B${ligne}`).value = {
      formula: `IF($Z$${ligne},ROUND(INDEX(${plageCourbe(lettre(3 + j))},${abs(CELLULES.palier)}),0),"masquée")`,
    };
    ws.getCell(`B${ligne}`).numFmt = '#,##0';
    ws.getCell(`B${ligne}`).alignment = { horizontal: 'right' };
    ws.getRow(ligne).height = 18;
  });
  const apres = LIGNE_NATURES + natures.length;
  ws.getRow(apres).height = 18;
  ecrireAvertissementNatures(ws, apres);
}

/** Ne s'affiche que si une nature est décochée : masquer une courbe ne retire rien d'un total. */
function ecrireAvertissementNatures(ws: ExcelJS.Worksheet, apres: number): void {
  const ligneNote = apres + 2;
  ws.getCell(`A${ligneNote}`).value = {
    formula: `IF(COUNTIF($Z$${LIGNE_NATURES}:$Z$${apres - 1},FALSE)>0,`
      + `"Des natures sont masquées : elles quittent le graphique, mais la courbe totale, les chiffres clés et `
      + `les tableaux portent toujours sur TOUTES les natures. Un habitant proche de deux natures compte dans les `
      + `deux courbes : leur somme ne ferait pas un total.","")`,
  };
  ws.getCell(`A${ligneNote}`).alignment = { wrapText: true, vertical: 'top' };
  ws.getCell(`A${ligneNote}`).font = { size: 9, color: { argb: 'FFC08400' } };
  ws.mergeCells(`A${ligneNote}:B${ligneNote + 3}`);
}

/** Les colonnes auxiliaires de « Courbes » : étiquettes et repère vertical. */
interface ColonnesAux { etqX: number; etqY: number; repX: number; repY: number }

/**
 * Feuille « Courbes » : cent paliers, la courbe totale et une colonne par
 * nature (#N/A si décochée — un point #N/A n'est pas tracé), puis les séries
 * techniques du graphique.
 */
function ecrireCourbes(ws: ExcelJS.Worksheet, natures: string[], plages: Plages): ColonnesAux {
  ws.getCell('A1').value = 'Rayon (km)';
  ws.getCell('B1').value = 'Toutes natures';
  natures.forEach((nat, j) => { ws.getCell(1, 3 + j).value = nat; });
  ws.getRow(1).font = { bold: true };
  const etqX = 3 + natures.length + 1;
  const aux: ColonnesAux = { etqX, etqY: etqX + 1, repX: etqX + 3, repY: etqX + 4 };
  ws.getCell(1, aux.etqX).value = 'Étiquettes — km';
  ws.getCell(1, aux.etqY).value = 'Étiquettes';
  ws.getCell(1, aux.repX).value = 'Repère — km';
  ws.getCell(1, aux.repY).value = 'Rayon choisi';

  const sommeSi = (colDonnees: string, critereNature: string): string =>
    `SUMIFS(${plages.donnees(colDonnees)},${plages.donnees('C')},${R(CELLULES.cleGravite)},`
    + `${plages.donnees('D')},${critereNature},${plages.donnees('E')},1)`;
  for (let i = 0; i < N_PALIERS; i++) {
    const n = i + 2;
    ws.getCell(n, 1).value = (i + 1) / 10;
    ws.getCell(n, 2).value = { formula: sommeSi(colCumul(i), `"${NATURE_TOUTES}"`) };
    natures.forEach((_, j) => {
      ws.getCell(n, 3 + j).value = {
        formula: `IF(${ref(F_RAYON, `$Z$${LIGNE_NATURES + j}`)},${sommeSi(colCumul(i), `${lettre(3 + j)}$1`)},NA())`,
      };
    });
  }
  ecrireSeriesTechniques(ws, aux);
  return aux;
}

/** Étiquettes au kilomètre et repère vertical au rayon choisi (deux points de même abscisse). */
function ecrireSeriesTechniques(ws: ExcelJS.Worksheet, aux: ColonnesAux): void {
  for (let km = 1; km <= 10; km++) {
    const n = km + 1;
    ws.getCell(n, aux.etqX).value = km;
    ws.getCell(n, aux.etqY).value = {
      formula: `IF(${R(CELLULES.etiquettes)},INDEX($B$2:$B$${N_PALIERS + 1},${km * 10}),NA())`,
    };
  }
  ws.getCell(2, aux.repX).value = { formula: R(CELLULES.rayonKm) };
  ws.getCell(3, aux.repX).value = { formula: `${lettre(aux.repX)}2` };
  ws.getCell(2, aux.repY).value = 0;
  ws.getCell(3, aux.repY).value = { formula: `MAX($B$2:$B$${N_PALIERS + 1})*1.08` };
  for (let c = 2; c <= aux.repY; c++) ws.getColumn(c).numFmt = '#,##0';
  ws.getColumn(1).numFmt = '0.0';
  ws.getColumn(aux.etqX).numFmt = '0';
  ws.getColumn(aux.repX).numFmt = '0.0';
}

/** Ce qui distingue le tableau des régions de celui des départements. */
interface SpecTableau {
  titre: string;
  entetes: string[];
  unites: Array<{ code: string; nom: string; region?: string; pop: number | null }>;
  /** Colonne de « Données » qui porte le code de l'unité : A département, B région. */
  critereCol: 'A' | 'B';
  /**
   * Le tableau des départements porte en plus le NOM de la région (colonne
   * C, qui décale les suivantes) et son CODE (colonne I, masquée).
   */
  avecRegion: boolean;
  dansTerritoire: (ligne: number) => string;
}

/** Les deux tableaux, régions puis départements. */
function ecrireTableauxUnites(
  wsRegions: ExcelJS.Worksheet, wsDepts: ExcelJS.Worksheet, d: DonneesExportRayon, plages: Plages,
): void {
  const type = R(CELLULES.typeTerritoire);
  const code = R(CELLULES.codeTerritoire);
  const nomRegion = new Map(d.regions.map((r) => [r.code, r.nom]));
  ecrireTableau(wsRegions, {
    titre: 'Par région',
    entetes: ['Code', 'Région', 'Habitants à moins du rayon', 'Population de la région', 'Part',
      'À moins de 10 km', 'Dans le territoire'],
    unites: d.regions, critereCol: 'B', avecRegion: false,
    dansTerritoire: (n) => `IF(${type}="france",1,IF($A${n}=${R(CELLULES.regionDuTerritoire)},1,0))`,
  }, plages, nomRegion);
  ecrireTableau(wsDepts, {
    titre: 'Par département',
    entetes: ['Code', 'Département', 'Région', 'Habitants à moins du rayon', 'Population du département',
      'Part', 'À moins de 10 km', 'Dans le territoire'],
    unites: d.departements, critereCol: 'A', avecRegion: true,
    // Le CODE de région est lu dans la colonne I masquée, jamais cherché par
    // code dans la liste des territoires : 18 codes INSEE désignent à la fois
    // une région et un département (sql/171).
    dansTerritoire: (n) => `IF(${type}="france",1,IF(${type}="region",`
      + `IF($I${n}=${code},1,0),IF($A${n}=${code},1,0)))`,
  }, plages, nomRegion);
}

/**
 * Un tableau par unité : habitants au rayon, population, part, à 10 km. Seules
 * les unités du territoire sont renseignées ; les autres restent vides.
 */
function ecrireTableau(ws: ExcelJS.Worksheet, spec: SpecTableau, plages: Plages, nomRegion: Map<string, string>): void {
  ws.getCell('A1').value = {
    formula: `"${spec.titre} — habitants à moins de "&FIXED(${R(CELLULES.rayonKm)},1)&" km d’un site — "&${R(CELLULES.gravite)}`,
  };
  ws.getCell('A1').font = { bold: true, size: 12 };
  ws.getCell('A2').value = 'Toutes natures confondues. Seules les unités du territoire choisi sur la feuille « Rayon » '
    + 'sont renseignées ; le rayon et le seuil se règlent aussi là-bas.';
  ws.getCell('A2').font = { size: 9, color: { argb: 'FF8A8A8A' } };
  ws.getRow(4).values = spec.entetes;
  ws.getRow(4).font = { bold: true };
  const decal = spec.avecRegion ? 1 : 0;
  spec.unites.forEach((u, i) => ecrireLigneUnite(ws, spec, u, i + 5, plages, nomRegion));
  ecrireTotalTableau(ws, spec.unites.length + 4, decal);
  mettreEnFormeTableau(ws, decal);
}

/** Une ligne d'unité : code, nom, (région), habitants, population, part, à 10 km, test du territoire. */
function ecrireLigneUnite(
  ws: ExcelJS.Worksheet, spec: SpecTableau, u: SpecTableau['unites'][number], n: number,
  plages: Plages, nomRegion: Map<string, string>,
): void {
  const decal = spec.avecRegion ? 1 : 0;
  const somme = (valeurs: string): string =>
    `ROUND(SUMIFS(${valeurs},${plages.donnees('C')},${R(CELLULES.cleGravite)},${plages.donnees('D')},"${NATURE_TOUTES}",`
    + `${plages.donnees(spec.critereCol)},$A${n}),0)`;
  const auRayon = `INDEX(${plages.cumuls},0,${R(CELLULES.palier)})`;
  const dixKm = plages.donnees(colCumul(N_PALIERS - 1));
  const row = ws.getRow(n);
  row.getCell(1).value = u.code;
  row.getCell(2).value = u.nom;
  if (spec.avecRegion) {
    row.getCell(3).value = nomRegion.get(u.region ?? '') ?? u.region ?? '';
    row.getCell(9).value = u.region ?? '';
  }
  const dedans = `$${lettre(7 + decal)}${n}=1`;
  const cPop = lettre(3 + decal);
  const cTot = lettre(4 + decal);
  row.getCell(7 + decal).value = { formula: spec.dansTerritoire(n) };
  row.getCell(3 + decal).value = { formula: `IF(${dedans},${somme(auRayon)},"")` };
  row.getCell(4 + decal).value = u.pop ?? null;
  row.getCell(5 + decal).value = { formula: `IF(AND(${dedans},N(${cTot}${n})>0),${cPop}${n}/${cTot}${n},"")` };
  row.getCell(6 + decal).value = { formula: `IF(${dedans},${somme(dixKm)},"")` };
}

/** Ligne de total sous le tableau : habitants au rayon et à 10 km. */
function ecrireTotalTableau(ws: ExcelJS.Worksheet, fin: number, decal: number): void {
  const rTotal = ws.getRow(fin + 1);
  rTotal.getCell(2).value = 'Total du territoire';
  for (const k of [3, 6]) {
    const c = lettre(k + decal);
    rTotal.getCell(k + decal).value = { formula: `SUM(${c}5:${c}${fin})` };
  }
  rTotal.font = { bold: true };
  rTotal.border = { top: { style: 'thin' } };
}

/** Formats et largeurs ; colonnes techniques masquées. */
function mettreEnFormeTableau(ws: ExcelJS.Worksheet, decal: number): void {
  for (const k of [3, 4, 6]) ws.getColumn(k + decal).numFmt = '#,##0';
  ws.getColumn(5 + decal).numFmt = '0.0 %';
  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 30;
  if (decal) ws.getColumn(3).width = 28;
  for (const k of [3, 4, 5, 6]) ws.getColumn(k + decal).width = 18;
  ws.getColumn(7 + decal).hidden = true;
  if (decal) ws.getColumn(9).hidden = true;
}

/** Les séries du graphique : la totale, une par nature, puis les deux séries techniques. */
function seriesDuGraphique(natures: string[], aux: ColonnesAux): SerieGraphique[] {
  const plageAux = (col: number, fin: number): string => ref(F_COURBES, `$${lettre(col)}$2:$${lettre(col)}$${fin}`);
  return [
    {
      nom: ref(F_COURBES, '$B$1'), libelle: 'Toutes natures', nPoints: N_PALIERS,
      x: plageCourbe('A'), y: plageCourbe('B'), couleur: COULEUR_TOTALE, epaisseurPt: 2.5,
    },
    ...natures.map((nat, j): SerieGraphique => ({
      nom: ref(F_COURBES, `$${lettre(3 + j)}$1`), libelle: nat, nPoints: N_PALIERS,
      x: plageCourbe('A'), y: plageCourbe(lettre(3 + j)),
      couleur: COULEURS_NATURES[j % COULEURS_NATURES.length],
      epaisseurPt: 1.25,
      // Au-delà de huit natures, une teinte revient : le pointillé les distingue.
      pointille: j >= COULEURS_NATURES.length,
    })),
    {
      nom: ref(F_COURBES, `$${lettre(aux.etqY)}$1`), libelle: 'Étiquettes', nPoints: 10,
      x: plageAux(aux.etqX, 11), y: plageAux(aux.etqY, 11),
      couleur: COULEUR_TOTALE, epaisseurPt: 0, sansTrait: true, horsLegende: true,
      etiquettes: { formatCode: '[>=1000000]0.0,," M";[>=1000]0," k";0' },
    },
    {
      nom: ref(F_COURBES, `$${lettre(aux.repY)}$1`), libelle: 'Rayon choisi', nPoints: 2,
      x: plageAux(aux.repX, 3), y: plageAux(aux.repY, 3),
      couleur: COULEUR_TOTALE, epaisseurPt: 1, pointille: true, horsLegende: true,
    },
  ];
}

/** La barre de défilement du rayon, une case par nature, la case des étiquettes. */
function controlesDuFormulaire(natures: string[], cochees: Set<string>, rayonM: number): Controle[] {
  return [
    {
      type: 'defilement',
      ancre: { de: { col: 0, ligne: 7, dy: 2 }, a: { col: 2, ligne: 8, dy: -2 } },
      lien: abs(CELLULES.palier),
      valeur: palierDuRayon(rayonM), min: 1, max: N_PALIERS, pas: 1, page: 10,
    },
    ...natures.map((nat, j): Controle => ({
      type: 'case',
      ancre: { de: { col: 0, ligne: LIGNE_NATURES - 1 + j }, a: { col: 1, ligne: LIGNE_NATURES + j } },
      lien: `$Z$${LIGNE_NATURES + j}`,
      texte: nat,
      cochee: cochees.has(nat),
    })),
    {
      type: 'case',
      ancre: { de: { col: 0, ligne: 8 }, a: { col: 1, ligne: 9 } },
      lien: abs(CELLULES.etiquettes),
      texte: 'Afficher les étiquettes (tous les 1 km)',
      cochee: true,
    },
  ];
}

/** L'onglet de méthode : il voyage avec le fichier, quand l'écran n'est plus là pour expliquer. */
function ecrireMethode(ws: ExcelJS.Worksheet): void {
  ws.columns = [{ width: 34 }, { width: 110 }];
  const ligne = (a: string, b: string, gras = false) => {
    const r = ws.addRow([a, b]);
    if (gras) r.font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(1).alignment = { vertical: 'top' };
  };
  ligne('Comment le chiffre est obtenu', '', true);
  ligne('La question',
    'Combien d’habitants vivent à moins de X km d’au moins un site Seveso ? La courbe va de 100 m à 10 km, par paliers de 100 m.');
  ligne('La distance',
    'Du CENTRE de chaque carreau INSEE de 200 m au site le plus proche, en mètres réels. Un carreau est compté ENTIER '
    + 'dès que son centre est à moins du rayon — pas de prorata de surface. Les périmètres PPRT n’interviennent pas : '
    + 'c’est un rayon autour du site, pas une zone réglementaire.');
  ligne('La population',
    'Population totale des ménages fiscaux, carroyage INSEE Filosofi 2021. Le carroyage totalise environ 63,8 millions '
    + 'd’habitants et non les 67,8 millions de la population légale : comparer ces deux totaux ferait conclure à tort à une lacune.');
  ligne('Les seuils Seveso',
    '« Seuil haut et seuil bas » compte chaque habitant UNE fois, au site le plus proche des deux seuils. Ce n’est PAS '
    + 'la somme des deux autres choix : un habitant proche d’un site de chaque seuil compte dans les deux.');
  ws.addRow([]);
  ligne('Ce que les chiffres ne disent pas', '', true);
  ligne('Les courbes par nature',
    'Chacune est exacte pour sa propre question, mais elles ne s’additionnent PAS : un habitant proche d’un site '
    + 'inflammable et d’un site toxique compte dans les deux. La courbe « Toutes natures » est calculée à part.');
  ligne('Masquer une nature',
    'La retire du graphique seulement. La courbe totale, les chiffres clés et les tableaux restent sur toutes les '
    + 'natures : recalculer un total sans une nature exigerait le détail carreau par carreau, que ce classeur ne porte pas.');
  ligne('Le territoire',
    'Une région ou un département compte les habitants qui y RÉSIDENT, quel que soit le département du site. '
    + 'Les tableaux sont additifs : la somme des départements d’une région égale la région.');
  ligne('La part',
    'Rapportée à la population carroyée de l’unité (même source que le numérateur). Un prorata dont les deux termes '
    + 'ne comptent pas la même chose ne voudrait rien dire.');
  ligne('Outre-mer',
    'La Martinique et La Réunion sont comptées. La Guadeloupe, la Guyane et Mayotte n’ont pas de carroyage INSEE : '
    + 'leurs sites existent, mais aucune population n’y est calculable. Une absence, pas un zéro.');
  ws.addRow([]);
  ligne('Utiliser ce classeur', '', true);
  ligne('Les réglages',
    'Feuille « Rayon » : menus Seuil Seveso et Territoire, barre de défilement du rayon, cases des natures et des '
    + 'étiquettes. Tout le classeur se recalcule — y compris les feuilles Régions et Départements.');
  ligne('Les données',
    'Feuille « Données » : une ligne par département, seuil et nature, et la population cumulée à chaque palier. '
    + '« seveso_haut_et_bas » et « (toutes natures) » sont des lignes calculées à part, jamais des sommes.');
  ws.addRow([]);
  ligne('Sources', '', true);
  ligne('Sites à risque', 'Géorisques (ministère de la Transition écologique), API installations classées.');
  ligne('Population', 'INSEE Filosofi, carroyage 200 m, millésime 2021.');
  ligne('Découpage', 'Référentiels INSEE des régions et départements.');
  ligne('Produit par', 'dentsu.explore — onglet Rayon du module « Population à risque industriel ».');
}
