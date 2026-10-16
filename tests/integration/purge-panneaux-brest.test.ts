/**
 * sql/260 — purge des 1 434 panneaux d'essai de Brest (spec 2026-10-16-ooh-campagnes § 4.1).
 *
 * Le fichier est APPLIQUÉ par ce test (psql dans le conteneur, comme scripts/seed-demo-campagne-risque.ts) : deux
 * passages réussissent, le second sans rien supprimer. La garde est éprouvée sur une source factice qui porte un
 * panneau d'une AUTRE source : la purge doit refuser.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const CONTENEUR = process.env.CONTENEUR_PG ?? 'supabase_db_genesis_app';
const SOURCE_BREST = 'custom_geo_brest-metropole_fr';

function appliquer(): { statut: number | null; sortie: string } {
  const r = spawnSync('docker', ['exec', '-i', CONTENEUR, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync('sql/260_purge_panneaux_brest.sql', 'utf8'),
    encoding: 'utf8',
  });
  return { statut: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

let org = '';
beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI ooh] Purge Brest', slug: `essai-ooh-purge-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(`création de l'espace : ${error?.message}`);
  org = data.id as string;
});
afterAll(async () => {
  const { error: e1 } = await admin.from('panneaux_affichage').delete().eq('source', 'essai-purge-etrangere');
  if (e1) throw new Error(`nettoyage panneaux : ${e1.message}`);
  const { error: e2 } = await admin.from('organizations').delete().eq('id', org);
  if (e2) throw new Error(`nettoyage espace : ${e2.message}`);
});

describe('sql/260 — purge des panneaux de Brest', () => {
  it('appliquée deux fois : les deux passages réussissent, le second ne supprime rien', () => {
    const premier = appliquer();
    expect(premier.statut, premier.sortie).toBe(0);
    const second = appliquer();
    expect(second.statut, second.sortie).toBe(0);
    expect(second.sortie).toContain('purge Brest : 0 panneau(x), 0 passage(s) d\'import, 0 source(s) supprimés');
  });

  it('plus aucun panneau, aucune source ni aucun passage d import de Brest', async () => {
    const { count: panneaux, error: e1 } = await admin.from('panneaux_affichage')
      .select('id', { count: 'exact', head: true }).eq('source', SOURCE_BREST);
    expect(e1).toBeNull();
    expect(panneaux).toBe(0);
    const { data: sources, error: e2 } = await admin.from('data_sources').select('id').eq('mapping->>source_key', SOURCE_BREST);
    expect(e2).toBeNull();
    expect(sources).toEqual([]);
    const { data: passages, error: e3 } = await admin.from('import_runs_ooh').select('id').eq('source', 'Brest Métropole 2026');
    expect(e3).toBeNull();
    expect(passages).toEqual([]);
  });

  it('refuse de purger une source qui porte un panneau d une autre source', async () => {
    const { data: ds, error } = await admin.from('data_sources').insert({
      organization_id: org, name: '[ESSAI ooh] source piégée', type: 'panneaux', visibilite: 'privee',
      mapping: { source_key: SOURCE_BREST },
    }).select('id').single();
    if (error || !ds) throw new Error(`source factice : ${error?.message}`);
    const { error: ep } = await admin.from('panneaux_affichage').insert({
      lat: 48.39, lng: -4.49, source: 'essai-purge-etrangere', source_ref: '1', data_source_id: ds.id, organization_id: org,
    });
    expect(ep).toBeNull();
    const r = appliquer();
    expect(r.statut).not.toBe(0);
    expect(r.sortie).toContain('purge Brest refusée');
    const { count } = await admin.from('panneaux_affichage').select('id', { count: 'exact', head: true }).eq('source', 'essai-purge-etrangere');
    expect(count).toBe(1);
    const { error: ed } = await admin.from('panneaux_affichage').delete().eq('source', 'essai-purge-etrangere');
    expect(ed).toBeNull();
    const { error: es } = await admin.from('data_sources').delete().eq('id', ds.id);
    expect(es).toBeNull();
  });
});
