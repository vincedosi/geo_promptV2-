'use client';

import { useState } from 'react';

interface PromptItem {
  text: string;
  desc: string;
}

interface PromptCategory {
  id: string;
  icon: string;
  label: string;
  color: string;
  description: string;
  prompts: PromptItem[];
}

const CATEGORIES: PromptCategory[] = [
  {
    id: 'pois',
    icon: '·',
    label: 'Analyse de zone',
    color: '#3dffa0',
    description: 'Cherche des établissements sur la carte et les affiche avec des markers colorés par catégorie.',
    prompts: [
      { text: 'Lycées à Brest dans un rayon de 3km', desc: 'Markers + cercle de rayon' },
      { text: 'CIRFA et lycées à Lyon', desc: 'Multi-catégories différenciées' },
      { text: "McDonald's à Paris dans 500m autour de Notre-Dame", desc: 'POIs commerces / point précis' },
      { text: 'CIRFA dans le département 29', desc: 'Filtre par département' },
    ],
  },
  {
    id: 'isochrone',
    icon: '·',
    label: 'Isochrones',
    color: '#38bdf8',
    description: "Zone colorée d'accessibilité autour des établissements. S'ajoute à une recherche de POIs.",
    prompts: [
      { text: 'Isochrone 5 min à pied autour des lycées à Brest', desc: 'Zone piéton colorée' },
      { text: 'Zone 30 min en voiture depuis les CIRFA de Lyon', desc: 'Zone voiture' },
      { text: '15 min à vélo autour des gares à Paris', desc: 'Zone vélo' },
    ],
  },
  {
    id: 'carreaux',
    icon: '·',
    label: 'Carreaux démo',
    color: '#f59e0b',
    description: 'Grille 200m colorée par densité de population cible (données Filosofi INSEE). Peut se combiner avec des POIs.',
    prompts: [
      { text: 'Montre les 18-24 ans à Brest', desc: 'Grille densité jeunes' },
      { text: "Où vivent les actifs 25-39 ans à Lyon", desc: 'Actifs en âge de recruter' },
      { text: 'Lycées à Brest + où vivent les 18-24 ans', desc: 'POIs + couche démo combinés' },
      { text: 'Montre les seniors 65-79 ans à Bordeaux', desc: 'Toutes tranches disponibles' },
    ],
  },
  {
    id: 'voronoi',
    icon: '⬡',
    label: 'Voronoï géométrique',
    color: '#a78bfa',
    description: "Découpe le territoire à vol d'oiseau — chaque zone appartient au POI le plus proche en ligne droite. Instantané, sans API externe.",
    prompts: [
      { text: 'Fais le Voronoï des CIRFA de France', desc: 'Territoires géométriques (France entière)' },
      { text: 'Voronoï des CIRFA de Bretagne', desc: 'Filtré sur une région' },
      { text: "Zone d'influence des lycées à Rennes", desc: "Fonctionne pour n'importe quelle catégorie" },
    ],
  },
  {
    id: 'battle',
    icon: '·',
    label: 'Voronoï Routier',
    color: '#f87171',
    description: "Territoires par temps de trajet réel (ORS). Anneaux 10/30/60/90/120 min en voiture. ~1-2 min au 1er appel, puis mis en cache.",
    prompts: [
      { text: "Bataille d'isochrones des CIRFA de Bretagne", desc: 'Qui recrute dans quelle zone routière' },
      { text: 'Affiche le voronoï routier des CIRFA de Normandie', desc: 'Formulation alternative — même résultat' },
      { text: "Territoires de recrutement réels CIRFA de France", desc: 'France entière (~2 min)' },
      { text: "Anneaux isochrones CIRFA du département 29", desc: 'Filtre par département' },
    ],
  },
  {
    id: 'coverage',
    icon: '·',
    label: 'Couverture audience',
    color: '#c4b5fd',
    description: 'Calcule le nombre de personnes d\'une cible dans une zone de temps réel (ORS + carreaux INSEE). Retourne un chiffre unique.',
    prompts: [
      { text: 'Combien de jeunes 18-24 ans dans 30 min en voiture autour de Brest ?', desc: 'Résultat numérique + isochrone sur la carte' },
      { text: 'Audience potentielle 15 min à pied autour de Lyon', desc: 'Population totale accessible à pied' },
      { text: 'Potentiel de recrutement 60 min voiture depuis Rennes', desc: 'Jeunes 18-24 ans dans le bassin routier' },
    ],
  },
  {
    id: 'panneaux',
    icon: '·',
    label: 'Panneaux OOH',
    color: '#fb923c',
    description: "Panneaux d'affichage extérieur géolocalisés (Clear Channel, JCDecaux, Exterion…). Filtres par régie, type, ville.",
    prompts: [
      { text: "Panneaux Clear Channel à Paris dans 1km autour de la Tour Eiffel", desc: "Régie + zone" },
      { text: 'Affiche les panneaux OOH à Lyon', desc: 'Tous les panneaux d\'une ville' },
      { text: 'Panneaux 4x3 JCDecaux à Bordeaux', desc: 'Par type de format' },
    ],
  },
];

interface PromptsPanelProps {
  sendMessage: (text: string) => void;
  onClose: () => void;
}

export function PromptsPanel({ sendMessage, onClose }: PromptsPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (id: string) => setOpenId(prev => prev === id ? null : id);

  const handleClick = (text: string) => {
    sendMessage(text);
    onClose();
  };

  return (
    <div style={{
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(0,0,0,0.25)',
      maxHeight: 420,
      overflowY: 'auto',
    }}>
      {/* Panel header */}
      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#0f0f23', zIndex: 1 }}>
        <div style={{ fontSize: 9, fontFamily: "'Michroma','Orbitron',sans-serif", color: '#a855f7', letterSpacing: '0.14em' }}>PROMPTS</div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
        >✕</button>
      </div>

      {/* Categories */}
      {CATEGORIES.map(cat => (
        <div key={cat.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          {/* Category header */}
          <button
            onClick={() => toggle(cat.id)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 16px', background: 'none', border: 'none',
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 10, color: cat.color, flexShrink: 0 }}>{cat.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cat.color }}>{cat.label}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.description}</div>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, flexShrink: 0 }}>{openId === cat.id ? '▲' : '▼'}</span>
          </button>

          {/* Prompts list */}
          {openId === cat.id && (
            <div style={{ paddingBottom: 8 }}>
              {/* Full description on expand */}
              <div style={{ padding: '0 16px 8px 42px', fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                {cat.description}
              </div>
              {cat.prompts.map(p => (
                <button
                  key={p.text}
                  onClick={() => handleClick(p.text)}
                  title="Cliquer pour envoyer ce prompt"
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 16px 7px 42px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 1.4 }}>
                    <span style={{ color: cat.color, marginRight: 6, fontSize: 10 }}>▶</span>
                    {p.text}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                    → {p.desc}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
