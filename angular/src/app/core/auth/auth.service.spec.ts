import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { SUPABASE } from './supabase';

const session = { access_token: 'jeton-a', user: { email: 'a@exemple.test' } } as unknown as Session;

interface OptionsFauxClient {
  session?: Session | null;
  erreur?: string;
  /** La PREMIÈRE réponse à signOut() échoue, pour tester le repli local (item 3). */
  erreurSignOut?: boolean;
}

function fauxClient(opts: OptionsFauxClient = {}) {
  let rappel: ((evt: string, s: Session | null) => void) | null = null;
  const appelsSignOut: unknown[] = [];
  return {
    /** @param evt Par défaut 'SIGNED_IN' — les tests qui veulent 'SIGNED_OUT' le précisent. */
    emettre: (s: Session | null, evt = 'SIGNED_IN') => rappel?.(evt, s),
    appelsSignOut,
    auth: {
      getSession: async () => ({ data: { session: opts.session ?? null }, error: null }),
      onAuthStateChange: (cb: (evt: string, s: Session | null) => void) => {
        rappel = cb;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signInWithPassword: async () => ({ data: {}, error: opts.erreur ? { message: opts.erreur } : null }),
      signOut: async (arg?: unknown) => {
        appelsSignOut.push(arg);
        if (opts.erreurSignOut && appelsSignOut.length === 1) return { error: { message: 'echec réseau' } };
        return { error: null };
      },
    },
  };
}

interface FauxRouteur {
  url: string;
  navigate: (commands: unknown[], extras?: unknown) => Promise<boolean>;
}

function fauxRouteur(url = '/carte'): FauxRouteur & { appels: Array<[unknown[], unknown]> } {
  const appels: Array<[unknown[], unknown]> = [];
  return {
    url,
    appels,
    navigate: async (commands: unknown[], extras?: unknown) => {
      appels.push([commands, extras]);
      return true;
    },
  };
}

function creer(client: ReturnType<typeof fauxClient>, routeur: FauxRouteur = fauxRouteur()) {
  TestBed.configureTestingModule({
    providers: [
      { provide: SUPABASE, useValue: client },
      { provide: Router, useValue: routeur },
    ],
  });
  return TestBed.inject(AuthService);
}

describe('AuthService', () => {
  it('reprend la session existante à l\'initialisation', async () => {
    const auth = creer(fauxClient({ session }));
    await auth.initialiser();
    expect(auth.connecte()).toBe(true);
    expect(auth.email()).toBe('a@exemple.test');
    expect(await auth.jeton()).toBe('jeton-a');
  });

  it('n\'est pas connecté sans session', async () => {
    const auth = creer(fauxClient());
    await auth.initialiser();
    expect(auth.connecte()).toBe(false);
    expect(await auth.jeton()).toBeNull();
  });

  it('suit les changements de session', async () => {
    const client = fauxClient();
    const auth = creer(client);
    await auth.initialiser();
    client.emettre(session);
    expect(auth.connecte()).toBe(true);
  });

  it('rend un message français quand la connexion échoue', async () => {
    const auth = creer(fauxClient({ erreur: 'Invalid login credentials' }));
    expect(await auth.connecter('a@exemple.test', 'faux')).toBe('Adresse ou mot de passe incorrect.');
  });

  it('rend null quand la connexion réussit', async () => {
    const auth = creer(fauxClient());
    expect(await auth.connecter('a@exemple.test', 'bon')).toBeNull();
  });

  it('repasse par signOut local si la déconnexion réseau échoue (item 3)', async () => {
    const client = fauxClient({ session, erreurSignOut: true });
    const auth = creer(client);
    await auth.initialiser();
    await auth.deconnecter();
    expect(auth.connecte()).toBe(false);
    expect(client.appelsSignOut).toEqual([undefined, { scope: 'local' }]);
  });

  it('ne rappelle pas signOut local quand la déconnexion réseau réussit', async () => {
    const client = fauxClient({ session });
    const auth = creer(client);
    await auth.initialiser();
    await auth.deconnecter();
    expect(client.appelsSignOut).toEqual([undefined]);
  });

  describe('renvoyerVersConnexion (item 1)', () => {
    it('efface la session localement et renvoie vers /connexion avec la page courante', async () => {
      const client = fauxClient({ session });
      const routeur = fauxRouteur('/risques?etape=3');
      const auth = creer(client, routeur);
      await auth.initialiser();

      await auth.renvoyerVersConnexion();

      expect(auth.connecte()).toBe(false);
      expect(client.appelsSignOut).toEqual([{ scope: 'local' }]);
      expect(routeur.appels).toEqual([
        [['/connexion'], { queryParams: { redirection: '/risques?etape=3' } }],
      ]);
    });

    it('ne navigue pas quand on est déjà sur /connexion, mais efface quand même la session', async () => {
      const client = fauxClient({ session });
      const routeur = fauxRouteur('/connexion');
      const auth = creer(client, routeur);
      await auth.initialiser();

      await auth.renvoyerVersConnexion();

      expect(auth.connecte()).toBe(false);
      expect(client.appelsSignOut).toEqual([{ scope: 'local' }]);
      expect(routeur.appels).toEqual([]);
    });

    it('un événement SIGNED_OUT de GoTrue renvoie vers /connexion sans rappeler signOut', async () => {
      const client = fauxClient({ session });
      const routeur = fauxRouteur('/risques');
      const auth = creer(client, routeur);
      await auth.initialiser();

      client.emettre(null, 'SIGNED_OUT');
      await Promise.resolve();

      expect(client.appelsSignOut).toEqual([]);
      expect(routeur.appels).toEqual([
        [['/connexion'], { queryParams: { redirection: '/risques' } }],
      ]);
    });

    it('deux fins de session simultanées ne redirigent qu\'une fois', async () => {
      const client = fauxClient({ session });
      const routeur = fauxRouteur('/risques?etape=3');
      const auth = creer(client, routeur);
      await auth.initialiser();

      await Promise.all([auth.renvoyerVersConnexion(), auth.renvoyerVersConnexion()]);

      expect(routeur.appels.length).toBe(1);
      expect(client.appelsSignOut).toEqual([{ scope: 'local' }]);
    });
  });
});
