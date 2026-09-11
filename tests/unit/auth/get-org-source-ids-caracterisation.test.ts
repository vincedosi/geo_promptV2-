import { describe, it, expect, vi } from 'vitest';

/**
 * Tests de CARACTÉRISATION de `lib/auth/getOrgSourceIds`.
 *
 * Cette fonction décide quelles sources de données une organisation voit. C'est
 * une règle d'AUTORISATION, et elle est aujourd'hui écrite à trois endroits
 * (`DUP-002`) : ici, dans `app/api/map/pois/route.ts:27-41` et dans
 * `app/api/map/categories/route.ts:54-58`.
 *
 * Le lot 7 supprime les deux copies au profit de celle-ci. Avant de fusionner
 * une règle d'autorisation, il faut prouver qu'elle se comporte exactement
 * pareil — une différence silencieuse ouvrirait ou fermerait des données.
 *
 * Trois retours ont des sens DIFFÉRENTS et ne doivent pas être confondus :
 *   null  → aucun filtre (super_admin, ou pas de session en développement)
 *   []    → organisation connue mais aucune source → AUCUN accès
 *   [...] → filtre sur ces identifiants
 * Confondre `null` et `[]` inverserait l'autorisation en tout accès.
 */

type Filtre = { methode: string; argument: unknown };

const filtresObserves: Filtre[] = [];
const reponse: { data: { id: string }[] | null } = { data: [] };

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

/**
 * `profiles.organization_id` est une colonne `uuid` : les valeurs reelles sont
 * toujours des UUID. Les fixtures d'origine utilisaient « org-1 » / « org-42 »,
 * des placeholders qui ne peuvent pas exister en base.
 */
const ORG_UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const session = (o: Record<string, unknown>) => o as never;

describe('caractérisation — getOrgSourceIds', () => {
  it('renvoie null sans session : aucun filtre (contournement de développement)', async () => {
    expect(await getOrgSourceIds(null)).toBeNull();
  });

  it('renvoie null pour un super_admin : il voit tout', async () => {
    expect(await getOrgSourceIds(session({ role: 'super_admin', orgId: ORG_UUID }))).toBeNull();
  });

  it('renvoie null si la session n a pas d organisation', async () => {
    expect(await getOrgSourceIds(session({ role: 'client', orgId: null }))).toBeNull();
  });

  it('renvoie un tableau VIDE quand l organisation n a aucune source — et non null', async () => {
    // Distinction capitale : [] ferme l'accès, null l'ouvre en grand.
    reponse.data = [];
    const r = await getOrgSourceIds(session({ role: 'client', orgId: ORG_UUID }));
    expect(r).toEqual([]);
    expect(r).not.toBeNull();
  });

  it('renvoie un tableau vide et non null quand la requête ne rend rien', async () => {
    reponse.data = null;
    expect(await getOrgSourceIds(session({ role: 'client', orgId: ORG_UUID }))).toEqual([]);
  });

  it('renvoie les identifiants des sources visibles', async () => {
    reponse.data = [{ id: 'src-1' }, { id: 'src-2' }];
    expect(await getOrgSourceIds(session({ role: 'client', orgId: ORG_UUID }))).toEqual(['src-1', 'src-2']);
  });

  it('exclut les sources supprimées et couvre possession ET partage', async () => {
    filtresObserves.length = 0;
    reponse.data = [];
    await getOrgSourceIds(session({ role: 'client', orgId: ORG_UUID }));

    expect(filtresObserves).toContainEqual({ methode: 'neq', argument: 'status=deleted' });
    // Les deux voies d'accès : l'organisation possède la source, ou on la lui a partagée.
    const ou = filtresObserves.find(f => f.methode === 'or')?.argument as string;
    expect(ou).toContain(`organization_id.eq.${ORG_UUID}`);
    expect(ou).toContain(`shared_with.cs.{${ORG_UUID}}`);
  });
});

describe('getOrgSourceIds — garde sur la valeur interpolée (SEC-002)', () => {
  it('ferme l accès plutôt que d interpoler une valeur qui n est pas un UUID', async () => {
    // Le retour DOIT être [] et non null : [] ferme, null ouvrirait tout.
    // Se tromper de côté ici transformerait une anomalie en fuite de données.
    // La chaine VIDE n'est pas dans cette liste : elle est falsy, donc attrapee
    // en amont par `if (!session.orgId) return null`. C'est le comportement
    // existant, teste plus haut, et on ne le change pas.
    for (const suspect of ["' or true--", '../../etc', 'org-1', 'DROP TABLE']) {
      const r = await getOrgSourceIds(session({ role: 'client', orgId: suspect }));
      expect(r, `orgId=${JSON.stringify(suspect)}`).toEqual([]);
      expect(r).not.toBeNull();
    }
  });

  it('laisse passer un UUID valide', async () => {
    filtresObserves.length = 0;
    reponse.data = [{ id: 'src-9' }];
    const r = await getOrgSourceIds(session({
      role: 'client', orgId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    }));
    expect(r).toEqual(['src-9']);
    expect(filtresObserves.some(f => f.methode === 'or')).toBe(true);
  });
});
