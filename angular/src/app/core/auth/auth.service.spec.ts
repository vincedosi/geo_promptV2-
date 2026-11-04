import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { Session } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { SUPABASE } from './supabase';

const session = { access_token: 'jeton-a', user: { email: 'a@exemple.test' } } as unknown as Session;

interface OptionsFauxClient {
  session?: Session | null;
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
      expect(appels).toEqual([['from', 'profiles'], ['select', 'role, full_name, organization_id'], ['eq', 'id', 'u1']]);
    });

    it('lireRole() puis lireProfil() : UNE seule lecture de profiles', async () => {
      const { client, appels } = clientProfil(async () => ({ data: { role: 'admin', full_name: 'A B' }, error: null }));
      const auth = creer(client as never);
      await auth.initialiser();
      expect(await auth.lireRole()).toBe('admin');
      expect(await auth.lireProfil()).toEqual({ role: 'admin', nom: 'A B', organisation: null });
      expect(appels.filter((a) => a[0] === 'from')).toHaveLength(1);
      await auth.deconnecter('locale');
    });

    it("un échec ne se mémorise pas : l'appel suivant relit profiles", async () => {
      for (const echec of [
        async () => ({ data: null, error: { message: 'refus' } }),
        async () => { throw new Error('réseau'); },
      ]) {
        TestBed.resetTestingModule();
        let n = 0;
        const { client, appels } = clientProfil(async () => (++n === 1 ? echec() : { data: { role: 'admin', full_name: 'A' }, error: null }));
        const auth = creer(client as never);
        await auth.initialiser();
        expect(await auth.lireProfil()).toBeNull();
        expect(await auth.lireProfil()).toEqual({ role: 'admin', nom: 'A', organisation: null });
        expect(appels.filter((a) => a[0] === 'from')).toHaveLength(2);
        // Le succès, lui, est gardé.
        expect(await auth.lireRole()).toBe('admin');
        expect(appels.filter((a) => a[0] === 'from')).toHaveLength(2);
      }
    });

    it("un changement d'utilisateur relit profiles ; la déconnexion vide le mémo", async () => {
      const { client, appels } = clientProfil(async () => ({ data: { role: 'admin', full_name: 'A' }, error: null }));
      const auth = creer(client as never);
      await auth.initialiser();
      await auth.lireProfil();
      client.emettre({ access_token: 'k', user: { id: 'u2', email: 'b@exemple.test' } } as unknown as Session);
      await auth.lireProfil();
      expect(appels.filter((a) => a[0] === 'eq').map((a) => a[2])).toEqual(['u1', 'u2']);
      await auth.deconnecter('locale');
      client.emettre({ access_token: 'k', user: { id: 'u2', email: 'b@exemple.test' } } as unknown as Session);
      await auth.lireProfil();
      expect(appels.filter((a) => a[0] === 'eq').map((a) => a[2])).toEqual(['u1', 'u2', 'u2']);
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

    it('lireProfil rend le rôle et le nom complet, null en cas d\'échec', async () => {
      const { client, appels } = clientProfil(async () => ({ data: { role: 'admin', full_name: 'Alice' }, error: null }));
      const auth = creer(client as never);
      await auth.initialiser();
      expect(await auth.lireProfil()).toEqual({ role: 'admin', nom: 'Alice', organisation: null });
      expect(appels[1]).toEqual(['select', 'role, full_name, organization_id']);
      TestBed.resetTestingModule();
      const echec = creer(clientProfil(async () => ({ data: null, error: { message: 'refus' } })).client as never);
      await echec.initialiser();
      expect(await echec.lireProfil()).toBeNull();
    });

    it("lireProfil rend l'organisation ACTIVE ; oublierProfil fait relire profiles", async () => {
      let org = 'o1';
      const { client, appels } = clientProfil(async () => ({ data: { role: 'admin', full_name: 'A', organization_id: org }, error: null }));
      const auth = creer(client as never);
      await auth.initialiser();
      expect((await auth.lireProfil())?.organisation).toBe('o1');
      org = 'o2';
      expect((await auth.lireProfil())?.organisation).toBe('o1');
      auth.oublierProfil();
      expect((await auth.lireProfil())?.organisation).toBe('o2');
      expect(appels.filter((a) => a[0] === 'from')).toHaveLength(2);
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

  describe('ouvrirSession (connexion automatique de développement)', () => {
    function clientSetSession(reponse: () => Promise<unknown>) {
      const client = fauxClient();
      const setSession = vi.fn(reponse);
      return { client: { ...client, auth: { ...client.auth, setSession } }, setSession };
    }

    it('pose les jetons et ouvre la session', async () => {
      const { client, setSession } = clientSetSession(async () => ({ data: { session }, error: null }));
      const auth = creer(client as unknown as ReturnType<typeof fauxClient>);
      expect(await auth.ouvrirSession('a', 'r')).toBe(true);
      expect(setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
      expect(auth.connecte()).toBe(true);
    });

    it('rend false sur une erreur, une absence de session ou une exception — jamais ne lève', async () => {
      for (const reponse of [
        async () => ({ data: { session: null }, error: { message: 'Invalid Refresh Token' } }),
        async () => ({ data: { session: null }, error: null }),
        async () => {
          throw new Error('réseau');
        },
      ]) {
        TestBed.resetTestingModule();
        const { client } = clientSetSession(reponse);
        const auth = creer(client as unknown as ReturnType<typeof fauxClient>);
        expect(await auth.ouvrirSession('a', 'r')).toBe(false);
        expect(auth.connecte()).toBe(false);
      }
    });
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
