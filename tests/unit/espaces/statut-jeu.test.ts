import { describe, it, expect } from 'vitest';
import { statutPourEspace } from '@/lib/espaces/donnees-espace';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('statutPourEspace (spec § 4.4)', () => {
  it('privé de cet espace → propriétaire', () => {
    expect(statutPourEspace({ visibilite: 'privee', organization_id: A, shared_with: [] }, A)).toBe('proprietaire');
  });
  it('privé d\'un autre, partagé avec celui-ci → partagé', () => {
    expect(statutPourEspace({ visibilite: 'privee', organization_id: B, shared_with: [A] }, A)).toBe('partage');
  });
  it('privé d\'un autre, non partagé → non visible', () => {
    expect(statutPourEspace({ visibilite: 'privee', organization_id: B, shared_with: [] }, A)).toBe('non_visible');
  });
  it('socle → socle, même pour son propriétaire (le socle prime : on le règle dans la fiche Socle)', () => {
    expect(statutPourEspace({ visibilite: 'socle', organization_id: A, shared_with: [] }, A)).toBe('socle');
    expect(statutPourEspace({ visibilite: 'socle', organization_id: B, shared_with: [] }, A)).toBe('socle');
  });
  it('privé sans propriétaire → non visible (fermé par défaut)', () => {
    expect(statutPourEspace({ visibilite: 'privee', organization_id: null, shared_with: [] }, A)).toBe('non_visible');
  });
});
