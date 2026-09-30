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
        // Comme le vrai supabase-js : un signOut() qui réussit émet SIGNED_OUT
        // à travers onAuthStateChange — c'est ce qui fait courir le handler de
        // initialiser() EN MÊME TEMPS que l'appelant de signOut() (item 3).
        rappel?.('SIGNED_OUT', null);
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

  describe('lireRole — profiles.role, comme fetchProfileEnrichment de React', () => {
    const avecId = { access_token: 'j', user: { id: 'u1', email: 'a@exemple.test' } } as unknown as Session;
    function clientProfil(reponse: () => Promise<unknown>) {
      const client = fauxClient({ session: avecId });
      const appels: unknown[][] = [];
      const requete = {
        select: (...a: unknown[]) => (appels.push(['select', ...a]), requete),
        eq: (...a: unknown[]) => (appels.push(['eq', ...a]), requete),
        single: () => reponse(),
      };
      return { client: { ...client, from: (t: string) => (appels.push(['from', t]), requete) }, appels };
    }

    it('lit le rôle du profil de la session', async () => {
      const { client, appels } = clientProfil(async () => ({ data: { role: 'super_admin' }, error: null }));
      const auth = creer(client as never);
      await auth.initialiser();
      expect(await auth.lireRole()).toBe('super_admin');
      expect(appels).toEqual([['from', 'profiles'], ['select', 'role'], ['eq', 'id', 'u1']]);
    });

    it('rend null sur une erreur, une absence ou une exception — jamais ne lève', async () => {
      for (const reponse of [
        async () => ({ data: null, error: { message: 'refus' } }),
        async () => ({ data: null, error: null }),
        async () => { throw new Error('réseau'); },
      ]) {
        TestBed.resetTestingModule();
        const auth = creer(clientProfil(reponse).client as never);
        await auth.initialiser();
        expect(await auth.lireRole()).toBeNull();
      }
    });

    it('rend null sans session, sans rien demander', async () => {
      const auth = creer(fauxClient());
      await auth.initialiser();
      expect(await auth.lireRole()).toBeNull();
    });
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

  describe('fin de session sans navigation (hôte comme autonome)', () => {
    it("deconnecter('locale') efface la session par un signOut LOCAL, sans appel réseau", async () => {
      const client = fauxClient({ session });
      const auth = creer(client);
      await auth.initialiser();

      await auth.deconnecter('locale');

      expect(auth.connecte()).toBe(false);
      expect(client.appelsSignOut).toEqual([{ scope: 'local' }]);
    });

    it("deux fins de session locales simultanées (deux 401) ne font qu'un signOut", async () => {
      const client = fauxClient({ session });
      const auth = creer(client);
      await auth.initialiser();

      await Promise.all([auth.deconnecter('locale'), auth.deconnecter('locale')]);

      expect(client.appelsSignOut).toEqual([{ scope: 'local' }]);
    });

    it('une seconde fin de session locale, plus tard, rappelle signOut', async () => {
      const client = fauxClient({ session });
      const auth = creer(client);
      await auth.initialiser();

      await auth.deconnecter('locale');
      await auth.deconnecter('locale');

      expect(client.appelsSignOut).toEqual([{ scope: 'local' }, { scope: 'local' }]);
    });

    it('un SIGNED_OUT de GoTrue met la session à null, sans rappeler signOut ni naviguer', async () => {
      const client = fauxClient({ session });
      const routeur = fauxRouteur('/risques');
      const auth = creer(client, routeur);
      await auth.initialiser();

      client.emettre(null, 'SIGNED_OUT');
      await Promise.resolve();

      expect(auth.connecte()).toBe(false);
      expect(client.appelsSignOut).toEqual([]);
      expect(routeur.appels).toEqual([]);
    });

    it('aucune action de AuthService ne navigue : la décision appartient au code à portée de route', async () => {
      const client = fauxClient({ session });
      const routeur = fauxRouteur('/risques');
      const auth = creer(client, routeur);
      await auth.initialiser();

      await auth.deconnecter();
      await auth.deconnecter('locale');
      client.emettre(null, 'SIGNED_OUT');
      await Promise.resolve();

      expect(routeur.appels).toEqual([]);
    });
  });
});
