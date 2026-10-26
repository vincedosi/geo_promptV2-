import type { CodeMotif } from '../../data/activation.api';
import { libellePublication, motifDePublication, texteMotif } from './motifs';

/** Les messages du serveur (`motifsPrevol`, `lib/campaigns/activation.ts`), un par code. */
const SERVEUR: Record<CodeMotif, string> = {
  aucune_strategie: 'Aucune stratégie n’est définie pour cette campagne.',
  droit: 'La poussée de ciblage vers un DSP est réservée aux super-administrateurs.',
  jamais_publiee: 'La stratégie n’a jamais été publiée — publiez-la pour figer le périmètre poussé.',
  derive: '2 zones ont changé depuis la publication de la v1 — republiez avant d’activer.',
  aucune_connexion: 'Aucune connexion DV360 active dans cet espace : téléchargez le fichier SDF.',
  connexion_en_erreur: 'La connexion DV360 de cet espace est en erreur ou révoquée : téléchargez le fichier SDF.',
  aucun_cp_dv360: 'Cette extraction n’achète pas DV360 au code postal : rien à pousser.',
};

describe('texteMotif', () => {
  it('un texte par code', () => {
    const textes = Object.entries(SERVEUR).map(([code, message]) => texteMotif({ code, message }));
    expect(textes).toEqual([
      'Cette campagne n’a pas encore de plan : lancez-la à l’étape ⑥.',
      'La poussée de ciblage vers un DSP est réservée aux super-administrateurs.',
      'Le plan n’a jamais été publié — publiez-le pour figer le périmètre poussé.',
      '2 zones ont changé depuis la publication de la v1 — republiez avant d’activer.',
      'Aucune connexion DV360 active dans cet espace : téléchargez le fichier SDF.',
      'La connexion DV360 de cet espace est en erreur ou révoquée : téléchargez le fichier SDF.',
      'Cette extraction n’achète pas DV360 au code postal : rien à pousser.',
    ]);
  });

  it('jamais le mot « stratégie », jamais de tutoiement', () => {
    for (const [code, message] of Object.entries(SERVEUR)) {
      const t = texteMotif({ code, message });
      expect(t).not.toMatch(/stratégie/i);
      expect(t).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i);
    }
  });

  it('un code inconnu garde le message du serveur', () => {
    expect(texteMotif({ code: 'nouveau', message: 'Message neuf.' })).toBe('Message neuf.');
  });
});

describe('publication', () => {
  it('le bouton est à côté de « jamais publiée » et de « dérivée », seulement', () => {
    expect(Object.keys(SERVEUR).filter((code) => motifDePublication({ code, message: '' }))).toEqual(['jamais_publiee', 'derive']);
  });

  it('« Publier le plan », puis « Republier (v1 → v2) »', () => {
    expect(libellePublication(null)).toBe('Publier le plan');
    expect(libellePublication(1)).toBe('Republier (v1 → v2)');
  });
});
