// ═══════════════════════════════════════════════════════
// Viewer State Store (Zustand)
// ═══════════════════════════════════════════════════════
// Mirrors the legacy `S` object in src/lib/viewer.js so
// React components can subscribe to state changes. Legacy
// code continues to mutate `window.S` directly — this store
// exposes a syncFromLegacy() helper for bridging.
// ═══════════════════════════════════════════════════════

import { create } from 'zustand'

const initialState = {
  mode: 'single',              // 'single' | 'diff'
  f1: null,
  f2: null,
  diff: null,
  pixelDiff: null,
  tab: 'visual',               // 'visual' | 'layers' | 'struct' | 'text' | '3d'
  sideTab: 'list',             // 'list' | 'semleg' | 'inspect' | 'info1' | 'info2'
  layers: {},                  // layerName → { visible, color, count }
  explode: 0,                  // 0..1 explode factor
  visLayers: { same: true, add: true, del: true },
  efState: { add: true, del: true, same: true },
  colorMode: 'semantic',       // 'semantic' | 'layer'
  pan: { x: 0, y: 0 },
  scale: 1,
  bounds: null,
  page: 0,
  dragging: false,
  lastMouse: null,
  allItems: [],
  selectedEnt: null,
  hoveredEnt: null
}

export const useViewerStore = create((set, get) => ({
  ...initialState,

  // Bulk setters for common operations
  setMode: (mode) => set({ mode }),
  setColorMode: (colorMode) => set({ colorMode }),
  setTab: (tab) => set({ tab }),
  setSideTab: (sideTab) => set({ sideTab }),
  setScale: (scale) => set({ scale }),
  setPan: (pan) => set({ pan }),
  setBounds: (bounds) => set({ bounds }),
  setExplode: (explode) => set({ explode }),
  setF1: (f1) => set({ f1 }),
  setF2: (f2) => set({ f2 }),
  setDiff: (diff) => set({ diff }),
  setLayers: (layers) => set({ layers }),
  setSelectedEnt: (selectedEnt) => set({ selectedEnt }),
  setHoveredEnt: (hoveredEnt) => set({ hoveredEnt }),
  setAllItems: (allItems) => set({ allItems }),

  // Pull current values from the legacy `window.S` object (populated by
  // src/lib/viewer.js). Call this after legacy code mutates state so that
  // React subscribers observe the change.
  syncFromLegacy: () => {
    const S = typeof window !== 'undefined' ? window.S : null
    if (!S) return
    set({
      mode: S.mode,
      f1: S.f1,
      f2: S.f2,
      diff: S.diff,
      pixelDiff: S.pixelDiff,
      tab: S.tab,
      sideTab: S.sideTab,
      layers: { ...S.layers },
      explode: S.explode,
      visLayers: { ...S.visLayers },
      efState: { ...S.efState },
      colorMode: S.colorMode,
      pan: { ...S.pan },
      scale: S.scale,
      bounds: S.bounds,
      page: S.page,
      allItems: S.allItems,
      selectedEnt: S.selectedEnt,
      hoveredEnt: S.hoveredEnt
    })
  },

  reset: () => set(initialState)
}))
