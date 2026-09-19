/**
 * `ProfilRayons` — le jeu d'anneaux par niveau réglementaire, et son contrat.
 *
 * ── CE QUE CET OBJET DÉCIDE ───────────────────────────────────────────────
 *
 * Il décide, pour chaque carreau INSEE de 200 m, la bande à laquelle il
 * appartient. Toute la chaîne en dépend : les chiffres de l'écran, la
 * géométrie des zones sur la carte, la ventilation des impressions d'une
 * campagne, et le contenu du classeur exporté.
 *
 * ── POURQUOI VALIDATION ET NORMALISATION SONT LA MÊME OPÉRATION ───────────
 *
 * Le profil voyage dans l'URL, dans un corps de requête, dans une clé de cache
 * et dans un nom de tuile. Si deux saisies équivalentes — `[2000, 1000]` et
 * `[1000, 2000]` — produisaient deux objets distincts, elles produiraient deux
 * empreintes, donc deux caches et deux calculs pour une seule question. Pire,
 * un cache pourrait être servi pour un profil qui n'est pas celui affiché :
 * c'est le défaut que sql/196 a dû corriger en production sur
 * `exposition_cache`, où le résultat précédent repartait avec une date
 * d'apparence parfaitement légitime.
 *
 * Le schéma Zod applique donc `tri + dédoublonnage` DANS le parse. Un profil
 * qui passe le schéma est déjà canonique — il n'existe pas d'état intermédiaire
 * « validé mais pas encore normalisé » où quelqu'un pourrait calculer une
 * empreinte.
 */
import { z } from 'zod';

/** Plancher d'un anneau, en mètres. En dessous, le pré-calcul n'a pas de palier. */
export const RAYON_MIN_M = 100;

/**
 * Plafond d'un anneau, en mètres.
 *
 * C'est la borne du pré-calcul de sql/198, pas un choix d'interface : au-delà
 * de 10 km il n'y a aucune donnée. Accepter 15 km rendrait une bande vide
 * indiscernable d'une bande réellement sans habitant.
 */
export const RAYON_MAX_M = 10_000;

/**
 * Nombre maximal d'anneaux par niveau.
 *
 * Quatre anneaux font cinq classes par niveau (les quatre bandes plus le
 * hors-zone), soit dix classes à lire sur une carte avec deux niveaux. Au-delà,
 * l'opacité dégressive ne distingue plus rien à l'œil.
 */
export const ANNEAUX_MAX = 4;

/** Les trois niveaux réglementaires du modèle. */
export const NIVEAUX = ['haut', 'bas', 'autres'] as const;

export type Niveau = (typeof NIVEAUX)[number];

/**
 * Le libellé de chaque niveau, tel qu'il s'affiche.
 *
 * ⚠ Source UNIQUE, et c'est un correctif du constat R-26 de
 * `docs/AUDIT_ZONE_RISQUE.md` : « Seveso haut » dans l'overlay, « Seveso seuil
 * haut » dans le panneau et la popup. Deux libellés pour une même chose font
 * douter qu'il s'agisse de la même chose, précisément là où la distinction
 * entre seuil haut et seuil bas est ce que l'écran sert à porter.
 *
 * La forme retenue est la forme RÉGLEMENTAIRE, celle de la directive Seveso :
 * on parle de seuil haut et de seuil bas, pas de « haut » tout court.
 */
export const LIBELLE_NIVEAU: Record<Niveau, string> = {
  haut: 'Seveso seuil haut',
  bas: 'Seveso seuil bas',
  autres: 'Autres régimes',
};

/**
 * La gravité, telle qu'elle est écrite en base, pour chaque niveau du profil.
 *
 * ⚠ DEUX VOCABULAIRES, et les confondre coûte cher. Le profil raisonne en
 * niveaux (`haut`, `bas`, `autres`) ; `poi_france.sous_categorie` porte des
 * gravités (`seveso_haut`, `seveso_bas`, `ied`, `autorisation`,
 * `enregistrement`, `autre`). Le premier est un modèle de lecture à trois
 * étages, le second une nomenclature réglementaire à six valeurs.
 *
 * Passer un `'haut'` là où la base attend `'seveso_haut'` ne lève pas : le
 * filtre ne trouve simplement aucun site, et l'écran affiche zéro habitant
 * exposé — un résultat parfaitement plausible, donc invisible.
 */
export const GRAVITE_DU_NIVEAU: Record<Niveau, readonly string[]> = {
  haut: ['seveso_haut'],
  bas: ['seveso_bas'],
  autres: ['ied', 'autorisation', 'enregistrement', 'autre'],
};


