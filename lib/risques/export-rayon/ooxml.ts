/**
 * Ce qu'exceljs ne sait pas écrire, écrit à la main : un GRAPHIQUE Excel natif,
 * une BARRE DE DÉFILEMENT et des CASES À COCHER (contrôles de formulaire).
 *
 * ── POURQUOI PAS UNE BIBLIOTHÈQUE ─────────────────────────────────────────
 *
 * exceljs (déjà au projet) écrit cellules, formules, validations et mises en
 * forme conditionnelles, mais aucun graphique ni aucun contrôle. Les seules
 * bibliothèques JavaScript qui écrivent des graphiques réécrivent tout le
 * classeur autrement ; en ajouter une pour trois fichiers XML serait payer une
 * dépendance entière pour ce qui tient ici en fonctions pures, testées.
 *
 * ── LA MÉCANIQUE ──────────────────────────────────────────────────────────
 *
 * Un .xlsx est un zip. On laisse exceljs produire le classeur, puis on y
 * AJOUTE : le graphique (`xl/charts/`), le dessin qui le place
 * (`xl/drawings/`), le VML qui porte les contrôles de formulaire, leurs
 * relations, et leurs types de contenu. La feuille reçoit deux balises,
 * `<drawing>` et `<legacyDrawing>`, à la place que le schéma leur impose.
 *
 * ⚠ Les contrôles sont écrits en VML seul, la forme d'Excel 2007, qu'Excel
 * relit toujours. La forme 2010 (`<controls>` + `ctrlProps`) n'ajoute rien à
 * une barre et à des cases liées à une cellule.
 */
import JSZip from 'jszip';

/** Échappe une chaîne pour un nœud texte ou un attribut XML. */
export function echapperXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Le graphique ──────────────────────────────────────────────────────────

export interface SerieGraphique {
  /** Référence de la cellule qui porte le nom de la série (`Feuille!$B$1`). */
  nom: string;
  /**
   * Le texte de cette cellule, écrit en cache.
   *
   * ⚠ Pas décoratif : sans cache de nom, Excel bâtit la légende AVANT de lire
   * les exclusions (`legendEntry/delete`) et les ignore — mesuré, 16 entrées
   * au lieu de 14, les séries techniques « Étiquettes » et « Rayon choisi »
   * restant affichées.
   */
  libelle: string;
  /** Plage des abscisses. */
  x: string;
  /**
   * Nombre de points de la série, écrit en cache (`numCache/ptCount`).
   *
   * ⚠ C'est lui, et non le cache de nom, qui fait respecter les exclusions de
   * légende : isolé par élimination sur un fichier ré-enregistré par Excel —
   * sans `numCache`, 16 entrées ; avec un `numCache` réduit à son seul
   * `ptCount`, 14. Les VALEURS n'ont pas à y être : Excel les recalcule.
   */
  nPoints: number;
  /** Plage des ordonnées. */
  y: string;
  /** Couleur, en hexadécimal SANS dièse. */
  couleur: string;
  epaisseurPt: number;
  /** Trait pointillé — sert à distinguer deux natures qui partagent une teinte. */
  pointille?: boolean;
  /** Pas de trait : la série ne porte que ses étiquettes. */
  sansTrait?: boolean;
  /** Étiquettes de valeur sur chaque point, au format donné. */
  etiquettes?: { formatCode: string };
  /** Retirée de la légende (série technique : repère, étiquettes). */
  horsLegende?: boolean;
}

export interface OptionsGraphique {
  /** Cellule dont le texte sert de titre — il suit donc les choix du classeur. */
  titre: string;
  series: SerieGraphique[];
  /** Bornes et pas de l'axe des abscisses. */
  xMin: number;
  xMax: number;
  xPas: number;
  formatX: string;
  formatY: string;
}

const EMU_PAR_PT = 12_700;

function texteProps(taillePt: number, couleur = '595959', gras = false): string {
  return `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${Math.round(taillePt * 100)}" b="${gras ? 1 : 0}">`
    + `<a:solidFill><a:srgbClr val="${couleur}"/></a:solidFill></a:defRPr></a:pPr>`
    + '<a:endParaRPr lang="fr-FR"/></a:p></c:txPr>';
}

