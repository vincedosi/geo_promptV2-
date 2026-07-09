import { describe, it, expect } from 'vitest';
// AdjustSchema vit dans lib/campaigns/adjust-schema.ts (pas dans la route) :
// Next.js App Router n'autorise que des exports connus (GET/POST/dynamic/…)
// sur un fichier route.ts, `export const AdjustSchema` y casse `tsc --noEmit`
// (route module contract). La route importe ce même schéma — ce test couvre
// donc exactement ce qui est utilisé en production.
import { AdjustSchema } from '@/lib/campaigns/adjust-schema';

describe('AdjustSchema', () => {
  it('accepte un ajustement links-only (changes vide, links renseigné)', () => {
    const res = AdjustSchema.safeParse({
      reason: 'Ajout des IDs DV360',
      changes: {},
      links: { dv360: { advertiser_id: '123' } },
    });
    expect(res.success).toBe(true);
  });

  it('refuse quand ni changes ni links ne sont renseignés', () => {
    const res = AdjustSchema.safeParse({
      reason: 'x y z',
      changes: {},
    });
    expect(res.success).toBe(false);
  });

  it('refuse une raison trop courte même avec un changement valide', () => {
    const res = AdjustSchema.safeParse({
      reason: 'ab',
      changes: { forecast_cpm: 5 },
    });
    expect(res.success).toBe(false);
  });

  it('refuse un budget de canal négatif', () => {
    const res = AdjustSchema.safeParse({
      reason: 'Réallocation budget',
      changes: { channel_budgets: { dv360: -100 } },
    });
    expect(res.success).toBe(false);
  });

  it('accepte un changement de budgets valide', () => {
    const res = AdjustSchema.safeParse({
      reason: 'Réallocation',
      changes: { channel_budgets: { dv360: 1000 } },
    });
    expect(res.success).toBe(true);
  });
});
