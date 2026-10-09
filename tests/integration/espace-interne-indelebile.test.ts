/**
 * L'espace interne ne se supprime pas, même par un appel direct à
 * `DELETE /api/admin/organizations/[id]` (l'onglet Réglages masque déjà le
 * bouton ; la route doit tenir seule). Seule l'identité de l'appelant est
 * simulée : la route lit la vraie base locale.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { SLUG_ORGANISATION_INTERNE } from '@/lib/espaces/nom-espace';

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAdmin: async () => ({ id: '00000000-0000-0000-0000-00000000a11c', role: 'super_admin', organization_id: null }),
}));

const { DELETE } = await import('@/app/api/admin/organizations/[id]/route');
const admin = creerClientTest();

function appeler(id: string) {
  return DELETE(new NextRequest(`http://localhost:3000/api/admin/organizations/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) });
}

describe('suppression d\'un espace', () => {
  it('refuse en 409 la suppression de l\'espace interne, qui reste en base', async () => {
    const { data, error } = await admin.from('organizations').select('id').eq('slug', SLUG_ORGANISATION_INTERNE).single();
    if (error || !data) throw new Error(`espace interne : ${error?.message}`);

    const res = await appeler(data.id as string);
    expect(res.status).toBe(409);

    const { count } = await admin.from('organizations').select('id', { count: 'exact', head: true }).eq('id', data.id);
    expect(count).toBe(1);
  });

  it('supprime un espace ordinaire', async () => {
    const { data, error } = await admin.from('organizations')
      .insert({ name: '[ESSAI espaces] Suppression', slug: `essai-espaces-suppression-${Date.now()}` })
      .select('id').single();
    if (error || !data) throw new Error(`espace : ${error?.message}`);

    const res = await appeler(data.id as string);
    expect(res.status).toBe(200);
    const { count } = await admin.from('organizations').select('id', { count: 'exact', head: true }).eq('id', data.id);
    expect(count).toBe(0);
  });
});
