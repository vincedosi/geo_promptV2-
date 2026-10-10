/**
 * `GET /api/admin/espaces/comptes` (vue « Tous les comptes » de la page Accès)
 * répond 401 sans droits d'administration, SANS rien lire en base : la liste
 * porte l'email de chaque compte.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const lectures: string[] = [];

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({ from: (t: string) => { lectures.push(t); throw new Error('lecture inattendue'); } }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAdmin: async () => null,
  adminUnauthorized: () => new Response(null, { status: 401 }),
}));

const { GET } = await import('@/app/api/admin/espaces/comptes/route');

describe('GET /api/admin/espaces/comptes — garde', () => {
  it('401 sans droits, aucune lecture', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/espaces/comptes'));
    expect(res.status).toBe(401);
    expect(lectures).toEqual([]);
  });
});
