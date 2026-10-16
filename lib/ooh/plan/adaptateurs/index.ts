/**
 * Les adaptateurs de plans de régie, et le rattachement d'une liste d'emplacements à sa ligne de campagne
 * (spec 2026-10-16-ooh-campagnes § 7). La vague suivante = un adaptateur de plus dans `ADAPTATEURS`, ou aucun si le
 * format est le même : le script ne change pas.
 */
import type { AdaptateurId, AdaptateurPlan, Classeur, EmplacementBrut, EnteteCampagne, LignePlan } from '@/types/campagnes-media';
import { normaliser } from '../texte';
import { ADAPTATEUR_BASIC_FIT } from './basic-fit';
import { ADAPTATEUR_GARES } from './mediatransports-gares';
import { ADAPTATEUR_STRIDE } from './stride-campus';
import { ADAPTATEUR_SYNTHESE } from './synthese-hyp';

/** Tous les formats connus, la synthèse en tête. */
const ADAPTATEURS: readonly AdaptateurPlan[] = [ADAPTATEUR_SYNTHESE, ADAPTATEUR_GARES, ADAPTATEUR_BASIC_FIT, ADAPTATEUR_STRIDE];

/** Un plan lu : l'en-tête et les lignes de la synthèse, les emplacements de toutes les listes reconnues. */
interface PlanLu {
  entete: EnteteCampagne;
  lignes: LignePlan[];
  emplacements: EmplacementBrut[];
  adaptateurs: AdaptateurId[];
}

/**
 * Lit un plan avec tous les adaptateurs qui le reconnaissent.
 *
 * @throws si aucun onglet de synthèse n'est reconnu : un plan sans lignes ne fait pas une campagne.
 */
export function lirePlan(classeur: Classeur): PlanLu {
  const reconnus = ADAPTATEURS.filter((a) => a.reconnait(classeur));
  const synthese = reconnus.find((a) => a.id === 'synthese-hyp');
  const lu = synthese?.lire(classeur);
  if (!lu?.entete) {
    throw new Error('Aucun onglet de synthèse reconnu (en-tête « AFFICHEURS · RESEAUX ») : ce plan demande un nouvel adaptateur.');
  }
  return {
    entete: lu.entete,
    lignes: lu.lignes,
    emplacements: reconnus.filter((a) => a.id !== 'synthese-hyp').flatMap((a) => a.lire(classeur).emplacements),
    adaptateurs: reconnus.map((a) => a.id),
  };
}

/** Les emplacements d'une ligne et le format qui les a lus. */
interface Rattachement {
  adaptateur: AdaptateurId;
  emplacements: EmplacementBrut[];
}

/**
 * Rattache chaque liste reconnue à la ligne de sa régie (régies normalisées : « BASIC FIT », « STRIDE »…), par `ordre`.
 * Une liste ne va qu'à la PREMIÈRE ligne de sa régie : la rattacher à deux lignes doublerait ses panneaux dans la
 * campagne. Une ligne sans liste (les DROM) n'a pas d'entrée.
 */
export function rattacher(lignes: readonly LignePlan[], emplacements: readonly EmplacementBrut[]): Map<number, Rattachement> {
  const sortie = new Map<number, Rattachement>();
  const pris = new Set<AdaptateurId>();
  for (const l of lignes) {
    const a = ADAPTATEURS.find((x) => x.regies.includes(normaliser(l.regie)));
    if (!a || pris.has(a.id)) continue;
    pris.add(a.id);
    sortie.set(l.ordre, { adaptateur: a.id, emplacements: emplacements.filter((e) => e.adaptateur === a.id) });
  }
  return sortie;
}

/**
 * Les listes reconnues qu'aucune ligne n'a prises (le plan n'a pas de ligne de leur régie). Le script les signale :
 * une liste jetée en silence ferait croire à une campagne complète.
 */
export function listesSansLigne(rattachement: ReadonlyMap<number, Rattachement>, emplacements: readonly EmplacementBrut[]): AdaptateurId[] {
  const prises = new Set([...rattachement.values()].map((r) => r.adaptateur));
  return [...new Set(emplacements.map((e) => e.adaptateur))].filter((a) => !prises.has(a));
}
