import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @file tests/unit/campagne/raison-aucune-donnee.test.ts
 *
 * ── Une chaîne de caractères qui traverse quatre fichiers ──────────────────
 *
 * Une campagne créée le matin n'a pas encore diffusé. `calculer_alignement_geo`
 * refuse alors de rendre un score — un 0 la déclarerait catastrophique, un 100
 * parfaite, les deux inventent un verdict là où il n'y a rien à mesurer.
 * `GET /api/campaigns/[id]/alignement` répond donc **404** avec
 * `raison: 'aucune_donnee'`, et TOUT l'intérêt de ce code est qu'il distingue
 * un ÉTAT DU CYCLE DE VIE d'une PANNE : sans lui, l'écran affiche « Cette
 * campagne n'est pas consultable » sur une campagne qui va très bien.
 *
 * Le littéral `'aucune_donnee'` est écrit **cinq fois, dans cinq fichiers**
 * — la RPC, la route, puis trois consommateurs qui le comparent chacun de leur
 * côté. Aucun type ne les relie : renommer le code côté base ou côté route
 * laisserait les trois comparaisons silencieusement fausses, et les trois
 * écrans repasseraient à « panne » sans qu'une seule ligne rougisse.
 *
 * Ce fichier ferme le cas dans les deux sens : un test de COMPORTEMENT sur le
 * cache, qui vérifie que le code remonte bien du corps 404 jusqu'à l'appelant,
 * et un test STRUCTUREL qui vérifie que les cinq écritures du littéral sont
 * toujours les mêmes.
 */

const RACINE = process.cwd();
const CODE = 'aucune_donnee';

// `cache-alignement.ts` émet la requête lui-même (le sémaphore vit DANS la
// fonction qui appelle, pas chez ses appelants) : on remplace `adminFetch`,
// pas la fonction testée.
const adminFetchStub = vi.fn();
vi.mock('@/lib/admin-fetch', () => ({
  adminFetch: (...args: unknown[]) => adminFetchStub(...args),
}));

/** Une `Response` minimale — le module n'utilise que `ok` et `json()`. */
function reponse(ok: boolean, corps: unknown): Response {
  return { ok, json: async () => corps } as unknown as Response;
}

describe('« pas encore de diffusion » remonte comme un ETAT, pas comme une panne', () => {
  let obtenir: (id: string) => Promise<{ data: unknown; erreurMessage: string | null; raison: string | null }>;
  let invalider: (id: string) => void;

  beforeEach(async () => {
    adminFetchStub.mockReset();
    const mod = await import('@/lib/campagne/cache-alignement');
    obtenir = mod.obtenirAlignementPartage;
    invalider = mod.invaliderAlignementPartage;
  });

  afterEach(() => {
    // Le cache est de portée MODULE et survit d'un cas à l'autre.
    for (const id of ['c-vide', 'c-panne', 'c-ok', 'c-illisible']) invalider(id);
  });

  it('un 404 metier rend le CODE, pas seulement une phrase francaise', async () => {
    adminFetchStub.mockResolvedValue(reponse(false, {
      error: 'Cette campagne n’a pas encore de données de diffusion.',
      raison: CODE,
      calculable: false,
    }));
    const r = await obtenir('c-vide');
    expect(r.data).toBeNull();
    expect(r.raison).toBe(CODE);
    // Le message existe aussi, mais l'écran ne doit PAS avoir à comparer des
    // phrases françaises pour savoir s'il regarde un état ou une panne.
    expect(r.erreurMessage).toContain('pas encore');
  });

  it('une vraie panne rend `raison: null` — la distinction tient dans ce champ', async () => {
    adminFetchStub.mockResolvedValue(reponse(false, { error: 'Erreur base de données.' }));
    const r = await obtenir('c-panne');
    expect(r.raison).toBeNull();
    expect(r.erreurMessage).toBe('Erreur base de données.');
  });

  it('un corps illisible ne fait pas lever, et ne fabrique pas de raison', async () => {
    adminFetchStub.mockResolvedValue({
      ok: false,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    } as unknown as Response);
    const r = await obtenir('c-illisible');
    expect(r.raison).toBeNull();
    expect(r.erreurMessage).toBe('Erreur base de données.');
  });

  it('un succes ne porte aucune raison', async () => {
    adminFetchStub.mockResolvedValue(reponse(true, { score: 93, n_cp: 2041 }));
    const r = await obtenir('c-ok');
    expect(r.raison).toBeNull();
    expect(r.erreurMessage).toBeNull();
    expect(r.data).toEqual({ score: 93, n_cp: 2041 });
  });

  it('un echec metier n est pas garde en cache — la campagne redevient consultable des qu elle diffuse', async () => {
    adminFetchStub.mockResolvedValue(reponse(false, { error: 'pas de données', raison: CODE }));
    await obtenir('c-vide');
    adminFetchStub.mockResolvedValue(reponse(true, { score: 40 }));
    const second = await obtenir('c-vide');
    expect(second.data).toEqual({ score: 40 });
    expect(adminFetchStub).toHaveBeenCalledTimes(2);
  });
});

describe('le littéral « aucune_donnee » est le meme partout', () => {
  /**
   * Cinq fichiers écrivent ce code, et rien dans le typage ne les relie. Un
   * renommage côté RPC ou côté route laisserait les trois comparaisons du
   * client silencieusement fausses : les écrans repasseraient à « panne » sur
   * une campagne parfaitement saine, sans erreur, sans log.
   *
   * On ne peut pas leur donner une constante partagée sans faire importer du
   * TypeScript à une migration SQL. On vérifie donc la seule chose
   * vérifiable : que les cinq écritures coïncident.
   */
  const ECRITURES: Array<[string, string]> = [
    ['sql/172_alignement_cas_degenere.sql', 'la RPC, qui EMET le code'],
    ['app/api/campaigns/[campaignId]/alignement/route.ts', 'la route, qui le relaie en 404'],
    ['lib/campagne/cache-alignement.ts', 'le cache partagé, qui l’extrait du corps'],
    ['components/campagne/BarreContexteCampagne.tsx', 'la barre de contexte de la carte'],
    ['components/campagne/suivi-v2/SuiviV2.tsx', 'l’écran de suivi'],
    ['app/map/_components/DiffusionMapLayer.tsx', 'la couche Diffusion de la carte'],
  ];

  it.each(ECRITURES)('%s contient le code, inchangé (%s)', (chemin) => {
    const source = readFileSync(join(RACINE, chemin), 'utf8');
    expect(
      source.includes(CODE),
      `« ${CODE} » n'apparaît plus dans ${chemin}. Si le code métier a été renommé, il doit `
      + `l'être dans les SIX fichiers du même commit : la RPC l'émet, la route le relaie, le `
      + `cache l'extrait, et trois écrans le comparent. Un seul oubli fait retomber « pas `
      + `encore de diffusion » dans « cette campagne n'est pas consultable ».`,
    ).toBe(true);
  });
});
