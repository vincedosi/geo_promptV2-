/**
 * Règles PURES de l'onglet « Réglages » d'un espace (`onglet-reglages.component.ts`) : lecture des
 * quotas saisis, lecture de la config rendue par le serveur, textes des deux confirmations. Sorties
 * du composant au lot 4 (T22) pour se tester sans TestBed.
 */

/** Résultat de la lecture d'un quota saisi : vide → `null`, entier positif ou nul → le nombre, le reste → refus. */
export type QuotaLu = { ok: true; valeur: number | null } | { ok: false };

/** Le message en ligne sous un quota refusé. */
export const MESSAGE_QUOTA = 'Saisissez un entier positif ou nul, ou laissez vide pour ne pas limiter.';

/**
 * Lit un quota saisi (« Quota de POI », « Quota de requêtes IA »). Vide → `null` (illimité) ; une
 * suite de chiffres → l'entier ; tout le reste (négatif, décimal, lettres, notation scientifique,
 * espace au milieu, entier hors plage sûre) est REFUSÉ. React se contentait de `parseInt`, qui
 * lisait « 1.5 » comme 1 et « 12abc » comme 12 : un nombre que l'admin n'avait pas tapé.
 */
export function lireQuota(saisie: string): QuotaLu {
  const s = saisie.trim();
  if (s === '') return { ok: true, valeur: null };
  if (!/^\d+$/.test(s)) return { ok: false };
  const n = Number(s);
  return Number.isSafeInteger(n) ? { ok: true, valeur: n } : { ok: false };
}

/** Une chaîne de la config lue, ou '' (la valeur peut être absente, `null` ou d'un autre type). */
export function texteDeConfig(config: Record<string, unknown>, cle: string): string {
  const v = config[cle];
  return typeof v === 'string' ? v : '';
}

/** Un quota de la config lue, en saisie. */
export function quotaEnSaisie(config: Record<string, unknown>, cle: string): string {
  const v = config[cle];
  return typeof v === 'number' ? String(v) : '';
}

/** Ce que la suppression emporte, d'après les effectifs de la liste de la page. */
export function messageSuppression(nbMembres: number, nbJeuxPrives: number): string {
  const n = nbMembres;
  const m = nbJeuxPrives;
  const membres = n === 1 ? 'Son 1 membre en est retiré' : `Ses ${n} membres en sont retirés`;
  const jeux = m === 1 ? 'son 1 jeu privé devient sans propriétaire et n\'est' : `ses ${m} jeux privés deviennent sans propriétaire et ne sont`;
  return `${membres} ; ${jeux} plus visible${m === 1 ? '' : 's'} que du super-administrateur.`;
}

/**
 * Ce que la désactivation change. C'est ce que les routes font d'un espace inactif (`admin/users`,
 * `admin/campaigns/[id]`) : plus de nouveau compte, plus de campagne rattachée. Rien n'est supprimé.
 * `nbMembres` vaut `undefined` quand l'espace n'est pas (encore) dans la liste de la page.
 */
export function messageDesactivation(nbMembres: number | undefined): string {
  const n = nbMembres;
  const qui = n === undefined ? 'Ses membres' : n === 1 ? 'Son 1 membre' : `Ses ${n} membres`;
  return `Un espace inactif n'accepte plus de nouveau compte ni de campagne. ${qui} y ${n === 1 ? 'est' : 'sont'} concerné${n === 1 ? '' : 's'}. Rien n'est supprimé : le réactiver suffit.`;
}
