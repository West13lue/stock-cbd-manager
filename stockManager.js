// stockManager.js
// ============================================
// Bulk Stock Manager - Stock côté serveur
// - Source de vérité = app (écrase Shopify)
// - Persistance complète via stockState.js (Render disk /var/data)
// - Queue pour éviter race conditions
// - Support suppression persistée (deletedProductIds)
// - ✅ FIX: les produits BASE ne disparaissent plus à chaque deploy
// - ✅ REVENTE: produits BASE désactivables via env
// ============================================

const { loadState, saveState } = require("./stockState");
const { listCategories } = require("./catalogStore");
// ✅ Dans ton repo, ces fichiers sont à la racine (pas /utils)
const queueMod = require("./queue");
const { logEvent } = require("./logger");

// Compat queue : supporte `module.exports = stockQueue` OU `{ stockQueue }`
const stockQueue = queueMod?.add ? queueMod : queueMod?.stockQueue;

// --------------------------------------------
// CONFIG PRODUITS "BASE" (hardcodée)
// ✅ Pour vendre l'app à d'autres boutiques :
// - laisse ENABLE_BASE_PRODUCTS à false (par défaut)
// - et fais importer les produits depuis Shopify dans l'UI
// - si tu veux garder tes produits "base" pour TON shop uniquement,
//   mets ENABLE_BASE_PRODUCTS=true dans Render.
// --------------------------------------------
const ENABLE_BASE_PRODUCTS = process.env.ENABLE_BASE_PRODUCTS === "true";

const BASE_PRODUCT_CONFIG = ENABLE_BASE_PRODUCTS
  ? {
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

      // ... ajoute ici tes autres produits base si besoin
    }
  : {};

// --------------------------------------------
// STORE EN MÉMOIRE (source actuelle)
// --------------------------------------------
const PRODUCT_CONFIG = { ...BASE_PRODUCT_CONFIG };

// --------------------------------------------
// Helpers
// --------------------------------------------
function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampMin0(n) {
  return Math.max(0, toNum(n, 0));
}

function normalizeVariants(variants) {
  const safe = {};
  for (const [label, v] of Object.entries(variants || {})) {
    const gramsPerUnit = toNum(v?.gramsPerUnit, 0);
    const inventoryItemId = toNum(v?.inventoryItemId, 0);

    if (!inventoryItemId) continue;
    if (!gramsPerUnit || gramsPerUnit <= 0) continue;

    safe[String(label)] = { gramsPerUnit, inventoryItemId };
  }
  return safe;
}

function normalizeCategoryIds(categoryIds) {
  return Array.isArray(categoryIds) ? categoryIds.map(String) : [];
}

function normalizeDeletedIds(arr) {
  return Array.isArray(arr) ? arr.map(String) : [];
}

function buildProductView(config) {
  const total = clampMin0(config.totalGrams);
  const out = {};

  for (const [label, v] of Object.entries(config.variants || {})) {
    const gramsPer = toNum(v?.gramsPerUnit, 0);
    const canSell = gramsPer > 0 ? Math.floor(total / gramsPer) : 0;

    out[label] = {
      gramsPerUnit: gramsPer,
      inventoryItemId: v.inventoryItemId,
      canSell,
    };
  }
  return out;
}

function snapshotProduct(productId) {
  const cfg = PRODUCT_CONFIG[productId];
  if (!cfg) return null;

  return {
    productId: String(productId),
    name: String(cfg.name || productId),
    totalGrams: clampMin0(cfg.totalGrams),
    categoryIds: normalizeCategoryIds(cfg.categoryIds),
    variants: buildProductView(cfg),
  };
}

// --------------------------------------------
// Persistance v2
// --------------------------------------------
function persistState(extra = {}) {
  const prev = loadState() || {};
  const deletedProductIds = normalizeDeletedIds(extra.deletedProductIds ?? prev.deletedProductIds);

  const products = {};
  for (const [pid, p] of Object.entries(PRODUCT_CONFIG)) {
    products[pid] = {
      name: String(p.name || pid),
      totalGrams: clampMin0(p.totalGrams),
      categoryIds: normalizeCategoryIds(p.categoryIds),
      variants: normalizeVariants(p.variants),
    };
  }

  saveState({
    version: 2,
    updatedAt: new Date().toISOString(),
    products,
    deletedProductIds,
  });
}

(function restoreState() {
  const saved = loadState() || {};

  // v2
  if (saved.version === 2 && saved.products && typeof saved.products === "object") {
    const restoredIds = Object.keys(saved.products);

    // 1) restore produits (remplace/ajoute)
    for (const [pid, p] of Object.entries(saved.products)) {
      PRODUCT_CONFIG[pid] = {
        name: String(p?.name || pid),
        totalGrams: clampMin0(p?.totalGrams),
        categoryIds: normalizeCategoryIds(p?.categoryIds),
        variants: normalizeVariants(p?.variants),
      };
    }

    // 2) applique les suppressions persistées (tombstones)
    const deleted = normalizeDeletedIds(saved.deletedProductIds);
    for (const pid of deleted) {
      // ✅ Ne "tombstone" pas les produits BASE : sinon ils disparaissent à chaque deploy.
      if (BASE_PRODUCT_CONFIG[pid]) continue;
      if (PRODUCT_CONFIG[pid]) delete PRODUCT_CONFIG[pid];
    }

    logEvent("stock_state_restore", {
      mode: "v2",
      products: restoredIds.length,
      deleted: deleted.length,
    });

    return;
  }

  // Legacy
  if (saved && typeof saved === "object") {
    let applied = 0;
    for (const [pid, data] of Object.entries(saved)) {
      if (!PRODUCT_CONFIG[pid]) continue;
      if (typeof data?.totalGrams === "number") PRODUCT_CONFIG[pid].totalGrams = clampMin0(data.totalGrams);
      if (Array.isArray(data?.categoryIds)) PRODUCT_CONFIG[pid].categoryIds = normalizeCategoryIds(data.categoryIds);
      applied++;
    }

    logEvent("stock_state_restore", {
      mode: "legacy",
      applied,
      base: Object.keys(PRODUCT_CONFIG).length,
    });
  }
})();

