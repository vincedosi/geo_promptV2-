import { describe, it, expect, vi, beforeEach } from 'vitest';

const sourcesRendues = vi.fn<() => Promise<string[]>>();
const jeuxLus = vi.fn();
const categories = vi.fn(async (..._a: unknown[]) => ['cat']);

// La règle `getOrgSourceIds` ferme par défaut : une lecture en échec rend [].
vi.mock('@/lib/auth/getOrgSourceIds', () => ({ getOrgSourceIds: () => sourcesRendues() }));
vi.mock('@/lib/poi/categories', () => ({ getCategoriesVisibles: (...a: unknown[]) => categories(...a) }));
vi.mock('@/lib/espaces/donnees-espace', () => ({
  lireJeux: () => jeuxLus(),
  sansCles: (j: unknown) => j,
  statutPourEspace: () => 'socle',
}));

import { apercuEspace } from '@/lib/espaces/apercu-espace';

const sb = { from: () => ({ select: () => ({ eq: async () => ({ count: 3, error: null }) }) }) } as never;
const jeuSocle = { id: 's1', visibilite: 'socle', organization_id: null, shared_with: [] };

beforeEach(() => { vi.clearAllMocks(); categories.mockResolvedValue(['cat']); });

describe('apercuEspace : lecture des sources en échec', () => {
  it('lève plutôt que de répondre des listes vides quand le socle existe', async () => {
    sourcesRendues.mockResolvedValue([]);
    jeuxLus.mockResolvedValue([jeuSocle]);
    await expect(apercuEspace(sb, 'org')).rejects.toThrow(/aucune source rendue/);
  });

  it('ne lève pas quand des sources sont rendues, et demande les catégories en mode strict', async () => {
    sourcesRendues.mockResolvedValue(['s1']);
    jeuxLus.mockResolvedValue([jeuSocle]);
    const r = await apercuEspace(sb, 'org');
    expect(r.jeux.socle).toHaveLength(1);
    expect(r.nb_campagnes).toBe(3);
    expect(categories).toHaveBeenCalledWith(['s1'], { strict: true });
  });

  it('ne lève pas quand il n\'y a ni socle ni source', async () => {
    sourcesRendues.mockResolvedValue([]);
    jeuxLus.mockResolvedValue([]);
    const r = await apercuEspace(sb, 'org');
    expect(r.jeux).toEqual({ socle: [], proprietaire: [], partage: [] });
  });
});
