// stockManager.js
// ===============================
// Gestion du stock côté serveur
// Source de vérité = ton app (elle écrase Shopify)
// + Persistance des totalGrams pour éviter le reset à 50
// + Support import Shopify + catégories + tri/filtre (via snapshot)
// ===============================

const { loadState, saveState } = require("./stockState");
const { listCategories } = require("./catalogStore");

// -----------------------------
// CONFIG PRODUITS : pool de grammes par variété
// (1 seul endroit où tu modifies les produits/grammages)
// -----------------------------
const PRODUCT_CONFIG = {
  // 3x Filtré
  "10349843513687": {
    name: "3x Filtré",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 54088575582551 },
      "3": { gramsPerUnit: 3, inventoryItemId: 54088575615319 },
      "5": { gramsPerUnit: 5, inventoryItemId: 54088575648087 },
      "10": { gramsPerUnit: 10, inventoryItemId: 54088575680855 },
      "25": { gramsPerUnit: 25, inventoryItemId: 54088575713623 },
      "50": { gramsPerUnit: 50, inventoryItemId: 54088575746391 },
    },
  },

  // Amnesia US
  "10309343248727": {
    name: "Amnesia US",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53927411155287 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53872331096407 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53872331129175 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53872331161943 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53872331194711 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53872331227479 },
    },
  },

  // Blue Gelato
  "10314007576919": {
    name: "Blue Gelato",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53915774091607 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53890393768279 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53890393801047 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53890393833815 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53890393866583 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53890393899351 },
    },
  },

  // Citrus Kush
  "10322603934039": {
    name: "Citrus Kush",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53925853725015 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53925853757783 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53925853790551 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53925853823319 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53925853856087 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53925853888855 },
    },
  },

  // Jaune
  "10349865271639": {
    name: "Jaune",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 54088627519831 },
      "3": { gramsPerUnit: 3, inventoryItemId: 54088627552599 },
      "5": { gramsPerUnit: 5, inventoryItemId: 54088627585367 },
      "10": { gramsPerUnit: 10, inventoryItemId: 54088627618135 },
      "25": { gramsPerUnit: 25, inventoryItemId: 54088627650903 },
      "50": { gramsPerUnit: 50, inventoryItemId: 54088627683671 },
    },
  },

  // Kosher Kush
  "10314004857175": {
    name: "Kosher Kush",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53927425966423 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53890386133335 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53890386166103 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53890386198871 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53890386231639 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53890386264407 },
    },
  },

  // M.A.C (LAC)
  "10322668486999": {
    name: "M.A.C (LAC) – Miracle Alien Cookies",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53926378406231 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53926378438999 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53926378471767 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53926378504535 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53926378537303 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53926378570071 },
    },
  },

  // Moonrock 57%
  "10322635751767": {
    name: "Moonrock 57%",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53926137725271 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53926137758039 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53926137790807 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53926137823575 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53926137856343 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53926137889111 },
    },
  },

  // Rainbow x GP3
  "10322564874583": {
    name: "Rainbow x GP3",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53925670224215 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53925670256983 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53925670289751 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53925670322519 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53925670355287 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53925670388055 },
    },
  },

  // Small Buds HQCT – Greenhouse FR
  "10408700772695": {
    name: "Small Buds HQCT – Greenhouse FR",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "3": { gramsPerUnit: 3, inventoryItemId: 54246752846167 },
      "5": { gramsPerUnit: 5, inventoryItemId: 54246752878935 },
      "10": { gramsPerUnit: 10, inventoryItemId: 54246752911703 },
      "25": { gramsPerUnit: 25, inventoryItemId: 54246752944471 },
      "50": { gramsPerUnit: 50, inventoryItemId: 54246752977239 },
    },
  },

  // Snow OG
  "10322557337943": {
    name: "Snow OG",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53925636079959 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53925636112727 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53925636145495 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53925636178263 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53925636211031 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53925636243799 },
    },
  },

  // Sorbet
  "10322589745495": {
    name: "Sorbet",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53925801820503 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53925801853271 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53925801886039 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53925801918807 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53925801951575 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53925801984343 },
    },
  },

  // Sour Diesel (GP3)
  "10322506744151": {
    name: "Sour Diesel (GP3)",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53925434327383 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53925434360151 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53925434392919 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53925434425687 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53925434458455 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53925434491223 },
    },
  },

  // Strawberry Diesel
  "10314002989399": {
    name: "Strawberry Diesel",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53927442252119 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53890381873495 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53890381906263 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53890381939031 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53890381971799 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53890382004567 },
    },
  },

  // Super OG
  "10322613993815": {
    name: "Super OG",
    totalGrams: 50,
    categoryIds: [],
    variants: {
      "1.5": { gramsPerUnit: 1.5, inventoryItemId: 53925976146263 },
      "3": { gramsPerUnit: 3, inventoryItemId: 53925976179031 },
      "5": { gramsPerUnit: 5, inventoryItemId: 53925976211799 },
      "10": { gramsPerUnit: 10, inventoryItemId: 53925976244567 },
      "25": { gramsPerUnit: 25, inventoryItemId: 53925976277335 },
      "50": { gramsPerUnit: 50, inventoryItemId: 53925976310103 },
    },
  },
};