function trait(couleur: string | null, epaisseurPt: number, pointille = false): string {
  if (couleur === null) return '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>';
  return `<c:spPr><a:ln w="${Math.round(epaisseurPt * EMU_PAR_PT)}" cap="rnd">`
    + `<a:solidFill><a:srgbClr val="${couleur}"/></a:solidFill>`
    + (pointille ? '<a:prstDash val="dash"/>' : '')
    + '<a:round/></a:ln></c:spPr>';
}

const cacheVide = (n: number) =>
  `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/></c:numCache>`;

function serieXml(s: SerieGraphique, i: number): string {
  // L'ordre des éléments est celui du schéma CT_ScatterSer : idx, order, tx,
  // spPr, marker, dPt*, dLbls, trendline, errBars, xVal, yVal, smooth.
  const etiquettes = s.etiquettes
    ? '<c:dLbls>'
      + `<c:numFmt formatCode="${echapperXml(s.etiquettes.formatCode)}" sourceLinked="0"/>`
      + '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'
      + texteProps(8, '262626', true)
      + '<c:dLblPos val="t"/><c:showLegendKey val="0"/><c:showVal val="1"/>'
      + '<c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/>'
      + '<c:showBubbleSize val="0"/></c:dLbls>'
    : '';
  return '<c:ser>'
    + `<c:idx val="${i}"/><c:order val="${i}"/>`
    + `<c:tx><c:strRef><c:f>${echapperXml(s.nom)}</c:f>`
    + `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${echapperXml(s.libelle)}</c:v></c:pt></c:strCache>`
    + '</c:strRef></c:tx>'
    + trait(s.sansTrait ? null : s.couleur, s.epaisseurPt, s.pointille)
    + '<c:marker><c:symbol val="none"/></c:marker>'
    + etiquettes
    + `<c:xVal><c:numRef><c:f>${echapperXml(s.x)}</c:f>${cacheVide(s.nPoints)}</c:numRef></c:xVal>`
    + `<c:yVal><c:numRef><c:f>${echapperXml(s.y)}</c:f>${cacheVide(s.nPoints)}</c:numRef></c:yVal>`
    + '<c:smooth val="0"/>'
    + '</c:ser>';
}

function axeXml(o: {
  id: number; croise: number; position: 'b' | 'l'; format: string;
  min?: number; max?: number; pas?: number; grille: boolean;
}): string {
  // Ordre CT_ValAx : axId, scaling, delete, axPos, majorGridlines, numFmt,
  // majorTickMark, minorTickMark, tickLblPos, spPr, txPr, crossAx, crosses,
  // crossBetween, majorUnit.
  return '<c:valAx>'
    + `<c:axId val="${o.id}"/>`
    + '<c:scaling><c:orientation val="minMax"/>'
    + (o.max !== undefined ? `<c:max val="${o.max}"/>` : '')
    + (o.min !== undefined ? `<c:min val="${o.min}"/>` : '')
    + '</c:scaling>'
    + '<c:delete val="0"/>'
    + `<c:axPos val="${o.position}"/>`
    + (o.grille
      ? '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E5E5E5"/></a:solidFill>'
        + '<a:prstDash val="sysDash"/></a:ln></c:spPr></c:majorGridlines>'
      : '')
    + `<c:numFmt formatCode="${echapperXml(o.format)}" sourceLinked="0"/>`
    + '<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
    + '<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>'
    + texteProps(9)
    + `<c:crossAx val="${o.croise}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/>`
    + (o.pas !== undefined ? `<c:majorUnit val="${o.pas}"/>` : '')
    + '</c:valAx>';
}

/**
 * Le graphique en nuage de points reliés — et non en courbes : seul le nuage
 * porte un axe des abscisses NUMÉRIQUE, donc un repère vertical placé au rayon
 * exact de la réglette, et des étiquettes aux seuls kilomètres ronds.
 */