/**
 * Une liste d'anneaux : bornée, entière, triée, sans doublon.
 *
 * Le tri et le dédoublonnage sont appliqués APRÈS la validation des bornes,
 * pour que le message d'erreur désigne la valeur telle que l'utilisateur l'a
 * saisie et non une version déjà réarrangée.
 */
const AnneauxSchema = z
  .array(
    z
      .number()
      .int('Un rayon se saisit en mètres entiers.')
      .min(RAYON_MIN_M, `Le rayon minimal est de ${RAYON_MIN_M} m.`)
      .max(RAYON_MAX_M, `Le rayon maximal est de ${RAYON_MAX_M} m.`),
  )
  .transform((rayons) => [...new Set(rayons)].sort((a, b) => a - b))
  .refine(
    (rayons) => rayons.length <= ANNEAUX_MAX,
    `Quatre anneaux au maximum par niveau.`,
  );

/**
 * Le profil complet.
 *
 * `lie` et `inclurePPRT` sont des booléens portés par le profil et non par
 * l'interface : ils changent le résultat du calcul, donc ils doivent entrer
 * dans l'empreinte. Un réglage qui change les chiffres sans changer la clé de
 * cache est la définition même du cache empoisonné.
 */
export const ProfilRayonsSchema = z.object({
  haut: AnneauxSchema,
  bas: AnneauxSchema,
  autres: AnneauxSchema,
  /** Tous les niveaux partagent les anneaux du niveau haut. Mode comparaison. */
  lie: z.boolean(),
  /** Les périmètres PPRT forment une classe à part, avant toute bande. */
  inclurePPRT: z.boolean(),
});

export type ProfilRayons = z.infer<typeof ProfilRayonsSchema>;

/**
 * Le profil ouvert par défaut.
 *
 * Trois anneaux sur le niveau haut, deux sur le bas : la finalité déclarée du
 * module est le custom bidding DIFFÉRENCIÉ, et un défaut identique sur les deux
 * niveaux n'illustrerait pas ce que l'écran sert à faire. Les valeurs
 * elles-mêmes (1, 2, 5 km et 0,5, 1 km) sont les paliers que les plans de
 * prévention emploient couramment.
 */
export const PROFIL_DEFAUT: ProfilRayons = {
  haut: [1000, 2000, 5000],
  bas: [500, 1000],
  autres: [],
  lie: false,
  inclurePPRT: true,
};

/**
 * Les anneaux réellement appliqués à un niveau.
 *
 * ⚠ Ne jamais lire `profil.bas` directement pour calculer : quand `lie` est
 * vrai, ce sont les anneaux du niveau haut qui s'appliquent, et lire le champ
 * brut donnerait une carte qui contredit le cadenas affiché à l'écran.
 *
 * @param profil - Le profil courant, déjà normalisé.
 * @param niveau - Le niveau dont on veut les anneaux.
 * @returns Les anneaux applicables, triés.
 */
export function anneauxDuNiveau(profil: ProfilRayons, niveau: Niveau): number[] {
  return profil.lie ? profil.haut : profil[niveau];
}

/**
 * Rend un profil canonique : bornes vérifiées, anneaux triés et dédoublonnés,
 * liaison appliquée.
 *
 * Appliquer la liaison ICI plutôt qu'à la lecture est délibéré : le profil
 * stocké est celui qui a servi au calcul, donc ce qu'on relit d'un cache ou
 * d'une URL décrit exactement ce qui a été mesuré. Un profil qui porterait
 * `lie: true` et des anneaux `bas` divergents laisserait deux lectures
 * possibles du même objet.
 *
 * ⚠ Lier ÉCRASE les anneaux propres, et délier ne les restaure pas. Conserver
 * un état caché « avant liaison » ferait réapparaître des anneaux que
 * l'utilisateur ne voit nulle part au moment où il décoche.
 *
 * @param brut - Un profil éventuellement désordonné, venu de l'URL ou d'une saisie.
 * @returns Le profil canonique.
 * @throws {z.ZodError} Si une borne ou un nombre d'anneaux est hors contrat.
 *
 * @example
 * normaliserProfil({ haut: [2000, 1000, 1000], bas: [500], autres: [], lie: false, inclurePPRT: true })
 * // → { haut: [1000, 2000], bas: [500], … }
 */
export function normaliserProfil(brut: unknown): ProfilRayons {
  const p = ProfilRayonsSchema.parse(brut);
  if (!p.lie) return p;
  return { ...p, bas: p.haut, autres: p.haut };
}
