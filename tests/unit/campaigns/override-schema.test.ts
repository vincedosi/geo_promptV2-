import { describe, it, expect } from 'vitest';
import { StatusOverrideSchema } from '@/app/api/admin/campaigns/[id]/route';

describe('StatusOverrideSchema', () => {
  it('accepte les valeurs autorisées et null', () => {
    for (const v of ['paused', 'ended', 'archived', null]) {
      expect(StatusOverrideSchema.safeParse(v).success).toBe(true);
    }
  });
  it('rejette une valeur inconnue', () => {
    expect(StatusOverrideSchema.safeParse('live').success).toBe(false);
    expect(StatusOverrideSchema.safeParse('en_pause').success).toBe(false);
  });
});
