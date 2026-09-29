export interface LignePopup {
  libelle: string;
  valeur: string;
}

/**
 * Le contenu d'une `maplibregl.Popup`, construit par `textContent` et JAMAIS
 * par `innerHTML` : les valeurs viennent de la base (noms de sites, communes)
 * et ne sont pas des textes de confiance.
 */
export function contenuPopup(titre: string, lignes: LignePopup[], doc: Document = document): HTMLElement {
  const racine = doc.createElement('div');
  racine.className = 'flex flex-col gap-1 text-xs text-primary';
  const t = doc.createElement('strong');
  t.className = 'font-medium';
  t.textContent = titre;
  racine.appendChild(t);
  for (const l of lignes) {
    const ligne = doc.createElement('div');
    const libelle = doc.createElement('span');
    libelle.className = 'text-tertiary';
    libelle.textContent = `${l.libelle} : `;
    const valeur = doc.createElement('span');
    valeur.className = 'font-mono';
    valeur.textContent = l.valeur;
    ligne.append(libelle, valeur);
    racine.appendChild(ligne);
  }
  return racine;
}
