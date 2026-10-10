/**
 * Le contenu d'une `maplibregl.Popup`, construit par `textContent` et JAMAIS
 * par `innerHTML` : les valeurs viennent de la base (noms de sites, communes)
 * et ne sont pas des textes de confiance.
 *
 * Même structure que `CarteRisque.tsx` : un titre (graisse 500) et UNE ligne
 * tertiaire qui joint les détails par « · ». Aucune valeur n'est en
 * JetBrains Mono : le mono est réservé aux nombres (DESIGN_SYSTEM § 4), et
 * commune, statut et nature sont du texte (écart V8 de l'inventaire).
 * Les détails vides sont écartés, comme `.filter(Boolean)` côté React.
 */
export function contenuPopup(titre: string, details: readonly (string | null | undefined)[], doc: Document = document): HTMLElement {
  const racine = doc.createElement('div');
  racine.className = 'text-[11.5px] leading-[1.55] text-primary';
  const t = doc.createElement('div');
  t.className = 'mb-[2px] font-medium';
  t.textContent = titre;
  racine.appendChild(t);
  const ligne = details.filter((d): d is string => !!d).join(' · ');
  const detail = doc.createElement('div');
  detail.className = 'text-tertiary';
  detail.textContent = ligne;
  racine.appendChild(detail);
  return racine;
}

/**
 * Un élément de popup construit par `textContent` (jamais `innerHTML` : noms, adresses, communes viennent de la base),
 * avec son style en ligne — l'UNIQUE fabrique des popups DOM de la carte principale (POI, radio, indicateurs civiques,
 * santé, risques industriels ; revue 1 de T12 : quatre copies locales réunies ici). Sans `texte`, l'élément reste vide
 * (un conteneur auquel on ajoute des enfants).
 */
export function elementTexte(
  doc: Document, balise: string, style: Partial<CSSStyleDeclaration>, texte?: string,
): HTMLElement {
  const el = doc.createElement(balise);
  Object.assign(el.style, style);
  if (texte !== undefined) el.textContent = texte;
  return el;
}