// -----------------------------
// Persistance : charge l'état sauvegardé au démarrage
// On persiste: totalGrams + categoryIds (si dispo)
// -----------------------------
(function applySavedTotals() {
  const saved = loadState(); // { [productId]: { totalGrams, categoryIds } }
  for (const [pid, data] of Object.entries(saved || {})) {
    if (!PRODUCT_CONFIG[pid]) continue;

    if (typeof data?.totalGrams === "number") {
      PRODUCT_CONFIG[pid].totalGrams = data.totalGrams;
    }
    if (Array.isArray(data?.categoryIds)) {
      PRODUCT_CONFIG[pid].categoryIds = data.categoryIds.map(String);
    }
  }
})();

function persistState() {
  const out = {};
  for (const [pid, p] of Object.entries(PRODUCT_CONFIG)) {
    out[pid] = {
      totalGrams: Number(p.totalGrams || 0),
      categoryIds: Array.isArray(p.categoryIds) ? p.categoryIds.map(String) : [],
    };
  }
  saveState(out);
}

// -----------------------------
// Helpers internes
// -----------------------------
function buildProductView(config) {
  const variants = {};
  for (const [label, v] of Object.entries(config.variants || {})) {
    const gramsPer = Number(v.gramsPerUnit || 0);
    const canSell = gramsPer > 0 ? Math.floor((Number(config.totalGrams || 0)) / gramsPer) : 0;

    variants[label] = {
      gramsPerUnit: gramsPer,
      inventoryItemId: v.inventoryItemId,
      canSell,
    };
  }
  return variants;
}

// -----------------------------
// Core operations
// -----------------------------
function applyOrderToProduct(productId, gramsToSubtract) {
  const config = PRODUCT_CONFIG[productId];
  if (!config) return null;

  const g = Number(gramsToSubtract || 0);
  config.totalGrams = Number(config.totalGrams || 0) - g;
  if (config.totalGrams < 0) config.totalGrams = 0;

  persistState();

  return {
    productId,
    name: config.name,
    totalGrams: config.totalGrams,
    categoryIds: config.categoryIds || [],
    variants: buildProductView(config),
  };
}

function restockProduct(productId, grams) {
  const config = PRODUCT_CONFIG[productId];
  if (!config) return null;

  const g = Number(grams || 0);
  config.totalGrams = Number(config.totalGrams || 0) + g;
  if (config.totalGrams < 0) config.totalGrams = 0;

  persistState();

  return {
    productId,
    name: config.name,
    totalGrams: config.totalGrams,
    categoryIds: config.categoryIds || [],
    variants: buildProductView(config),
  };
}

