/**
 * « Pas construit » n'est pas « pas carroyé ».
 *
 * ── LE DÉFAUT QUE CE FICHIER VERROUILLE ───────────────────────────────────
 *
 * Sélectionner la Guadeloupe dans l'onglet Rayons affichait :
 *
 *     « Les distances par carreau n'ont pas encore été construites.
 *       Construction : node scripts/construire_carreau_risque.mjs »
 *
 * Le pré-calcul ÉTAIT construit — 883 451 lignes, 98 départements. Ce que
 * l'écran lisait comme une absence de calcul était une absence de DONNÉE
 * SOURCE : le carroyage Filosofi 2021 à 200 m de l'INSEE ne publie que la
 * métropole, la Martinique et La Réunion.
 *
 * L'écran réclamait donc une action impossible — le script ne peut pas
 * fabriquer des carreaux que l'INSEE ne publie pas — et il taisait le seul
 * fait qui compte : ces départements portent des sites à risque bien réels.
 *
 * ⚠ Ces tests LISENT la base, ils n'écrivent rien : ils décrivent l'état du
 * pré-calcul tel qu'il est. Si le pré-calcul n'est pas construit sur le poste,
 * ils le disent au lieu d'échouer sur une cause qui n'est pas la leur.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

interface Couverture {
  construit: boolean;
  territoire_couvert: boolean;
  n_sites: number;
  n_seveso: number;
}

async function couverture(departement: string | null): Promise<Couverture> {
  const { data, error } = await sb.rpc('couverture_carreau_risque', {
    p_departement: departement,
  });
  if (error) throw new Error(`couverture_carreau_risque : ${error.message}`);
  return data as unknown as Couverture;
}

/**
 * Les trois départements que l'INSEE ne carroie pas.
 *
 * Ce n'est pas une lacune d'import : le fichier source ne les contient pas.
 * Mesuré le 2026-09-20 — `carreaux_filosofi` porte 0 carreau pour chacun,
 * et 25 995 pour la Martinique et La Réunion réunies.
 */
const NON_CARROYES = ['971', '973', '976'];

describe('couverture du carroyage INSEE', () => {
  let construit = false;

  beforeAll(async () => {
    construit = (await couverture(null)).construit;
  }, 60_000);

  it('dit si le pré-calcul existe, sans compter ses lignes', async () => {
    const c = await couverture(null);
    // Le champ est un booléen : la fonction répond « y a-t-il quelque chose »,
    // jamais « combien ». Un `count(distinct)` sur 883 451 lignes coûtait
    // 295 ms — 98 % de l'appel — pour un chiffre qu'aucun message n'utilise.
    expect(typeof c.construit).toBe('boolean');
  }, 60_000);

  it('un département NON CARROYÉ est signalé comme tel, pas comme non construit', async () => {
    if (!construit) {
      // Le pré-calcul n'est pas monté sur ce poste : la distinction ne peut
      // pas être observée, et échouer ici accuserait la mauvaise cause.
      expect(construit).toBe(false);
      return;
    }
    for (const dept of NON_CARROYES) {
      const c = await couverture(dept);
      expect(c.construit, `${dept} : le pré-calcul devrait être vu comme construit`).toBe(true);
      expect(c.territoire_couvert, `${dept} ne devrait pas être couvert`).toBe(false);
    }
  }, 60_000);

  it('et il porte quand même des sites — c est ce qu il faut dire', async () => {
    if (!construit) return;
    /*
     * LE point du correctif. « Aucune population calculable » se lit « il n'y
     * a rien là-bas » tant qu'on ne précise pas combien de sites s'y trouvent.
     * Mesuré : 603 sites sur les trois départements, dont 31 Seveso.
     */
    const total = (await Promise.all(NON_CARROYES.map(couverture)))
      .reduce((t, c) => t + c.n_sites, 0);
    expect(total).toBeGreaterThan(0);
  }, 60_000);

  it('un département carroyé est couvert', async () => {
    if (!construit) return;
    // Le contrepoids : sans lui, une fonction qui répondrait TOUJOURS
    // « non couvert » passerait les tests précédents.
    const c = await couverture('69');
    expect(c.territoire_couvert).toBe(true);
    expect(c.n_sites).toBeGreaterThan(0);
  }, 60_000);

  it('sans département, la couverture ne dit rien d un territoire', async () => {
    const c = await couverture(null);
    // `n_sites` vaut 0 faute de territoire à compter — et surtout PAS le total
    // national, qui se lirait comme le compte du territoire demandé.
    expect(c.n_sites).toBe(0);
    expect(c.n_seveso).toBe(0);
  }, 60_000);
});

describe('un jeu de zones ne se construit pas sur un territoire sans carreau', () => {
  it('refuse explicitement, plutôt que d enregistrer un jeu vide', async () => {
    const { data: modele, error: erreurModele } = await sb
      .from('zone_sets')
      .select('org_id, created_by, profil, cible, gravites, natures, modes, mode_plan, seuil_couverture_cp, poids')
      .limit(1)
      .maybeSingle();
    if (erreurModele) throw new Error(`modèle : ${erreurModele.message}`);
    if (!modele) return; // aucun jeu en base : rien à cloner, rien à prouver

    const { data: cree, error: erreurCreation } = await sb
      .from('zone_sets')
      .insert({
        ...modele,
        nom: '[TEST] territoire non carroyé',
        version: 999,
        territoire: '971',
        profil_hash: `test_non_carroye_${Date.now()}`,
        brouillon: true,
      })
      .select('id')
      .single();
    if (erreurCreation || !cree) throw new Error(`fixture : ${erreurCreation?.message}`);

    try {
      const { data, error } = await sb.rpc('construire_zone_set', {
        p_zone_set_id: cree.id,
      });
      if (error) throw new Error(`construire_zone_set : ${error.message}`);
      const r = data as unknown as { ok: boolean; error?: string };

      /*
       * ⚠ `ok: false` et NON un jeu vide. Avant ce correctif, la fonction
       * rendait `ok: true` avec zéro classe et zéro code postal — un jeu
       * enregistrable, rattachable à une campagne comme plan, et qui ne
       * diffusait alors nulle part sans que rien le signale.
       */
      expect(r.ok).toBe(false);
      expect(r.error).toBe('territoire_non_carroye');
    } finally {
      // ⚠ L'erreur est LUE : supabase-js ne lève pas, et une fixture qui
      // survit polluerait la bibliothèque de jeux de l'organisation.
      const { error } = await sb.from('zone_sets').delete().eq('id', cree.id);
      if (error) throw new Error(`nettoyage de la fixture : ${error.message}`);
    }
  }, 120_000);
});
