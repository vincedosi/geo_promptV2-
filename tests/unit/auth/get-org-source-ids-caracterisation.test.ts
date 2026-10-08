import { describe, it, expect, vi } from 'vitest';

/**
 * Règle d'autorisation `lib/auth/getOrgSourceIds` — quelles sources une
 * session voit-elle.
 *
 * ── CE QUI A CHANGÉ LE 2026-10-08, ET POURQUOI CE TEST LE DIT ──────────────
 *
 * Ce fichier figeait jusque-là un comportement OUVERT par défaut : `null`
 * (« tout voir ») sans session et pour un compte sans organisation. Il le
 * caractérisait fidèlement — c'était son rôle avant la fusion `DUP-002` — et
 * c'est précisément ce qui était dangereux : une anomalie de session ouvrait
 * les données de tous les clients.
 *
 * Désormais :
 *   null  → super_admin, et LUI SEUL
 *   [...] → le socle + l'organisation + ses partages
 *   []    → la lecture a échoué : on ferme, jamais on n'ouvre
 * Confondre `null` et `[]` inverserait l'autorisation en tout accès.
 */

type Filtre = { methode: string; argument: unknown };

const filtresObserves: Filtre[] = [];
const reponse: { data: { id: string }[] | null; error: { message: string } | null } = { data: [], error: null };

function fausseChaine() {
  const chaine = {
    select() { return chaine; },
    neq(colonne: string, valeur: unknown) {
      filtresObserves.push({ methode: 'neq', argument: `${colonne}=${String(valeur)}` });
      return chaine;
    },
    or(expression: string) {
      filtresObserves.push({ methode: 'or', argument: expression });
      return Promise.resolve(reponse);
    },
  };
  return chaine;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({ from: () => fausseChaine() }),
}));

const { getOrgSourceIds } = await import('@/lib/auth/getOrgSourceIds');

const ORG_UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const session = (o: Record<string, unknown>) => o as never;

function dernierOu(): string {
  return filtresObserves.filter(f => f.methode === 'or').at(-1)?.argument as string;
}

describe('getOrgSourceIds — seul le super_admin voit tout', () => {
  it('renvoie null pour un super_admin', async () => {
    expect(await getOrgSourceIds(session({ role: 'super_admin', orgId: ORG_UUID }))).toBeNull();
  });

  it('sans session : le socle seul, JAMAIS null', async () => {
    reponse.data = [{ id: 'socle-1' }];
    const r = await getOrgSourceIds(null);
    expect(r).toEqual(['socle-1']);
    expect(dernierOu()).toBe('visibilite.eq.socle');
  });

  it('compte sans organisation : le socle seul, JAMAIS null', async () => {
    reponse.data = [{ id: 'socle-1' }];
    expect(await getOrgSourceIds(session({ role: 'client', orgId: null }))).toEqual(['socle-1']);
    expect(dernierOu()).toBe('visibilite.eq.socle');
  });

  it('un admin d organisation n est PAS un super_admin', async () => {
    reponse.data = [];
    expect(await getOrgSourceIds(session({ role: 'admin', orgId: ORG_UUID }))).not.toBeNull();
  });
});

describe('getOrgSourceIds — les trois voies d accès d un client', () => {
  it('couvre socle, possession et partage, et exclut les sources supprimées', async () => {
    filtresObserves.length = 0;
    reponse.data = [];
    await getOrgSourceIds(session({ role: 'client', orgId: ORG_UUID }));

    expect(filtresObserves).toContainEqual({ methode: 'neq', argument: 'status=deleted' });
    const ou = dernierOu();
    expect(ou).toContain('visibilite.eq.socle');
    expect(ou).toContain(`organization_id.eq.${ORG_UUID}`);
    expect(ou).toContain(`shared_with.cs.{${ORG_UUID}}`);
  });

  it('renvoie les identifiants des sources visibles', async () => {
    reponse.data = [{ id: 'src-1' }, { id: 'src-2' }];
    expect(await getOrgSourceIds(session({ role: 'client', orgId: ORG_UUID }))).toEqual(['src-1', 'src-2']);
  });

  it('une lecture en échec ferme ([]) au lieu d ouvrir (null)', async () => {
    reponse.data = null;
    reponse.error = { message: 'boom' };
    const r = await getOrgSourceIds(session({ role: 'client', orgId: ORG_UUID }));
    expect(r).toEqual([]);
    reponse.error = null;
  });
});

describe('getOrgSourceIds — garde sur la valeur interpolée (SEC-002)', () => {
  it('n interpole jamais une organisation qui n est pas un UUID : socle seul', async () => {
    for (const suspect of ["' or true--", '../../etc', 'org-1', 'DROP TABLE', '']) {
      reponse.data = [];
      const r = await getOrgSourceIds(session({ role: 'client', orgId: suspect }));
      expect(r, `orgId=${JSON.stringify(suspect)}`).not.toBeNull();
      expect(dernierOu()).toBe('visibilite.eq.socle');
    }
  });
});
