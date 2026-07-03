import { describe, it, expect } from 'vitest';
import { stripHeavyFields, trimHistory } from '@/lib/chat/trim-history';

// ─── stripHeavyFields ─────────────────────────────────────────────────────────

describe('stripHeavyFields', () => {
  it('retourne les primitives telles quelles', () => {
    expect(stripHeavyFields(null)).toBeNull();
    expect(stripHeavyFields('texte')).toBe('texte');
    expect(stripHeavyFields(42)).toBe(42);
  });

  it('strip pois[] (> 5) en résumé nb_resultats + categories', () => {
    const input = {
      zone: 'Paris',
      pois: [
        { id: 1, categorie: 'ecole' }, { id: 2, categorie: 'ecole' },
        { id: 3, categorie: 'gare' }, { id: 4, categorie: 'gare' },
        { id: 5, categorie: 'mairie' }, { id: 6, categorie: 'mairie' },
      ],
    };
    const result = stripHeavyFields(input) as any;
    expect(result.pois).toBeUndefined();          // le tableau lourd est retiré
    expect(result.nb_resultats).toBe(6);
    expect(result.categories).toEqual(['ecole', 'gare', 'mairie']);
    expect(result._stripped).toBe(true);
    expect(result.zone).toBe('Paris');
  });

  it('ne strip PAS pois[] si <= 5 éléments (déjà léger)', () => {
    const input = { zone: 'Brest', pois: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const result = stripHeavyFields(input) as any;
    expect(result.pois).toHaveLength(3);          // préservé
    expect(result._stripped).toBeUndefined();
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
      pois: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }],
      isochroneGeoJSON: { features: [{}] },
      meta: 'Brest',
    };
    const result = stripHeavyFields(input) as any;
    expect(result.pois).toBeUndefined();
    expect(result.nb_resultats).toBe(6);
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

  it('garde tout si <= 10 messages', () => {
    const msgs = Array.from({ length: 8 }, (_, i) => makeMsg('user', `msg ${i}`));
    expect(trimHistory(msgs)).toHaveLength(8);
  });

  it('tronque à 10 messages si historique plus long', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => makeMsg('user', `msg ${i}`));
    const result = trimHistory(msgs);
    expect(result).toHaveLength(10);
    // garde les 10 derniers (msg 10 → msg 19)
    expect((result[0] as any).parts[0].text).toBe('msg 10');
    expect((result[9] as any).parts[0].text).toBe('msg 19');
  });

  it('strip les tool results anciens, préserve intact le tout dernier message', () => {
    // MAX_MESSAGES=10, KEEP_INTACT=1 → seul idx 9 (dernier) est préservé intact.
    const heavy = { pois: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }] };
    const msgs = [
      makeToolResult(heavy),            // idx 0 → ancien → strippé
      ...Array.from({ length: 8 }, (_, i) => makeMsg('user', `msg ${i}`)),
      makeToolResult(heavy),            // idx 9 → dernier → intact
    ];
    const result = trimHistory(msgs) as any[];
    // idx 0 → strippé (pois retiré, résumé nb_resultats)
    expect(result[0].parts[0].result.pois).toBeUndefined();
    expect(result[0].parts[0].result.nb_resultats).toBe(6);
    // idx 9 → intact (dernier message préservé)
    expect(result[9].parts[0].result.pois).toHaveLength(6);
  });

  it('ne modifie pas les messages texte ordinaires', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => makeMsg('user', `msg ${i}`));
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
