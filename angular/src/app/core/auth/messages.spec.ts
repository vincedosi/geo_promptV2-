import { cibleDeRedirection, messageErreurConnexion } from './messages';

describe('messageErreurConnexion', () => {
  it('traduit les identifiants refusés', () => {
    expect(messageErreurConnexion('Invalid login credentials')).toBe('Adresse ou mot de passe incorrect.');
  });
  it('traduit un compte non confirmé', () => {
    expect(messageErreurConnexion('Email not confirmed')).toBe('Ce compte n\'a pas encore été confirmé.');
  });
  it('dit que le service ne répond pas sur une erreur réseau', () => {
    expect(messageErreurConnexion('Failed to fetch')).toMatch(/ne répond pas/);
  });
  it('ne laisse jamais passer un message anglais inconnu', () => {
    expect(messageErreurConnexion('Something odd')).toBe('La connexion a échoué. Réessayez dans un instant.');
  });
});

describe('cibleDeRedirection', () => {
  it('garde un chemin interne', () => {
    expect(cibleDeRedirection('/risques?etape=2')).toBe('/risques?etape=2');
  });
  it('refuse une URL absolue', () => {
    expect(cibleDeRedirection('https://exemple.test/piege')).toBe('/');
  });
  it('refuse un chemin à double barre (URL relative au protocole)', () => {
    expect(cibleDeRedirection('//exemple.test')).toBe('/');
  });
  it('refuse de revenir sur la page de connexion', () => {
    expect(cibleDeRedirection('/connexion')).toBe('/');
  });
  it('rend l\'accueil quand rien n\'est demandé', () => {
    expect(cibleDeRedirection(null)).toBe('/');
  });
});
