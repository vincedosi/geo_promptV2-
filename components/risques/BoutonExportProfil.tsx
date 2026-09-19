'use client';

/**
 * « Exporter le profil » — le classeur des anneaux, bandes, territoires et
 * diffusion.
 *
 * ── POURQUOI UN SECOND BOUTON D'EXPORT ───────────────────────────────────
 *
 * L'en-tête en porte déjà un, qui exporte le tableau de population exposée
 * (`/api/risques/exposition/export`). Les deux ne calculent PAS la même chose :
 * celui-là part des zones PPRT-ou-rayon par site, celui-ci de la règle
 * d'affectation unique. Les fondre en un seul bouton contextuel — un fichier
 * différent selon l'onglet ouvert — produirait deux classeurs homonymes dont
 * on ne saurait plus lequel vient d'où.
 *
 * Deux boutons nommés valent mieux qu'un bouton qui change d'avis.
 *
 * ── LE TÉLÉCHARGEMENT PASSE PAR UN BLOB ──────────────────────────────────
 *
 * `window.open` sur une route protégée perdrait l'en-tête d'authentification :
 * l'onglet s'ouvrirait sur un 401. On récupère donc le classeur par
 * `adminFetch`, puis on déclenche le téléchargement depuis la mémoire.
 */
import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { codeProfil } from '@/lib/risques/code-profil';
import { anneauxDuNiveau, NIVEAUX, type ProfilRayons } from '@/lib/risques/profil';
import type { Dimension } from '@/lib/risques/dimensions';
import { fInter } from '@/lib/design/polices';

interface Props {
  profil: ProfilRayons;
  cible: string;
  libelleCible: string;
  maille: Dimension;
  parent: string | null;
  campagne: string | null;
}

export function BoutonExportProfil({
  profil, cible, libelleCible, maille, parent, campagne,
}: Props) {
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Un profil sans anneau n'a ni bandes ni territoires : le classeur serait
  // vide. Le dire avant la requête vaut mieux qu'un fichier de trois lignes.
  const vide = NIVEAUX.every((n) => anneauxDuNiveau(profil, n).length === 0);

  const exporter = async () => {
    setEnCours(true);
    setMessage(null);
    try {
      const p = new URLSearchParams({
        profil: codeProfil(profil),
        cible,
        maille: maille === 'commune' ? 'commune' : 'departement',
        libelle_cible: libelleCible,
      });
      if (parent) p.set('parent', parent);
      if (campagne) p.set('campagne', campagne);

      const r = await adminFetch(`/api/risques/profil/export?${p}`);
      if (!r.ok) {
        // La route rend un JSON en cas d'erreur, un classeur sinon. Lire le
        // corps comme du texte évite de lever sur un binaire.
        const texte = await r.text();
        let erreur = 'Export impossible.';
        try {
          erreur = (JSON.parse(texte) as { error?: string }).error ?? erreur;
        } catch { /* le corps n'était pas du JSON : on garde le message générique */ }
        setMessage(erreur);
        return;
      }

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (r.headers.get('content-disposition') ?? '')
        .match(/filename="([^"]+)"/)?.[1] ?? 'profil-risque.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Sans révocation, le blob reste en mémoire jusqu'au rechargement de la
      // page — quelques centaines de ko par export, sur un écran qu'on garde
      // ouvert longtemps.
      URL.revokeObjectURL(url);
    } catch {
      setMessage('L’export n’a pas répondu.');
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={exporter}
        disabled={enCours || vide}
        title={vide
          ? 'Réglez au moins un anneau : le classeur serait vide.'
          : 'Classeur Excel : profil, bandes, territoires, diffusion'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'transparent',
          border: '0.5px solid var(--border-default)',
          borderRadius: 6, padding: '6px 12px',
          cursor: enCours || vide ? 'not-allowed' : 'pointer',
          fontFamily: fInter, fontSize: 12,
          color: vide ? 'var(--text-tertiary)' : 'var(--text-secondary)',
        }}
      >
        {enCours
          ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
          : <Download size={13} />}
        Exporter le profil
      </button>
      {message && (
        <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--danger)' }}>{message}</span>
      )}
    </div>
  );
}
