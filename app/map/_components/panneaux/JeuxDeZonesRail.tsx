'use client';

/**
 * Les jeux de zones enregistrés, dans le panneau « Zones » du rail.
 *
 * ── POURQUOI ILS APPARAISSENT ICI, ET PAS SEULEMENT DANS L'ATELIER ───────
 *
 * Un jeu de zones EST une zone : un périmètre nommé, enregistré, réutilisable.
 * Le chercher dans « Calques → Zones à risque industriel → Analyser la
 * population → onglet Zones » suppose de se rappeler où il a été fabriqué,
 * alors que le rail « Zones » est justement l'endroit où l'on va chercher un
 * périmètre qu'on a déjà.
 *
 * ── CE QU'IL NE FAIT PAS, ET POURQUOI ────────────────────────────────────
 *
 * Il n'affiche PAS les géométries sur la carte et ne les supprime pas. Les
 * deux gestes vivent dans l'atelier, avec le contexte qui les rend
 * compréhensibles — le profil de rayons, le seuil de couverture, le taux
 * d'utile. Un bouton « supprimer » posé ici retirerait un objet dont
 * l'utilisateur ne voit, à cet endroit, ni la composition ni les usages.
 *
 * Ce panneau montre et ouvre. C'est tout, et c'est délibéré.
 */
import { useEffect, useRef, useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre, formaterDecimal } from '@/lib/format/nombre';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

interface JeuResume {
  id: string;
  nom: string;
  version: number;
  n_cp_retenus: number | null;
  taux_utile: number | null;
  seuil_couverture_cp: number;
}

interface Props {
  /** Ouvre l'atelier sur ce jeu. */
  onOuvrir: (id: string) => void;
}

export function JeuxDeZonesRail({ onOuvrir }: Props) {
  const [jeux, setJeux] = useState<JeuResume[] | null>(null);
  const [echec, setEchec] = useState(false);
  const monte = useRef(true);

  // ⚠ Remis à `true` à chaque montage : React monte, démonte puis remonte en
  // développement, et un drapeau posé une seule fois reste à `false` pour
  // toujours — la liste resterait alors en chargement, sans rien dire.
  useEffect(() => {
    monte.current = true;
    return () => { monte.current = false; };
  }, []);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const rep = await adminFetch('/api/zones/jeux', { cache: 'no-store' });
        if (!rep.ok) throw new Error(String(rep.status));
        const j = await rep.json();
        if (annule || !monte.current) return;
        setJeux(Array.isArray(j.jeux) ? j.jeux : []);
      } catch {
        if (!annule && monte.current) { setJeux([]); setEchec(true); }
      }
    })();
    return () => { annule = true; };
  }, []);

  if (jeux === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 16px 10px' }}>
        <Loader2 size={12} className="animate-spin" style={{ color: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          Lecture des jeux de zones…
        </span>
      </div>
    );
  }

  if (jeux.length === 0) {
    return (
      <p style={{ margin: 0, padding: '0 16px 12px', fontFamily: fInter, fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        {echec
          ? 'Liste indisponible pour le moment.'
          : 'Aucun jeu enregistré. Ils se fabriquent dans Calques, section Zones à '
            + 'risque industriel, bouton « Analyser la population à risque ».'}
      </p>
    );
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
      {jeux.map((j) => (
        <li key={j.id}>
          <button
            type="button"
            onClick={() => onOuvrir(j.id)}
            title="Ouvrir ce jeu dans l’atelier"
            style={{
              display: 'flex', alignItems: 'center', gap: 9, width: '100%',
              textAlign: 'left', padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent',
              border: '0.5px solid var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          >
            <Layers size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: fInter, fontSize: 12 }}>
                {j.nom}
                <span style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 7 }}>
                  v{j.version}
                </span>
              </span>
              <span style={{ display: 'block', marginTop: 2, fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)' }}>
                {j.n_cp_retenus === null ? '—' : formaterNombre(j.n_cp_retenus)} CP
                {j.taux_utile !== null && ` · ${formaterDecimal(Number(j.taux_utile))} % d’utile`}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
