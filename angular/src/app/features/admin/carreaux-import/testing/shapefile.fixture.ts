/**
 * Fabrique d'un bundle Shapefile JETABLE (lot 6, T14) : les octets d'un `.shp`, `.shx` et `.dbf` de polygones
 * (type 5), plus le `.prj` Lambert 93. Utilisée par les specs Angular et par le test racine
 * `tests/unit/angular/admin-shapefile-fixture.test.ts`, qui vérifie que les fichiers versionnés
 * `tests/fixtures/admin/carreaux-essai.{shp,shx,dbf,prj}` (ceux qu'on dépose au navigateur) en sont la sortie
 * EXACTE. Le code de l'application ne l'importe jamais.
 *
 * Formats (spécification ESRI et dBASE III) :
 * - `.shp` / `.shx` : en-tête de 100 octets (code 9994 et longueur en mots de 16 bits en gros-boutiste, version
 *   1000, type de forme et emprise en petit-boutiste) ; un enregistrement `.shp` = numéro + longueur du contenu
 *   (gros-boutiste) puis type 5, emprise, nombre de parties, de points, indices des parties, points ;
 *   un enregistrement `.shx` = décalage + longueur (en mots).
 * - `.dbf` : en-tête de 32 octets (version 3, date FIXE pour des octets stables, nombre d'enregistrements,
 *   tailles d'en-tête et d'enregistrement), descripteurs de 32 octets, 0x0D, enregistrements (drapeau espace
 *   puis champs à largeur fixe : texte calé à gauche, nombres à droite), 0x1A.
 */

export interface ChampDbf {
  nom: string;
  type: 'C' | 'N';
  longueur: number;
  decimales?: number;
}

export interface AttributsDbf {
  champs: readonly ChampDbf[];
  lignes: readonly Record<string, string | number | null>[];
}

export interface OctetsShapefile {
  shp: Uint8Array;
  shx: Uint8Array;
  dbf: Uint8Array;
}

/** Projection Lambert 93 telle que l'écrit un SIG (WKT ESRI) : `detectCRS` y lit EPSG:2154. */
export const PRJ_LAMBERT_93 =
  'PROJCS["RGF93_Lambert_93",GEOGCS["GCS_RGF_1993",DATUM["D_RGF_1993",SPHEROID["GRS_1980",6378137.0,298.257222101]],'
  + 'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],'
  + 'PARAMETER["False_Easting",700000.0],PARAMETER["False_Northing",6600000.0],PARAMETER["Central_Meridian",3.0],'
  + 'PARAMETER["Standard_Parallel_1",49.0],PARAMETER["Standard_Parallel_2",44.0],PARAMETER["Latitude_Of_Origin",46.5],'
  + 'UNIT["Meter",1.0]]';

function emprise(points: readonly number[][]): [number, number, number, number] {
  let [xmin, ymin, xmax, ymax] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    xmin = Math.min(xmin, x); ymin = Math.min(ymin, y); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y);
  }
  return [xmin, ymin, xmax, ymax];
}

function enTete(vue: DataView, longueurOctets: number, boite: readonly number[]): void {
  vue.setInt32(0, 9994, false);
  vue.setInt32(24, longueurOctets / 2, false);
  vue.setInt32(28, 1000, true);
  vue.setInt32(32, 5, true);
  boite.forEach((v, i) => vue.setFloat64(36 + i * 8, v, true));
}

/**
 * Les octets d'un Shapefile de polygones : `polygones[i]` = anneaux `[anneau][point][x, y]` de l'entité `i`,
 * `attributs.lignes[i]` ses valeurs.
 */
export function fabriquerShapefile(polygones: readonly number[][][][], attributs: AttributsDbf): OctetsShapefile {
  const contenus = polygones.map((anneaux) => {
    const points = anneaux.flat();
    return { anneaux, points, octets: 44 + 4 * anneaux.length + 16 * points.length };
  });
  const tailleShp = 100 + contenus.reduce((s, c) => s + 8 + c.octets, 0);
  const tailleShx = 100 + 8 * contenus.length;
  const boite = emprise(contenus.flatMap((c) => c.points));

  const shp = new Uint8Array(tailleShp);
  const shx = new Uint8Array(tailleShx);
  const vShp = new DataView(shp.buffer);
  const vShx = new DataView(shx.buffer);
  enTete(vShp, tailleShp, boite);
  enTete(vShx, tailleShx, boite);

  let o = 100;
  contenus.forEach((c, i) => {
    vShx.setInt32(100 + i * 8, o / 2, false);
    vShx.setInt32(104 + i * 8, c.octets / 2, false);
    vShp.setInt32(o, i + 1, false);
    vShp.setInt32(o + 4, c.octets / 2, false);
    const d = o + 8;
    vShp.setInt32(d, 5, true);
    emprise(c.points).forEach((v, k) => vShp.setFloat64(d + 4 + k * 8, v, true));
    vShp.setInt32(d + 36, c.anneaux.length, true);
    vShp.setInt32(d + 40, c.points.length, true);
    let debut = 0;
    c.anneaux.forEach((anneau, p) => {
      vShp.setInt32(d + 44 + p * 4, debut, true);
      debut += anneau.length;
    });
    const dp = d + 44 + c.anneaux.length * 4;
    c.points.forEach(([x, y], k) => {
      vShp.setFloat64(dp + k * 16, x, true);
      vShp.setFloat64(dp + k * 16 + 8, y, true);
    });
    o = d + c.octets;
  });

  return { shp, shx, dbf: fabriquerDbf(attributs) };
}

