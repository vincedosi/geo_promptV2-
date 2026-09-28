/**
 * L'export Excel interactif de l'onglet Rayon.
 *
 * Le classeur a été vérifié dans le VRAI Excel (automatisation COM, le
 * 2026-09-28) : 13 588 157 habitants à 5 km du seuil haut, identique à
 * `lire_couverture_rayon`. Ces tests verrouillent ce qui a rendu ce résultat
 * possible, et que rien d'autre ne signalerait s'il cassait :
 * - le joker `*` de la base, qui ferait tout additionner dans `SOMME.SI.ENS` ;
 * - la convention de cumul de sql/199 ;
 * - l'ordre des balises dans la feuille, sans lequel Excel « répare » le fichier ;
 * - le cache `numCache`, sans lequel Excel ignore les exclusions de légende.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import JSZip from 'jszip';
import {
  preparerDonnees, cleGraviteInitiale, palierDuRayon,
  GRAVITE_TOUTES, NATURE_TOUTES, N_PALIERS, type ReponseExportRayon,
} from '@/lib/risques/export-rayon/donnees';
import {
  graphiqueXml, insererBalisesDessin, vmlControles, completerTypes, echapperXml,
} from '@/lib/risques/export-rayon/ooxml';
import { construireClasseurRayon, lettre, abs } from '@/lib/risques/export-rayon/classeur';
import { COULEURS_NATURES, COULEUR_TOTALE } from '@/lib/risques/export-rayon/couleurs';

/** Deux départements, deux natures, les trois gravités — le plus petit jeu qui exerce tout. */
const brut: ReponseExportRayon = {
  calculable: true,
  cible: 'ind',
  lignes: [
    { d: '13', g: '*', n: '*', inc: { 0: 10, 1: 5, 99: 1 } },
    { d: '13', g: '*', n: 'Explosibles', inc: { 0: 4 } },
    { d: '13', g: '*', n: 'Toxicité aiguë', inc: { 0: 8, 2: 2 } },
    { d: '13', g: 'seveso_haut', n: '*', inc: { 0: 6 } },
    { d: '13', g: 'seveso_bas', n: '*', inc: { 1: 3 } },
    { d: '75', g: '*', n: '*', inc: { 5: 100 } },
  ],
  departements: [
    { code: '13', nom: 'Bouches-du-Rhône', region: '93', pop: 2_000_000 },
    { code: '75', nom: 'Paris', region: '11', pop: 2_100_000 },
  ],
  regions: [
    { code: '11', nom: 'Île-de-France', pop: 12_000_000 },
    { code: '93', nom: 'Provence-Alpes-Côte d’Azur', pop: 4_900_000 },
  ],
  calcule_le: '2026-09-22T08:03:16Z',
};

describe('preparerDonnees', () => {
  const d = preparerDonnees(brut);

  it('cumule les incréments — le cumul i est la population à moins de (i+1)×100 m', () => {
    const l = d.lignes.find((x) => x.departement === '13' && x.nature === NATURE_TOUTES && x.gravite === GRAVITE_TOUTES)!;
    expect(l.cumuls).toHaveLength(N_PALIERS);
    expect(l.cumuls[0]).toBe(10);
    expect(l.cumuls[1]).toBe(15);
    expect(l.cumuls[98]).toBe(15);
    expect(l.cumuls[99]).toBe(16);
  });

  it('réécrit les deux jokers « * » de la base — un critère "*" retiendrait TOUTES les lignes', () => {
    expect(d.lignes.some((l) => l.gravite === '*' || l.nature === '*')).toBe(false);
    expect(GRAVITE_TOUTES).not.toMatch(/[*?~]/);
    expect(NATURE_TOUTES).not.toMatch(/[*?~]/);
  });

  it('rattache chaque ligne à la région de son département', () => {
    expect(d.lignes.find((l) => l.departement === '75')!.region).toBe('11');
  });

  it('ordonne les natures de la plus peuplée à 10 km à la moins peuplée', () => {
    expect(d.natures).toEqual(['Toxicité aiguë', 'Explosibles']);
  });
});

describe('valeurs initiales', () => {
  it('traduit les gravités cochées comme sql/199 : aucune ou les deux → les deux seuils', () => {
    expect(cleGraviteInitiale([])).toBe(GRAVITE_TOUTES);
    expect(cleGraviteInitiale(['seveso_haut', 'seveso_bas'])).toBe(GRAVITE_TOUTES);
    expect(cleGraviteInitiale(['seveso_haut'])).toBe('seveso_haut');
    expect(cleGraviteInitiale(['seveso_bas'])).toBe('seveso_bas');
  });

  it('borne le palier de la réglette entre 1 et 100', () => {
    expect(palierDuRayon(5000)).toBe(50);
    expect(palierDuRayon(0)).toBe(1);
    expect(palierDuRayon(50_000)).toBe(100);
    expect(palierDuRayon(Number.NaN)).toBe(10);
  });
});

describe('couleurs', () => {
  /*
   * Un classeur ne lit pas `var(--nature-1)` : les teintes sont recopiées en
   * hexadécimal. Ce test garde la copie égale au thème CLAIR de globals.css.
   */
  it('reprennent le thème clair de globals.css, à la teinte près', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    const clair = css.slice(css.indexOf('html.light'));
    const val = (jeton: string) => clair.match(new RegExp(`${jeton}:\\s*#([0-9a-fA-F]{6})`))?.[1]?.toUpperCase();
    COULEURS_NATURES.forEach((hex, i) => expect(val(`--nature-${i + 1}`)).toBe(hex));
    expect(val('--brand-teal')).toBe(COULEUR_TOTALE);
  });
});

