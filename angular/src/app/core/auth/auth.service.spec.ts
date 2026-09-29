import { TestBed } from '@angular/core/testing';
import type { Session } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { SUPABASE } from './supabase';

const session = { access_token: 'jeton-a', user: { email: 'a@exemple.test' } } as unknown as Session;

function fauxClient(opts: { session?: Session | null; erreur?: string } = {}) {
  let rappel: ((evt: string, s: Session | null) => void) | null = null;
  return {
    emettre: (s: Session | null) => rappel?.('SIGNED_IN', s),
    auth: {
      getSession: async () => ({ data: { session: opts.session ?? null }, error: null }),
      onAuthStateChange: (cb: (evt: string, s: Session | null) => void) => {
        rappel = cb;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signInWithPassword: async () => ({ data: {}, error: opts.erreur ? { message: opts.erreur } : null }),
      signOut: async () => ({ error: null }),
    },
  };
}

function creer(client: ReturnType<typeof fauxClient>) {
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
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
});
