import { describe, it, expect } from 'vitest';
import {
  actorKindLabel, actorDisplayName, parseActorsParam, actorsKey, isAllActors,
} from '@/lib/campaigns/actor-metrics';

describe('actor-metrics', () => {
  it('label du kind en sentence case', () => {
    expect(actorKindLabel('dsp')).toBe('DSP');
    expect(actorKindLabel('social')).toBe('Social');
    expect(actorKindLabel('régie')).toBe('Régie');
  });
  it('nom affiché : fallback pour acteur vide', () => {
    expect(actorDisplayName('dv360')).toBe('dv360');
    expect(actorDisplayName('')).toBe('Non attribué');
    expect(actorDisplayName('   ')).toBe('Non attribué');
  });

  it('parseActorsParam : absent ou vide ⇒ null (jamais [])', () => {
    // Invariant critique : les RPC lisent [] comme « aucun acteur » (payload vide).
    expect(parseActorsParam(new URLSearchParams(''))).toBeNull();
    expect(parseActorsParam(new URLSearchParams('actors='))).toBeNull();
    expect(parseActorsParam(new URLSearchParams('actors=%20'))).toBeNull();
    expect(parseActorsParam(new URLSearchParams('actors=,%20,'))).toBeNull();
  });
  it('parseActorsParam : liste nettoyée (trim + blancs filtrés)', () => {
    expect(parseActorsParam(new URLSearchParams('actors=dv360,tiktok'))).toEqual(['dv360', 'tiktok']);
    expect(parseActorsParam(new URLSearchParams('actors=dv360, ,tiktok'))).toEqual(['dv360', 'tiktok']);
  });

  it('actorsKey : stable quel que soit l’ordre', () => {
    expect(actorsKey(['b', 'a'])).toBe(actorsKey(['a', 'b']));
    expect(actorsKey([])).toBe('');
  });

  it('isAllActors : [] ou liste complète ⇒ tous', () => {
    expect(isAllActors([], 5)).toBe(true);
    expect(isAllActors(['a', 'b', 'c', 'd', 'e'], 5)).toBe(true);
    expect(isAllActors(['a'], 5)).toBe(false);
  });
});
