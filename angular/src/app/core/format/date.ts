/**
 * Le jour ET l'heure d'un instant, en français (`PanneauExtractions.tsx:62-69`) : « 25/10/2026 14:05 » ; « — » sur une
 * date illisible. Les versions d'un jeu de zones s'affichent ainsi au module risque, à ⑤ et à ⑥.
 *
 * Il vivait dans un composant du module risque, importé par la carte (revue finale du lot 6, F-4). À ne pas confondre
 * avec `dateFr` de `features/carte/logique/analyses/commun.ts`, qui rend le jour SANS l'heure : deux noms distincts.
 */
export function dateHeureFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
