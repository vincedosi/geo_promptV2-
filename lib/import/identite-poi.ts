/**
 * @file lib/import/identite-poi.ts
 *
 * Identité stable d'un POI importé — la clé de déduplication des imports.
 *
 * ── Le défaut corrigé (`ECH-001`, critique) ─────────────────────────────────
 *
 * `lib/import/validator.ts` posait `id: randomUUID()` à chaque analyse du
 * fichier, et `lib/import/inserter.ts` insérait avec
 * `{ onConflict: 'id', ignoreDuplicates: true }`.
 *
 * L'identifiant étant neuf à chaque exécution, **le conflit ne pouvait jamais
 * se produire** : le `ignoreDuplicates: true` donnait une illusion
 * d'idempotence. Rejouer le même fichier — reprise après coupure réseau, double
 * clic, relance après échec partiel — dupliquait l'intégralité des POI, sans
 * une erreur, sans une alerte. La base grossissait et les analyses
 * géographiques comptaient double.
 *
 * ── Pourquoi un identifiant déterministe, et pas une contrainte `UNIQUE` ────
 *
 * La solution qui vient d'abord à l'esprit est une contrainte d'unicité sur la
 * clé naturelle, à l'image de `panneaux_affichage` et son
 * `UNIQUE (source, source_ref)`. Deux faits mesurés en base le 2026-09-11
 * l'écartent :
 *
 *  - `poi_france` **n'a pas de colonne `source_ref`** : les fichiers importés
 *    n'apportent aucun identifiant externe. Il n'y a rien à contraindre.
 *  - **358 lignes sont déjà en doublon** sur les 290 877 existantes. Poser une
 *    contrainte `UNIQUE` échouerait, et supprimer ces lignes serait une
 *    destruction de données qui ne relève pas d'un correctif technique.
 *
 * Rendre l'identifiant déterministe est le changement minimal qui rend le code
 * existant correct : la clé primaire est déjà `id`, le `onConflict: 'id'` est
 * déjà écrit. Il ne lui manquait qu'un identifiant reproductible. Aucune
 * migration, aucune contrainte, réversible en une ligne.
 *
 * ── Ce qui compose l'identité, et pourquoi ──────────────────────────────────
 *
 * **Ce que le fichier dit, jamais ce qu'on en dérive.** Le fichier est l'entrée
 * stable ; tout ce qu'on calcule à partir de lui peut varier d'une exécution à
 * l'autre.
 *
 * `data_source_id` est **délibérément exclu**. Chaque import crée une NOUVELLE
 * ligne `data_sources` (`app/api/admin/import-poi/execute/route.ts:146`, un
 * `insert` et non un `upsert`) : l'inclure ferait changer l'identifiant à
 * chaque exécution et anéantirait exactement l'effet recherché.
 *
 * `categorie` **est** inclus. Le débat mérite d'être tranché explicitement :
 *  - l'inclure fait qu'un ré-import après correction d'un mappage de catégorie
 *    crée un doublon — visible, et consécutif à une action délibérée ;
 *  - l'exclure ferait fusionner deux POI distincts partageant nom et adresse
 *    mais de catégories différentes — une **perte silencieuse**.
 * Entre un doublon visible et une perte silencieuse, on choisit le doublon.
 *
 * ── Limite connue, à ne pas découvrir en production ─────────────────────────
 *
 * Les 290 877 POI déjà en base portent des identifiants aléatoires. Le premier
 * ré-import d'un fichier déjà importé **créera donc encore une série de
 * doublons** — les nouveaux identifiants déterministes ne peuvent pas
 * rencontrer les anciens. À partir de ce ré-import, le fichier devient
 * idempotent.
 *
 * Autre limite : quand un fichier ne porte pas de coordonnées, celles-ci
 * viennent du géocodage BAN. Une mise à jour du référentiel BAN qui déplacerait
 * un point changerait son identité. C'est rare, et sans remède simple — le
 * signaler vaut mieux que le taire.
 */
import { createHash } from 'node:crypto';

/**
 * Espace de nommage RFC 4122 pour les POI de l'import universel.
 *
 * Constante figée : la changer réattribuerait TOUS les identifiants et ferait
 * réapparaître le défaut qu'on corrige ici.
 */
const ESPACE_POI = 'b7a1e6c4-3f2d-4a58-9e10-5c8d2f7b4a63';

