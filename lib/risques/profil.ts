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
 * Le pas du pré-calcul, en mètres.
 *
 * `couverture_rayon_risque` (sql/198) est agrégée par paliers de 100 m. Deux
 * anneaux plus proches que cela délimiteraient une bande qu'aucun palier ne
 * mesure : elle s'afficherait à zéro habitant, ce qui se lit « personne
 * n'habite là » et non « cette bande n'a pas de donnée ».
 */
export const PAS_RAYON_M = 100;

/**
 * Pose le BORD de la zone d'un niveau — son anneau extérieur.
 *
 * ── POURQUOI LE BORD, ET PAS « LE » RAYON ─────────────────────────────────
 *
 * La barre porte une réglette par niveau, alors qu'un niveau peut avoir
 * jusqu'à quatre anneaux (`ANNEAUX_MAX`) et que le profil par défaut en a
 * trois sur le seuil haut. Une réglette ne peut donc pas représenter « le »
 * rayon du niveau : elle déplace son anneau EXTÉRIEUR, c'est-à-dire l'étendue
 * réelle de la zone, et laisse les anneaux intérieurs aux chips de l'atelier.
 *
 * C'est aussi l'abscisse à laquelle le bandeau KPI lit le gain marginal :
 * « ce que 100 m de plus apporteraient » se demande au bord, pas au milieu.
 *
 * ── LE BORD NE PASSE JAMAIS SOUS UN ANNEAU INTÉRIEUR ──────────────────────
 *
 * Sans cette garde, poser 1 500 m sur `[1000, 2000, 5000]` rendrait
 * `[1000, 1500, 2000]` après tri : le bord deviendrait 2 000 m, soit l'inverse
 * du geste demandé, et la bande que l'utilisateur regardait aurait changé de
 * rang sans qu'il ait touché à autre chose. On ramène donc au premier palier
 * au-dessus du dernier anneau intérieur.
 *
 * @param profil - Le profil courant, déjà canonique.
 * @param niveau - Le niveau dont on déplace le bord.
 * @param rayonM - Le rayon visé, en mètres. Ramené dans les bornes du pré-calcul.
 * @returns Un profil canonique. Écrit sur le niveau HAUT quand le cadenas est
 *          fermé — écrire sur `bas` serait sans effet visible, `anneauxDuNiveau`
 *          rendant alors les anneaux du haut.
 *
 * @example
 * poserRayonExterieur({ haut: [1000, 2000, 5000], … }, 'haut', 7000).haut
 * // → [1000, 2000, 7000]
 */
export function poserRayonExterieur(
  profil: ProfilRayons,
  niveau: Niveau,
  rayonM: number,
): ProfilRayons {
  const cible: Niveau = profil.lie ? 'haut' : niveau;
  const actuels = anneauxDuNiveau(profil, niveau);
  const interieurs = actuels.slice(0, -1);
  const dernierInterieur = interieurs[interieurs.length - 1];
  const plancher = dernierInterieur === undefined
    ? RAYON_MIN_M
    : dernierInterieur + PAS_RAYON_M;

  const borne = Math.min(RAYON_MAX_M, Math.max(plancher, Math.round(rayonM)));
  return normaliserProfil({ ...profil, [cible]: [...interieurs, borne] });
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

/**
 * Le profil RÉELLEMENT calculé, une fois le filtre de gravité appliqué.
 *
 * ── LE DÉFAUT QU'ELLE FERME (2026-09-28) ─────────────────────────────────
 *
 * Le filtre « Seveso seuil haut / seuil bas » de la barre commune ne vivait
 * que dans l'état ; le calcul de population, la carte des zones et le jeu de
 * zones ne lisaient que le PROFIL, qui porte des anneaux pour les deux seuils.
 * Décocher le seuil bas ne changeait donc rien : à 5 km, l'écran affichait
 * toujours ~24 M d'habitants, ceux des deux seuils.
 *
 * Vider les anneaux d'un niveau suffit côté base : `classe_carreau_risque`
 * (sql/204) ne retient RIEN d'un niveau sans anneau, PPRT compris.
 *
 * ⚠ Un profil LIÉ est d'abord délié : lié, `anneauxDuNiveau` rend les anneaux
 * du haut pour tous les niveaux, et vider `bas` serait sans effet.
 *
 * ⚠ Sans filtre effectif (liste vide, ou tous les niveaux gardés), le profil
 * est rendu TEL QUEL — même objet, donc même code, donc les caches de zones
 * et de jeux déjà construits restent valides.
 *
 * @param profil - Le profil saisi (celui que les réglettes éditent).
 * @param gravites - Les gravités cochées (`seveso_haut`, `seveso_bas`, …).
 * @returns Le profil à envoyer au calcul.
 */
export function profilDesGravites(profil: ProfilRayons, gravites: readonly string[]): ProfilRayons {
  if (gravites.length === 0) return profil;
  const garde = (n: Niveau) => GRAVITE_DU_NIVEAU[n].some((g) => gravites.includes(g));
  // Les deux seuils SEULS : « autres » n'est calculé nulle part en base, et
  // le vider changerait le code d'un profil lié sans changer aucun chiffre.
  const aVider = (['haut', 'bas'] as const)
    .filter((n) => !garde(n) && anneauxDuNiveau(profil, n).length > 0);
  if (aVider.length === 0) return profil;

  const delie: ProfilRayons = {
    ...profil,
    lie: false,
    haut: anneauxDuNiveau(profil, 'haut'),
    bas: anneauxDuNiveau(profil, 'bas'),
    autres: anneauxDuNiveau(profil, 'autres'),
  };
  for (const n of aVider) delie[n] = [];
  return delie;
}

/**
 * Met un rayon en mètres sous la forme la plus courte qui reste juste.
 *
 * Un média planner dit « 500 m » et « 2 km », jamais « 2000 m ». La bascule se
 * fait au kilomètre entier seulement : 1 500 m reste « 1,5 km », lisible, mais
 * 1 234 m deviendrait « 1,2 km » et perdrait de la précision dans un libellé
 * qui sert justement à vérifier une saisie.
 *
 * ⚠ Source UNIQUE. Elle a été écrite deux fois le même jour — dans le résumé de
 * profil et dans le panneau de réglage — et deux formats de rayon sur le même
 * écran font douter qu'il s'agisse du même rayon.
 *
 * @param m - Le rayon, en mètres.
 * @returns Par exemple `500 m`, `2 km`, `1,5 km`.
 */
export function libelleRayon(m: number): string {
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1).replace('.', ',')} km`;
}