function getStockSnapshot() {
  const stock = {};
  for (const [productId, config] of Object.entries(PRODUCT_CONFIG)) {
    stock[productId] = {
      name: config.name,
      totalGrams: config.totalGrams,
      categoryIds: config.categoryIds || [],
      variants: buildProductView(config),
    };
  }
  return stock;
}

// -----------------------------
// NOUVEAU: Catégories par produit
// -----------------------------
function setProductCategories(productId, categoryIds) {
  const p = PRODUCT_CONFIG[productId];
  if (!p) return false;

  p.categoryIds = Array.isArray(categoryIds) ? categoryIds.map(String) : [];
  persistState();
  return true;
}

// -----------------------------
// NOUVEAU: Import / upsert depuis Shopify
// - Crée ou met à jour une config produit
// - Ne casse pas totalGrams persistant si tu passes totalGrams explicitement
// -----------------------------
function upsertImportedProductConfig({ productId, name, totalGrams, variants, categoryIds }) {
  const pid = String(productId);
  const exists = !!PRODUCT_CONFIG[pid];

  const safeVariants = {};
  for (const [label, v] of Object.entries(variants || {})) {
    const gramsPerUnit = Number(v.gramsPerUnit || 0) || 1;
    const inventoryItemId = Number(v.inventoryItemId);
    if (!inventoryItemId) continue;
    safeVariants[String(label)] = { gramsPerUnit, inventoryItemId };
  }

  if (!Object.keys(safeVariants).length) {
    throw new Error("Import: aucune variante valide (inventoryItemId manquant)");
  }

  if (!exists) {
    PRODUCT_CONFIG[pid] = {
      name: String(name || pid),
      totalGrams: Number.isFinite(Number(totalGrams)) ? Number(totalGrams) : 0,
      categoryIds: Array.isArray(categoryIds) ? categoryIds.map(String) : [],
      variants: safeVariants,
    };
  } else {
    // update contrôlé
    PRODUCT_CONFIG[pid].name = String(name || PRODUCT_CONFIG[pid].name);
    PRODUCT_CONFIG[pid].variants = safeVariants;

    if (Number.isFinite(Number(totalGrams))) {
      PRODUCT_CONFIG[pid].totalGrams = Number(totalGrams);
      if (PRODUCT_CONFIG[pid].totalGrams < 0) PRODUCT_CONFIG[pid].totalGrams = 0;
    }

    if (Array.isArray(categoryIds)) {
      PRODUCT_CONFIG[pid].categoryIds = categoryIds.map(String);
    } else if (!Array.isArray(PRODUCT_CONFIG[pid].categoryIds)) {
      PRODUCT_CONFIG[pid].categoryIds = [];
    }
  }

  persistState();

  const cfg = PRODUCT_CONFIG[pid];
  return {
    productId: pid,
    name: cfg.name,
    totalGrams: cfg.totalGrams,
    categoryIds: cfg.categoryIds || [],
    variants: buildProductView(cfg),
  };
}

// -----------------------------
// NOUVEAU: Snapshot "catalog" pour le front
// Retourne: { products:[...], categories:[...] }
// -----------------------------
function getCatalogSnapshot() {
  const categories = listCategories ? listCategories() : [];

  const products = Object.entries(PRODUCT_CONFIG).map(([productId, p]) => ({
    productId,
    name: p.name,
    totalGrams: Number(p.totalGrams || 0),
    categoryIds: Array.isArray(p.categoryIds) ? p.categoryIds : [],
    variants: buildProductView(p),
  }));

  return { products, categories };
}

// -----------------------------
// Exports
// -----------------------------
module.exports = {
  PRODUCT_CONFIG,
  applyOrderToProduct,
  restockProduct,
  getStockSnapshot,

  // nouveaux exports utilisés par server.js
  upsertImportedProductConfig,
  setProductCategories,
  getCatalogSnapshot,
};
