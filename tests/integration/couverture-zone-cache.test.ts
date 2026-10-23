/**
 * Le cache de couverture (sql/270, lot 4, T6) : `couverture_zone_cache`, `couverture_zone_en_cache`, `couverture_zone`.
 *
 * Ce que ce fichier prouve (Review Focus 1 et 2 du plan, corrections R-1 et R-2 de la relecture) :
 *   - deux appels : le premier calcule (`cache: false`), le second est servi du cache (`cache: true`), mêmes chiffres ;
 *   - ACCÈS CROISÉ : l'id d'une zone en cache, demandé avec l'`org_id` d'un AUTRE espace, ne lit RIEN — ni le cache
 *     (`null`), ni la zone (`zone_introuvable`), et n'écrit aucune ligne ;
 *   - la forme change (`remplacer_geometrie_zone` → `updated_at`) : le cache est périmé, le suivant recalcule ;
 *   - la base change (`construit_le` d'une bande plus récent, table recertifiée) : le cache est périmé ;
 *   - la base n'est plus certifiée complète : le cache n'est pas servi (le calcul refusera) ;
 *   - un refus ne s'écrit jamais ; la suppression de la zone emporte ses lignes de cache (cascade).
 *
 * Fichier distinct de `couverture-geometrie.test.ts` (T5), en relecture au moment de l'écriture : les deux ne se
 * touchent pas. Les pannes de base sont simulées par psql dans des transactions ANNULÉES (base locale partagée).
 */
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const CONTENEUR = process.env.CONTENEUR_PG ?? 'supabase_db_genesis_app';
const LONG = 120_000;

