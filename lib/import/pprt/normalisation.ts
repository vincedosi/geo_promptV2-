/**
 * Normalisation des périmètres PPRT servis par la Géoplateforme IGN.
 *
 * Source : WFS `wfs_sup:assiette_sup_s` sur `data.geopf.fr`, filtre
 * `suptype='pm3'`. La catégorie **PM3** des servitudes d'utilité publique EST
 * le plan de prévention des risques technologiques ; la couche est alimentée
 * par le Géoportail de l'Urbanisme, où chaque DDT dépose ses documents.
 *
 * Pourquoi cette source et pas le WFS Géorisques dont le nom promet les PPRT :
 * mesuré le 2026-09-17, `ms:PPRT_PERIMETRE_RISQIND` porte ~147 000 lignes et
 * **tous les PPR confondus** (la ligne à `STARTINDEX=100000` est un PPR
 * mouvement de terrain), son `CQL_FILTER` est ignoré en silence et son
 * `numberMatched` vaut toujours 500. Comparaison chiffrée dans
 * `ARCHITECTURE.md` § « Périmètres PPRT ».
 *
 * ── CE FICHIER EXISTE PARCE QUE LA SOURCE EST SALE ────────────────────────
 *
 * Trois défauts mesurés sur les 664 lignes, qu'aucun code appelant ne doit
 * avoir à redécouvrir :
 *
 *  1. **`idass` n'identifie rien.** 660 valeurs distinctes pour 664 lignes.
 *     `2147483647` — INT32_MAX, donc un débordement chez l'éditeur — sert
 *     d'identifiant à QUATRE PPRT sans rapport (Pointe Jarry en Guadeloupe,
 *     Azelis, Butagaz et Aperam en Saône-et-Loire), et `PM3-130009400-0241-1-1`
 *     est partagé par TITANOBEL et PSV dans l'Yonne. S'en servir comme clé
 *     d'unicité perdrait quatre zones en silence. D'où `refZonePprt()`.
 *  2. **`typeass` arrive en six orthographes pour deux familles réelles**,
 *     dont une en mojibake (`Pï¿½rimï¿½tre rï¿½glementï¿½ du PPR`, l'UTF-8 de
 *     l'éditeur relu en latin-1) et une ligne où la valeur est `24`. D'où
 *     `normaliserTypeZone()`, qui travaille sur un squelette et garde la
 *     valeur brute à côté.
 *  3. **Le nom lisible manque sur 202 des 664 lignes** (`nomsuplitt` rempli
 *     462 fois). D'où `nomLisible()`, qui retombe sur `nomass`.
 *
 * Et un fait de structure : **trois nombres, aucun interchangeable**. 664
 * assiettes (une par polygone), 609 générateurs (`idgen` à la source :
 * l'établissement à l'origine du risque — les 7 lignes d'AXEREAL dans le Cher
 * tiennent toutes dans 600 m et partagent le leur), et 415 procédures PPRT
 * selon `gaspar/pprt`. Plusieurs générateurs relèvent d'une même procédure, et
 * ce flux ne porte aucune clé de jointure vers GASPAR : annoncer 664 ou 609
 * « PPRT » serait faux.
 */
import { createHash } from 'node:crypto';
import { identitePoiSourceExterne } from '@/lib/import/identite-poi';

/** Nom de source, présent dans la clé d'identité et dans chaque ligne écrite. */
export const SOURCE_PPRT = 'geoplateforme_pm3';

/** Les deux familles réelles de `typeass`, plus l'aveu d'ignorance. */
export type TypeZonePprt = 'enveloppe' | 'perimetre_reglemente' | 'indetermine';

/**
 * Réduit un libellé à ses seules lettres ASCII minuscules.
 *
 * Les accents sont dépliés par NFD avant d'être retirés, ce qui fait tomber
 * « réglementaires », « reglementaires » et « règlementaires » sur le même
 * squelette. Les caractères de remplacement du mojibake (U+FFFD) ne sont pas
 * des lettres ASCII : ils disparaissent, ce qui donne un squelette stable mais
 * DIFFÉRENT du libellé propre — d'où son entrée explicite dans la table.
 */