export function graphiqueXml(o: OptionsGraphique): string {
  const legende = o.series
    .map((s, i) => (s.horsLegende ? `<c:legendEntry><c:idx val="${i}"/><c:delete val="1"/></c:legendEntry>` : ''))
    .join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<c:roundedCorners val="0"/>'
    + '<c:chart>'
    + `<c:title><c:tx><c:strRef><c:f>${echapperXml(o.titre)}</c:f></c:strRef></c:tx>`
    + `<c:overlay val="0"/>${texteProps(11, '262626', true)}</c:title>`
    + '<c:autoTitleDeleted val="0"/>'
    + '<c:plotArea><c:layout/>'
    + '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>'
    + o.series.map(serieXml).join('')
    + '<c:axId val="500"/><c:axId val="501"/></c:scatterChart>'
    + axeXml({ id: 500, croise: 501, position: 'b', format: o.formatX, min: o.xMin, max: o.xMax, pas: o.xPas, grille: false })
    + axeXml({ id: 501, croise: 500, position: 'l', format: o.formatY, min: 0, grille: true })
    + '</c:plotArea>'
    + `<c:legend><c:legendPos val="b"/>${legende}<c:overlay val="0"/>${texteProps(9)}</c:legend>`
    + '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>'
    + '</c:chart>'
    + '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>'
    + '</c:chartSpace>';
}

// ── Le dessin qui place le graphique ──────────────────────────────────────

/** Une ancre de cellule, 0-indexée (colonne A = 0, ligne 1 = 0). */
interface Ancre { col: number; ligne: number }

function dessinXml(de: Ancre, a: Ancre): string {
  const point = (tag: string, p: Ancre) => `<xdr:${tag}><xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff>`
    + `<xdr:row>${p.ligne}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    + '<xdr:twoCellAnchor editAs="oneCell">'
    + point('from', de) + point('to', a)
    + '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Courbe de couverture"/>'
    + '<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
    + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
    + '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>'
    + '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/>'
    + '</xdr:twoCellAnchor></xdr:wsDr>';
}

// ── Les contrôles de formulaire ───────────────────────────────────────────

/** Une ancre VML : cellule de départ et d'arrivée, décalages en PIXELS. */
interface AncreControle {
  de: Ancre & { dx?: number; dy?: number };
  a: Ancre & { dx?: number; dy?: number };
}

export type Controle =
  | {
    type: 'defilement'; ancre: AncreControle; lien: string;
    valeur: number; min: number; max: number; pas: number; page: number;
  }
  | { type: 'case'; ancre: AncreControle; lien: string; texte: string; cochee: boolean };

function ancreVml(a: AncreControle): string {
  return `<x:Anchor>${a.de.col}, ${a.de.dx ?? 0}, ${a.de.ligne}, ${a.de.dy ?? 0}, `
    + `${a.a.col}, ${a.a.dx ?? 0}, ${a.a.ligne}, ${a.a.dy ?? 0}</x:Anchor>`;
}

/**
 * Le VML des contrôles. `premierId` fixe les identifiants de forme : Excel les
 * veut uniques dans le classeur, par blocs de 1 024 par dessin.
 */
export function vmlControles(controles: Controle[], premierId = 1025): string {
  const formes = controles.map((c, i) => {
    const id = premierId + i;
    // Une case sans cadre ni fond : le style par défaut d'une forme VML en
    // dessine un, épais, autour de chaque case — vu à l'export PDF.
    const habillage = c.type === 'case'
      ? ' filled="f" stroked="f"'
      : ' fillcolor="buttonFace [67]" strokecolor="windowText [64]"';
    const commun = `<v:shape id="_x0000_s${id}" type="#_x0000_t201"`
      + ' style="position:absolute;z-index:' + (i + 1) + '" o:button="t"' + habillage
      + ' o:insetmode="auto">'
      + '<v:fill color2="buttonFace [67]" o:detectmouseclick="t"/>'
      + '<o:lock v:ext="edit" rotation="t"/>';
    if (c.type === 'defilement') {
      return commun
        + '<x:ClientData ObjectType="Scroll">'
        + ancreVml(c.ancre)
        + '<x:PrintObject>False</x:PrintObject><x:AutoFill>False</x:AutoFill>'
        + `<x:FmlaLink>${echapperXml(c.lien)}</x:FmlaLink>`
        + `<x:Val>${c.valeur}</x:Val><x:Min>${c.min}</x:Min><x:Max>${c.max}</x:Max>`
        + `<x:Inc>${c.pas}</x:Inc><x:Page>${c.page}</x:Page><x:Horiz/>`
        + '</x:ClientData></v:shape>';
    }
    return commun
      + '<v:textbox style="mso-direction-alt:auto" o:singleclick="f"><div style="text-align:left">'
      + `<font face="Calibri" size="200" color="auto">${echapperXml(c.texte)}</font></div></v:textbox>`
      + '<x:ClientData ObjectType="Checkbox">'
      + ancreVml(c.ancre)
      + '<x:AutoFill>False</x:AutoFill><x:AutoLine>False</x:AutoLine><x:TextVAlign>Center</x:TextVAlign>'
      + `<x:FmlaLink>${echapperXml(c.lien)}</x:FmlaLink>`
      + (c.cochee ? '<x:Checked>1</x:Checked>' : '')
      + '<x:NoThreeD/></x:ClientData></v:shape>';
  });
  return '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"'
    + ' xmlns:x="urn:schemas-microsoft-com:office:excel">'
    + `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${Math.floor(premierId / 1024)}"/></o:shapelayout>`
    + '<v:shapetype id="_x0000_t201" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe">'
    + '<v:stroke joinstyle="miter"/><v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/>'
    + '<o:lock v:ext="edit" shapetype="t"/></v:shapetype>'
    + formes.join('')
    + '</xml>';
}

