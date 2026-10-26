/**
 * Doublures communes des tests de route de ④ (couverture, couverture par rayon) : la session, le quota et
 * le client admin, tenus dans `etat`. Chaque fichier les charge par `vi.mock(module, () => import('./_doublures-route'))`
 * pour `@/lib/api/middleware`, `@/lib/api/rate-limit` et `@/lib/auth` — un seul module, des exports en trop sans effet.
 */
type Profil = { id: string; role: string; organization_id: string | null } | null;
type Reponse = { data: unknown; error: unknown };

export const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

export const etat = {
  profil: null as Profil,
  quotaOk: true,
  /** `préfixe:clé` de chaque jeton demandé. */
  quotas: [] as string[],
  limiteurs: [] as { max: number; window: string; prefix: string }[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  /** La réponse de chaque RPC par nom ; absente : `{ data: null, error: null }`. */
  reponses: {} as Record<string, Reponse>,
  /** La réponse d'une lecture de table par nom ; une table absente d'ici LÈVE (aucune lecture attendue). */
  tables: {} as Record<string, Reponse>,
  /** Chaque table lue, avec ses filtres (`eq`, `in`) dans l'ordre d'appel. */
  lectures: [] as { table: string; filtres: unknown[][] }[],
};

/** À appeler dans `beforeEach` : session valide, jetons disponibles, journaux vides. Les limiteurs, créés à l'import, restent. */
export function reinitialiser(): void {
  Object.assign(etat, { profil: { id: 'u1', role: 'client', organization_id: ORG }, quotaOk: true, reponses: {}, tables: {} });
  etat.quotas.length = 0;
  etat.rpcs.length = 0;
  etat.lectures.length = 0;
}

export const requireAuth = async () => etat.profil;

export function createRateLimiter(o: { max: number; window: string; prefix: string }) {
  etat.limiteurs.push(o);
  return async (cle: string) => {
    etat.quotas.push(`${o.prefix}:${cle}`);
    return etat.quotaOk ? { ok: true, retrySec: 0 } : { ok: false, retrySec: 30 };
  };
}

export const rateLimitResponse = (s: number) =>
  new Response(JSON.stringify({ error: 'Trop de requêtes.' }), { status: 429, headers: { 'Retry-After': String(s) } });

export function createQuota(o: { max: number; window: string; prefix: string }) {
  const limiteur = createRateLimiter(o);
  return async (cle: string) => {
    const q = await limiteur(cle);
    return q.ok ? null : rateLimitResponse(q.retrySec);
  };
}

export const createAdminClient = () => ({
  rpc(nom: string, args: Record<string, unknown>) {
    etat.rpcs.push({ nom, args });
    return Promise.resolve(etat.reponses[nom] ?? { data: null, error: null });
  },
  from(table: string) {
    const reponse = etat.tables[table];
    if (!reponse) throw new Error(`aucune lecture de table attendue : ${table}`);
    const lecture = { table, filtres: [] as unknown[][] };
    etat.lectures.push(lecture);
    // Une requête enchaînable minimale : chaque filtre est noté, la réponse est celle de `etat.tables`.
    const requete = {
      select: () => requete,
      eq: (...a: unknown[]) => { lecture.filtres.push(['eq', ...a]); return requete; },
      in: (...a: unknown[]) => { lecture.filtres.push(['in', ...a]); return requete; },
      gt: (...a: unknown[]) => { lecture.filtres.push(['gt', ...a]); return requete; },
      limit: () => requete,
      order: () => requete,
      maybeSingle: () => Promise.resolve(reponse),
      then: (ok: (r: Reponse) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(reponse).then(ok, ko),
    };
    return requete;
  },
});
