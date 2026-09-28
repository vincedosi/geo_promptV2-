'use client';

/**
 * Bouton « Export Excel » de l'onglet Rayon.
 *
 * Le classeur est INTERACTIF (seuil, territoire, rayon et natures se règlent
 * dans Excel) : l'état de l'écran ne sert qu'à l'ouvrir sur ce qu'on
 * regardait. Voir `app/api/risques/exposition/rayon/export/route.ts`.
 *
 * Même patron de téléchargement que `BoutonExportProfil` : le nom du fichier
 * vient de l'en-tête de la réponse, et une erreur JSON est lue et affichée
 * plutôt que téléchargée comme un .xlsx illisible.
 */
import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { fInter } from '@/lib/design/polices';

interface Props {
  niveaux: string[];
  natures: string[];
  perim: { niveau: 'region' | 'departement'; code: string } | null;
  rayonM: number;
}

export function BoutonExportRayon({ niveaux, natures, perim, rayonM }: Props) {
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const exporter = async () => {
    setEnCours(true);
    setMessage(null);
    try {
      const p = new URLSearchParams({ rayon_m: String(rayonM) });
      if (niveaux.length > 0) p.set('gravites', niveaux.join(','));
      if (natures.length > 0) p.set('natures', natures.join(','));
      if (perim) {
        p.set('perim_niveau', perim.niveau);
        p.set('perim_code', perim.code);
      }

      const r = await adminFetch(`/api/risques/exposition/rayon/export?${p}`);
      if (!r.ok) {
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
        .match(/filename="([^"]+)"/)?.[1] ?? 'rayon-influence-seveso.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setMessage('L’export n’a pas répondu.');
    } finally {
      setEnCours(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={exporter}
        disabled={enCours}
        title="Classeur Excel interactif : seuil Seveso, territoire, rayon et natures se règlent dans Excel"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'transparent',
          border: '0.5px solid var(--brand-teal)',
          borderRadius: 6, padding: '5px 12px',
          cursor: enCours ? 'wait' : 'pointer',
          fontFamily: fInter, fontSize: 12, fontWeight: 500,
          color: 'var(--brand-teal)',
          whiteSpace: 'nowrap',
        }}
      >
        {enCours
          ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
          : <Download size={13} />}
        {enCours ? 'Préparation…' : 'Export Excel'}
      </button>
      {message && (
        <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--danger)' }}>{message}</span>
      )}
    </span>
  );
}
