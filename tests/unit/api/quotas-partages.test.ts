import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `ECH-004` — le quota d'appels doit valoir pour TOUTES les instances.
 *
 * Le défaut : les trois limiteurs comptaient dans la mémoire du processus. Sur
 * Vercel, chaque invocation peut être une instance différente — « 3 imports par
 * 60 s » ne limitait rien. Upstash devait couvrir ce cas, mais ses variables
 * d'environnement sont vides en production.
 *
 * Ce qui est vérifié ici, c'est l'ORDRE des moteurs et le comportement en
 * panne : la base d'abord, la mémoire seulement si la base n'a pas répondu, et
 * dans ce cas on échoue OUVERT. Un `false` rendu par erreur bloquerait les
 * imports alors que rien ne le justifie.
 */

const appelsRpc: { nom: string; args: Record<string, unknown> }[] = [];
const reponse: { data: unknown; error: { message: string } | null } = { data: null, error: null };

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    rpc: (nom: string, args: Record<string, unknown>) => {
      appelsRpc.push({ nom, args });
      return Promise.resolve(reponse);
    },
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const { checkImportRateLimit, createRateLimiter } = await import('@/lib/api/rate-limit');

beforeEach(() => {
  appelsRpc.length = 0;
  reponse.data = { ok: true, retry_s: 0 };
  reponse.error = null;
});

describe('checkImportRateLimit — quota partagé des imports', () => {
  // Clé d'ESSAI : le seul appelant de checkImportRateLimit (l'import ArcGIS) est supprimé depuis le 2026-10-16.
  // Le test porte sur le mécanisme — compteur en base, refus, échec ouvert —, pas sur une route.
  const CLE = 'import-essai-quota';

  it('interroge le compteur en base, pas une Map locale', async () => {
    await checkImportRateLimit(CLE);
    expect(appelsRpc).toHaveLength(1);
    expect(appelsRpc[0].nom).toBe('consommer_quota');
    expect(appelsRpc[0].args).toEqual({
      p_cle: `import:${CLE}`, p_max: 3, p_fenetre_s: 60,
    });
  });

  it('refuse quand la base dit que le quota est depasse', async () => {
    reponse.data = { ok: false, retry_s: 42 };
    const r = await checkImportRateLimit(CLE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBe(42);
  });

  it('laisse passer quand la base ne repond pas — on echoue OUVERT', async () => {
    // L'operation protegee echouerait de toute facon si la base est en panne :
    // refuser en plus n'apporterait rien, et bloquerait l'administration.
    reponse.data = null;
    reponse.error = { message: 'base indisponible' };
    const r = await checkImportRateLimit('cle-panne-' + Date.now());
    expect(r.ok).toBe(true);
  });
});

describe('createRateLimiter — moteur partagé', () => {
  it('passe par la base, avec le prefixe de la route dans la cle', async () => {
    const limiteur = createRateLimiter({ max: 5, window: '60 s', prefix: 'geo:rl:test' });
    await limiteur('utilisateur-1');
    expect(appelsRpc[0].args).toEqual({
      p_cle: 'geo:rl:test:utilisateur-1', p_max: 5, p_fenetre_s: 60,
    });
  });

  it('traduit la fenetre en secondes, quelle que soit son unite', async () => {
    const parHeure = createRateLimiter({ max: 2, window: '2 h', prefix: 'p:h' });
    await parHeure('x');
    expect(appelsRpc[0].args.p_fenetre_s).toBe(7200);

    appelsRpc.length = 0;
    const parMinutes = createRateLimiter({ max: 2, window: '5 m', prefix: 'p:m' });
    await parMinutes('x');
    expect(appelsRpc[0].args.p_fenetre_s).toBe(300);
  });

  it('rend le verdict de la base tel quel, refus compris', async () => {
    reponse.data = { ok: false, retry_s: 17 };
    const limiteur = createRateLimiter({ max: 1, window: '60 s', prefix: 'geo:rl:verdict' });
    expect(await limiteur('k')).toEqual({ ok: false, retrySec: 17 });
  });

  it('limite encore en memoire quand la base est muette — dernier recours', async () => {
    reponse.data = null;
    reponse.error = { message: 'hors ligne' };
    const limiteur = createRateLimiter({ max: 2, window: '60 s', prefix: 'geo:rl:repli' });
    expect((await limiteur('ip-1')).ok).toBe(true);
    expect((await limiteur('ip-1')).ok).toBe(true);
    // Le repli ne vaut que pour cette instance, mais il vaut mieux que rien.
    expect((await limiteur('ip-1')).ok).toBe(false);
  });
});
