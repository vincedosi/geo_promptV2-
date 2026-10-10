import type { CompteResume } from './types';

/** Un groupe de la vue « Tous les comptes » : bandeau (point teal, libellé, effectif) puis ses lignes. */
export interface GroupeComptes {
  cle: string;
  libelle: string;
  comptes: CompteResume[];
}

export const LIBELLE_SUPER_ADMINS = 'Super admins';
/** Membre d'au moins un espace, sans espace actif (« Aucun (socle seul) » dans sa fiche). */
export const LIBELLE_AUCUN_ACTIF = 'Aucun espace actif';
/** Rattaché à AUCUN espace : la page React l'appelait « Sans organisation ». */
export const LIBELLE_SANS_ESPACE = 'Sans espace';
const ESPACE_INCONNU = 'Espace inconnu';

/** Minuscules, sans diacritiques (« Hélène » → « helene »), espaces de bord retirés. */
export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Filtre LOCAL par nom ou email, insensible à la casse et aux accents ; filtre vide → tout. */
export function filtrerComptes(comptes: readonly CompteResume[], filtre: string): CompteResume[] {
  const f = normaliser(filtre);
  if (f === '') return [...comptes];
  return comptes.filter((c) => normaliser(c.email).includes(f) || normaliser(c.nom ?? '').includes(f));
}

/**
 * Regroupement de la page React Users (`app/admin/users/page.tsx`, `groupedUsers` ; supprimée le 2026-10-10, voir dc3c5ee7) : Super admins,
 * puis un groupe par espace ACTIF du compte (nom affiché, ordre alphabétique `fr`), puis « Sans
 * espace » en dernier. Écart voulu : un membre sans espace actif n'est PAS rangé « Sans espace »
 * (il en a), mais dans « Aucun espace actif », avant lui. Un groupe vide n'est pas rendu ; l'ordre
 * des comptes dans un groupe est celui reçu (le serveur trie par email).
 *
 * @param noms - Nom affiché par identifiant d'espace, quand l'espace actif n'est pas dans
 *   `compte.espaces` (incohérence passagère) : repli avant « Espace inconnu ».
 */
export function grouperComptes(
  comptes: readonly CompteResume[],
  noms: ReadonlyMap<string, string> = new Map(),
): GroupeComptes[] {
  const superAdmins: CompteResume[] = [];
  const parEspace = new Map<string, GroupeComptes>();
  const aucunActif: CompteResume[] = [];
  const sansEspace: CompteResume[] = [];

  for (const c of comptes) {
    if (c.role === 'super_admin') superAdmins.push(c);
    else if (c.espace_actif !== null) {
      const id = c.espace_actif;
      let g = parEspace.get(id);
      if (!g) {
        const libelle = c.espaces.find((e) => e.id === id)?.nom_affiche ?? noms.get(id) ?? ESPACE_INCONNU;
        g = { cle: `espace-${id}`, libelle, comptes: [] };
        parEspace.set(id, g);
      }
      g.comptes.push(c);
    } else if (c.espaces.length > 0) aucunActif.push(c);
    else sansEspace.push(c);
  }

  const groupes: GroupeComptes[] = [];
  if (superAdmins.length) groupes.push({ cle: 'super-admins', libelle: LIBELLE_SUPER_ADMINS, comptes: superAdmins });
  groupes.push(...[...parEspace.values()].sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr')));
  if (aucunActif.length) groupes.push({ cle: 'aucun-actif', libelle: LIBELLE_AUCUN_ACTIF, comptes: aucunActif });
  if (sansEspace.length) groupes.push({ cle: 'sans-espace', libelle: LIBELLE_SANS_ESPACE, comptes: sansEspace });
  return groupes;
}
