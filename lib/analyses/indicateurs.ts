/**
 * @file lib/analyses/indicateurs.ts — matérialisation paresseuse d'un
 * indicateur par code postal, partagée par `/api/analyses/score` et
 * `/api/analyses/correlation` (Tâche 12/13, durcie le 2026-09-13).
 *
 * `indicator_cp_values` est peuplée À LA DEMANDE, pas référentielle : au
 * 2026-09-13 elle ne portait que 2 des 19 indicateurs actifs du registre.
 * Sans ce filet, une analyse sur n'importe quel autre indicateur rendait du
 * vide **en silence** — un score absent se lisant « pas de données ici »
 * plutôt que « je n'ai jamais calculé cet indicateur ».
 *
 * ── Pourquoi la PRÉSENCE de valeurs ne suffit pas comme test ───────────────
 * `materialize_indicator_cp_values` peut écrire ZÉRO ligne, et c'est un cas
 * réel : `part_couples_enfants` pointe sur `iris.part_couples_avec_enfants`,
 * **entièrement vide** (0 renseigné sur 49 448 IRIS) tout en étant `active`
 * dans le registre, donc proposée à l'utilisateur. Tester la présence faisait
 * alors rematérialiser À CHAQUE LANCEMENT : un seq scan complet d'`iris`,
 * ~173 Mo lus et 1,3 s, avec un quota de 12 lancements/minute/utilisateur, sur
 * un disque Nano plafonné à 5 Mo/s et 250 IOPS. La famille exacte des
 * incidents du 28/03 et du 08/04 (CLAUDE.md).
 *
 * D'où le journal `indicator_cp_materializations` (sql/148) : il retient le
 * NOMBRE de lignes écrites, zéro compris, et la date de la donnée pour les
 * sources quotidiennes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

/** Ce que `etat_indicateur_cp` (sql/148) rend. */
interface EtatIndicateur {
  connu: boolean;
  data_source: string | null;
  journalise: boolean;
  n_lignes: number | null;
  computed_at: string | null;
  date_donnee: string | null;
  a_des_valeurs: boolean;
  valeurs_calculees_le: string | null;
  perime: boolean;
}

export type ResultatIndicateur =
  | { ok: true; calculeLe: string | null; nLignes: number | null }
  /** L'indicateur n'existe pas / est inactif au registre. */
  | { ok: false; raison: 'inconnu'; message: string }
  /** Sa source est vide : aucune valeur par code postal n'est calculable. */
  | { ok: false; raison: 'sans_donnees'; message: string }
  /** La matérialisation elle-même a échoué. */
  | { ok: false; raison: 'echec'; message: string };

/**
 * S'assure qu'un indicateur est disponible par code postal, en le calculant
 * seulement si nécessaire.
 *
 * Ne rematérialise QUE dans deux cas, jamais « par fraîcheur » :
 *   - aucune valeur ET aucun journal disant qu'on a déjà essayé ;
 *   - source quotidienne (`pollen`, `atmo`) dont la donnée a changé de jour.
 *
 * Les 16 indicateurs `iris_column` et l'abstention ne bougent qu'à un import
 * IRIS ou jamais : les recalculer sur un simple critère d'âge ferait payer un
 * balayage complet d'`iris` pour un résultat identique. C'est la différence
 * assumée avec `/api/bidding/strategies`, qui rematérialise au-delà de 30
 * jours — une stratégie écrit des enchères de production, où la fraîcheur se
 * paie ; ces analyses se relancent des dizaines de fois par session.
 *
 * La date rendue est celle de la DONNÉE quand elle existe (pollen/atmo), sinon
 * celle du calcul. Rendre la date du calcul pour une mesure du 3 juillet
 * afficherait « calculé le 13/09 » sous une valeur vieille de deux mois.
 */
export async function assurerIndicateurCp(
  supabase: SupabaseClient<Database>,
  code: string,
): Promise<ResultatIndicateur> {
  const { data: etatBrut, error: erreurEtat } = await supabase.rpc('etat_indicateur_cp', {
    p_indicator_code: code,
  });
  if (erreurEtat) {
    return { ok: false, raison: 'echec', message: erreurEtat.message };
  }
  const etat = etatBrut as unknown as EtatIndicateur;

  if (!etat?.connu) {
    return { ok: false, raison: 'inconnu', message: `Indicateur inconnu ou inactif : ${code}.` };
  }

  // Déjà calculé, et rien ne s'est périmé : on ne touche à rien.
  if (etat.a_des_valeurs && !etat.perime) {
    return {
      ok: true,
      calculeLe: etat.date_donnee ?? etat.valeurs_calculees_le,
      nLignes: etat.n_lignes,
    };
  }

  // Déjà essayé, et la source n'avait rien à donner. On ne rescanne PAS.
  if (!etat.a_des_valeurs && etat.journalise && etat.n_lignes === 0 && !etat.perime) {
    return {
      ok: false,
      raison: 'sans_donnees',
      message: `L’indicateur « ${code} » n’a aucune valeur par code postal : sa source est vide en base.`,
    };
  }

  const { data: resultatBrut, error: erreurMat } = await supabase.rpc('materialiser_indicateur_cp', {
    p_indicator_code: code,
  });
  if (erreurMat) {
    return { ok: false, raison: 'echec', message: erreurMat.message };
  }
  const resultat = resultatBrut as unknown as {
    n_lignes: number; data_source: string; date_donnee: string | null; computed_at: string;
  };

  if (!resultat || resultat.n_lignes === 0) {
    // Le journal vient d'enregistrer ce zéro : le prochain appel sortira plus
    // haut sans rescanner.
    return {
      ok: false,
      raison: 'sans_donnees',
      message: `L’indicateur « ${code} » n’a aucune valeur par code postal : sa source est vide en base.`,
    };
  }

  return {
    ok: true,
    calculeLe: resultat.date_donnee ?? resultat.computed_at,
    nLignes: resultat.n_lignes,
  };
}
