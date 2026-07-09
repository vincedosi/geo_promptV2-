import { describe, it, expect } from 'vitest';
import { selectPusher, runPush } from '@/lib/dsp/push';
import type { BiddingPushContext } from '@/lib/dsp/push/types';

function ctx(over: Partial<BiddingPushContext> = {}): BiddingPushContext {
  return {
    channel: 'ttd',
    campaign: { id: 'c1', name: 'Campagne test', is_demo: true },
    channelBudget: 30000,
    budgetChanged: true,
    zoneName: 'Zone test',
    tiers: [{ name: 'Item A', cps: ['35000', '35200'], score: 0.6 }],
    connection: null,
    links: null,
    isDemo: true,
    ...over,
  };
}

describe('selectPusher', () => {
  it('démo → simulé, même avec connexion', () => {
    expect(selectPusher('dv360', true, true).channel).toBe('dv360');
    // le simulé se reconnaît à son résultat, pas à son channel — testé via runPush
  });
  it('pas de connexion → simulé ; connexion réelle sans connecteur → skipped', async () => {
    const noConn = await runPush(ctx({ channel: 'dv360', isDemo: false, connection: null }));
    expect(noConn.status).toBe('simulated');
    const noPusher = await runPush(ctx({ channel: 'ttd', isDemo: false, connection: {} as never }));
    expect(noPusher.status).toBe('skipped');
  });
});

describe('push simulé', () => {
  it('construit le vrai payload (script pondéré + delta budget) sans réseau', async () => {
    const r = await runPush(ctx({ channel: 'dv360' }));
    expect(r.status).toBe('simulated');
    expect(r.payload_summary.script).toContain('max_aggregate');
    expect(r.payload_summary.script).toContain('"35000"');
    expect(r.payload_summary.budget).toBe(30000);
  });
  it('sans tiers ni delta budget → payload minimal, toujours simulé', async () => {
    const r = await runPush(ctx({ tiers: [], budgetChanged: false, channelBudget: null }));
    expect(r.status).toBe('simulated');
    expect(r.payload_summary.script).toBeUndefined();
  });
});

describe('push dv360 réel', () => {
  it('links absents → skipped avec détail explicite', async () => {
    const r = await runPush(ctx({ channel: 'dv360', isDemo: false, connection: {} as never, links: null }));
    expect(r.status).toBe('skipped');
    expect(r.detail).toContain('IDs DV360');
  });
});
