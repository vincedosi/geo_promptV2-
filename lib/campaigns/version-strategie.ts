/**
 * @file lib/campaigns/version-strategie.ts — savoir si une stratégie publiée a
 * dérivé (Tâche 19, 2026-09-13).
 *
 * Une stratégie publiée est **figée** : les enchères sont parties au DSP avec
 * une liste de codes postaux issue de zones, à un instant donné. Si l'une de
 * ces zones est modifiée ensuite, la stratégie en vol ne correspond plus à ce
 * que la carte affiche — et personne ne le voit.
 *
 * D'où l'empreinte : `{ zone_id: empreinte_de_contenu }` au moment de la
 * publication. La comparer à l'état courant dit exactement quelles zones ont
 * bougé, ont été ajoutées ou retirées depuis.
 *
 * ── L'empreinte est un HACHAGE OPAQUE, plus une date ──────────────────────
 * `empreinte_zones()` rendait `{ zone_id: updated_at }` jusqu'à **sql/159**,
 * qui l'a fait passer à `{ zone_id: md5(géométrie + n_cp + n_iris) }` —
 * précisément parce qu'`updated_at` faisait d'un simple RENOMMAGE une dérive,
 * et ne voyait pas la vraie (aucun chemin applicatif ne modifie la géométrie
 * d'une zone existante).
 *
 * **Le côté TypeScript n'avait jamais suivi.** Il normalisait chaque valeur par
 * `Date.parse()` : `Date.parse('e13279f21b9ec2b78a8a2698a8fe54cc')` vaut `NaN`,
 * donc `null` **des deux côtés**, et la règle « `null` ⇒ on ne peut pas
 * affirmer l'égalité » déclarait TOUTE zone modifiée, TOUJOURS — y compris sur
 * un hachage rigoureusement identique. Conséquence en production :
 * `/activation/prevol` posait un blocage de dérive permanent,
 * `/activation/pousser` refusait, et republier n'y changeait rien puisque la
 * nouvelle empreinte était un hachage aussi illisible que la précédente.
 * Aucune activation DSP ne pouvait aboutir.
 *
 * Deux empreintes de contenu se comparent donc **caractère par caractère** :
 * elles sont produites par la MÊME fonction SQL (`empreinte_zones`, appelée à
 * la publication puis au pré-vol), il n'existe pas deux écritures équivalentes
 * d'un même md5 — le motif « Postgres écrit +00:00 là où JS écrit Z » qui
 * justifiait la normalisation par date n'a plus d'objet.
 *
 * ── Principe conservé : dans le doute, on ALERTE ──────────────────────────
 * Cette fonction décide d'un bandeau « republier » et d'un blocage
 * d'activation. Un faux positif coûte une republication inutile ; un faux
 * négatif laisse une campagne diffuser sur un périmètre qui n'est plus celui
 * qu'on croit. Toute valeur NON COMPARABLE — absente, vide, ou d'un type autre
 * que `string` (l'empreinte est relue d'un `jsonb`, rien n'en garantit le
 * contenu) — compte donc encore comme un changement. Ce qui change, c'est que
 * le cas NOMINAL n'y tombe plus.
 *
 * Logique PURE, testée sans base.
 */

/** `{ zone_id: empreinte }` — relu d'un `jsonb`, donc de forme non garantie. */
export type EmpreinteZones = Record<string, string>;

/**
 * Normalise une empreinte de zone pour la comparaison.
 *
 * Rend `null` sur tout ce qui n'est pas une chaîne non vide — et `null` ne
 * sera jamais réputé égal à quoi que ce soit, pas même à lui-même : une
 * empreinte qu'on ne sait pas lire n'autorise pas à affirmer que rien n'a
 * bougé.
 *
 * **Aucune normalisation de contenu.** Le hachage est opaque : le rogner, le
 * mettre en minuscules ou tenter de l'interpréter reviendrait à inventer une
 * équivalence que la fonction SQL ne garantit pas.
 */
function comparable(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.length > 0 ? valeur : null;
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

  for (const [zoneId, empreinteAvant] of Object.entries(avant)) {
    if (!(zoneId in maintenant)) {
      modifiees.add(zoneId); // retirée depuis la publication
      continue;
    }
    const a = comparable(empreinteAvant);
    const b = comparable(maintenant[zoneId]);
    // `null` d'un côté ou de l'autre : on ne peut pas affirmer l'égalité.
    if (a === null || b === null || a !== b) modifiees.add(zoneId);
  }

  for (const zoneId of Object.keys(maintenant)) {
    if (!(zoneId in avant)) modifiees.add(zoneId); // ajoutée depuis
  }

  return [...modifiees].sort();
}
