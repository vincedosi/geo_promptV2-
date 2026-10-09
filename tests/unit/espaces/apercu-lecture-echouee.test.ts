import { describe, it, expect, vi } from 'vitest';

// La règle `getOrgSourceIds` ferme par défaut : une lecture en échec rend [].
vi.mock('@/lib/auth/getOrgSourceIds', () => ({ getOrgSourceIds: vi.fn(async () => []) }));
vi.mock('@/lib/poi/categories', () => ({ getCategoriesVisibles: vi.fn(async () => []) }));
vi.mock('@/lib/espaces/donnees-espace', () => ({
  lireJeux: vi.fn(async () => [{ id: 's1', visibilite: 'socle', organization_id: null, shared_with: [] }]),
  sansCles: (j: unknown) => j,
  statutPourEspace: () => 'socle',
}));

import { apercuEspace } from '@/lib/espaces/apercu-espace';

describe('apercuEspace : lecture des sources en échec', () => {
  it('lève plutôt que de répondre des listes vides quand le socle existe', async () => {
    await expect(apercuEspace({} as never, 'org')).rejects.toThrow(/aucune source rendue/);
  });
});
