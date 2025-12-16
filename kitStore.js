// kitStore.js — Gestion des produits composés (Kits / Bundles)
// Un kit est composé de plusieurs produits avec leurs quantités

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/var/data";

// ============================================
// Helpers
// ============================================

function sanitizeShop(shop) {
  const s = String(shop || "").trim().toLowerCase();
  return s ? s.replace(/[^a-z0-9._-]/g, "_") : "default";
}

function kitsFile(shop) {
  const dir = path.join(DATA_DIR, sanitizeShop(shop));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "kits.json");
}

function generateId() {
  return `kit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================
// STRUCTURE D'UN KIT
// ============================================
/*
{
  id: "kit_123",
  name: "Pack Découverte CBD",
  description: "3 variétés pour découvrir notre gamme",
  sku: "PACK-DECOUVERTE",
  
  // Composants (recette)
  components: [
    { productId: "prod_1", productName: "CBD Premium", grams: 10 },
    { productId: "prod_2", productName: "CBD Relax", grams: 10 },
    { productId: "prod_3", productName: "CBD Sport", grams: 5 },
  ],
  
  // Totaux
  totalGrams: 25,
  totalCost: 112.50,  // Somme des CMP des composants
  
  // Prix de vente
  sellingPrice: 150,
  margin: 37.50,
  marginPercent: 25,
  
  // Shopify (optionnel)
  shopifyProductId: "123456789",
  shopifyVariantId: "987654321",
  
  // Stock
  stockMethod: "calculated",  // calculated (basé sur composants) | fixed
  fixedStock: null,
  
  // Statut
  status: "active" | "inactive" | "draft",
  
  // Métadonnées
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-15T00:00:00Z",
}
*/

// ============================================
// CRUD Operations
// ============================================

function loadKits(shop) {
  const file = kitsFile(shop);
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(data.kits) ? data.kits : [];
    }
  } catch (e) {
    console.warn("Erreur lecture kits:", e.message);
  }
  return [];
}

function saveKits(shop, kits) {
  const file = kitsFile(shop);
  const data = { updatedAt: new Date().toISOString(), kits };
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(file + ".tmp", file);
  return kits;
}

function createKit(shop, kitData) {
  const kits = loadKits(shop);
  
  const kit = {
    id: generateId(),
    name: String(kitData.name || "").trim(),
    description: kitData.description || "",
    sku: String(kitData.sku || "").trim().toUpperCase() || null,
    
    components: (kitData.components || []).map(c => ({
      productId: String(c.productId),
      productName: c.productName || "",
      grams: Number(c.grams || 0),
    })),
    
    totalGrams: 0,
    totalCost: 0,
    
    sellingPrice: Number(kitData.sellingPrice || 0),
    margin: 0,
    marginPercent: 0,
    
    shopifyProductId: kitData.shopifyProductId || null,
    shopifyVariantId: kitData.shopifyVariantId || null,
    
    stockMethod: kitData.stockMethod || "calculated",
    fixedStock: kitData.fixedStock || null,
    
    status: "active",
    
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  if (!kit.name) throw new Error("Nom du kit requis");
  if (kit.components.length === 0) throw new Error("Au moins un composant requis");
  
  // Calculer les totaux
  kit.totalGrams = kit.components.reduce((sum, c) => sum + c.grams, 0);
  
  kits.push(kit);
  saveKits(shop, kits);
  
  return kit;
}

function getKit(shop, kitId) {
  const kits = loadKits(shop);
  return kits.find(k => k.id === kitId) || null;
}

function getKitBySku(shop, sku) {
  const kits = loadKits(shop);
  return kits.find(k => k.sku && k.sku.toLowerCase() === sku.toLowerCase()) || null;
}

function updateKit(shop, kitId, updates) {
  const kits = loadKits(shop);
  const index = kits.findIndex(k => k.id === kitId);
  if (index === -1) throw new Error(`Kit non trouvé: ${kitId}`);
  
  const kit = kits[index];
  
  if (updates.name !== undefined) kit.name = String(updates.name).trim();
  if (updates.description !== undefined) kit.description = updates.description;
  if (updates.sku !== undefined) kit.sku = String(updates.sku).trim().toUpperCase() || null;
  if (updates.sellingPrice !== undefined) kit.sellingPrice = Number(updates.sellingPrice);
  if (updates.shopifyProductId !== undefined) kit.shopifyProductId = updates.shopifyProductId;
  if (updates.shopifyVariantId !== undefined) kit.shopifyVariantId = updates.shopifyVariantId;
  if (updates.stockMethod !== undefined) kit.stockMethod = updates.stockMethod;
  if (updates.fixedStock !== undefined) kit.fixedStock = updates.fixedStock;
  if (updates.status !== undefined) kit.status = updates.status;
  
  if (updates.components !== undefined) {
    kit.components = updates.components.map(c => ({
      productId: String(c.productId),
      productName: c.productName || "",
      grams: Number(c.grams || 0),
    }));
    kit.totalGrams = kit.components.reduce((sum, c) => sum + c.grams, 0);
  }
  
  kit.updatedAt = new Date().toISOString();
  
  kits[index] = kit;
  saveKits(shop, kits);
  return kit;
}

function deleteKit(shop, kitId) {
  const kits = loadKits(shop);
  const filtered = kits.filter(k => k.id !== kitId);
  saveKits(shop, filtered);
  return true;
}

function listKits(shop, options = {}) {
  const { status, search } = options;
  let kits = loadKits(shop);
  
  if (status) kits = kits.filter(k => k.status === status);
  
  if (search) {
    const q = search.toLowerCase();
    kits = kits.filter(k =>
      k.name.toLowerCase().includes(q) ||
      (k.sku && k.sku.toLowerCase().includes(q))
    );
  }
  
  return kits;
}

// ============================================
// CALCUL DE STOCK & COÛT
// ============================================

/**
 * Calcule le stock disponible d'un kit (basé sur ses composants)
 * Le stock d'un kit = min(stock_composant / qty_composant)
 */
function calculateKitStock(shop, kitId, stockSnapshot) {
  const kit = getKit(shop, kitId);
  if (!kit) return { stock: 0, error: "Kit non trouvé" };
  
  if (kit.stockMethod === "fixed") {
    return { stock: kit.fixedStock || 0, method: "fixed" };
  }
  
  let minKitsPossible = Infinity;
  const componentDetails = [];
  
  for (const component of kit.components) {
    const productStock = stockSnapshot[component.productId]?.totalGrams || 0;
    const kitsFromThisComponent = component.grams > 0 
      ? Math.floor(productStock / component.grams)
      : Infinity;
    
    componentDetails.push({
      productId: component.productId,
      productName: component.productName,
      gramsPerKit: component.grams,
      stockAvailable: productStock,
      kitsPossible: kitsFromThisComponent,
      isLimiting: false,
    });
    
    if (kitsFromThisComponent < minKitsPossible) {
      minKitsPossible = kitsFromThisComponent;
    }
  }
  
  // Marquer le composant limitant
  for (const detail of componentDetails) {
    if (detail.kitsPossible === minKitsPossible) {
      detail.isLimiting = true;
    }
  }
  
  return {
    stock: minKitsPossible === Infinity ? 0 : minKitsPossible,
    method: "calculated",
    componentDetails,
    limitingFactor: componentDetails.find(d => d.isLimiting),
  };
}

/**
 * Calcule le coût d'un kit (somme des CMP des composants)
 */
function calculateKitCost(shop, kitId, stockSnapshot) {
  const kit = getKit(shop, kitId);
  if (!kit) return { cost: 0, error: "Kit non trouvé" };
  
  let totalCost = 0;
  const componentCosts = [];
  
  for (const component of kit.components) {
    const product = stockSnapshot[component.productId];
    const cmp = product?.averageCostPerGram || 0;
    const componentCost = cmp * component.grams;
    
    componentCosts.push({
      productId: component.productId,
      productName: component.productName,
      grams: component.grams,
      cmpPerGram: cmp,
      totalCost: componentCost,
    });
    
    totalCost += componentCost;
  }
  
  const margin = kit.sellingPrice - totalCost;
  const marginPercent = kit.sellingPrice > 0 ? (margin / kit.sellingPrice) * 100 : 0;
  
  return {
    totalCost: roundTo(totalCost, 2),
    sellingPrice: kit.sellingPrice,
    margin: roundTo(margin, 2),
    marginPercent: roundTo(marginPercent, 2),
    componentCosts,
  };
}

/**
 * Met à jour les coûts et marges d'un kit
 */
function refreshKitCosts(shop, kitId, stockSnapshot) {
  const costs = calculateKitCost(shop, kitId, stockSnapshot);
  if (costs.error) return costs;
  
  return updateKit(shop, kitId, {
    totalCost: costs.totalCost,
    margin: costs.margin,
    marginPercent: costs.marginPercent,
  });
}

// ============================================
// DÉSTOCKAGE D'UN KIT
// ============================================

/**
 * Déstocke les composants d'un kit lors d'une vente
 * @returns {Array} Liste des déductions par composant
 */
function deductKitComponents(shop, kitId, quantity = 1, stockManager) {
  const kit = getKit(shop, kitId);
  if (!kit) throw new Error(`Kit non trouvé: ${kitId}`);
  
  const deductions = [];
  
  for (const component of kit.components) {
    const gramsToDeduct = component.grams * quantity;
    
    deductions.push({
      productId: component.productId,
      productName: component.productName,
      gramsDeducted: gramsToDeduct,
    });
    
    // Appliquer la déduction via stockManager si fourni
    if (stockManager && typeof stockManager.applyOrderToProduct === "function") {
      stockManager.applyOrderToProduct(shop, component.productId, gramsToDeduct);
    }
  }
  
  return {
    kitId,
    kitName: kit.name,
    quantity,
    totalGramsDeducted: kit.totalGrams * quantity,
    deductions,
  };
}

// ============================================
// KITS POUR UN PRODUIT
// ============================================

/**
 * Trouve tous les kits qui contiennent un produit donné
 */
function getKitsContainingProduct(shop, productId) {
  const kits = loadKits(shop);
  
  return kits
    .filter(k => k.components.some(c => c.productId === productId))
    .map(k => ({
      kitId: k.id,
      kitName: k.name,
      gramsInKit: k.components.find(c => c.productId === productId)?.grams || 0,
    }));
}

// ============================================
// STATS
// ============================================

function getKitStats(shop, stockSnapshot) {
  const kits = loadKits(shop);
  
  const stats = {
    total: kits.length,
    active: kits.filter(k => k.status === "active").length,
    inactive: kits.filter(k => k.status !== "active").length,
    totalValue: 0,
    totalMargin: 0,
    averageMarginPercent: 0,
    outOfStock: 0,
  };
  
  let marginSum = 0;
  let marginCount = 0;
  
  for (const kit of kits.filter(k => k.status === "active")) {
    const stock = calculateKitStock(shop, kit.id, stockSnapshot);
    const costs = calculateKitCost(shop, kit.id, stockSnapshot);
    
    if (stock.stock === 0) stats.outOfStock++;
    
    stats.totalValue += kit.sellingPrice * stock.stock;
    stats.totalMargin += costs.margin * stock.stock;
    
    if (costs.marginPercent > 0) {
      marginSum += costs.marginPercent;
      marginCount++;
    }
  }
  
  stats.averageMarginPercent = marginCount > 0 ? roundTo(marginSum / marginCount, 2) : 0;
  
  return stats;
}

// ============================================
// HELPERS
// ============================================

function roundTo(num, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

// ============================================
// Exports
// ============================================

module.exports = {
  // CRUD
  loadKits,
  createKit,
  getKit,
  getKitBySku,
  updateKit,
  deleteKit,
  listKits,
  
  // Stock & Coût
  calculateKitStock,
  calculateKitCost,
  refreshKitCosts,
  
  // Déstockage
  deductKitComponents,
  
  // Recherche
  getKitsContainingProduct,
  
  // Stats
  getKitStats,
};