describe('ooxml', () => {
  it('insère <drawing> et <legacyDrawing> AVANT extLst, à la place que le schéma impose', () => {
    const f = '<worksheet xmlns:r="x"><sheetData/><pageMargins/><extLst/></worksheet>';
    const r = insererBalisesDessin(f, 'rA', 'rB');
    expect(r).toBe('<worksheet xmlns:r="x"><sheetData/><pageMargins/>'
      + '<drawing r:id="rA"/><legacyDrawing r:id="rB"/><extLst/></worksheet>');
  });

  it('déclare le préfixe r: s’il manque', () => {
    expect(insererBalisesDessin('<worksheet><sheetData/></worksheet>', 'a', 'b'))
      .toMatch(/^<worksheet xmlns:r="http/);
  });

  it('refuse une feuille qui porte déjà un dessin plutôt que de l’écraser', () => {
    expect(() => insererBalisesDessin('<worksheet><drawing r:id="x"/></worksheet>', 'a', 'b')).toThrow();
  });

  it('écrit le cache numCache/ptCount — sans lui Excel ignore les exclusions de légende', () => {
    const x = graphiqueXml({
      titre: 'R!$A$2', xMin: 0, xMax: 10, xPas: 1, formatX: '0', formatY: '0',
      series: [
        { nom: 'C!$B$1', libelle: 'Total', x: 'C!$A$2:$A$101', y: 'C!$B$2:$B$101', nPoints: 100, couleur: '4ECDC4', epaisseurPt: 2 },
        { nom: 'C!$Z$1', libelle: 'Repère', x: 'C!$Y$2:$Y$3', y: 'C!$Z$2:$Z$3', nPoints: 2, couleur: '4ECDC4', epaisseurPt: 1, horsLegende: true },
      ],
    });
    expect(x).toContain('<c:ptCount val="100"/>');
    expect(x).toContain('<c:legendEntry><c:idx val="1"/><c:delete val="1"/></c:legendEntry>');
    expect(x).toContain('<c:v>Total</c:v>');
  });

  it('écrit une barre de défilement liée à sa cellule, et des cases cochées ou non', () => {
    const v = vmlControles([
      { type: 'defilement', ancre: { de: { col: 0, ligne: 7 }, a: { col: 2, ligne: 8 } }, lien: '$Z$7', valeur: 50, min: 1, max: 100, pas: 1, page: 10 },
      { type: 'case', ancre: { de: { col: 0, ligne: 19 }, a: { col: 1, ligne: 20 } }, lien: '$Z$20', texte: 'A & B', cochee: true },
      { type: 'case', ancre: { de: { col: 0, ligne: 20 }, a: { col: 1, ligne: 21 } }, lien: '$Z$21', texte: 'C', cochee: false },
    ]);
    expect(v).toContain('ObjectType="Scroll"');
    expect(v).toContain('<x:FmlaLink>$Z$7</x:FmlaLink>');
    expect(v).toContain('<x:Max>100</x:Max>');
    expect(v.match(/ObjectType="Checkbox"/g)).toHaveLength(2);
    expect(v.match(/<x:Checked>1<\/x:Checked>/g)).toHaveLength(1);
    expect(v).toContain('A &amp; B');
  });

  it('ajoute les types de contenu une seule fois', () => {
    const t = completerTypes(completerTypes('<Types></Types>'));
    expect(t.match(/Extension="vml"/g)).toHaveLength(1);
    expect(t.match(/chart1\.xml/g)).toHaveLength(1);
  });

  it('échappe le XML', () => {
    expect(echapperXml(`a<b>&"'`)).toBe('a&lt;b&gt;&amp;&quot;&apos;');
  });
});

describe('adresses', () => {
  it('lettre et abs', () => {
    expect([lettre(1), lettre(26), lettre(27), lettre(105)]).toEqual(['A', 'Z', 'AA', 'DA']);
    expect(abs('AB6')).toBe('$AB$6');
  });
});

describe('construireClasseurRayon', () => {
  it('produit un classeur complet : graphique, contrôles, relations et types', async () => {
    const buf = await construireClasseurRayon(
      preparerDonnees(brut),
      { gravites: ['seveso_haut'], natures: [], perim: { niveau: 'departement', code: '13' }, rayonM: 5000 },
      new Date('2026-09-28T10:00:00Z'),
    );
    const zip = await JSZip.loadAsync(buf);
    for (const partie of ['xl/charts/chart1.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/vmlDrawing1.vml',
      'xl/drawings/_rels/drawing1.xml.rels']) {
      expect(zip.file(partie), partie).not.toBeNull();
    }
    const types = await zip.file('[Content_Types].xml')!.async('string');
    expect(types).toContain('/xl/charts/chart1.xml');

    const feuille = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(feuille).toMatch(/<drawing r:id="rIdMagDessin"\/><legacyDrawing r:id="rIdMagVml"\/>/);
    const rels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string');
    expect(rels).toContain('../drawings/vmlDrawing1.vml');

    // Deux natures + la barre + la case des étiquettes.
    const vml = await zip.file('xl/drawings/vmlDrawing1.vml')!.async('string');
    expect(vml.match(/ObjectType="Checkbox"/g)).toHaveLength(3);
    expect(vml).toContain('<x:Val>50</x:Val>');

    // Aucune formule ne passe un joker « * » en critère.
    for (const nom of Object.keys(zip.files).filter((f) => f.startsWith('xl/worksheets/sheet'))) {
      const xml = await zip.file(nom)!.async('string');
      expect(xml, nom).not.toMatch(/,&quot;\*&quot;[,)]/);
      expect(xml, nom).not.toMatch(/,"\*"[,)]/);
    }
  });
});
