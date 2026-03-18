import { describe, it, expect } from 'vitest';
import { stripHeavyFields, trimHistory } from '@/lib/chat/trim-history';

// ─── stripHeavyFields ─────────────────────────────────────────────────────────

describe('stripHeavyFields', () => {
  it('retourne les primitives telles quelles', () => {
    expect(stripHeavyFields(null)).toBeNull();
    expect(stripHeavyFields('texte')).toBe('texte');
    expect(stripHeavyFields(42)).toBe(42);
  });

  it('strip pois[] et garde nb_pois', () => {
    const input = { zone: 'Paris', pois: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const result = stripHeavyFields(input) as any;
    expect(result.pois).toEqual([]);
    expect(result.nb_pois).toBe(3);
    expect(result._stripped).toBe(true);
    expect(result.zone).toBe('Paris');
  });

  it('strip isochroneGeoJSON et garde nb_features', () => {
    const input = {
      isochroneGeoJSON: { type: 'FeatureCollection', features: [1, 2, 3, 4, 5] },
    };
    const result = stripHeavyFields(input) as any;
    expect(result.isochroneGeoJSON._stripped).toBe(true);
    expect(result.isochroneGeoJSON.nb_features).toBe(5);
    expect(result.isochroneGeoJSON.features).toBeUndefined();
  });

  it('strip voronoiGeoJSON.features et garde nb_features', () => {
    const input = {
      voronoiGeoJSON: { type: 'FeatureCollection', features: [{}, {}], crs: 'WGS84' },
    };
    const result = stripHeavyFields(input) as any;
    expect(result.voronoiGeoJSON.features).toEqual([]);
    expect(result.voronoiGeoJSON.nb_features).toBe(2);
    expect(result.voronoiGeoJSON.crs).toBe('WGS84'); // autres champs préservés
    expect(result.voronoiGeoJSON._stripped).toBe(true);
  });

  it('strip poisForMap.pois et garde nb_pois', () => {
    const input = {
      poisForMap: { pois: [{ id: 'a' }, { id: 'b' }], categorie: 'cirfa' },
    };
    const result = stripHeavyFields(input) as any;
    expect(result.poisForMap.pois).toEqual([]);
    expect(result.poisForMap.nb_pois).toBe(2);
    expect(result.poisForMap.categorie).toBe('cirfa');
  });

  it('strip features[] de bataille si geometry présente', () => {
    const input = {
      features: [
        { geometry: { type: 'Polygon', coordinates: [] }, properties: { mode: 'drive' } },
        { geometry: { type: 'Polygon', coordinates: [] }, properties: { mode: 'walk' } },
      ],
    };
    const result = stripHeavyFields(input) as any;
    expect(result.features).toEqual([]);
    expect(result.nb_features).toBe(2);
    expect(result._stripped).toBe(true);
  });

  it('ne strip PAS features[] si pas de geometry (liste POI simple)', () => {
    const input = { features: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] };
    const result = stripHeavyFields(input) as any;
    expect(result.features).toHaveLength(2); // préservé
    expect(result._stripped).toBeUndefined();
  });

  it('strip plusieurs champs en cascade', () => {
    const input = {
      pois: [{ id: 1 }, { id: 2 }],
      isochroneGeoJSON: { features: [{}] },
      meta: 'Brest',
    };
    const result = stripHeavyFields(input) as any;
    expect(result.pois).toEqual([]);
    expect(result.isochroneGeoJSON._stripped).toBe(true);
    expect(result.meta).toBe('Brest');
  });
});

// ─── trimHistory ──────────────────────────────────────────────────────────────

const makeMsg = (role: string, text: string) => ({
  role,
  parts: [{ type: 'text', text }],
});

const makeToolResult = (result: object) => ({
  role: 'tool',
  parts: [{ type: 'tool-result', result }],
});

describe('trimHistory', () => {
  it('retourne [] pour un historique vide', () => {
    expect(trimHistory([])).toEqual([]);
  });

  it('garde tout si moins de 14 messages', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => makeMsg('user', `msg ${i}`));
    expect(trimHistory(msgs)).toHaveLength(10);
  });

  it('tronque à 14 messages si historique plus long', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => makeMsg('user', `msg ${i}`));
    const result = trimHistory(msgs);
    expect(result).toHaveLength(14);
    // garde les 14 derniers
    expect((result[0] as any).parts[0].text).toBe('msg 6');
    expect((result[13] as any).parts[0].text).toBe('msg 19');
  });

  it('préserve intacts les 4 derniers messages', () => {
    const heavyResult = { pois: [{ id: 1 }, { id: 2 }] };
    // 14 messages total → seuil keep_intact = idx >= 14-4 = 10
    // heavy à idx 9  → 9 >= 10 ? NON  → strippé ✓
    // heavy à idx 12 → 12 >= 10 ? OUI → intact  ✓
    const msgs = [
      ...Array.from({ length: 9 }, (_, i) => makeMsg('user', `msg ${i}`)),
      makeToolResult(heavyResult), // idx 9  → strippé
      makeMsg('user', 'récent 1'), // idx 10 → intact
      makeMsg('user', 'récent 2'), // idx 11 → intact
      makeToolResult(heavyResult), // idx 12 → intact
      makeMsg('user', 'récent 3'), // idx 13 → intact
    ];
    const result = trimHistory(msgs) as any[];
    // idx 9 → strippé
    const oldToolMsg = result[9];
    expect(oldToolMsg.parts[0].result.pois).toEqual([]);
    expect(oldToolMsg.parts[0].result.nb_pois).toBe(2);
    // idx 12 → intact
    const recentToolMsg = result[12];
    expect(recentToolMsg.parts[0].result.pois).toHaveLength(2);
  });

  it('ne modifie pas les messages texte ordinaires', () => {
    const msgs = Array.from({ length: 14 }, (_, i) => makeMsg('user', `msg ${i}`));
    const result = trimHistory(msgs) as any[];
    result.forEach((msg, i) => {
      expect(msg.parts[0].text).toBe(`msg ${i}`);
    });
  });

  it('gère les messages sans parts (format content)', () => {
    const msg = { role: 'user', content: 'bonjour' };
    const result = trimHistory([msg]) as any[];
    expect(result[0].content).toBe('bonjour');
  });
});
