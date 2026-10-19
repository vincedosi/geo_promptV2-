/**
 * GET /api/map/ooh/campagnes/[id]/export-html contre la VRAIE base locale. Seule l'identité de l'appelant (l'espace
 * actif) est simulée ; la RPC, PostgREST et le générateur sont les vrais.
 *
 * Deux choses à établir :
 *   1. AUCUNE troncature silencieuse : la campagne TF4 de l'espace `marine` porte ≈ 1 253 emplacements, au-delà des
 *      1 000 lignes de `max_rows` (CLAUDE.md « Troncature PostgREST ») ; le fichier doit en porter exactement autant
 *      que la table de liaison en compte, par un comptage indépendant de la RPC.
 *   2. Le cloisonnement : la même campagne demandée depuis un AUTRE espace est un 404, sans fichier.
 *
 * La campagne TF4 est une donnée importée à la main le 2026-10-16 (scripts/ooh/importer-plan.ts) : une base remontée
 * d'un dump antérieur ne l'a pas. Le cas 1 est alors SAUTÉ et le dit, plutôt que d'échouer sur une donnée absente.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';
import { totauxCampagne } from '@/lib/ooh/export-html-totaux';
import type { CampagneOohLue } from '@/types/campagne-ooh';

let espaceActif: string | null = null;
vi.mock('@/lib/auth/getSessionOrg', async (original) => ({
  ...(await original<typeof import('@/lib/auth/getSessionOrg')>()),
  orgIdActif: async () => espaceActif,
}));

const { GET } = await import('@/app/api/map/ooh/campagnes/[id]/export-html/route');
const sb = creerClientTest();

let marine: string | null = null;
let tf4: string | null = null;
let attendus = 0;
let autreEspace = '';

function exporter(id: string) {
  return GET(new NextRequest(`http://localhost:3000/api/map/ooh/campagnes/${id}/export-html`), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  const { data: org } = await sb.from('organizations').select('id').eq('slug', 'marine').maybeSingle();
  marine = (org?.id as string | undefined) ?? null;
  if (marine) {
    const { data: c } = await sb.from('campagnes').select('id').eq('organization_id', marine).eq('vague', 'TF4').maybeSingle();
    tf4 = (c?.id as string | undefined) ?? null;
  }
  if (tf4) {
    const { data: lignes, error: el } = await sb.from('campagne_lignes').select('id').eq('campagne_id', tf4).eq('media', 'ooh');
    if (el) throw new Error(el.message);
    // Comptage INDÉPENDANT de la RPC : `count: 'exact'` sur la table de liaison, sans lire les lignes.
    const { count, error } = await sb.from('campagne_ligne_panneaux').select('ligne_id', { count: 'exact', head: true })
      .in('ligne_id', (lignes ?? []).map((l) => l.id as string));
    if (error) throw new Error(error.message);
    attendus = count ?? 0;
  } else {
    console.warn('[export-html] campagne TF4 absente de l espace `marine` : le test de volume est sauté.');
  }
  const { data: autre, error } = await sb.from('organizations')
    .insert({ name: '[ESSAI ooh] Export HTML', slug: `essai-ooh-export-html-${Date.now()}` }).select('id').single();
  if (error || !autre) throw new Error(`espace : ${error?.message}`);
  autreEspace = autre.id as string;
});

afterAll(async () => {
  if (!autreEspace) return;
  const { error } = await sb.from('organizations').delete().eq('id', autreEspace);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('export HTML d une campagne OOH, base locale', () => {
  it('TF4 depuis l espace marine : 200, un fichier joint qui porte TOUS les emplacements (plus de 1 000)', async (ctx) => {
    if (!tf4 || !marine) ctx.skip();
    espaceActif = marine;
    const res = await exporter(tf4!);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[a-z0-9-]+\.html"/);
    const html = await res.text();
    const m = /<script type="application\/json" id="donnees-carte">([\s\S]*?)<\/script>/.exec(html);
    const points = JSON.parse(m![1]).points.features as unknown[];
    expect(attendus).toBeGreaterThan(1000);
    expect(points).toHaveLength(attendus);
    expect(html).not.toContain('data-tronque');
    // Ni identifiant interne, ni adresse de l'application dans un fichier destiné au client.
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(html).not.toMatch(/localhost|127\.0\.0\.1|supabase/i);
  });

  it('TF4 : lignes + coûts annexes = budget du plan au centime, et le pied du tableau dit le même total que la synthèse', async (ctx) => {
    if (!tf4 || !marine) ctx.skip();
    const { data, error } = await sb.rpc('campagne_ooh_jsonb', { p_campagne: tf4, p_org: marine, p_limite: 20000 });
    expect(error).toBeNull();
    const t = totauxCampagne(data as CampagneOohLue);
    expect(t.annexes.length).toBeGreaterThan(0);
    expect(t.budget).not.toBeNull();
    expect(Math.round(t.total! * 100)).toBe(Math.round(t.budget! * 100));
    expect(t.ecart).toBe(0);
    espaceActif = marine;
    const html = await (await exporter(tf4!)).text();
    const synthese = /data-chiffre="montant"[^>]*>([^<]*)</.exec(html)![1];
    const total = /Total de la campagne<\/td><td class="nombre">([^<]*)</.exec(html)![1];
    expect(total).toBe(synthese);
    expect(html).not.toContain('data-ecart');
  });

  it('la même campagne depuis un autre espace : 404, aucun fichier', async (ctx) => {
    if (!tf4) ctx.skip();
    espaceActif = autreEspace;
    const res = await exporter(tf4!);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-disposition')).toBeNull();
    expect(await res.json()).toEqual({ error: 'Campagne introuvable dans cet espace de travail.' });
  });

  it('une campagne inexistante : 404', async () => {
    espaceActif = autreEspace;
    const res = await exporter('00000000-0000-4000-8000-00000000dead');
    expect(res.status).toBe(404);
  });
});
