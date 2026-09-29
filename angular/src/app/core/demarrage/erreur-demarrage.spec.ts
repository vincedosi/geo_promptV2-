import { afficherErreurDemarrage } from './erreur-demarrage';

describe('afficherErreurDemarrage', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('affiche le message d\'une erreur ConfigService, dans un role="alert"', () => {
    const erreur = new Error(
      'Configuration locale introuvable. Dans le dossier angular/, lancer : npm run config',
    );
    afficherErreurDemarrage(erreur, document);

    expect(document.body.textContent).toContain('npm run config');
    const alerte = document.body.querySelector('[role="alert"]');
    expect(alerte).not.toBeNull();
  });

  it('affiche un message générique pour une valeur qui n\'est pas une Error', () => {
    afficherErreurDemarrage('quelque chose', document);

    expect(document.body.textContent).toContain('Erreur inconnue au démarrage.');
  });

  it('rend le message en TEXTE, jamais en HTML', () => {
    const erreur = new Error('<img src=x onerror=alert(1)>');
    afficherErreurDemarrage(erreur, document);

    expect(document.body.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
