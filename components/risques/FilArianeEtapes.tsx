'use client';

/**
 * Le fil d'Ariane des quatre étapes : ① Sites › ② Rayon › ③ Couverture › ④ Zones.
 *
 * ── DEUX FILS D'ARIANE SUR LE MÊME EN-TÊTE, ET C'EST VOULU ────────────────
 *
 * ⚠ À ne pas confondre avec `FilAriane` (`components/risques/elements.tsx`),
 * qui est celui des TERRITOIRES — France › Provence-Alpes-Côte d'Azur ›
 * Bouches-du-Rhône. Celui-ci dit *où j'en suis dans le travail*, celui-là dit
 * *où je regarde*. Les deux sont des chemins, ils ne parlent pas de la même
 * chose, et les fondre en un seul obligerait à quitter son territoire pour
 * changer d'étape.
 *
 * ── CE N'EST PAS UN TUNNEL ────────────────────────────────────────────────
 *
 * Chaque étape est cliquable dans les deux sens, toujours. Le geste central du
 * module est justement le retour : on lit une couverture au ③, elle ne
 * convient pas, on revient au ② élargir le rayon. Aucune étape n'est
 * verrouillée par la précédente, et aucune ne doit l'être.
 *
 * La pastille d'une étape RENSEIGNÉE dit « tu as posé un choix ici », jamais
 * « cette étape est validée » — la nuance est dans `lib/risques/etape.ts`.
 */
import React, { useRef } from 'react';
import {
  ETAPES, LIBELLE_ETAPE, rangEtape, etapeRenseignee,
  type Etape, type EtatParcours,
} from '@/lib/risques/etape';
import { fInter } from '@/lib/design/polices';

interface Props {
  etape: Etape;
  parcours: EtatParcours;
  onEtape: (e: Etape) => void;
}

export function FilArianeEtapes({ etape, parcours, onEtape }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  /*
   * Flèches gauche/droite pour circuler, Origine/Fin pour les extrémités — le
   * comportement attendu d'une barre d'étapes, et celui que les lecteurs
   * d'écran annoncent. Le focus SUIT la sélection : déplacer le focus sans
   * changer d'étape laisserait l'anneau de focus sur une étape qu'on ne
   * regarde pas.
   */
  const auClavier = (e: React.KeyboardEvent, i: number) => {
    const cible =
      e.key === 'ArrowLeft' ? i - 1
        : e.key === 'ArrowRight' ? i + 1
          : e.key === 'Home' ? 0
            : e.key === 'End' ? ETAPES.length - 1
              : null;
    if (cible === null) return;
    e.preventDefault();
    const borne = Math.max(0, Math.min(ETAPES.length - 1, cible));
    onEtape(ETAPES[borne]);
    refs.current[borne]?.focus();
  };

  return (
    <nav
      aria-label="Étapes du parcours"
      style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 4 }}
    >
      {ETAPES.map((e, i) => {
        const courante = e === etape;
        const renseignee = etapeRenseignee(e, parcours);
        return (
          <React.Fragment key={e}>
            {i > 0 && (
              <span aria-hidden style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>›</span>
            )}
            <button
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              onClick={() => onEtape(e)}
              onKeyDown={(ev) => auClavier(ev, i)}
              // `step` et non `page` : ce sont des étapes d'un même écran, et la
              // distinction est ce que le lecteur d'écran annonce.
              aria-current={courante ? 'step' : undefined}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                border: 0, background: 'none', padding: '4px 10px 6px', cursor: 'pointer',
                fontFamily: fInter, fontSize: 12,
                fontWeight: courante ? 500 : 400,
                color: courante ? 'var(--text-primary)' : 'var(--text-tertiary)',
                // Souligné teal : le patron d'onglets du DESIGN_SYSTEM.
                borderBottom: `2px solid ${courante ? 'var(--brand-teal)' : 'transparent'}`,
              }}
            >
              <span
                aria-hidden
                style={{
                  fontSize: 10,
                  color: courante ? 'var(--brand-teal)' : 'var(--text-tertiary)',
                }}
              >
                {rangEtape(e)}
              </span>
              {LIBELLE_ETAPE[e]}
              {/*
                La pastille est PORTÉE PAR L'ÉTAPE et non par un compteur : elle
                doit se lire d'un coup d'œil, sans avoir à comparer des nombres.
                Elle est masquée sur l'étape courante — on y est, la dire
                renseignée n'apprend rien et ajoute du bruit là où l'œil revient
                le plus souvent.
              */}
              {renseignee && !courante && (
                <span
                  aria-label="renseignée"
                  title="Vous avez posé un choix à cette étape."
                  style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: 'var(--brand-teal)',
                  }}
                />
              )}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
