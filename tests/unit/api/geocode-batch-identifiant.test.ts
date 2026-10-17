/**
 * `POST /api/admin/geocode/batch` — l'identifiant de session de géocodage qu'elle rend doit être accepté par les
 * routes qui le relisent.
 *
 * Jusqu'au 2026-10-17, la route posait `geocodeId = randomUUID().slice(0, 12)`. Or `geocode/update`,
 * `import-poi/dry-run` et `import-poi/execute` résolvent ce fichier par `resolveSafeJsonPath`, qui exige un UUID
 * COMPLET (garde contre la traversée de chemin, e1b132cb) : elles répondaient « geocodeId invalide » à la session
 * que la route venait de créer. L'import POI par adresse ne pouvait pas aller au bout — constaté en preuve
 * navigateur (lot 6, T13), dans l'écran React comme dans l'écran Angular.
 *
 * Ce test passe par la MÊME validation que les trois routes consommatrices (`isValidUuid`, `resolveSafeJsonPath`
 * de `lib/api/safe-path.ts`), pas par une seconde règle écrite à la main.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isValidUuid, resolveSafeJsonPath } from '@/lib/api/safe-path';

vi.mock('@/lib/api/middleware', () => ({
  requireAdmin: async () => ({ id: 'u', organization_id: 'o', role: 'super_admin' }),
  adminUnauthorized: () => new Response(null, { status: 401 }),
}));
// Ni lecture de fichier réelle, ni appel à la BAN (service externe).
vi.mock('@/lib/import/file-parser', () => ({
  parseFile: async () => ({ rows: [{ adresse: 'Place Bellecour', code_postal: '69002', ville: 'Lyon' }] }),
}));
vi.mock('@/lib/import/geocoder', () => ({
  geocodeBatchDetailed: async () => [{
    rowIndex: 0, inputAddress: 'Place Bellecour 69002 Lyon', lat: 45.7576, lng: 4.8317, score: 0.97,
    resultLabel: 'Place Bellecour 69002 Lyon', resultType: 'street', resultCity: 'Lyon', resultPostcode: '69002',
    status: 'green', manualOverride: false,
  }],
}));

const TEMP_DIR = path.join(os.tmpdir(), 'genesis-import');
const GEOCODE_DIR = path.join(os.tmpdir(), 'genesis-geocode');
const aNettoyer: string[] = [];

afterEach(() => {
  for (const f of aNettoyer.splice(0)) fs.rmSync(f, { force: true });
});

describe('POST /api/admin/geocode/batch — identifiant de session', () => {
  it('rend un `geocodeId` UUID complet, que `resolveSafeJsonPath` (update, dry-run, execute) accepte et qui désigne le fichier écrit', async () => {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const fileId = randomUUID();
    const fichier = path.join(TEMP_DIR, `${fileId}.csv`);
    fs.writeFileSync(fichier, 'adresse\nPlace Bellecour\n');
    aNettoyer.push(fichier);

    const { POST } = await import('@/app/api/admin/geocode/batch/route');
    const res = await POST(new NextRequest('http://localhost/api/admin/geocode/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, colAdresse: 'adresse', colCodePostal: 'code_postal', colVille: 'ville' }),
    }));
    const corps = await res.json() as { success: boolean; geocodeId: string };
    expect(res.status).toBe(200);
    expect(corps.success).toBe(true);

    expect(isValidUuid(corps.geocodeId)).toBe(true);
    const chemin = resolveSafeJsonPath(GEOCODE_DIR, corps.geocodeId);
    expect(chemin).not.toBeNull();
    aNettoyer.push(chemin!);
    expect(fs.existsSync(chemin!)).toBe(true);
    expect(JSON.parse(fs.readFileSync(chemin!, 'utf-8')).geocodeId).toBe(corps.geocodeId);
  });
});