/** Un script psql ; rend la DERNIÈRE ligne de sa sortie. Lève si psql échoue. */
function psql(script: string): string {
  const r = spawnSync('docker', ['exec', '-i', CONTENEUR, 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`psql (${r.status}) : ${r.stderr}`);
  const lignes = r.stdout.trim().split('\n');
  return lignes[lignes.length - 1];
}

interface Reponse {
  refus?: string; cache?: boolean; zone_maj?: string; zone_id?: string; population?: number; n_carreaux?: number;
  base_construite_le?: string; calcule_le?: string; lignes?: unknown[];
}

let org = '';
let autreOrg = '';
let zone = '';
let zoneSupprimee = '';

async function nouvelleOrg(nom: string) {
  const { data, error } = await admin.from('organizations')
    .insert({ name: `[ESSAI lot4 T6] ${nom}`, slug: `essai-lot4-t6-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

const carre = (o: number, s: number, e: number, n: number) =>
  JSON.stringify({ type: 'Polygon', coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]] });

/** Deux kilomètres autour du centre de Lyon : quelques ms par calcul. */
const LYON = carre(4.82, 45.75, 4.85, 45.77);
const LYON_PLUS_PETIT = carre(4.83, 45.755, 4.845, 45.765);

async function creerZone(nom: string, geojson: string): Promise<string> {
  const { data, error } = await admin.rpc('creer_zone_recette', {
    p_nom: nom, p_org_id: org, p_cree_par: null, p_recette: { v: 1, type: 'dessin' }, p_geometry_geojson: geojson,
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

async function enCache(z: string, o: string, cible = 'ind', decoupage = 'cp'): Promise<Reponse | null> {
  const { data, error } = await admin.rpc('couverture_zone_en_cache', { p_zone_id: z, p_org_id: o, p_cible: cible, p_decoupage: decoupage });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as Reponse | null;
}

async function couvrir(z: string, o: string, cible = 'ind', decoupage = 'cp'): Promise<Reponse> {
  const { data, error } = await admin.rpc('couverture_zone', { p_zone_id: z, p_org_id: o, p_cible: cible, p_decoupage: decoupage });
  if (error) throw new Error(`${error.code} ${error.message}`);
  return data as Reponse;
}

const lignesDeCache = (z: string) => Number(psql(`select count(*) from public.couverture_zone_cache where zone_id = '${z}';`));

beforeAll(async () => {
  org = await nouvelleOrg('a');
  autreOrg = await nouvelleOrg('b');
  zone = await creerZone('Lyon centre', LYON);
  zoneSupprimee = await creerZone('Lyon centre (à supprimer)', LYON);
}, LONG);

afterAll(async () => {
  for (const o of [org, autreOrg]) {
    if (!o) continue;
    const { error } = await admin.from('organizations').delete().eq('id', o);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('couverture_zone — calcul puis cache', () => {
  it('rien en cache au départ ; le premier appel calcule, le second est servi du cache, mêmes chiffres', async () => {
    expect(await enCache(zone, org)).toBeNull();
    const premier = await couvrir(zone, org);
    expect(premier.refus).toBeUndefined();
    expect(premier.cache).toBe(false);
    expect(premier.n_carreaux).toBeGreaterThan(0);
    expect(lignesDeCache(zone)).toBe(1);

    const lu = await enCache(zone, org);
    expect(lu?.cache).toBe(true);
    const second = await couvrir(zone, org);
    expect(second.cache).toBe(true);
    // Mêmes clés, mêmes chiffres : seule la marque `cache` diffère.
    expect({ ...second, cache: false }).toEqual(premier);
    expect({ ...lu, cache: false }).toEqual(premier);
  }, LONG);

  it('une ligne par (zone, cible, découpage) : une autre cible ou un autre découpage ne lit pas cette ligne', async () => {
    expect(await enCache(zone, org, 'ind', 'forme')).toBeNull();
    expect(await enCache(zone, org, 'men_pauv', 'cp')).toBeNull();
  });

  it('un refus ne s’écrit pas (cible inconnue)', async () => {
    const avant = lignesDeCache(zone);
    expect((await couvrir(zone, org, 'xxx', 'cp')).refus).toBe('cible_inconnue');
    expect(lignesDeCache(zone)).toBe(avant);
  });
});

describe('accès croisé entre espaces (Review Focus 1, R-1)', () => {
  it('l’id d’une zone EN CACHE, demandé depuis un autre espace : ni le cache, ni la zone, rien d’écrit', async () => {
    await couvrir(zone, org);
    expect((await enCache(zone, org))?.cache).toBe(true);
    const avant = lignesDeCache(zone);

    expect(await enCache(zone, autreOrg)).toBeNull();
    expect(await couvrir(zone, autreOrg)).toEqual({ refus: 'zone_introuvable' });
    expect(lignesDeCache(zone)).toBe(avant);
  });

  it('un id inconnu : null en cache, `zone_introuvable` au calcul', async () => {
    const inconnu = '00000000-0000-4000-8000-000000000000';
    expect(await enCache(inconnu, org)).toBeNull();
    expect(await couvrir(inconnu, org)).toEqual({ refus: 'zone_introuvable' });
  });
});

describe('péremption (Review Focus 2, R-2)', () => {
  it('la forme change (remplacer_geometrie_zone → updated_at) : le cache ne sert plus l’ancien chiffre', async () => {
    const avant = await couvrir(zone, org);
    expect((await enCache(zone, org))?.cache).toBe(true);

    const { error } = await admin.rpc('remplacer_geometrie_zone', { p_zone_id: zone, p_org_id: org, p_geometry_geojson: LYON_PLUS_PETIT });
    if (error) throw new Error(error.message);

    expect(await enCache(zone, org)).toBeNull();
    const apres = await couvrir(zone, org);
    expect(apres.cache).toBe(false);
    expect(apres.n_carreaux).toBeLessThan(avant.n_carreaux ?? 0);
    // sql/270 (T8, relecture I1) : la réponse porte la version de la forme chiffrée — l'écran y indexe le contour.
    expect(typeof avant.zone_maj).toBe('string');
    expect(apres.zone_maj).not.toBe(avant.zone_maj);
    expect((await enCache(zone, org))?.zone_maj).toBe(apres.zone_maj);
    expect((await enCache(zone, org))?.n_carreaux).toBe(apres.n_carreaux);
  }, LONG);

  it('la base est reconstruite (une bande plus récente, table recertifiée) : le cache est périmé, puis réécrit', async () => {
    await couvrir(zone, org);
    expect((await enCache(zone, org))?.cache).toBe(true);
    // Dans UNE transaction annulée : bande 0 « reconstruite » maintenant, certificat refait, puis lecture et calcul.
    // Une instruction par étape : une fonction STABLE voit l'instantané de SON instruction, pas l'écriture d'à côté.
    const sortie = psql(`begin;
      update public.carreau_couverture_bandes set construit_le = clock_timestamp() where bande = (select min(bande) from public.carreau_couverture_bandes);
      select public.certifier_carreau_couverture();
      select coalesce(public.carreau_couverture_complete(), 'complete')
          || '|' || (public.couverture_zone_en_cache('${zone}', '${org}', 'ind', 'cp') is null)::text as a \\gset
      select public.couverture_zone('${zone}', '${org}', 'ind', 'cp')->>'cache' as b \\gset
      select public.couverture_zone_en_cache('${zone}', '${org}', 'ind', 'cp')->>'cache' as c \\gset
      rollback;
      select :'a' || '|' || :'b' || '|' || :'c';`);
    // Base certifiée complète : seule la date de construction périme la ligne ; le calcul la réécrit.
    expect(sortie).toBe('complete|true|false|true');
    // Après l'annulation, la ligne d'origine est de nouveau valide.
    expect((await enCache(zone, org))?.cache).toBe(true);
  }, LONG);

  it('la base n’est plus certifiée complète : le cache n’est pas servi, le calcul refuse', async () => {
    await couvrir(zone, org);
    const sortie = psql(`begin;
      delete from public.carreau_couverture_controle;
      select (public.couverture_zone_en_cache('${zone}', '${org}', 'ind', 'cp') is null)::text
          || '|' || (public.couverture_zone('${zone}', '${org}', 'ind', 'cp')->>'refus');
      rollback;`);
    expect(sortie).toBe('true|couverture_non_construite');
  }, LONG);
});

describe('cascade', () => {
  it('supprimer la zone emporte ses lignes de cache', async () => {
    await couvrir(zoneSupprimee, org);
    await couvrir(zoneSupprimee, org, 'ind', 'forme');
    expect(lignesDeCache(zoneSupprimee)).toBe(2);
    const { error } = await admin.from('custom_geo_zones').delete().eq('id', zoneSupprimee);
    if (error) throw new Error(error.message);
    expect(lignesDeCache(zoneSupprimee)).toBe(0);
  });
});

describe('droits', () => {
  it('les trois objets sont réservés à service_role', () => {
    const r = psql(`select string_agg(x, ',' order by x) from (
      select 'anon:' || has_function_privilege('anon', 'public.couverture_zone(uuid, uuid, text, text)', 'execute') x
      union all select 'auth:' || has_function_privilege('authenticated', 'public.couverture_zone_en_cache(uuid, uuid, text, text)', 'execute')
      union all select 'srv:' || has_function_privilege('service_role', 'public.couverture_zone(uuid, uuid, text, text)', 'execute')
      union all select 'tab:' || has_table_privilege('authenticated', 'public.couverture_zone_cache', 'select')
      union all select 'rls:' || relrowsecurity from pg_class where oid = 'public.couverture_zone_cache'::regclass) t;`);
    expect(r).toBe('anon:false,auth:false,rls:true,srv:true,tab:false');
  });
});
