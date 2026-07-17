import { describe, it, expect } from 'vitest';
import { serializeDraft, deserializeDraft } from '@/components/campaign/wizard/useDraftAutosave';
import { DEFAULT_PROG_DRAFT } from '@/components/campaign/wizard/steps/types';

describe('serializeDraft/deserializeDraft', () => {
  it('aller-retour sans perte', () => {
    const d = { ...DEFAULT_PROG_DRAFT, name: 'X', pressure: 2.4, channelLinks: { dv360: { advertiser_id: '1' } } };
    expect(deserializeDraft(serializeDraft(d))).toEqual(d);
  });
  it('données inconnues/corrompues → null (on repart du défaut)', () => {
    expect(deserializeDraft({ foo: 'bar' })).toBeNull();
    expect(deserializeDraft(null)).toBeNull();
    expect(deserializeDraft({ v: 2, draft: {} })).toBeNull();
  });
  it('champs ajoutés depuis la sauvegarde → défaut conservé', () => {
    const saved = serializeDraft({ ...DEFAULT_PROG_DRAFT, name: 'Y' });
    delete (saved.draft as Record<string, unknown>).diffusion;
    const parsed = deserializeDraft(saved);
    expect(parsed?.name).toBe('Y');
    expect(parsed?.diffusion).toBe(DEFAULT_PROG_DRAFT.diffusion);
  });
});