// ── L'injection dans le zip ───────────────────────────────────────────────

const REL_DESSIN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const REL_VML = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing';
const REL_GRAPHIQUE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';

/**
 * Les éléments qui SUIVENT `<drawing>` dans le schéma d'une feuille
 * (CT_Worksheet). Les deux balises s'insèrent avant le premier présent : Excel
 * refuse d'ouvrir une feuille dont les enfants sont dans le désordre, et le
 * message qu'il donne (« contenu illisible ») ne dit pas lequel.
 */
const APRES_DESSIN = [
  '<legacyDrawingHF', '<drawingHF', '<picture', '<oleObjects', '<controls',
  '<webPublishItems', '<tableParts', '<extLst', '</worksheet>',
];

/** Insère `<drawing>` et `<legacyDrawing>` à leur place dans le XML d'une feuille. */
export function insererBalisesDessin(feuille: string, idDessin: string, idVml: string): string {
  if (/<drawing\b|<legacyDrawing\b/.test(feuille)) {
    throw new Error('La feuille porte déjà un dessin : l’injection écraserait celui d’exceljs.');
  }
  const positions = APRES_DESSIN
    .map((b) => feuille.indexOf(b))
    .filter((i) => i >= 0);
  const ou = Math.min(...positions);
  const balises = `<drawing r:id="${idDessin}"/><legacyDrawing r:id="${idVml}"/>`;
  let resultat = feuille.slice(0, ou) + balises + feuille.slice(ou);
  // Le préfixe `r:` doit être déclaré sur la racine ; exceljs le fait
  // d'ordinaire, mais une feuille sans relation peut ne pas le porter.
  if (!/<worksheet[^>]*xmlns:r=/.test(resultat)) {
    resultat = resultat.replace(
      '<worksheet',
      '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    );
  }
  return resultat;
}

/** Retrouve le fichier XML d'une feuille par son NOM, via le classeur et ses relations. */
async function cheminFeuille(zip: JSZip, nom: string): Promise<string> {
  const classeur = await zip.file('xl/workbook.xml')!.async('string');
  const m = classeur.match(new RegExp(`<sheet [^>]*name="${echapperXml(nom)}"[^>]*r:id="([^"]+)"`));
  if (!m) throw new Error(`Feuille « ${nom} » absente du classeur.`);
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const cible = rels.match(new RegExp(`<Relationship [^>]*Id="${m[1]}"[^>]*Target="([^"]+)"`))
    ?? rels.match(new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${m[1]}"`));
  if (!cible) throw new Error(`Relation de la feuille « ${nom} » introuvable.`);
  return 'xl/' + cible[1].replace(/^\/?xl\//, '');
}

function ajouterRelations(existantes: string | null, ajouts: Array<{ id: string; type: string; cible: string }>): string {
  const lignes = ajouts
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.cible}"/>`)
    .join('');
  if (!existantes) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + lignes + '</Relationships>';
  }
  return existantes.replace('</Relationships>', lignes + '</Relationships>');
}

/** Ajoute les types de contenu des nouvelles parties, sans doublon. */
export function completerTypes(types: string): string {
  let t = types;
  if (!/Extension="vml"/.test(t)) {
    t = t.replace('</Types>',
      '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/></Types>');
  }
  const surcharges: Array<[string, string]> = [
    ['/xl/drawings/drawing1.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml'],
    ['/xl/charts/chart1.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'],
  ];
  for (const [partie, type] of surcharges) {
    if (!t.includes(`PartName="${partie}"`)) {
      t = t.replace('</Types>', `<Override PartName="${partie}" ContentType="${type}"/></Types>`);
    }
  }
  return t;
}

export interface Injection {
  /** Nom de la feuille qui reçoit le graphique et les contrôles. */
  feuille: string;
  graphique: OptionsGraphique;
  ancreGraphique: { de: Ancre; a: Ancre };
  controles: Controle[];
}

/**
 * Ajoute graphique et contrôles à un classeur produit par exceljs.
 *
 * @param classeur - Le .xlsx d'exceljs.
 * @param i - Ce qu'il faut ajouter, et où.
 * @returns Le .xlsx complété.
 * @throws Si la feuille est absente ou porte déjà un dessin.
 */
export async function injecter(classeur: Buffer | ArrayBuffer, i: Injection): Promise<Buffer> {
  const zip = await JSZip.loadAsync(classeur);
  if (zip.file('xl/drawings/drawing1.xml') || zip.file('xl/charts/chart1.xml')) {
    throw new Error('Le classeur porte déjà un dessin : les noms de parties entreraient en collision.');
  }

  const cheminXml = await cheminFeuille(zip, i.feuille);
  const dossier = cheminXml.slice(0, cheminXml.lastIndexOf('/'));
  const fichier = cheminXml.slice(cheminXml.lastIndexOf('/') + 1);
  const cheminRels = `${dossier}/_rels/${fichier}.rels`;

  const idDessin = 'rIdMagDessin';
  const idVml = 'rIdMagVml';

  zip.file(cheminXml, insererBalisesDessin(await zip.file(cheminXml)!.async('string'), idDessin, idVml));
  zip.file(cheminRels, ajouterRelations(
    zip.file(cheminRels) ? await zip.file(cheminRels)!.async('string') : null,
    [
      { id: idDessin, type: REL_DESSIN, cible: '../drawings/drawing1.xml' },
      { id: idVml, type: REL_VML, cible: '../drawings/vmlDrawing1.vml' },
    ],
  ));

  zip.file('xl/drawings/drawing1.xml', dessinXml(i.ancreGraphique.de, i.ancreGraphique.a));
  zip.file('xl/drawings/_rels/drawing1.xml.rels',
    ajouterRelations(null, [{ id: 'rId1', type: REL_GRAPHIQUE, cible: '../charts/chart1.xml' }]));
  zip.file('xl/charts/chart1.xml', graphiqueXml(i.graphique));
  zip.file('xl/drawings/vmlDrawing1.vml', vmlControles(i.controles));

  zip.file('[Content_Types].xml', completerTypes(await zip.file('[Content_Types].xml')!.async('string')));

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
