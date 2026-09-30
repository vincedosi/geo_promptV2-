/**
 * Remplace la page par un message d'erreur quand l'application ne parvient
 * même pas à s'AMORCER en lancement autonome : échec de `initFederation()`
 * (main.ts) ou de `bootstrapApplication` (bootstrap.ts) — aucun composant
 * Angular n'existe alors pour l'afficher. Les échecs du DÉMARRAGE applicatif
 * (feuilles, `config.local.json`, session) ne passent PAS par ici : ils sont
 * affichés DANS la racine d'ombre par `RacineDistanteComponent`
 * (`DemarrageService.erreur()`), le `<body>` n'étant jamais touché — il
 * appartient au shell dans AIDA.
 *
 * `createElement` + `textContent` uniquement : le message porte parfois du
 * texte arbitraire (une erreur réseau, un corps de réponse) et ne doit
 * jamais être interprété comme du HTML.
 *
 * Styles EN LIGNE et NEUTRES, jamais de classe : `magelian.css` n'est pas
 * posée dans le document (elle n'est adoptée que par les racines d'ombre,
 * isolation CSS), donc une classe Tailwind n'y aurait aucun effet — c'était le
 * cas jusqu'à la revue finale du lot AIDA. Seules des marges et une taille,
 * et `color: inherit` : aucune couleur en dur, le texte prend la couleur de
 * texte du document — celle du `color-scheme` que pose le script de thème
 * d'index.html, lisible sur le fond de styles/document.css.
 */
export function afficherErreurDemarrage(erreur: unknown, doc: Document): void {
  const message = erreur instanceof Error ? erreur.message : 'Erreur inconnue au démarrage.';

  const main = doc.createElement('main');
  main.setAttribute('role', 'alert');
  main.style.color = 'inherit';
  main.style.margin = '24px';
  main.style.fontFamily = 'system-ui, sans-serif';

  const titre = doc.createElement('h1');
  titre.style.color = 'inherit';
  titre.style.margin = '0 0 8px';
  titre.style.fontSize = '18px';
  titre.textContent = "L'application n'a pas pu démarrer";

  const paragraphe = doc.createElement('p');
  paragraphe.style.color = 'inherit';
  paragraphe.style.margin = '0';
  paragraphe.style.fontSize = '14px';
  paragraphe.textContent = message;

  main.append(titre, paragraphe);

  doc.body.replaceChildren(main);
}
