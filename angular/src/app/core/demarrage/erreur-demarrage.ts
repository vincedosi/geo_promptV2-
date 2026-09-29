/**
 * Remplace la page par un message d'erreur quand le démarrage échoue —
 * jamais un écran blanc. Cas typique : `config.local.json` absent ou
 * incomplet (`ConfigService.charger()` rejette avant même que le routeur
 * n'existe, donc aucun composant Angular n'est là pour l'afficher).
 *
 * `createElement` + `textContent` uniquement : le message porte parfois du
 * texte arbitraire (une erreur réseau, un corps de réponse) et ne doit
 * jamais être interprété comme du HTML.
 */
export function afficherErreurDemarrage(erreur: unknown, doc: Document): void {
  const message = erreur instanceof Error ? erreur.message : 'Erreur inconnue au démarrage.';

  const main = doc.createElement('main');
  main.setAttribute('role', 'alert');
  main.className = 'p-6';

  const titre = doc.createElement('h1');
  titre.className = 'text-primary';
  titre.textContent = "L'application n'a pas pu démarrer";

  const paragraphe = doc.createElement('p');
  paragraphe.className = 'text-danger text-sm';
  paragraphe.textContent = message;

  main.append(titre, paragraphe);

  doc.body.replaceChildren(main);
}
