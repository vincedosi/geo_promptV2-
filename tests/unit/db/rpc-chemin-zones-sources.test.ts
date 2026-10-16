import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Les RPC du chemin des zones ont une SOURCE versionnée (spec carte-en-parcours § 16.6). Jusqu'au 2026-10-14, huit
 * n'existaient que dans la base locale et son dump : un `docker volume rm` les effaçait sans recours.
 */
const RAPATRIEES = [
  'get_carreaux_capture_geometry', 'get_carreaux_by_zoom', 'get_admin_filter_geometry', 'get_iris_selection_geometry',
  'resolve_custom_geo_zone_codes', 'resolve_custom_geo_zone_codes_with_subzones', 'transform_geometries_for_save',
  'compute_zone_audience_stats',
];

const sources = readdirSync('sql').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`sql/${f}`, 'utf8')).join('\n');

describe('RPC du chemin des zones : une source dans sql/', () => {
  it.each(RAPATRIEES)('%s', (nom) => {
    expect(sources).toMatch(new RegExp(`create or replace function public\\.${nom}\\s*\\(`, 'i'));
  });
  it('les deux surcharges de resolve_custom_geo_zone_codes', () => {
    const n = sources.match(/create or replace function public\.resolve_custom_geo_zone_codes\s*\(/gi)?.length ?? 0;
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
