/**
 * @file lib/campaigns/version-strategie.ts — savoir si une stratégie publiée a
 * dérivé (Tâche 19, 2026-09-13).
 *
 * Une stratégie publiée est **figée** : les enchères sont parties au DSP avec
 * une liste de codes postaux issue de zones, à un instant donné. Si l'une de
 * ces zones est modifiée ensuite, la stratégie en vol ne correspond plus à ce
 * que la carte affiche — et personne ne le voit.
 *
 * D'où l'empreinte : `{ zone_id: updated_at }` au moment de la publication.
 * La comparer à l'état courant dit exactement quelles zones ont bougé, ont été
 * ajoutées ou retirées depuis.
 *
 * ── Principe : dans le doute, on ALERTE ───────────────────────────────────
 * Cette fonction décide d'un bandeau « republier ». Un faux positif coûte une
 * republication inutile ; un faux négatif laisse une campagne diffuser sur un
 * périmètre qui n'est plus celui qu'on croit. Toute date illisible, absente ou
 * de forme inattendue compte donc comme un changement.
 *
 * Logique PURE, testée sans base.
 */

/** `{ zone_id: updated_at }` — relu d'un `jsonb`, donc de forme non garantie. */
export type EmpreinteZones = Record<string, string>;

/**
 * Normalise une date pour la comparaison.
 *
 * Rend `null` sur tout ce qui n'est pas une date lisible — et `null` ne sera
 * jamais égal à quoi que ce soit, pas même à lui-même, ce qui est exactement
 * le comportement voulu : une date qu'on ne sait pas lire n'autorise pas à
 * affirmer que rien n'a bougé.
 *
 * Postgres sérialise « +00:00 » là où JavaScript écrit « Z », et les deux
 * désignent le même instant : comparer les CHAÎNES ferait republier une
 * stratégie à chaque fois que la donnée change de chemin de sérialisation.
 */
function instant(valeur: unknown): number | null {
  if (typeof valeur !== 'string') return null;
  const t = Date.parse(valeur);
  return Number.isFinite(t) ? t : null;
}

/** Un objet simple, ou un objet vide — jamais une exception. */
function empreinte(v: unknown): EmpreinteZones {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as EmpreinteZones)
    : {};
}

/**
 * Zones ayant dérivé depuis la publication : modifiées, ajoutées ou retirées.
 *
 * Rend les identifiants **triés**, et c'est un contrat : le résultat alimente
 * un bandeau d'alerte et des étiquettes de ligne. Un ordre dépendant de
 * l'itération d'objet ferait danser l'affichage d'un rendu à l'autre.
 */
export function zonesModifiees(
  publiee: EmpreinteZones,
  courante: EmpreinteZones,
): string[] {
  const avant = empreinte(publiee);
  const maintenant = empreinte(courante);

  const modifiees = new Set<string>();

  for (const [zoneId, dateAvant] of Object.entries(avant)) {
    if (!(zoneId in maintenant)) {
      modifiees.add(zoneId); // retirée depuis la publication
      continue;
    }
    const a = instant(dateAvant);
    const b = instant(maintenant[zoneId]);
    // `null` d'un côté ou de l'autre : on ne peut pas affirmer l'égalité.
    if (a === null || b === null || a !== b) modifiees.add(zoneId);
  }

  for (const zoneId of Object.keys(maintenant)) {
    if (!(zoneId in avant)) modifiees.add(zoneId); // ajoutée depuis
  }

  return [...modifiees].sort();
}
