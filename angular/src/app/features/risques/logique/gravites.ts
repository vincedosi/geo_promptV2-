/**
 * Les gravités réglementaires d'un site ICPE, et leurs libellés.
 *
 * ── POURQUOI CE FICHIER ───────────────────────────────────────────────────
 *
 * La liste était écrite TROIS fois — `RisqueIndustrielSection.tsx` (le panneau
 * Calques), `RisqueIndustrielLayer.tsx` (la couche carte) et
 * `AnalysePopulationOverlay.tsx` (l'analyse de population) — et la troisième
 * divergeait sur **quatre libellés sur six**, tout en portant le commentaire
 * « Miroir du panneau Calques ». Un commentaire qui affirme une synchronisation
 * inexistante est pire qu'aucun commentaire : il décourage la vérification.
 *
 * | id | panneau et carte | overlay, avant correctif |
 * |---|---|---|
 * | `seveso_haut` | Seveso seuil haut | **Seveso haut** |
 * | `seveso_bas` | Seveso seuil bas | **Seveso bas** |
 * | `ied` | Directive IED | **IED** |
 * | `autre` | Régime déclaratif ou non précisé | **Autre** |
 *
 * C'est le constat R-26 de `docs/AUDIT_ZONE_RISQUE.md`, et la question qu'il
 * posait — « lequel fait foi ? » — se tranche en faveur de la forme
 * **réglementaire** : la directive Seveso parle de seuil haut et de seuil bas.
 * « Seveso haut » est un raccourci de conversation, et l'écran sert précisément
 * à porter la distinction entre les deux seuils.
 *
 * ── CE QUE CE N'EST PAS ───────────────────────────────────────────────────
 *
 * Ce n'est pas une échelle de danger ordonnée. `rang_gravite` de la table
 * `icpe_rubrique_familles` (sql/173) sert à départager la nature dominante d'un
 * site qui en porte plusieurs ; la gravité réglementaire, elle, est le statut
 * Seveso. Les deux ne se comparent pas.
 */

/**
 * Les six valeurs de `poi_france.sous_categorie` pour la catégorie
 * `risque_industriel`, de la plus grave à la moins grave.
 *
 * L'ordre est celui de lecture d'un écran de risque et sert de tri par défaut ;
 * il n'implique aucune arithmétique.
 */
const GRAVITES = [
  'seveso_haut',
  'seveso_bas',
  'ied',
  'autorisation',
  'enregistrement',
  'autre',
] as const;

type Gravite = (typeof GRAVITES)[number];

/**
 * Le libellé affiché de chaque gravité — **la seule source**.
 *
 * Non exporté : `NIVEAUX_RISQUE` et `libelleGravite` sont les deux seules
 * portes d'entrée, et c'est voulu. Passer par elles garantit l'ordre de lecture
 * dans un cas, et le repli sur la valeur brute dans l'autre ; un accès direct
 * au dictionnaire contournerait les deux.
 *
 * ⚠ Ne pas retaper ces chaînes dans un composant. Deux libellés pour une même
 * chose font douter qu'il s'agisse de la même chose, et c'est particulièrement
 * coûteux ici : un média planner qui lit « Seveso haut » sur un écran et
 * « Seveso seuil haut » sur un autre ne peut pas savoir s'il regarde le même
 * périmètre réglementaire.
 */
const LIBELLE_GRAVITE: Record<Gravite, string> = {
  seveso_haut: 'Seveso seuil haut',
  seveso_bas: 'Seveso seuil bas',
  ied: 'Directive IED',
  autorisation: 'Autorisation',
  enregistrement: 'Enregistrement',
  autre: 'Régime déclaratif ou non précisé',
};

/**
 * Les gravités avec leur libellé, prêtes à parcourir pour construire une liste
 * de cases à cocher.
 *
 * Un tableau plutôt qu'un `Object.entries` chez chaque appelant : l'ordre est
 * porté ici, et `Object.entries` ne le garantit que par accident sur des clés
 * non numériques.
 */
export const NIVEAUX_RISQUE: ReadonlyArray<{ id: Gravite; label: string }> =
  GRAVITES.map((id) => ({ id, label: LIBELLE_GRAVITE[id] }));

/**
 * Le libellé d'une gravité venue de la base, avec repli sur la valeur brute.
 *
 * ⚠ `poi_france.sous_categorie` est une colonne `text` : le générateur de types
 * la rend en `string`, et rien en base ne garantit qu'elle vaut l'une des six
 * valeurs connues. Indexer `LIBELLE_GRAVITE` directement obligerait à un cast,
 * qui mentirait — et afficherait `undefined` dans une popup le jour où un
 * import apporte une septième valeur.
 *
 * Le repli montre la valeur brute : moins jolie, mais vraie, et elle désigne le
 * correctif à faire.
 *
 * @param valeur - La gravité telle que la base la porte.
 * @returns Le libellé connu, ou la valeur brute.
 *
 * @example
 * libelleGravite('seveso_haut')  // 'Seveso seuil haut'
 * libelleGravite('inconnue_2027') // 'inconnue_2027'
 */
export function libelleGravite(valeur: string): string {
  return (LIBELLE_GRAVITE as Record<string, string>)[valeur] ?? valeur;
}
