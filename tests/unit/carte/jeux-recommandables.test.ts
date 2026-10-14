import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `jeuxRecommandables` — les jeux COMMUNS qu'un espace peut se voir recommander (spec carte-en-parcours § 7.2) :
 * les référentiels du registre, puis les types de POI du SOCLE. Une catégorie rangée dans un autre jeu
 * (`CATEGORIES_HORS_POI`) ou dont le nom ne donne pas une clé conforme n'est pas proposée (Review Focus 5).
 */

const sourcesDemandees = vi.fn();
let sourcesSocle: string[] = ['s1'];
/** Vrai : la lecture des catégories échoue en cours de route (signalée par `surEchec`, liste partielle rendue). */
let lectureEchoue = false;
const visibles = vi.fn(async (_s: string[] | null, options?: { surEchec?: () => void }): Promise<string[]> => {
  if (lectureEchoue) { options?.surEchec?.(); return ['lycee']; }
  return ['lycee', 'risque_industriel', 'Lycée Pro', 'panneaux'];
});

vi.mock('@/lib/auth/getOrgSourceIds', () => ({
  getOrgSourceIds: async (session: unknown, options: unknown) => {
    sourcesDemandees(session, options);
    return sourcesSocle;
  },
}));
vi.mock('@/lib/poi/categories', () => ({
  getCategoriesVisibles: (s: string[] | null, options?: { surEchec?: () => void }) => visibles(s, options),
}));
vi.mock('@/lib/poi/libelles-categories', async (original) => ({
  ...(await original<typeof import('@/lib/poi/libelles-categories')>()),
  libellesCategories: async () => ({ lycee: 'Lycées' }),
}));

const { jeuxRecommandables, clesPoiInconnues } = await import('@/lib/carte/jeux-recommandables');
const { JEUX_REFERENTIELS } = await import('@/lib/carte/jeux-carte');

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** Client factice : `organizations` rend l'espace (ou rien), `espace_jeux_recommandes` la sélection. */
function client(espace: { id: string } | null) {
  const lues: string[] = [];
  const filtres: [string, string, unknown][] = [];
  const from = (table: string) => {
    lues.push(table);
    const chaine = {
      select() { return chaine; },
      eq(col: string, val: unknown) { filtres.push([table, col, val]); return chaine; },
      maybeSingle: async () => ({ data: espace, error: null }),
      then<T>(ok: (r: { data: unknown[]; error: null }) => T) {
        return Promise.resolve({
          data: [{ cle_jeu: 'poi:lycee' }, { cle_jeu: 'iris:socio-demo' }, { cle_jeu: 'poi:disparue' }],
          error: null,
        }).then(ok);
      },
    };
    return chaine;
  };
  return { sb: { from } as never, lues, filtres };
}

describe('jeuxRecommandables', () => {
  beforeEach(() => { visibles.mockClear(); sourcesDemandees.mockClear(); sourcesSocle = ['s1']; lectureEchoue = false; });

  it('lecture complète : socleIncomplet = false', async () => {
    const { sb } = client({ id: ORG });
    expect((await jeuxRecommandables(sb, ORG))!.socleIncomplet).toBe(false);
  });

  it('lecture des catégories en échec (liste partielle) : socleIncomplet = true, sans passer strict (le cache est gardé)', async () => {
    lectureEchoue = true;
    const { sb } = client({ id: ORG });
    const rep = (await jeuxRecommandables(sb, ORG))!;
    expect(rep.socleIncomplet).toBe(true);
    expect(visibles.mock.calls[0][1]).not.toHaveProperty('strict');
  });

  it('aucune source au socle (lecture des sources en échec) : socleIncomplet = true', async () => {
    sourcesSocle = [];
    const { sb } = client({ id: ORG });
    expect((await jeuxRecommandables(sb, ORG))!.socleIncomplet).toBe(true);
  });

  it('les 10 référentiels dans l ordre du registre, puis les types de POI du socle', async () => {
    const { sb } = client({ id: ORG });
    const rep = await jeuxRecommandables(sb, ORG);
    expect(rep).not.toBeNull();
    const cles = rep!.jeux.map((j) => j.cle);
    expect(cles).toEqual([...JEUX_REFERENTIELS.map((j) => j.cle), 'poi:lycee', 'poi:panneaux']);
    expect(rep!.jeux.find((j) => j.cle === 'poi:lycee')).toMatchObject({ nom: 'Lycées', nature: 'poi', maille: 'point' });
    expect(rep!.jeux.find((j) => j.cle === 'poi:panneaux')?.nom).toBe('Panneaux');
  });

  it('une catégorie rangée ailleurs ou au nom non conforme n est pas proposée', async () => {
    const { sb } = client({ id: ORG });
    const cles = (await jeuxRecommandables(sb, ORG))!.jeux.map((j) => j.cle);
    expect(cles).not.toContain('poi:risque_industriel');
    expect(cles.some((c) => c.includes('Lyc'))).toBe(false);
  });

  it('recommande : vrai pour la sélection, faux ailleurs ; une clé disparue n apparaît pas', async () => {
    const { sb, filtres } = client({ id: ORG });
    const jeux = (await jeuxRecommandables(sb, ORG))!.jeux;
    expect(jeux.filter((j) => j.recommande).map((j) => j.cle).sort()).toEqual(['iris:socio-demo', 'poi:lycee']);
    expect(jeux.some((j) => j.cle === 'poi:disparue')).toBe(false);
    expect(filtres).toContainEqual(['espace_jeux_recommandes', 'organization_id', ORG]);
  });

  it('espace introuvable → null, sans lire les catégories', async () => {
    const { sb, lues } = client(null);
    expect(await jeuxRecommandables(sb, ORG)).toBeNull();
    expect(visibles).not.toHaveBeenCalled();
    expect(lues).toEqual(['organizations']);
  });

  it('les catégories sont celles du SOCLE (getOrgSourceIds sans session, vue espace)', async () => {
    const { sb } = client({ id: ORG });
    await jeuxRecommandables(sb, ORG);
    expect(sourcesDemandees).toHaveBeenCalledWith(null, { vueEspace: true });
    expect(visibles).toHaveBeenCalledWith(['s1'], { surEchec: expect.any(Function) });
  });
});

describe('clesPoiInconnues', () => {
  beforeEach(() => { visibles.mockClear(); sourcesSocle = ['s1']; lectureEchoue = false; });

  it('lecture des catégories en échec : lève au lieu de déclarer les clés inconnues', async () => {
    lectureEchoue = true;
    await expect(clesPoiInconnues(['poi:panneaux'])).rejects.toThrow(/incompl/);
  });

  it('rend les clés poi: hors des types de POI recommandables, dans l ordre', async () => {
    expect(await clesPoiInconnues(['iris:socio-demo', 'poi:lycee', 'poi:bmw', 'poi:disparue']))
      .toEqual(['poi:bmw', 'poi:disparue']);
  });

  it('sans clé poi:, ne lit aucune catégorie', async () => {
    expect(await clesPoiInconnues(['iris:socio-demo', 'ooh:panneaux'])).toEqual([]);
    expect(visibles).not.toHaveBeenCalled();
  });
});
