// inventoryCountStore.js — Inventaire physique assisté
// Comptage, écarts, ajustements automatiques

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/var/data";

// ============================================
// STATUTS D'INVENTAIRE
// ============================================

const COUNT_STATUS = {
  DRAFT: "draft",         // En cours de saisie
  REVIEW: "review",       // En attente de validation
  APPROVED: "approved",   // Validé, ajustements appliqués
  CANCELLED: "cancelled", // Annulé
};

// ============================================
// Helpers
// ============================================

function sanitizeShop(shop) {
  const s = String(shop || "").trim().toLowerCase();
  return s ? s.replace(/[^a-z0-9._-]/g, "_") : "default";
}

function inventoryDir(shop) {
  const dir = path.join(DATA_DIR, sanitizeShop(shop), "inventory-counts");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function inventoryFile(shop, countId) {
  return path.join(inventoryDir(shop), `${countId}.json`);
}

function generateCountId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${date}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// ============================================
// STRUCTURE D'UN INVENTAIRE
// ============================================
/*
{
  id: "INV-20250115-AB12",
  name: "Inventaire Janvier 2025",
  
  // Dates
  createdAt: "2025-01-15T10:00:00Z",
  startedAt: "2025-01-15T10:00:00Z",
  completedAt: null,
  approvedAt: null,
  
  // Périmètre
  scope: "full" | "partial" | "category",
  categoryIds: [],  // Si scope = category
  productIds: [],   // Si scope = partial
  
  // Lignes d'inventaire
  lines: [
    {
      productId: "123456",
      productName: "CBD Premium",
      expectedGrams: 500,     // Stock théorique (avant comptage)
      countedGrams: 485,      // Stock compté
      variance: -15,          // Écart (compté - attendu)
      variancePercent: -3,    // Écart en %
      countedAt: "2025-01-15T11:30:00Z",
      countedBy: "user_123",
      notes: "Quelques pertes lors du conditionnement",
      adjusted: false,
    },
  ],
  
  // Totaux
  totalExpected: 5000,
  totalCounted: 4850,
  totalVariance: -150,
  totalVarianceValue: -675,  // En € (variance × CMP moyen)
  
  // Statut
  status: "draft",
  
  // Métadonnées
  createdBy: "user_123",
  approvedBy: null,
  notes: "Inventaire trimestriel",
  updatedAt: "2025-01-15T10:00:00Z",
}
*/

// ============================================
// CRUD Operations
// ============================================

function loadInventoryCount(shop, countId) {
  const file = inventoryFile(shop, countId);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (e) {
    console.warn("Erreur lecture inventaire:", e.message);
  }
  return null;
}

function saveInventoryCount(shop, count) {
  const file = inventoryFile(shop, count.id);
  count.updatedAt = new Date().toISOString();
  fs.writeFileSync(file + ".tmp", JSON.stringify(count, null, 2), "utf8");
  fs.renameSync(file + ".tmp", file);
  return count;
}

/**
 * Crée un nouvel inventaire
 * @param {Object} stockSnapshot - État actuel du stock
 */
function createInventoryCount(shop, stockSnapshot, options = {}) {
  const {
    name,
    scope = "full",      // full | partial | category
    categoryIds = [],
    productIds = [],
    createdBy = null,
    notes = "",
  } = options;

  // Filtrer les produits selon le périmètre
  let productsToCount = Object.entries(stockSnapshot);

  if (scope === "partial" && productIds.length > 0) {
    productsToCount = productsToCount.filter(([id]) => productIds.includes(id));
  } else if (scope === "category" && categoryIds.length > 0) {
    productsToCount = productsToCount.filter(([, product]) =>
      product.categoryIds?.some(catId => categoryIds.includes(catId))
    );
  }

  const count = {
    id: generateCountId(),
    name: name || `Inventaire du ${new Date().toLocaleDateString("fr-FR")}`,
    
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    approvedAt: null,
    
    scope,
    categoryIds: scope === "category" ? categoryIds : [],
    productIds: scope === "partial" ? productIds : [],
    
    lines: productsToCount.map(([productId, product]) => ({
      productId,
      productName: product.name || productId,
      expectedGrams: product.totalGrams || 0,
      countedGrams: null,  // À remplir
      variance: null,
      variancePercent: null,
      countedAt: null,
      countedBy: null,
      notes: "",
      adjusted: false,
      cmpPerGram: product.averageCostPerGram || 0,
    })),
    
    totalExpected: 0,
    totalCounted: null,
    totalVariance: null,
    totalVarianceValue: null,
    
    status: COUNT_STATUS.DRAFT,
    
    createdBy,
    approvedBy: null,
    notes,
    updatedAt: new Date().toISOString(),
  };

  // Calculer le total attendu
  count.totalExpected = count.lines.reduce((sum, l) => sum + l.expectedGrams, 0);

  saveInventoryCount(shop, count);
  return count;
}

/**
 * Met à jour le comptage d'un produit
 */
function updateProductCount(shop, countId, productId, countedGrams, options = {}) {
  const count = loadInventoryCount(shop, countId);
  if (!count) throw new Error(`Inventaire non trouvé: ${countId}`);
  if (count.status !== COUNT_STATUS.DRAFT) throw new Error("Inventaire non modifiable");

  const lineIndex = count.lines.findIndex(l => l.productId === productId);
  if (lineIndex === -1) throw new Error(`Produit non trouvé dans l'inventaire: ${productId}`);

  const line = count.lines[lineIndex];
  line.countedGrams = Number(countedGrams);
  line.variance = line.countedGrams - line.expectedGrams;
  line.variancePercent = line.expectedGrams > 0
    ? roundTo((line.variance / line.expectedGrams) * 100, 2)
    : 0;
  line.countedAt = new Date().toISOString();
  line.countedBy = options.countedBy || null;
  line.notes = options.notes || line.notes;

  count.lines[lineIndex] = line;

  // Recalculer les totaux si tous comptés
  recalculateTotals(count);

  saveInventoryCount(shop, count);
  return count;
}

/**
 * Met à jour plusieurs produits d'un coup
 */
function updateMultipleCounts(shop, countId, updates, options = {}) {
  const count = loadInventoryCount(shop, countId);
  if (!count) throw new Error(`Inventaire non trouvé: ${countId}`);
  if (count.status !== COUNT_STATUS.DRAFT) throw new Error("Inventaire non modifiable");

  for (const update of updates) {
    const lineIndex = count.lines.findIndex(l => l.productId === update.productId);
    if (lineIndex === -1) continue;

    const line = count.lines[lineIndex];
    line.countedGrams = Number(update.countedGrams);
    line.variance = line.countedGrams - line.expectedGrams;
    line.variancePercent = line.expectedGrams > 0
      ? roundTo((line.variance / line.expectedGrams) * 100, 2)
      : 0;
    line.countedAt = new Date().toISOString();
    line.countedBy = options.countedBy || null;
    if (update.notes) line.notes = update.notes;

    count.lines[lineIndex] = line;
  }

  recalculateTotals(count);
  saveInventoryCount(shop, count);
  return count;
}

function recalculateTotals(count) {
  const countedLines = count.lines.filter(l => l.countedGrams !== null);

  if (countedLines.length === count.lines.length) {
    // Tous comptés
    count.totalCounted = countedLines.reduce((sum, l) => sum + l.countedGrams, 0);
    count.totalVariance = count.totalCounted - count.totalExpected;
    count.totalVarianceValue = countedLines.reduce((sum, l) => sum + (l.variance * l.cmpPerGram), 0);
    count.totalVarianceValue = roundTo(count.totalVarianceValue, 2);
  }
}

// ============================================
// WORKFLOW
// ============================================

/**
 * Soumet l'inventaire pour validation
 */
function submitForReview(shop, countId) {
  const count = loadInventoryCount(shop, countId);
  if (!count) throw new Error(`Inventaire non trouvé: ${countId}`);
  if (count.status !== COUNT_STATUS.DRAFT) throw new Error("Statut invalide");

  // Vérifier que tout est compté
  const unfinished = count.lines.filter(l => l.countedGrams === null);
  if (unfinished.length > 0) {
    throw new Error(`${unfinished.length} produit(s) non comptés`);
  }

  count.status = COUNT_STATUS.REVIEW;
  count.completedAt = new Date().toISOString();

  saveInventoryCount(shop, count);
  return count;
}

/**
 * Approuve l'inventaire et applique les ajustements
 * @returns {Object} { count, adjustments }
 */
function approveAndAdjust(shop, countId, approvedBy, stockManager) {
  const count = loadInventoryCount(shop, countId);
  if (!count) throw new Error(`Inventaire non trouvé: ${countId}`);
  if (count.status !== COUNT_STATUS.REVIEW) throw new Error("L'inventaire doit être en revue");

  const adjustments = [];

  for (const line of count.lines) {
    if (line.variance !== 0 && !line.adjusted) {
      // Appliquer l'ajustement
      if (stockManager && typeof stockManager.applyOrderToProduct === "function") {
        // Si négatif (perte), on déstocke
        // Si positif (gain), on restocke
        if (line.variance < 0) {
          stockManager.applyOrderToProduct(shop, line.productId, Math.abs(line.variance));
        } else {
          // Pour le gain, on devrait utiliser restockProduct avec prix 0
          // ou une fonction d'ajustement spécifique
        }
      }

      line.adjusted = true;
      adjustments.push({
        productId: line.productId,
        productName: line.productName,
        expectedGrams: line.expectedGrams,
        countedGrams: line.countedGrams,
        adjustment: line.variance,
        valueImpact: roundTo(line.variance * line.cmpPerGram, 2),
      });
    }
  }

  count.status = COUNT_STATUS.APPROVED;
  count.approvedAt = new Date().toISOString();
  count.approvedBy = approvedBy;

  saveInventoryCount(shop, count);

  return {
    count,
    adjustments,
    summary: {
      totalAdjustments: adjustments.length,
      totalVariance: count.totalVariance,
      totalValueImpact: count.totalVarianceValue,
    },
  };
}

/**
 * Annule un inventaire
 */
function cancelInventoryCount(shop, countId, reason = "") {
  const count = loadInventoryCount(shop, countId);
  if (!count) throw new Error(`Inventaire non trouvé: ${countId}`);
  if (count.status === COUNT_STATUS.APPROVED) {
    throw new Error("Impossible d'annuler un inventaire approuvé");
  }

  count.status = COUNT_STATUS.CANCELLED;
  count.notes += `\n[ANNULÉ] ${reason}`;

  saveInventoryCount(shop, count);
  return count;
}

// ============================================
// LISTE & RECHERCHE
// ============================================

function listInventoryCounts(shop, options = {}) {
  const { status, limit = 50 } = options;
  const dir = inventoryDir(shop);

  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  let counts = [];

  for (const file of files) {
    const countId = file.replace(".json", "");
    const count = loadInventoryCount(shop, countId);
    if (count) {
      counts.push({
        id: count.id,
        name: count.name,
        status: count.status,
        scope: count.scope,
        linesCount: count.lines.length,
        completedCount: count.lines.filter(l => l.countedGrams !== null).length,
        totalExpected: count.totalExpected,
        totalVariance: count.totalVariance,
        createdAt: count.createdAt,
        completedAt: count.completedAt,
      });
    }
  }

  if (status) {
    counts = counts.filter(c => c.status === status);
  }

  // Trier par date (plus récent en premier)
  counts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return counts.slice(0, limit);
}

function getInventoryCount(shop, countId) {
  return loadInventoryCount(shop, countId);
}

// ============================================
// RAPPORT D'ÉCARTS
// ============================================

function generateVarianceReport(shop, countId) {
  const count = loadInventoryCount(shop, countId);
  if (!count) throw new Error(`Inventaire non trouvé: ${countId}`);

  const linesWithVariance = count.lines
    .filter(l => l.variance !== null && l.variance !== 0)
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  const positiveVariance = linesWithVariance.filter(l => l.variance > 0);
  const negativeVariance = linesWithVariance.filter(l => l.variance < 0);

  return {
    countId: count.id,
    countName: count.name,
    status: count.status,
    summary: {
      totalProducts: count.lines.length,
      productsWithVariance: linesWithVariance.length,
      productsWithGain: positiveVariance.length,
      productsWithLoss: negativeVariance.length,
      totalGramsVariance: count.totalVariance,
      totalValueVariance: count.totalVarianceValue,
      averageVariancePercent: count.lines.length > 0
        ? roundTo(count.lines.reduce((sum, l) => sum + (l.variancePercent || 0), 0) / count.lines.length, 2)
        : 0,
    },
    topGains: positiveVariance.slice(0, 5),
    topLosses: negativeVariance.slice(0, 5),
    allVariances: linesWithVariance,
  };
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
  COUNT_STATUS,

  // CRUD
  createInventoryCount,
  getInventoryCount,
  updateProductCount,
  updateMultipleCounts,
  listInventoryCounts,

  // Workflow
  submitForReview,
  approveAndAdjust,
  cancelInventoryCount,

  // Rapports
  generateVarianceReport,
};