/**
 * UUID version 5 (RFC 4122) — empreinte SHA-1 d'un nom dans un espace de nommage.
 *
 * Implémenté ici plutôt qu'importé : le paquet `uuid` est présent mais
 * n'embarque pas ses types, et ajouter `@types/uuid` serait une dépendance de
 * plus pour quinze lignes. `node:crypto` est déjà utilisé par ce module.
 *
 * Conforme au vecteur de test canonique de la RFC — vérifié par le test :
 *   uuidV5('www.example.com', espace DNS) = 2ed6657d-e927-568b-95e1-2665a8aea6a2
 */
export function uuidV5(nom: string, espace: string): string {
  const octetsEspace = Buffer.from(espace.replace(/-/g, ''), 'hex');
  const empreinte = createHash('sha1')
    .update(Buffer.concat([octetsEspace, Buffer.from(nom, 'utf8')]))
    .digest();

  // Les 16 premiers octets, avec version (5) et variante (RFC 4122) forcées.
  const o = Buffer.from(empreinte.subarray(0, 16));
  o[6] = (o[6] & 0x0f) | 0x50; // version 5 dans les 4 bits hauts de l'octet 6
  o[8] = (o[8] & 0x3f) | 0x80; // variante 10x dans les bits hauts de l'octet 8

  const h = o.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Séparateur de champs : caractère « unit separator », absent des données réelles. */
const SEP = '';

/**
 * Normalise un champ texte pour le rendre reproductible.
 *
 * `trim` est indispensable : `CLAUDE.md` rappelle que les CSV INSEE portent des
 * espaces invisibles. La mise en minuscules et le repli des espaces internes
 * absorbent les différences de saisie entre deux exports du même jeu.
 * La normalisation Unicode NFC évite que « é » composé et « é » précomposé
 * produisent deux identités.
 */
function normaliserTexte(valeur: string | null | undefined): string {
  if (!valeur) return '';
  return valeur.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Coordonnée à 6 décimales (~11 cm) — au-delà, c'est du bruit de flottant. */
function normaliserCoord(valeur: number | null | undefined): string {
  return Number.isFinite(valeur) ? (valeur as number).toFixed(6) : '';
}

/** Champs qui composent l'identité. Les défauts reproduisent ceux de l'inserter. */
export interface ChampsIdentitePoi {
  source?: string | null;
  categorie?: string | null;
  nom?: string | null;
  adresse?: string | null;
  code_postal?: string | null;
  ville?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Identifiant reproductible d'un POI.
 *
 * Le même contenu de ligne produit toujours le même identifiant, quelle que
 * soit l'exécution ou la machine. C'est ce qui rend
 * `upsert(..., { onConflict: 'id', ignoreDuplicates: true })` enfin conforme à
 * ce que son nom annonce.
 *
 * Les valeurs par défaut (`'import_universel'`, `'autre'`) sont celles que
 * `lib/import/inserter.ts` applique à l'écriture : l'identité doit être
 * calculée sur ce qui sera réellement stocké, sans quoi elle ne retrouverait
 * pas la ligne existante.
 */
export function identitePoi(champs: ChampsIdentitePoi): string {
  const cle = [
    normaliserTexte(champs.source) || 'import_universel',
    normaliserTexte(champs.categorie) || 'autre',
    normaliserTexte(champs.nom),
    normaliserTexte(champs.adresse),
    normaliserTexte(champs.code_postal),
    normaliserTexte(champs.ville),
    normaliserCoord(champs.lat),
    normaliserCoord(champs.lng),
  ].join(SEP);

  return uuidV5(cle, ESPACE_POI);
}

/**
 * Identité d'un POI dont la SOURCE porte déjà un identifiant stable — par
 * exemple le `codeAIOT` d'une installation classée Géorisques.
 *
 * ── Pourquoi une seconde fonction, et pas `identitePoi()` ──────────────────
 *
 * `identitePoi()` compose sa clé du nom, de l'adresse et des coordonnées, parce
 * que les fichiers importés n'apportent AUCUN identifiant externe (voir
 * l'en-tête de ce fichier). Quand la source en fournit un, il est strictement
 * meilleur : il survit à un changement de raison sociale, à une correction
 * d'adresse ou à un repositionnement du point, là où la clé composée créerait
 * un doublon à chacun de ces trois événements — tous ordinaires sur un
 * référentiel public mis à jour en continu.
 *
 * Le nom de la source entre dans la clé pour que deux référentiels utilisant la
 * même numérotation ne se télescopent pas. Le préfixe littéral `ref-externe`
 * garantit qu'aucune clé produite ici ne peut coïncider avec une clé de
 * `identitePoi()`, dont le premier segment est un nom de source.
 */
export function identitePoiSourceExterne(source: string, refExterne: string): string {
  const cle = ['ref-externe', normaliserTexte(source), normaliserTexte(refExterne)].join(SEP);
  return uuidV5(cle, ESPACE_POI);
}
