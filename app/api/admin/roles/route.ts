import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import type { UserRole } from '@/types/admin';

export const dynamic = 'force-dynamic';

// `satisfies` (et non `:`) : garde-fou de compilation — ajouter un role a
// `UserRole` sans le declarer ici casse le build, au lieu de le faire disparaitre
// silencieusement du selecteur de roles (c'est ce qui est arrive a `editor`).
const ROLE_LEVELS = { super_admin: 0, admin: 1, client: 2 } satisfies Record<UserRole, number>;
const ROLE_LABELS = { super_admin: 'Super admin', admin: 'Admin', client: 'Client' } satisfies Record<UserRole, string>;

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  // La liste des roles vient de `ROLE_LEVELS`, pas de la base.
  //
  // Cette route appelait `get_check_constraint_values` pour lire la contrainte
  // `profiles_role_check` a l'execution. La fonction n'a jamais existe : l'appel
  // echouait a chaque fois et le repli sur la constante servait TOUJOURS. On
  // avait donc le pire des deux mondes — un aller-retour inutile, et du code qui
  // se pretendait dynamique sans l'etre.
  //
  // L'appel est retire plutot que la fonction ecrite, parce que la dynamique
  // etait structurellement impossible : l'ancien code filtrait de toute facon la
  // liste recue sur `r in ROLE_LEVELS`, ecartant tout role absent du code, et un
  // role a besoin d'un NIVEAU et d'un LIBELLE que la contrainte CHECK ne porte
  // pas. Lire la base ne pouvait donc rien apporter.
  //
  // La derive code/base est deja empechee autrement : `satisfies
  // Record<UserRole, _>` ci-dessus casse le build si `UserRole` et ces tables
  // divergent, et `types/admin.ts` documente `UserRole` comme le miroir exact de
  // la contrainte. Un role ajoute en base sans passer par le code est un
  // changement de schema, pas un cas d'usage a supporter a chaud.
  const userLevel = ROLE_LEVELS[profile.role] ?? 99;
  const result = (Object.keys(ROLE_LEVELS) as UserRole[])
    .map(r => ({ value: r, label: ROLE_LABELS[r], level: ROLE_LEVELS[r] }))
    .filter(r => profile.role === 'super_admin' || r.level >= userLevel)
    .sort((a, b) => a.level - b.level);

  return NextResponse.json(result);
}
