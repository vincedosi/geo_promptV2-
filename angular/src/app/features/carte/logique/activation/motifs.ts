import type { MotifPrevol } from '../../data/activation.api';

/**
 * ⑦ Activation — le texte d'un motif du pré-vol (lot 7, T3), PUR. Les messages du serveur (`motifsPrevol`,
 * `lib/campaigns/activation.ts`) sont lus par React tels quels : deux d'entre eux disent « stratégie », mot que l'écran
 * Angular n'emploie pas (E4, A-9) — le plan de la campagne est le conteneur que l'utilisateur a lancé en ⑥. Ceux-là
 * sont réécrits ici, au vouvoiement comme tout le parcours ; les autres sont déjà justes, et repris du serveur pour
 * garder leurs chiffres (le nombre de zones modifiées de `derive`, la source de `aucun_cp_dv360`).
 */
const TEXTES: Readonly<Record<string, string>> = {
  aucune_strategie: 'Cette campagne n’a pas encore de plan : lancez-la à l’étape ⑥.',
  jamais_publiee: 'Le plan n’a jamais été publié — publiez-le pour figer le périmètre poussé.',
};

/** Le texte affiché d'un motif ; un code inconnu (motif ajouté au serveur plus tard) garde le message du serveur. */
export function texteMotif(m: MotifPrevol): string {
  return TEXTES[m.code] ?? m.message;
}

/** Le motif qui appelle le bouton de publication, à côté de lui (A-9) : jamais publié, ou dérivé depuis la publication. */
export function motifDePublication(m: MotifPrevol): boolean {
  return m.code === 'jamais_publiee' || m.code === 'derive';
}

/** Le libellé du bouton de publication : « Publier le plan », ou « Republier (v1 → v2) » après une version (React). */
export function libellePublication(versionPubliee: number | null): string {
  return versionPubliee === null ? 'Publier le plan' : `Republier (v${versionPubliee} → v${versionPubliee + 1})`;
}
