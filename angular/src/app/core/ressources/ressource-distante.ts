import { InjectionToken } from '@angular/core';

/**
 * URL du module JavaScript qui porte ce code, UNE FOIS EMPAQUETÉ.
 *
 * Pourquoi pas une URL relative (`'config.local.json'`) ou absolue
 * (`'/config.local.json'`) : dans le shell AIDA, le document est celui du
 * SHELL. Une adresse relative se résout contre SA page, une adresse absolue
 * contre SON origine — ni l'une ni l'autre ne désigne le dossier où notre
 * application est servie. `import.meta.url`, lui, vaut toujours l'adresse du
 * fichier qui s'exécute, où qu'il ait été chargé.
 *
 * ⚠ Valable parce que le build est PLAT, et c'est mesuré (2026-09-30, tâche 4
 * du lot AIDA) : `main-*.js`, tous les `chunk-*.js`, `Routes-*.js`,
 * `maplibre.css`, `magelian.css` et `config.local.json` sont dans le même
 * dossier (`dist/magelian/browser/`). Relevé au navigateur :
 * `http://localhost:4200/chunk-….js` sous `ng serve`,
 * `http://localhost:4300/chunk-….js` pour le build de production servi seul,
 * `http://localhost:4301/remotes/magelian/chunk-….js` pour le module exposé
 * `./Routes` importé par un hôte sur une AUTRE origine (:4302). Le jour où le
 * build range ses chunks dans un sous-dossier, cette base devient fausse.
 *
 * Sous Vitest, c'est l'adresse du paquet de test : les specs injectent donc
 * leur base par `BASE_RESSOURCES`.
 */
export const BASE_DISTANTE: string = import.meta.url;

/** Adresse d'un fichier servi À CÔTÉ de l'application distante. */
export function urlRessourceDistante(nom: string, base?: string): string {
  return new URL(nom, base ?? BASE_DISTANTE).href;
}

/** Base de résolution des ressources, injectable pour que les tests la fixent. */
export const BASE_RESSOURCES = new InjectionToken<string>('BASE_RESSOURCES', {
  providedIn: 'root',
  factory: () => BASE_DISTANTE,
});
