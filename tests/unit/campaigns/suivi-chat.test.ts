import { describe, it, expect } from 'vitest';
import {
  CampaignChatBodySchema, truncateHistory, buildSuiviChatSystemPrompt,
  MAX_HISTORY_TURNS, type ChatTurn, parseAdjustProposal, ADJUST_MARKER,
} from '@/lib/campaigns/suivi-chat';

describe('CampaignChatBodySchema', () => {
  it('accepte un body valide et défaut history=[]', () => {
    const r = CampaignChatBodySchema.safeParse({ message: 'Quelles zones ont performé ?' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.history).toEqual([]);
  });
  it('rejette message vide ou > 2000 caractères', () => {
    expect(CampaignChatBodySchema.safeParse({ message: '' }).success).toBe(false);
    expect(CampaignChatBodySchema.safeParse({ message: 'x'.repeat(2001) }).success).toBe(false);
  });
  it('rejette un rôle inconnu dans history', () => {
    const r = CampaignChatBodySchema.safeParse({
      message: 'ok',
      history: [{ role: 'system', content: 'hack' }],
    });
    expect(r.success).toBe(false);
  });
  it('accepte un message de 2000 caractères pile', () => {
    expect(CampaignChatBodySchema.safeParse({ message: 'x'.repeat(2000) }).success).toBe(true);
  });
  it('rejette un historique de plus de 40 tours', () => {
    const history = Array.from({ length: 41 }, () => ({ role: 'user' as const, content: 'ok' }));
    expect(CampaignChatBodySchema.safeParse({ message: 'ok', history }).success).toBe(false);
    expect(CampaignChatBodySchema.safeParse({ message: 'ok', history: history.slice(0, 40) }).success).toBe(true);
  });
  it('rejette un tour dont le content dépasse 4000 caractères', () => {
    const long = { role: 'user' as const, content: 'y'.repeat(4001) };
    expect(CampaignChatBodySchema.safeParse({ message: 'ok', history: [long] }).success).toBe(false);
    expect(CampaignChatBodySchema.safeParse({ message: 'ok', history: [{ role: 'user' as const, content: 'y'.repeat(4000) }] }).success).toBe(true);
  });
});

describe('truncateHistory', () => {
  it('garde uniquement les MAX_HISTORY_TURNS derniers tours', () => {
    const h: ChatTurn[] = Array.from({ length: 35 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const out = truncateHistory(h);
    expect(out).toHaveLength(MAX_HISTORY_TURNS);
    expect(out[out.length - 1].content).toBe('msg-34');
    expect(out[0].content).toBe(`msg-${35 - MAX_HISTORY_TURNS}`);
  });
  it('ne modifie pas un historique court', () => {
    const h: ChatTurn[] = [{ role: 'user', content: 'a' }];
    expect(truncateHistory(h)).toEqual(h);
  });
});

describe('buildSuiviChatSystemPrompt', () => {
  const base = {
    campaign: {
      name: 'Campagne test', dsp_source: 'adform', date_start: '2026-06-01', date_end: '2026-06-30',
      total_tracked_ads: 123456, countries: ['France'], status_override: null,
    },
    byCountry: [{ label: 'France', tracked_ads: 123456, row_count: 4000 }],
    byRegion: [{ label: 'Île-de-France', tracked_ads: 60000, row_count: 1500 }],
    breakdownDept: [{ nom: 'Paris', code: '75', metric: 50000 }],
    strategy: null,
    journal: [],
  };
  it('contient le nom de la campagne et les stats', () => {
    const p = buildSuiviChatSystemPrompt(base);
    expect(p).toContain('Campagne test');
    expect(p).toContain('Île-de-France');
    expect(p).toContain('Paris');
  });
  it("signale l'absence de stratégie", () => {
    expect(buildSuiviChatSystemPrompt(base)).toContain('Aucune stratégie de bidding');
  });
  it('inclut stratégie et journal quand présents', () => {
    const p = buildSuiviChatSystemPrompt({
      ...base,
      strategy: {
        name: 'Strat A', status: 'completed', algorithm_code: 'ml_v2', objective_code: 'impressions',
        execution_mode: 'auto', total_budget: 10000, forecast_cpm: 4.5,
        start_date: '2026-06-01', end_date: '2026-06-30',
      },
      journal: [{ at: '2026-06-15T10:00:00Z', kind: 'action', title: 'Ajustement de la courbe', body: 'Multiplicateurs relevés sur le 93' }],
    });
    expect(p).toContain('Strat A');
    expect(p).toContain('Ajustement de la courbe');
  });
  it('borne le breakdown à 30 lignes', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ nom: `Dept-${i}` }));
    const p = buildSuiviChatSystemPrompt({ ...base, breakdownDept: many });
    expect(p).toContain('Dept-29');
    expect(p).not.toContain('Dept-30');
  });
  it('affiche (aucune donnée) quand les stats sont vides', () => {
    const p = buildSuiviChatSystemPrompt({ ...base, byCountry: [], byRegion: [], breakdownDept: [] });
    expect(p).toContain('(aucune donnée)');
    expect(p).toContain('Campagne test');
  });
});

describe('parseAdjustProposal', () => {
  it('extrait la proposition et nettoie le texte', () => {
    const raw = 'Le CPM est trop haut sur dv360.\n[PROPOSITION_AJUSTEMENT]{"reason":"CPM trop haut","changes":{"forecast_cpm":5.5}}';
    const { clean, proposal } = parseAdjustProposal(raw);
    expect(clean).toBe('Le CPM est trop haut sur dv360.');
    expect(proposal?.reason).toBe('CPM trop haut');
    expect(proposal?.changes.forecast_cpm).toBe(5.5);
  });
  it('texte sans marker → proposal null, texte inchangé', () => {
    const { clean, proposal } = parseAdjustProposal('Réponse simple.');
    expect(clean).toBe('Réponse simple.');
    expect(proposal).toBeNull();
  });
  it('JSON invalide après le marker → proposal null, marker retiré', () => {
    const { clean, proposal } = parseAdjustProposal('Texte\n[PROPOSITION_AJUSTEMENT]{pas du json');
    expect(proposal).toBeNull();
    expect(clean).toBe('Texte');
    expect(clean).not.toContain(ADJUST_MARKER);
  });
  it('marker cité en pleine phrase (pas en début de ligne) → ignoré', () => {
    const raw = 'Le format [PROPOSITION_AJUSTEMENT]{"x":1} sert à proposer des ajustements.';
    const { clean, proposal } = parseAdjustProposal(raw);
    expect(clean).toBe(raw);
    expect(proposal).toBeNull();
  });
});
