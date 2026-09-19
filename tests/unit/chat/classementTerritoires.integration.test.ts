import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Vérifie l'outil `classement_territoires` de bout en bout contre un faux
 * client Supabase : les arguments envoyés à la RPC `classer_territoires`
 * (sql/150), la résolution de coordonnées (départements via `ref_departements`,
 * communes via `iris` + `communes_arrondissements`), et le mapping d'erreur
 * RPC → message utilisateur avec suggestions.
 */

type RpcCall  = { fn: string; args: Record<string, unknown> };
type FromCall = { table: string; select: string; in?: [string, unknown[]] };

const rpcCalls:  RpcCall[]  = [];
const fromCalls: FromCall[] = [];

let rpcResponse: { data: unknown; error: { message: string } | null } = { data: [], error: null };
let irisResponse: { data: unknown; error: null } = { data: [], error: null };
let departementsResponse: { data: unknown; error: null } = { data: [], error: null };
let arrondissementsResponse: { data: unknown; error: null } = { data: [], error: null };

function makeFakeSupabase() {
  return {
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      if (fn === 'classer_territoires') return Promise.resolve(rpcResponse);
      if (fn === 'get_iris_metric_columns') {
        return Promise.resolve({ data: [{ key: 'population' }, { key: 'pop_15_29' }], error: null });
      }
      return Promise.resolve({ data: null, error: { message: `RPC inattendue: ${fn}` } });
    },
    from: (table: string) => {
      const call: FromCall = { table, select: '' };
      fromCalls.push(call);
      const builder = {
        select(cols: string) { call.select = cols; return builder; },
        in(col: string, values: unknown[]) {
          call.in = [col, values];
          if (table === 'ref_departements')          return Promise.resolve(departementsResponse);
          if (table === 'communes_arrondissements')   return Promise.resolve(arrondissementsResponse);
          if (table === 'iris')                       return Promise.resolve(irisResponse);
          return Promise.resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => makeFakeSupabase(),
}));

import { classementTerritoires } from '@/lib/chat/tools/classementTerritoires';

beforeEach(() => {
  rpcCalls.length = 0;
  fromCalls.length = 0;
  rpcResponse = { data: [], error: null };
  irisResponse = { data: [], error: null };
  departementsResponse = { data: [], error: null };
  arrondissementsResponse = { data: [], error: null };
});

describe('classementTerritoires — appel RPC', () => {
  it('rejette sans appeler la RPC quand indicateur est vide', async () => {
    const result = await classementTerritoires({});
    expect(result).toEqual({
      type:  'classement_territoires',
      error: "Indicateur requis pour classer les territoires.",
    });
    expect(rpcCalls).toHaveLength(0);
  });

  it('envoie des paramètres bornés et par défaut cohérents (commune/volume/limite 10)', async () => {
    departementsResponse = { data: [], error: null };
    await classementTerritoires({ indicateur: 'pop_15_29' });

    const appel = rpcCalls.find(c => c.fn === 'classer_territoires');
    expect(appel?.args).toMatchObject({
      p_indicateur: 'pop_15_29',
      p_palier: 'commune',
      p_tri: 'volume',
      p_plancher_population: 0,
      p_limite: 10,
      p_regrouper_arrondissements: true,
    });
  });

  it('applique le plancher par défaut pour un tri en part sans seuil fourni', async () => {
    await classementTerritoires({ indicateur: 'pop_15_29', tri: 'part' });
    const appel = rpcCalls.find(c => c.fn === 'classer_territoires');
    expect(appel?.args.p_plancher_population).toBe(20_000);
  });

  it('force p_regrouper_arrondissements à false au palier departement, quel que soit l\'argument reçu', async () => {
    await classementTerritoires({ indicateur: 'population', palier: 'departement', regrouper_arrondissements: true });
    const appel = rpcCalls.find(c => c.fn === 'classer_territoires');
    expect(appel?.args.p_regrouper_arrondissements).toBe(false);
    expect(appel?.args.p_palier).toBe('departement');
  });

  it('borne la limite envoyée à la RPC (jamais de liste illimitée sur Nano)', async () => {
    await classementTerritoires({ indicateur: 'population', limite: 5000 });
    const appel = rpcCalls.find(c => c.fn === 'classer_territoires');
    expect(appel?.args.p_limite).toBe(100);
  });
});

describe('classementTerritoires — résolution de coordonnées', () => {
  it('résout les centroïdes de département depuis ref_departements', async () => {
    rpcResponse = {
      data: [{ code: '29', nom: 'Finistère', population: 900000, valeur: 100000, part: null, classe: 'effectif' }],
      error: null,
    };
    departementsResponse = { data: [{ code_dept: '29', centroid_lat: 48.2, centroid_lon: -4.0 }], error: null };

    const result = await classementTerritoires({ indicateur: 'population', palier: 'departement' }) as {
      resultats: Array<{ code: string; lat: number | null; lng: number | null }>;
    };

    expect(result.resultats[0]).toMatchObject({ code: '29', lat: 48.2, lng: -4.0 });
    expect(fromCalls.some(c => c.table === 'ref_departements')).toBe(true);
    // Aucune requête iris/communes_arrondissements au palier département.
    expect(fromCalls.some(c => c.table === 'iris')).toBe(false);
  });

  it("rend lat/lng null (jamais un repli trompeur type Paris) quand le centroïde n'est pas résolu", async () => {
    rpcResponse = {
      data: [{ code: '999', nom: 'Zone inconnue', population: 1000, valeur: 100, part: null, classe: 'effectif' }],
      error: null,
    };
    departementsResponse = { data: [], error: null };

    const result = await classementTerritoires({ indicateur: 'population', palier: 'departement' }) as {
      resultats: Array<{ lat: number | null; lng: number | null }>;
    };

    expect(result.resultats[0].lat).toBeNull();
    expect(result.resultats[0].lng).toBeNull();
  });

  it('reconstitue le centroïde de Paris depuis ses arrondissements pondérés par la population', async () => {
    rpcResponse = {
      data: [{ code: '75056', nom: 'Paris', population: 2_113_697, valeur: 513_373, part: 24.3, classe: 'effectif' }],
      error: null,
    };
    arrondissementsResponse = {
      data: [
        { code_arrondissement: '75101', code_commune_mere: '75056' },
        { code_arrondissement: '75120', code_commune_mere: '75056' },
      ],
      error: null,
    };
    irisResponse = {
      data: [
        { code_commune: '75101', centroid_lat: 48.86, centroid_lng: 2.34, population: 17_000 },
        { code_commune: '75120', centroid_lat: 48.87, centroid_lng: 2.40, population: 145_000 },
      ],
      error: null,
    };

    const result = await classementTerritoires({ indicateur: 'population' }) as {
      resultats: Array<{ code: string; lat: number | null; lng: number | null }>;
    };

    expect(result.resultats[0].code).toBe('75056');
    expect(result.resultats[0].lat).not.toBeNull();
    // Moyenne pondérée par la population, pas une moyenne simple des deux arrondissements.
    const totalPop = 17_000 + 145_000;
    const attendu = (48.86 * 17_000 + 48.87 * 145_000) / totalPop;
    expect(result.resultats[0].lat!).toBeCloseTo(attendu, 6);
  });
});

describe('classementTerritoires — erreurs RPC', () => {
  it("pose type: 'classement_territoires' sur l'erreur RPC — sans lui, ClassementCard rendait null en silence", async () => {
    rpcResponse = {
      data: null,
      error: { message: 'indicateur inconnu ou non numerique au palier commune : bidon' },
    };

    const result = await classementTerritoires({ indicateur: 'bidon' }) as {
      type: string;
      error: string;
      indicateur: string;
      indicateurs_disponibles: Array<{ key: string; label: string }>;
    };

    expect(result.type).toBe('classement_territoires');
    expect(result.indicateur).toBe('bidon');
    expect(result.error).toContain("n'existe pas ou n'est pas numérique");
    expect(result.indicateurs_disponibles.length).toBeGreaterThan(0);
    expect(rpcCalls.some(c => c.fn === 'get_iris_metric_columns')).toBe(true);
  });

  it("pose aussi type sur la garde 'indicateur requis' (pas d'appel RPC)", async () => {
    const result = await classementTerritoires({}) as { type: string; error: string };
    expect(result.type).toBe('classement_territoires');
    expect(result.error).toBe('Indicateur requis pour classer les territoires.');
  });

  it("ne laisse jamais fuir un message Postgres non reconnu — message générique à l'écran", async () => {
    rpcResponse = {
      data: null,
      error: { message: 'connection terminated unexpectedly at 10.0.0.1' },
    };

    const result = await classementTerritoires({ indicateur: 'population' }) as { error: string };

    expect(result.error).not.toContain('10.0.0.1');
    expect(result.error).not.toContain('connection terminated');
    expect(result.error).toBe("Le classement n'a pas pu être calculé. Réessayez, ou changez d'indicateur.");
  });
});
