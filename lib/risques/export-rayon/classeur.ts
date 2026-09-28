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

/** Lettre(s) d'une colonne, 1-indexée (1 → A, 27 → AA). */
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

/** `B7` → `$B$7`. */
export function abs(adresse: string): string {
  return adresse.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
}

/** Première ligne des cases de nature sur la feuille « Rayon ». */
const LIGNE_NATURES = 20;

/** Première colonne des cumuls sur « Données » (F) : cumul i en colonne F + i. */
const COL_CUMUL0 = 6;

// ── Construction ──────────────────────────────────────────────────────────

/**
 * Construit le classeur et y injecte graphique et contrôles.
 *
 * @param d - Les données préparées (`preparerDonnees`).
 * @param etat - L'état de l'écran à l'export : valeurs initiales des contrôles.
 * @param editeLe - Date d'édition (paramètre pour des tests déterministes).
 * @returns Le fichier .xlsx.
 */
export async function construireClasseurRayon(
  d: DonneesExportRayon,
  etat: EtatInitialExport,
  editeLe: Date = new Date(),
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MAGELIAN';
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

  const nLignes = d.lignes.length;
  const derniereLigne = nLignes + 1;
  const plage = (col: string) => `${ref(F_DONNEES, `$${col}$2:$${col}$${derniereLigne}`)}`;
  const colCumul = (i: number) => lettre(COL_CUMUL0 + i);
  const plageCumuls = ref(F_DONNEES, `$${colCumul(0)}$2:$${colCumul(N_PALIERS - 1)}$${derniereLigne}`);
  const R = (c: string) => ref(F_RAYON, c);

  // ── Listes (masquée) ────────────────────────────────────────────────────
  wsListes.getCell('A1').value = 'Seuil';
  wsListes.getCell('B1').value = 'Clé';
  CHOIX_GRAVITE.forEach((c, i) => {
    wsListes.getCell(`A${i + 2}`).value = c.libelle;
    wsListes.getCell(`B${i + 2}`).value = c.cle;
  });

  const nomRegion = new Map(d.regions.map((r) => [r.code, r.nom]));
  const territoires: Array<{ libelle: string; type: string; code: string; pop: number; region: string }> = [
    {
      libelle: 'France entière', type: 'france', code: '', region: '',
      pop: d.regions.reduce((s, r) => s + (r.pop ?? 0), 0),
    },
    ...d.regions.map((r) => ({
      libelle: `${r.nom} (région)`, type: 'region', code: r.code, pop: r.pop ?? 0, region: r.code,
    })),
    ...d.departements.map((dp) => ({
      libelle: `${dp.code} — ${dp.nom}`, type: 'departement', code: dp.code, pop: dp.pop ?? 0, region: dp.region,
    })),
  ];
  ['Territoire', 'Type', 'Code', 'Population', 'Région'].forEach((t, i) => {
    wsListes.getCell(1, 4 + i).value = t;
  });
  territoires.forEach((t, i) => {
    const l = i + 2;
    wsListes.getCell(l, 4).value = t.libelle;
    wsListes.getCell(l, 5).value = t.type;
    wsListes.getCell(l, 6).value = t.code;
    wsListes.getCell(l, 7).value = t.pop;
    wsListes.getCell(l, 8).value = t.region;
  });
  const finTerr = territoires.length + 1;
  const L = (col: string) => ref(F_LISTES, `$${col}$2:$${col}$${finTerr}`);
  const matchTerr = `MATCH(${abs(CELLULES.territoire)},${L('D')},0)`;

  const territoireInitial = etat.perim
    ? territoires.find((t) => t.type === etat.perim!.niveau && t.code === etat.perim!.code) ?? territoires[0]
    : territoires[0];
  const graviteInitiale = CHOIX_GRAVITE.find((c) => c.cle === cleGraviteInitiale(etat.gravites))!;
  const naturesCochees = new Set(etat.natures.length > 0 ? etat.natures : d.natures);

  // ── Données ─────────────────────────────────────────────────────────────
  wsDonnees.getRow(1).values = [
    'Département', 'Région', 'Seuil', 'Nature', 'Dans le territoire',
    ...Array.from({ length: N_PALIERS }, (_, i) => `< ${((i + 1) / 10).toFixed(1).replace('.', ',')} km`),
  ];
  wsDonnees.getRow(1).font = { bold: true };
  d.lignes.forEach((l, i) => {
    const n = i + 2;
    const row = wsDonnees.getRow(n);
    row.getCell(1).value = l.departement;
    row.getCell(2).value = l.region;
    row.getCell(3).value = l.gravite;
    row.getCell(4).value = l.nature;
    // La ligne compte-t-elle dans le territoire choisi ? Calculé UNE fois par
    // ligne, puis simple critère `=1` pour toutes les sommes.
    row.getCell(5).value = {
      formula: `IF(${R(abs(CELLULES.typeTerritoire))}="france",1,IF(${R(abs(CELLULES.typeTerritoire))}="region",`
        + `IF(B${n}=${R(abs(CELLULES.codeTerritoire))},1,0),IF(A${n}=${R(abs(CELLULES.codeTerritoire))},1,0)))`,
    };
    l.cumuls.forEach((v, k) => { row.getCell(COL_CUMUL0 + k).value = Math.round(v * 100) / 100; });
  });
  wsDonnees.getColumn(4).width = 36;
  for (let k = 0; k < N_PALIERS; k++) wsDonnees.getColumn(COL_CUMUL0 + k).numFmt = '#,##0';

  // ── Rayon : saisies ─────────────────────────────────────────────────────
  wsRayon.columns = [
    { width: 46 }, { width: 24 }, { width: 3 },
    ...Array.from({ length: 13 }, () => ({ width: 11 })),
  ];
  for (const c of ['Z', 'AA', 'AB', 'AC']) wsRayon.getColumn(c).hidden = true;

  wsRayon.getCell('A1').value = 'Population à proximité des sites Seveso — rayon d’influence';
  wsRayon.getCell('A1').font = { bold: true, size: 14 };
  // Le titre du graphique : une cellule, pour qu'il suive les trois menus.
  wsRayon.getCell(CELLULES.titreGraphique).value = {
    formula: `"Population à moins de "&FIXED(${abs(CELLULES.rayonKm)},1)&" km — "&${abs(CELLULES.gravite)}&" — "&${abs(CELLULES.territoire)}`,
  };
  wsRayon.getCell(CELLULES.titreGraphique).font = { italic: true, color: { argb: 'FF595959' } };
  wsRayon.getCell('A3').value = `Cible : population totale (ménages fiscaux, carroyage INSEE Filosofi 2021 à 200 m)`
    + ` · pré-calcul du ${d.calculeLe ? new Date(d.calculeLe).toLocaleDateString('fr-FR') : 'date inconnue'}`
    + ` · édité le ${editeLe.toLocaleDateString('fr-FR')}`;
  wsRayon.getCell('A3').font = { size: 9, color: { argb: 'FF8A8A8A' } };

  const libelle = (c: string, t: string) => {
    wsRayon.getCell(c).value = t;
    wsRayon.getCell(c).font = { bold: true };
  };
  const saisie = (c: string) => {
    wsRayon.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF7F5' } };
    wsRayon.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FF4ECDC4' } } };
  };

  libelle('A5', 'Seuil Seveso');
  wsRayon.getCell(CELLULES.gravite).value = graviteInitiale.libelle;
  wsRayon.getCell(CELLULES.gravite).dataValidation = {
    type: 'list', allowBlank: false, formulae: [ref(F_LISTES, '$A$2:$A$4')],
    showErrorMessage: true, errorTitle: 'Seuil', error: 'Choisissez un seuil dans la liste.',
  };
  saisie(CELLULES.gravite);

  libelle('A6', 'Territoire');
  wsRayon.getCell(CELLULES.territoire).value = territoireInitial.libelle;
  wsRayon.getCell(CELLULES.territoire).dataValidation = {
    type: 'list', allowBlank: false, formulae: [L('D')],
    showErrorMessage: true, errorTitle: 'Territoire', error: 'Choisissez un territoire dans la liste.',
  };
  saisie(CELLULES.territoire);

  libelle('A7', 'Rayon — glissez la barre ci-dessous');
  wsRayon.getCell(CELLULES.rayonKm).value = { formula: `${abs(CELLULES.palier)}/10` };
  wsRayon.getCell(CELLULES.rayonKm).numFmt = '0.0" km"';
  wsRayon.getCell(CELLULES.rayonKm).font = { bold: true, size: 13, color: { argb: 'FF1F8A7C' } };
  wsRayon.getRow(8).height = 22;

  // Cellules techniques, masquées : clés lues par toutes les formules.
  wsRayon.getCell(CELLULES.cleGravite).value = {
    formula: `INDEX(${ref(F_LISTES, '$B$2:$B$4')},MATCH($B$5,${ref(F_LISTES, '$A$2:$A$4')},0))`,
  };
  wsRayon.getCell(CELLULES.typeTerritoire).value = { formula: `INDEX(${L('E')},${matchTerr})` };
  wsRayon.getCell(CELLULES.codeTerritoire).value = { formula: `INDEX(${L('F')},${matchTerr})` };
  wsRayon.getCell(CELLULES.regionDuTerritoire).value = { formula: `INDEX(${L('H')},${matchTerr})` };
  wsRayon.getCell(CELLULES.popTerritoire).value = { formula: `INDEX(${L('G')},${matchTerr})` };
  wsRayon.getCell(CELLULES.palier).value = palierDuRayon(etat.rayonM);
  wsRayon.getCell(CELLULES.etiquettes).value = true;

  // ── Rayon : chiffres clés ───────────────────────────────────────────────
  const total = (r: string) => `${ref(F_COURBES, `$B$2:$B$${N_PALIERS + 1}`)}${r}`;
  const popAu = (palier: string) => `ROUND(INDEX(${total('')},${palier}),0)`;
  const section = (ligne: number, texte: string) => {
    const c = wsRayon.getCell(`A${ligne}`);
    c.value = texte;
    c.font = { bold: true, size: 11 };
    wsRayon.getRow(ligne).getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FF4ECDC4' } } };
    wsRayon.getRow(ligne).getCell(2).border = { bottom: { style: 'thin', color: { argb: 'FF4ECDC4' } } };
  };
  section(10, 'Au rayon choisi — toutes natures');
  const kpi = (ligne: number, texte: string, formule: string, format: string) => {
    wsRayon.getCell(`A${ligne}`).value = texte;
    const c = wsRayon.getCell(`B${ligne}`);
    c.value = { formula: formule };
    c.numFmt = format;
    c.font = { bold: true };
  };
  kpi(11, 'Habitants à moins du rayon', popAu(abs(CELLULES.palier)), '#,##0');
  kpi(12, 'Part des habitants du territoire', `IF(${abs(CELLULES.popTerritoire)}>0,B11/${abs(CELLULES.popTerritoire)},0)`, '0.0 %');
  kpi(13, 'Part du total à 10 km', `IF(B15>0,B11/B15,0)`, '0.0 %');
  kpi(14, 'Gagnés par les 100 derniers mètres',
    `B11-IF(${abs(CELLULES.palier)}>1,${popAu(`${abs(CELLULES.palier)}-1`)},0)`, '#,##0');
  kpi(15, 'Habitants à moins de 10 km', popAu(String(N_PALIERS)), '#,##0');

  // ── Rayon : natures ─────────────────────────────────────────────────────
  section(LIGNE_NATURES - 2, 'Natures de risque affichées sur le graphique');
  wsRayon.getCell(`B${LIGNE_NATURES - 1}`).value = 'habitants au rayon';
  wsRayon.getCell(`B${LIGNE_NATURES - 1}`).font = { size: 9, color: { argb: 'FF8A8A8A' } };
  d.natures.forEach((nat, j) => {
    const ligne = LIGNE_NATURES + j;
    wsRayon.getCell(`Z${ligne}`).value = naturesCochees.has(nat);
    const colCourbe = lettre(3 + j);
    wsRayon.getCell(`B${ligne}`).value = {
      formula: `IF($Z$${ligne},ROUND(INDEX(${ref(F_COURBES, `$${colCourbe}$2:$${colCourbe}$${N_PALIERS + 1}`)},`
        + `${abs(CELLULES.palier)}),0),"masquée")`,
    };
    wsRayon.getCell(`B${ligne}`).numFmt = '#,##0';
    wsRayon.getCell(`B${ligne}`).alignment = { horizontal: 'right' };
    wsRayon.getRow(ligne).height = 18;
  });
  const ligneApresNatures = LIGNE_NATURES + d.natures.length;
  wsRayon.getRow(ligneApresNatures).height = 18;
  const ligneNote = ligneApresNatures + 2;
  wsRayon.getCell(`A${ligneNote}`).value = {
    formula: `IF(COUNTIF($Z$${LIGNE_NATURES}:$Z$${ligneApresNatures - 1},FALSE)>0,`
      + `"Des natures sont masquées : elles quittent le graphique, mais la courbe totale, les chiffres clés et `
      + `les tableaux portent toujours sur TOUTES les natures. Un habitant proche de deux natures compte dans les `
      + `deux courbes : leur somme ne ferait pas un total.","")`,
  };
  wsRayon.getCell(`A${ligneNote}`).alignment = { wrapText: true, vertical: 'top' };
  wsRayon.getCell(`A${ligneNote}`).font = { size: 9, color: { argb: 'FFC08400' } };
  wsRayon.mergeCells(`A${ligneNote}:B${ligneNote + 3}`);

  // ── Courbes ─────────────────────────────────────────────────────────────
  wsCourbes.getCell('A1').value = 'Rayon (km)';
  wsCourbes.getCell('B1').value = 'Toutes natures';
  d.natures.forEach((nat, j) => { wsCourbes.getCell(1, 3 + j).value = nat; });
  wsCourbes.getRow(1).font = { bold: true };
  const colEtqX = 3 + d.natures.length + 1;
  const colEtqY = colEtqX + 1;
  const colRepX = colEtqX + 3;
  const colRepY = colRepX + 1;
  wsCourbes.getCell(1, colEtqX).value = 'Étiquettes — km';
  wsCourbes.getCell(1, colEtqY).value = 'Étiquettes';
  wsCourbes.getCell(1, colRepX).value = 'Repère — km';
  wsCourbes.getCell(1, colRepY).value = 'Rayon choisi';

  const sommeSi = (colDonnees: string, critereNature: string) =>
    `SUMIFS(${plage(colDonnees)},${plage('C')},${R(abs(CELLULES.cleGravite))},`
    + `${plage('D')},${critereNature},${plage('E')},1)`;

  for (let i = 0; i < N_PALIERS; i++) {
    const n = i + 2;
    const cd = colCumul(i);
    wsCourbes.getCell(n, 1).value = (i + 1) / 10;
    wsCourbes.getCell(n, 2).value = { formula: sommeSi(cd, `"${NATURE_TOUTES}"`) };
    d.natures.forEach((_, j) => {
      const col = lettre(3 + j);
      wsCourbes.getCell(n, 3 + j).value = {
        formula: `IF(${R(`$Z$${LIGNE_NATURES + j}`)},${sommeSi(cd, `${col}$1`)},NA())`,
      };
    });
  }
  // Étiquettes : un point par kilomètre, #N/A quand la case est décochée —
  // un point #N/A n'est pas tracé, donc son étiquette non plus.
  for (let km = 1; km <= 10; km++) {
    const n = km + 1;
    wsCourbes.getCell(n, colEtqX).value = km;
    wsCourbes.getCell(n, colEtqY).value = {
      formula: `IF(${R(abs(CELLULES.etiquettes))},INDEX($B$2:$B$${N_PALIERS + 1},${km * 10}),NA())`,
    };
  }
  // Repère vertical au rayon choisi : deux points de même abscisse.
  wsCourbes.getCell(2, colRepX).value = { formula: R(abs(CELLULES.rayonKm)) };
  wsCourbes.getCell(3, colRepX).value = { formula: `${lettre(colRepX)}2` };
  wsCourbes.getCell(2, colRepY).value = 0;
  wsCourbes.getCell(3, colRepY).value = { formula: `MAX($B$2:$B$${N_PALIERS + 1})*1.08` };
  for (let c = 2; c <= colRepY; c++) wsCourbes.getColumn(c).numFmt = '#,##0';
  wsCourbes.getColumn(1).numFmt = '0.0';
  wsCourbes.getColumn(colEtqX).numFmt = '0';
  wsCourbes.getColumn(colRepX).numFmt = '0.0';

  // ── Tableaux par région et par département ──────────────────────────────
  const colonneAuRayon = `INDEX(${plageCumuls},0,${R(abs(CELLULES.palier))})`;
  const sommeUnite = (colonneValeurs: string, critereCol: string, cellCode: string) =>
    `ROUND(SUMIFS(${colonneValeurs},${plage('C')},${R(abs(CELLULES.cleGravite))},${plage('D')},"${NATURE_TOUTES}",`
    + `${plage(critereCol)},${cellCode}),0)`;
  const colDixKm = plage(colCumul(N_PALIERS - 1));

  const tableau = (
    ws: ExcelJS.Worksheet,
    titre: string,
    entetes: string[],
    unites: Array<{ code: string; nom: string; region?: string; pop: number | null }>,
    critereCol: 'A' | 'B',
    dansTerritoire: (ligne: number) => string,
  ) => {
    ws.getCell('A1').value = {
      formula: `"${titre} — habitants à moins de "&FIXED(${R(abs(CELLULES.rayonKm))},1)&" km d’un site — "&${R(abs(CELLULES.gravite))}`,
    };
    ws.getCell('A1').font = { bold: true, size: 12 };
    ws.getCell('A2').value = 'Toutes natures confondues. Seules les unités du territoire choisi sur la feuille « Rayon » '
      + 'sont renseignées ; le rayon et le seuil se règlent aussi là-bas.';
    ws.getCell('A2').font = { size: 9, color: { argb: 'FF8A8A8A' } };
    ws.getRow(4).values = entetes;
    ws.getRow(4).font = { bold: true };
    const decal = critereCol === 'A' && entetes.length > 7 ? 1 : 0;
    unites.forEach((u, i) => {
      const n = i + 5;
      const row = ws.getRow(n);
      row.getCell(1).value = u.code;
      row.getCell(2).value = u.nom;
      if (decal) {
        row.getCell(3).value = nomRegion.get(u.region ?? '') ?? u.region ?? '';
        // Le CODE de région, masqué, pour le test « dans le territoire ». Ne
        // PAS le chercher dans la liste des territoires par code : 18 codes
        // INSEE désignent à la fois une région et un département (sql/171).
        row.getCell(9).value = u.region ?? '';
      }
      const cIn = 7 + decal;
      const cPop = lettre(3 + decal);
      const cTot = lettre(4 + decal);
      row.getCell(cIn).value = { formula: dansTerritoire(n) };
      row.getCell(3 + decal).value = {
        formula: `IF($${lettre(cIn)}${n}=1,${sommeUnite(colonneAuRayon, critereCol, `$A${n}`)},"")`,
      };
      row.getCell(4 + decal).value = u.pop ?? null;
      row.getCell(5 + decal).value = {
        formula: `IF(AND($${lettre(cIn)}${n}=1,N(${cTot}${n})>0),${cPop}${n}/${cTot}${n},"")`,
      };
      row.getCell(6 + decal).value = {
        formula: `IF($${lettre(cIn)}${n}=1,${sommeUnite(colDixKm, critereCol, `$A${n}`)},"")`,
      };
    });
    const fin = unites.length + 4;
    const rTotal = ws.getRow(fin + 1);
    rTotal.getCell(2).value = 'Total du territoire';
    for (const k of [3, 6]) {
      const c = lettre(k + decal);
      rTotal.getCell(k + decal).value = { formula: `SUM(${c}5:${c}${fin})` };
    }
    rTotal.font = { bold: true };
    rTotal.border = { top: { style: 'thin' } };
    for (const k of [3, 4, 6]) ws.getColumn(k + decal).numFmt = '#,##0';
    ws.getColumn(5 + decal).numFmt = '0.0 %';
    ws.getColumn(1).width = 8;
    ws.getColumn(2).width = 30;
    if (decal) ws.getColumn(3).width = 28;
    for (const k of [3, 4, 5, 6]) ws.getColumn(k + decal).width = 18;
    ws.getColumn(7 + decal).hidden = true;
    if (decal) ws.getColumn(9).hidden = true;
  };

  tableau(
    wsRegions, 'Par région',
    ['Code', 'Région', 'Habitants à moins du rayon', 'Population de la région', 'Part', 'À moins de 10 km', 'Dans le territoire'],
    d.regions, 'B',
    (n) => `IF(${R(abs(CELLULES.typeTerritoire))}="france",1,IF($A${n}=${R(abs(CELLULES.regionDuTerritoire))},1,0))`,
  );
  tableau(
    wsDepts, 'Par département',
    ['Code', 'Département', 'Région', 'Habitants à moins du rayon', 'Population du département', 'Part',
      'À moins de 10 km', 'Dans le territoire'],
    d.departements, 'A',
    (n) => `IF(${R(abs(CELLULES.typeTerritoire))}="france",1,IF(${R(abs(CELLULES.typeTerritoire))}="region",`
      + `IF($I${n}=${R(abs(CELLULES.codeTerritoire))},1,0),`
      + `IF($A${n}=${R(abs(CELLULES.codeTerritoire))},1,0)))`,
  );

  // ── Méthode et limites ──────────────────────────────────────────────────
  ecrireMethode(wsMethode);

  // ── Graphique et contrôles ──────────────────────────────────────────────
  const plageCourbe = (col: string) => ref(F_COURBES, `$${col}$2:$${col}$${N_PALIERS + 1}`);
  const series: SerieGraphique[] = [
    {
      nom: ref(F_COURBES, '$B$1'), libelle: 'Toutes natures', nPoints: N_PALIERS, x: plageCourbe('A'), y: plageCourbe('B'),
      couleur: COULEUR_TOTALE, epaisseurPt: 2.5,
    },
    ...d.natures.map((nat, j): SerieGraphique => {
      const col = lettre(3 + j);
      return {
        nom: ref(F_COURBES, `$${col}$1`), libelle: nat, nPoints: N_PALIERS, x: plageCourbe('A'), y: plageCourbe(col),
        couleur: COULEURS_NATURES[j % COULEURS_NATURES.length],
        epaisseurPt: 1.25,
        // Au-delà de huit natures, une teinte revient : le pointillé les distingue.
        pointille: j >= COULEURS_NATURES.length,
      };
    }),
    {
      nom: ref(F_COURBES, `$${lettre(colEtqY)}$1`), libelle: 'Étiquettes', nPoints: 10,
      x: ref(F_COURBES, `$${lettre(colEtqX)}$2:$${lettre(colEtqX)}$11`),
      y: ref(F_COURBES, `$${lettre(colEtqY)}$2:$${lettre(colEtqY)}$11`),
      couleur: COULEUR_TOTALE, epaisseurPt: 0, sansTrait: true, horsLegende: true,
      etiquettes: { formatCode: '[>=1000000]0.0,," M";[>=1000]0," k";0' },
    },
    {
      nom: ref(F_COURBES, `$${lettre(colRepY)}$1`), libelle: 'Rayon choisi', nPoints: 2,
      x: ref(F_COURBES, `$${lettre(colRepX)}$2:$${lettre(colRepX)}$3`),
      y: ref(F_COURBES, `$${lettre(colRepY)}$2:$${lettre(colRepY)}$3`),
      couleur: COULEUR_TOTALE, epaisseurPt: 1, pointille: true, horsLegende: true,
    },
  ];

  const controles: Controle[] = [
    {
      type: 'defilement',
      ancre: { de: { col: 0, ligne: 7, dy: 2 }, a: { col: 2, ligne: 8, dy: -2 } },
      lien: abs(CELLULES.palier),
      valeur: palierDuRayon(etat.rayonM), min: 1, max: N_PALIERS, pas: 1, page: 10,
    },
    ...d.natures.map((nat, j): Controle => ({
      type: 'case',
      ancre: { de: { col: 0, ligne: LIGNE_NATURES - 1 + j }, a: { col: 1, ligne: LIGNE_NATURES + j } },
      lien: `$Z$${LIGNE_NATURES + j}`,
      texte: nat,
      cochee: naturesCochees.has(nat),
    })),
    {
      type: 'case',
      ancre: { de: { col: 0, ligne: 8 }, a: { col: 1, ligne: 9 } },
      lien: abs(CELLULES.etiquettes),
      texte: 'Afficher les étiquettes (tous les 1 km)',
      cochee: true,
    },
  ];

  const brut = await wb.xlsx.writeBuffer();
  return injecter(Buffer.from(brut as ArrayBuffer), {
    feuille: F_RAYON,
    graphique: {
      titre: R(abs(CELLULES.titreGraphique)),
      series,
      xMin: 0, xMax: 10, xPas: 1,
      formatX: '0" km"',
      formatY: '[>=1000000]0,," M";[>=1000]0," k";0',
    },
    ancreGraphique: { de: { col: 3, ligne: 3 }, a: { col: 16, ligne: 34 } },
    controles,
  });
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
  ligne('Produit par', 'MAGELIAN — onglet Rayon du module « Population à risque industriel ».');
}
