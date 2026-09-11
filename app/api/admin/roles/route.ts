import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import type { UserRole } from '@/types/admin';
// Niveaux et libelles vivent dans `lib/auth/roles.ts` : la meme liste sert
// desormais aux schemas de validation des routes (`SEC-001`). Le garde-fou
// `satisfies Record<UserRole, _>` y est conserve.
import { ROLE_LEVELS, ROLE_LABELS } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

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
