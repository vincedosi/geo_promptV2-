import { create } from 'zustand';

// ── Layer state ─────────────────────────────────────────────────────────────

interface LayerState {
  active: boolean;
  expanded: boolean;
}

function layer(active = false, expanded = false): LayerState {
  return { active, expanded };
}

// ── Store ───────────────────────────────────────────────────────────────────

interface LayerStore {
  // Terrain layers
  terrain: {
    panneaux: LayerState;
    poi: LayerState;
    transport: LayerState;
    tmja: LayerState;
    radio: LayerState;
  };
  // Socio-demo layers
  socio: {
    iris: LayerState;
    carreaux: LayerState;
  };
  // Media layers
  media: {
    digital: LayerState;
  };
  // Analysis layers
  analysis: {
    scoring: LayerState;
    correlation: LayerState;
    clustering: LayerState;
    couverture: LayerState;
    isochrone: LayerState;
  };

  // Category open/closed state
  categories: {
    contexte: boolean;
    terrain: boolean;
    socio: boolean;
    media: boolean;
    analysis: boolean;
  };

  // Actions
  toggleLayer: (category: string, layerId: string) => void;
  setActive: (category: string, layerId: string, active: boolean) => void;
  toggleExpanded: (category: string, layerId: string) => void;
  toggleCategory: (categoryId: string) => void;
}

export const useLayerStore = create<LayerStore>((set) => ({
  terrain: {
    panneaux: layer(),
    poi: layer(),
    transport: layer(),
    tmja: layer(),
    radio: layer(),
  },
  socio: {
    iris: layer(),
    carreaux: layer(),
  },
  media: {
    digital: layer(),
  },
  analysis: {
    scoring: layer(),
    correlation: layer(),
    clustering: layer(),
    couverture: layer(),
    isochrone: layer(),
  },
  categories: {
    contexte: true,
    terrain: true,
    socio: false,
    media: false,
    analysis: false,
  },

  toggleLayer: (category, layerId) =>
    set((state) => {
      const cat = state[category as keyof Pick<LayerStore, 'terrain' | 'socio' | 'media' | 'analysis'>];
      if (!cat || !(layerId in cat)) return state;
      const current = (cat as Record<string, LayerState>)[layerId];
      return {
        [category]: {
          ...cat,
          [layerId]: { ...current, active: !current.active },
        },
      };
    }),

  setActive: (category, layerId, active) =>
    set((state) => {
      const cat = state[category as keyof Pick<LayerStore, 'terrain' | 'socio' | 'media' | 'analysis'>];
      if (!cat || !(layerId in cat)) return state;
      const current = (cat as Record<string, LayerState>)[layerId];
      return {
        [category]: {
          ...cat,
          [layerId]: { ...current, active },
        },
      };
    }),

  toggleExpanded: (category, layerId) =>
    set((state) => {
      const cat = state[category as keyof Pick<LayerStore, 'terrain' | 'socio' | 'media' | 'analysis'>];
      if (!cat || !(layerId in cat)) return state;
      const current = (cat as Record<string, LayerState>)[layerId];
      return {
        [category]: {
          ...cat,
          [layerId]: { ...current, expanded: !current.expanded },
        },
      };
    }),

  toggleCategory: (categoryId) =>
    set((state) => ({
      categories: {
        ...state.categories,
        [categoryId]: !state.categories[categoryId as keyof typeof state.categories],
      },
    })),
}));