function squelette(valeur: string | null | undefined): string {
  return (valeur ?? '')
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Table FERMÉE des squelettes reconnus.
 *
 * Fermée à dessein : un libellé inconnu devient `indetermine` et conserve sa
 * valeur brute, plutôt que d'être rangé de force dans la famille la plus
 * proche. Mal étiqueter une zone réglementaire est pire que l'avouer.
 */
const TYPES_CONNUS: Record<string, TypeZonePprt> = {
  // « Enveloppe des zonages réglementaires » et ses variantes d'accent (639 lignes)
  enveloppedeszonagesreglementaires: 'enveloppe',
  // « Périmètre réglementé du PPR », écriture correcte (10 lignes)
  perimetrereglementeduppr: 'perimetre_reglemente',
  // Le MÊME libellé, en mojibake chez l'éditeur (8 lignes).
  //
  // Valeur brute : `Pï¿½rimï¿½tre rï¿½glementï¿½ du PPR`. Ce sont les trois
  // octets EF BF BD — l'UTF-8 du caractère de remplacement — relus en latin-1,
  // donc les points de code 239/191/189 : `ï`, `¿`, `½`. Et `ï` se déplie en
  // NFD en `i` + tréma combinant : **le `i` survit**, `¿` et `½` non. D'où ce
  // squelette, où chaque `é` perdu laisse un `i` à sa place. Mesuré, pas
  // deviné — la première version de cette ligne disait `primtrerglementduppr`
  // et n'aurait jamais filtré, rangeant ces 8 zones en `indetermine`.
  pirimitreriglementiduppr: 'perimetre_reglemente',
};

export function normaliserTypeZone(brut: string | null | undefined): TypeZonePprt {
  return TYPES_CONNUS[squelette(brut)] ?? 'indetermine';
}

/** Échelon administratif du dépôt au Géoportail de l'Urbanisme. */
export interface DepotPm3 {
  niveau: 'departement' | 'region';
  code: string;
}

/**
 * Échelon et code du DÉPÔT, lus dans `partition` — une indication de
 * provenance, **jamais le département de la zone**.
 *
 * `130010366_SUP_62_PM3` est un dépôt départemental (62), mais
 * `130006091_SUP_R76_PM3` est **régional** (R76, Occitanie) et porte 33 zones
 * réparties sur plusieurs départements. Mesuré : 60 dépôts départementaux,
 * 4 ultramarins à trois chiffres, et **5 dépôts régionaux totalisant 77 des
 * 664 zones** (R76 Occitanie, R52 Pays de la Loire, R28 Normandie, R94 Corse,
 * R02 Martinique).
 *
 * C'est le piège de cette source, et il induit en erreur dans le sens le plus
 * coûteux : un premier recensement de la couverture, fait en cherchant deux ou
 * trois chiffres dans ce champ, a conclu que la Seine-Maritime, la
 * Haute-Garonne et la Loire-Atlantique n'avaient aucune zone — alors qu'elles
 * arrivent par les dépôts R28 et R52. Le département d'une zone se déduit de
 * sa GÉOMÉTRIE (`ref_departements`, fait côté PostGIS par
 * `pprt_consolider_departement`), jamais de son nom de fichier.
 */
export function depotDePartition(partition: string | null | undefined): DepotPm3 | null {
  const m = /_SUP_(R[0-9]{2}|9[0-9]{2}|2[AB]|[0-9]{2})_/i.exec(partition ?? '');
  if (!m) return null;
  const code = m[1].toUpperCase();
  return code.startsWith('R')
    ? { niveau: 'region', code: code.slice(1) }
    : { niveau: 'departement', code };
}

/**
 * Nom affichable de la zone.
 *
 * `nomsuplitt` est le libellé de l'éditeur et gagne quand il existe — même
 * quand c'est le titre de l'arrêté (« Arrêté d'approbation du PPRT de la
 * société LOGISTINORD »), parce que c'est le seul texte que quelqu'un a
 * réellement rédigé. Il manque sur 202 lignes ; `nomass` (rempli partout) est
 * alors dégrossi : `PM3_pprt-logistinord_ass` -> `pprt-logistinord`.
 */
export function nomLisible(
  nomsuplitt: string | null | undefined,
  nomass: string | null | undefined,
): string {
  const litt = (nomsuplitt ?? '').trim();
  if (litt) return litt;

  const derive = (nomass ?? '')
    .trim()
    .replace(/^PM3[_-]*/i, '')
    .replace(/[_-]*ass$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return derive || 'PPRT sans libellé';
}

/**
 * Clé d'identité externe d'un polygone PPRT.
 *
 * Composée de la partition (le document déposé au GPU, départemental ou
 * régional), du nom technique et d'une empreinte de la GÉOMÉTRIE. Les deux
 * premiers ne suffisent pas : un PPRT à plusieurs zones répète le même couple (AXEREAL
 * dans le Cher, 7 lignes). `idass`, qui devrait les départager, est corrompu
 * (voir l'en-tête). L'empreinte géométrique, elle, est unique sur les 664
 * lignes — vérifié — et surtout STABLE : réimporter le même flux rend les
 * mêmes identifiants, donc l'import est rejouable sans doublon.
 *
 * Contrepartie assumée : une DDT qui redépose une zone au tracé RETOUCHÉ
 * produit un nouvel identifiant. C'est pour cela que l'import remplace par
 * partition (DELETE ciblé + INSERT) au lieu de se fier au seul upsert.
 */
export function refZonePprt(
  partition: string | null | undefined,
  nomass: string | null | undefined,
  geometrie: unknown,
): string {
  const empreinte = createHash('md5').update(JSON.stringify(geometrie ?? null)).digest('hex');
  return [partition ?? '', nomass ?? '', empreinte].join('|');
}

/** Une feature GeoJSON du WFS, réduite à ce qu'on en lit. */
export interface FeaturePm3 {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}

/** Une ligne prête pour `pprt_perimetres`. */
export interface LignePprt {
  id: string;
  nom: string;
  type_zone: TypeZonePprt;
  type_zone_source: string | null;
  id_generateur: string | null;
  /**
   * Procédure PPRT dont relève l'assiette (`gaspar/pprt`).
   *
   * Posée par la ROUTE et non par cette fonction : elle ne se lit pas sur
   * l'assiette mais sur le GÉNÉRATEUR, une autre couche du même WFS
   * (`generateur_sup_s.id_gaspar`, sql/183). La normalisation ne voit qu'une
   * assiette à la fois et ne peut donc pas la résoudre.
   */
  id_gaspar: string | null;
  id_assiette: string | null;
  nom_technique: string | null;
  /** Échelon du dépôt au GPU : 'departement' ou 'region'. Provenance, pas localisation. */
  depot_niveau: string | null;
  /** Code de l'échelon ci-dessus. Le département de la zone vient de PostGIS. */
  depot_code: string | null;
  partition: string;
  document_source: string | null;
  fichier_acte: string | null;
  mode_geometrie: string | null;
  date_source: string | null;
  source: string;
  geojson: unknown;
}

function texte(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Convertit une feature du WFS en ligne de base, ou rend `null` si elle n'est
 * pas exploitable.
 *
 * Deux refus, et aucun n'est silencieux côté appelant (l'import les compte) :
 * une géométrie absente ou d'un type autre que surfacique — on n'écrit pas un
 * périmètre qui n'en est pas un — et une `partition` manquante, sans laquelle
 * l'import ne saurait plus quoi remplacer au réimport.
 */
export function normaliserZonePprt(feature: FeaturePm3): LignePprt | null {
  const p = feature.properties ?? {};
  const geom = feature.geometry;

  const typeGeom = texte(geom?.type);
  if (!geom || !geom.coordinates || (typeGeom !== 'MultiPolygon' && typeGeom !== 'Polygon')) {
    return null;
  }

  const partition = texte(p.partition);
  if (!partition) return null;

  const nomass = texte(p.nomass);
  const depot = depotDePartition(partition);

  return {
    id: identitePoiSourceExterne(SOURCE_PPRT, refZonePprt(partition, nomass, geom.coordinates)),
    nom: nomLisible(texte(p.nomsuplitt), nomass),
    type_zone: normaliserTypeZone(texte(p.typeass)),
    type_zone_source: texte(p.typeass),
    id_generateur: texte(p.idgen),
    // Résolu après coup par la route, à partir de la couche des générateurs.
    id_gaspar: null,
    id_assiette: texte(p.idass),
    nom_technique: nomass,
    depot_niveau: depot?.niveau ?? null,
    depot_code: depot?.code ?? null,
    partition,
    document_source: texte(p.gpu_doc_id),
    fichier_acte: texte(p.fichier),
    mode_geometrie: texte(p.modegeoass),
    date_source: texte(p.gpu_timestamp),
    source: SOURCE_PPRT,
    geojson: geom,
  };
}