function fabriquerDbf({ champs, lignes }: AttributsDbf): Uint8Array {
  const tailleEnTete = 32 + 32 * champs.length + 1;
  const tailleEnregistrement = 1 + champs.reduce((s, c) => s + c.longueur, 0);
  const dbf = new Uint8Array(tailleEnTete + tailleEnregistrement * lignes.length + 1);
  const vue = new DataView(dbf.buffer);
  dbf[0] = 0x03;
  dbf[1] = 126; dbf[2] = 10; dbf[3] = 17; // 2026-10-17, fixe
  vue.setUint32(4, lignes.length, true);
  vue.setUint16(8, tailleEnTete, true);
  vue.setUint16(10, tailleEnregistrement, true);
  champs.forEach((c, i) => {
    const d = 32 + i * 32;
    for (let k = 0; k < c.nom.length && k < 11; k++) dbf[d + k] = c.nom.charCodeAt(k);
    dbf[d + 11] = c.type.charCodeAt(0);
    dbf[d + 16] = c.longueur;
    dbf[d + 17] = c.decimales ?? 0;
  });
  dbf[tailleEnTete - 1] = 0x0d;
  lignes.forEach((ligne, i) => {
    let d = tailleEnTete + i * tailleEnregistrement;
    dbf[d++] = 0x20;
    for (const c of champs) {
      const v = ligne[c.nom];
      const brut = v === null || v === undefined ? '' : typeof v === 'number' ? v.toFixed(c.decimales ?? 0) : v;
      const texte = (c.type === 'N' ? brut.padStart(c.longueur) : brut.padEnd(c.longueur)).slice(0, c.longueur);
      for (let k = 0; k < c.longueur; k++) dbf[d + k] = texte.charCodeAt(k);
      d += c.longueur;
    }
  });
  dbf[dbf.length - 1] = 0x1a;
  return dbf;
}

/** Les champs du jeu d'essai : un identifiant reconnu par `detectIdColumn`, deux nombres, un texte. */
export const CHAMPS_ESSAI: readonly ChampDbf[] = [
  { nom: 'idcar_200m', type: 'C', longueur: 20 },
  { nom: 'ind', type: 'N', longueur: 10, decimales: 1 },
  { nom: 'men', type: 'N', longueur: 10 },
  { nom: 'lcog_geo', type: 'C', longueur: 10 },
];

/**
 * `n` carreaux de 200 m en Lambert 93 (Paris, à partir de x = 652 000, y = 6 862 000), dix par rangée ; anneau
 * fermé, sens horaire (anneau extérieur ESRI). Identifiants `ESSAI_LOT6_0001`… : aucun ne peut se confondre
 * avec un carreau INSEE.
 */
export function carreauxEssai(n: number): { polygones: number[][][][]; attributs: AttributsDbf } {
  const polygones: number[][][][] = [];
  const lignes: Record<string, string | number | null>[] = [];
  for (let i = 0; i < n; i++) {
    const x = 652000 + (i % 10) * 200;
    const y = 6862000 + Math.floor(i / 10) * 200;
    polygones.push([[[x, y], [x, y + 200], [x + 200, y + 200], [x + 200, y], [x, y]]]);
    lignes.push({
      idcar_200m: `ESSAI_LOT6_${String(i + 1).padStart(4, '0')}`,
      ind: 10 + (i % 7) * 2.5,
      men: 4 + (i % 5),
      lcog_geo: '75056',
    });
  }
  return { polygones, attributs: { champs: CHAMPS_ESSAI, lignes } };
}

/** Le bundle jetable de 50 carreaux (`carreaux-essai.*`). */
export function bundleEssai(n = 50): OctetsShapefile & { prj: string } {
  const { polygones, attributs } = carreauxEssai(n);
  return { ...fabriquerShapefile(polygones, attributs), prj: PRJ_LAMBERT_93 };
}

/** Les quatre fichiers du bundle, nommés `<base>.{shp,shx,dbf,prj}`, comme un dépôt multiple les donne. */
export function fichiersEssai(n = 50, base = 'carreaux-essai'): File[] {
  const b = bundleEssai(n);
  return [
    new File([b.shp as BlobPart], `${base}.shp`),
    new File([b.shx as BlobPart], `${base}.shx`),
    new File([b.dbf as BlobPart], `${base}.dbf`),
    new File([b.prj], `${base}.prj`),
  ];
}