// --------------------------------------------
// Queue wrapper (anti race conditions)
// --------------------------------------------
function enqueue(fn) {
  if (stockQueue && typeof stockQueue.add === "function") return stockQueue.add(fn);
  return Promise.resolve().then(fn);
}

// --------------------------------------------
// API Stock
// --------------------------------------------
async function applyOrderToProduct(productId, gramsToSubtract) {
  const pid = String(productId);

  return enqueue(() => {
    const cfg = PRODUCT_CONFIG[pid];
    if (!cfg) return null;

    const g = clampMin0(gramsToSubtract);
    cfg.totalGrams = clampMin0(clampMin0(cfg.totalGrams) - g);

    persistState();
    return snapshotProduct(pid);
  });
}

async function restockProduct(productId, gramsDelta) {
  const pid = String(productId);

  return enqueue(() => {
    const cfg = PRODUCT_CONFIG[pid];
    if (!cfg) return null;

    const delta = toNum(gramsDelta, 0);
    cfg.totalGrams = clampMin0(clampMin0(cfg.totalGrams) + delta);

    persistState();
    return snapshotProduct(pid);
  });
}

function getStockSnapshot() {
  const stock = {};
  for (const [pid] of Object.entries(PRODUCT_CONFIG)) {
    stock[pid] = snapshotProduct(pid);
  }
  return stock;
}

// --------------------------------------------
// Catégories
// --------------------------------------------
function setProductCategories(productId, categoryIds) {
  const pid = String(productId);
  const cfg = PRODUCT_CONFIG[pid];
  if (!cfg) return false;

  const existing = new Set((listCategories?.() || []).map((c) => String(c.id)));
  const ids = normalizeCategoryIds(categoryIds).filter(
    (id) => existing.size === 0 || existing.has(String(id))
  );

  cfg.categoryIds = ids;
  persistState();
  return true;
}

// --------------------------------------------
// Import Shopify -> Upsert config
// --------------------------------------------
function upsertImportedProductConfig({ productId, name, totalGrams, variants, categoryIds }) {
  const pid = String(productId);

  const safeVariants = normalizeVariants(variants);
  if (!Object.keys(safeVariants).length) {
    throw new Error("Import: aucune variante valide (inventoryItemId/gramsPerUnit manquant)");
  }

  if (!PRODUCT_CONFIG[pid]) {
    PRODUCT_CONFIG[pid] = {
      name: String(name || pid),
      totalGrams: clampMin0(totalGrams),
      categoryIds: normalizeCategoryIds(categoryIds),
      variants: safeVariants,
    };
  } else {
    const cfg = PRODUCT_CONFIG[pid];
    cfg.name = String(name || cfg.name || pid);
    cfg.variants = safeVariants;

    if (Number.isFinite(Number(totalGrams))) cfg.totalGrams = clampMin0(totalGrams);
    if (Array.isArray(categoryIds)) cfg.categoryIds = normalizeCategoryIds(categoryIds);
    if (!Array.isArray(cfg.categoryIds)) cfg.categoryIds = [];
  }

  // ✅ Si le produit avait été "supprimé" dans l'UI, on le restaure lors d'un import.
  const prev = loadState() || {};
  const deleted = new Set(normalizeDeletedIds(prev.deletedProductIds));
  if (deleted.has(pid)) {
    deleted.delete(pid);
    persistState({ deletedProductIds: Array.from(deleted) });
  } else {
    persistState();
  }

  return snapshotProduct(pid);
}

// --------------------------------------------
// Catalog snapshot (UI)
// --------------------------------------------
function getCatalogSnapshot() {
  const categories = listCategories ? listCategories() : [];
  const products = Object.keys(PRODUCT_CONFIG).map((pid) => snapshotProduct(pid));
  return { products, categories };
}

// --------------------------------------------
// Suppression produit (config locale)
// --------------------------------------------
function removeProduct(productId) {
  const pid = String(productId);
  if (!PRODUCT_CONFIG[pid]) return false;

  delete PRODUCT_CONFIG[pid];

  // ✅ Par défaut, on ne "tombstone" pas les produits BASE.
  // (pour forcer une suppression persistée des produits base, mets ALLOW_DELETE_BASE_PRODUCTS=true)
  const allowDeleteBase = process.env.ALLOW_DELETE_BASE_PRODUCTS === "true";
  if (BASE_PRODUCT_CONFIG[pid] && !allowDeleteBase) {
    persistState();
    return true;
  }

  const prev = loadState() || {};
  const deleted = new Set(normalizeDeletedIds(prev.deletedProductIds));
  deleted.add(pid);

  persistState({ deletedProductIds: Array.from(deleted) });
  return true;
}

module.exports = {
  PRODUCT_CONFIG,
  applyOrderToProduct,
  restockProduct,
  getStockSnapshot,
  upsertImportedProductConfig,
  setProductCategories,
  getCatalogSnapshot,
  removeProduct,
};
