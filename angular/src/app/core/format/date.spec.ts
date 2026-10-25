import { dateHeureFr } from './date';

describe('dateHeureFr', () => {
  it('jour et heure en français, « — » sur une date illisible', () => {
    const iso = '2026-10-25T14:05:00Z';
    expect(dateHeureFr('pas une date')).toBe('—');
    expect(dateHeureFr(iso)).toBe(new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }));
  });
});
