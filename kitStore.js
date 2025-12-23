// kitStore.js - Gestion des Kits, Bundles et Recettes (BOM)
// v1.0 - Bill of Materials, assemblage, mapping Shopify, calcul marges

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/var/data";

// ============================================
// CONSTANTES
// ============================================

const KIT_TYPE = {
  KIT: "kit",           // Pack interne (coffret, box)
  BUNDLE: "bundle",     // Bundle Shopify
  RECIPE: "recipe",     // Recette de fabrication
};

const KIT_STATUS = {
  ACTIVE: "active",
  DRAFT: "draft",
  ARCHIVED: "archived",
};

const PRICING_MODE = {
  FIXED: "fixed",           // Prix fixe défini
  SUM_COMPONENTS: "sum",    // Prix = somme des composants
  DISCOUNT_PCT: "discount", // Somme composants - X%
};

const UNIT_TYPE = {
  GRAM: "g",
  KILOGRAM: "kg",
  UNIT: "unit",
  MILLILITER: "ml",
  LITER: "l",
  PIECE: "pcs",
};

const EVENT_TYPE = {
  SALE_CONSUME: "sale_consume",   // Vente = décrémente composants
  ASSEMBLY: "assembly",           // Assemblage manuel
  DISASSEMBLY: "disassembly",     // Désassemblage
  ADJUSTMENT: "adjustment",       // Ajustement manuel
  CREATED: "created",
  UPDATED: "updated",
  ARCHIVED: "archived",
};

// ============================================
// HELPERS
// ============================================

function kitDir(shop) {
  const dir = path.join(DATA_DIR, shop, "kits");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function kitFile(shop) {
  return path.join(kitDir(shop), "kits.json");
}

function eventsFile(shop) {
  return path.join(kitDir(shop), "events.json");
}

function loadKits(shop) {
  try {
    const file = kitFile(shop);
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
  const file = kitFile(shop);
  const data = { updatedAt: new Date().toISOString(), kits };
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(file + ".tmp", file);
  return kits;
}

function loadEvents(shop) {
  try {
    const file = eventsFile(shop);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(data.events) ? data.events : [];
    }
  } catch (e) {
    console.warn("Erreur lecture events kits:", e.message);
  }
  return [];
}

function saveEvents(shop, events) {
  const file = eventsFile(shop);
  // Garder seulement les 1000 derniers événements
  const trimmed = events.slice(-1000);
  const data = { updatedAt: new Date().toISOString(), events: trimmed };
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(file + ".tmp", file);
  return trimmed;
}

function generateKitId() {
  return `kit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function generateItemId() {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
}

function generateEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================
// CRUD KITS
// ============================================

/**
 * Créer un kit/bundle/recette
 */
function createKit(shop, kitData) {
  const kits = loadKits(shop);
  
  // Validation
  if (!kitData.name || !kitData.name.trim()) {
    throw new Error("Nom du kit requis");
  }
  
  const kit = {
    id: generateKitId(),
    name: kitData.name.trim(),
    sku: kitData.sku || null,
    type: kitData.type || KIT_TYPE.KIT,
    status: kitData.status || KIT_STATUS.DRAFT,
    
    // Pricing
    pricingMode: kitData.pricingMode || PRICING_MODE.FIXED,
    salePrice: Number(kitData.salePrice) || 0,
    discountPercent: Number(kitData.discountPercent) || 0,
    
    // Catégorie et tags
    categoryId: kitData.categoryId || null,
    tags: Array.isArray(kitData.tags) ? kitData.tags : [],
    
    // Mapping Shopify
    shopifyProductId: kitData.shopifyProductId || null,
    shopifyVariantId: kitData.shopifyVariantId || null,
    
    // Stock du kit (si géré comme produit stockable)
    isStockable: kitData.isStockable || false,
    stockQuantity: Number(kitData.stockQuantity) || 0,
    
    // Composants (BOM)
    items: [],
    
    // Métadonnées
    notes: kitData.notes || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  kits.push(kit);
  saveKits(shop, kits);
  
  // Log event
  logEvent(shop, {
    type: EVENT_TYPE.CREATED,
    kitId: kit.id,
    kitName: kit.name,
    details: { type: kit.type, pricingMode: kit.pricingMode },
  });
  
  return kit;
}

/**
 * Récupérer un kit par ID
 */
function getKit(shop, kitId) {
  const kits = loadKits(shop);
  return kits.find(k => k.id === kitId) || null;
}

/**
 * Récupérer un kit par SKU
 */
function getKitBySku(shop, sku) {
  if (!sku) return null;
  const kits = loadKits(shop);
  return kits.find(k => k.sku && k.sku.toLowerCase() === sku.toLowerCase()) || null;
}

/**
 * Récupérer un kit par Shopify variant ID
 */
function getKitByShopifyVariant(shop, variantId) {
  if (!variantId) return null;
  const kits = loadKits(shop);
  return kits.find(k => k.shopifyVariantId === String(variantId)) || null;
}

/**
 * Mettre à jour un kit
 */
function updateKit(shop, kitId, updates) {
  const kits = loadKits(shop);
  const index = kits.findIndex(k => k.id === kitId);
  
  if (index === -1) {
    throw new Error("Kit non trouvé");
  }
  
  const kit = kits[index];
  const changes = {};
  
  // Champs modifiables
  const allowedFields = [
    "name", "sku", "type", "status", 
    "pricingMode", "salePrice", "discountPercent",
    "categoryId", "tags", "notes",
    "shopifyProductId", "shopifyVariantId",
    "isStockable", "stockQuantity"
  ];
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      changes[field] = { from: kit[field], to: updates[field] };
      kit[field] = updates[field];
    }
  }
  
  kit.updatedAt = new Date().toISOString();
  saveKits(shop, kits);
  
  // Log event
  logEvent(shop, {
    type: EVENT_TYPE.UPDATED,
    kitId: kit.id,
    kitName: kit.name,
    details: { changes },
  });
  
  return kit;
}

/**
 * Archiver un kit
 */
function archiveKit(shop, kitId) {
  return updateKit(shop, kitId, { status: KIT_STATUS.ARCHIVED });
}

/**
 * Supprimer un kit (définitif)
 */
function deleteKit(shop, kitId) {
  const kits = loadKits(shop);
  const index = kits.findIndex(k => k.id === kitId);
  
  if (index === -1) {
    throw new Error("Kit non trouvé");
  }
  
  const kit = kits[index];
  kits.splice(index, 1);
  saveKits(shop, kits);
  
  // Log event
  logEvent(shop, {
    type: EVENT_TYPE.ARCHIVED,
    kitId: kit.id,
    kitName: kit.name,
    details: { deleted: true },
  });
  
  return { deleted: true, kit };
}

/**
 * Lister les kits avec filtres
 */
function listKits(shop, options = {}) {
  let kits = loadKits(shop);
  
  const { status, type, categoryId, search, includeArchived } = options;
  
  // Filtres
  if (!includeArchived) {
    kits = kits.filter(k => k.status !== KIT_STATUS.ARCHIVED);
  }
  if (status) {
    kits = kits.filter(k => k.status === status);
  }
  if (type) {
    kits = kits.filter(k => k.type === type);
  }
  if (categoryId) {
    kits = kits.filter(k => k.categoryId === categoryId);
  }
  if (search) {
    const q = search.toLowerCase();
    kits = kits.filter(k => 
      k.name.toLowerCase().includes(q) ||
      (k.sku && k.sku.toLowerCase().includes(q))
    );
  }
  
  // Tri alphabétique par défaut
  kits.sort((a, b) => a.name.localeCompare(b.name));
  
  return kits;
}

// ============================================
// GESTION DES COMPOSANTS (BOM)
// ============================================

/**
 * Ajouter un composant au kit
 */
function addKitItem(shop, kitId, itemData) {
  const kits = loadKits(shop);
  const kit = kits.find(k => k.id === kitId);
  
  if (!kit) {
    throw new Error("Kit non trouvé");
  }
  
  if (!itemData.productId) {
    throw new Error("productId requis");
  }
  
  // Vérifier si le produit n'est pas déjà dans le kit
  const existing = kit.items.find(i => 
    i.productId === itemData.productId && 
    (i.variantId || null) === (itemData.variantId || null)
  );
  
  if (existing) {
    throw new Error("Ce produit est déjà dans le kit");
  }
  
  const item = {
    id: generateItemId(),
    productId: String(itemData.productId),
    variantId: itemData.variantId ? String(itemData.variantId) : null,
    productName: itemData.productName || "",
    
    quantity: Number(itemData.quantity) || 1,
    unitType: itemData.unitType || UNIT_TYPE.GRAM,
    
    // Options avancées (PRO)
    isOptional: itemData.isOptional || false,
    choiceGroupId: itemData.choiceGroupId || null,
    
    // Pertes et arrondis
    wastePct: Number(itemData.wastePct) || 0,
    roundingRule: itemData.roundingRule || null,
    
    // Freebie (cadeau inclus)
    isFreebie: itemData.isFreebie || false,
    
    // Prix override (si prix composant différent du CMP)
    priceOverride: itemData.priceOverride !== undefined ? Number(itemData.priceOverride) : null,
    
    addedAt: new Date().toISOString(),
  };
  
  kit.items.push(item);
  kit.updatedAt = new Date().toISOString();
  saveKits(shop, kits);
  
  return { kit, item };
}

/**
 * Mettre à jour un composant
 */
function updateKitItem(shop, kitId, itemId, updates) {
  const kits = loadKits(shop);
  const kit = kits.find(k => k.id === kitId);
  
  if (!kit) {
    throw new Error("Kit non trouvé");
  }
  
  const item = kit.items.find(i => i.id === itemId);
  if (!item) {
    throw new Error("Composant non trouvé");
  }
  
  // Champs modifiables
  const allowedFields = [
    "quantity", "unitType", "isOptional", "choiceGroupId",
    "wastePct", "roundingRule", "isFreebie", "priceOverride", "productName"
  ];
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      item[field] = updates[field];
    }
  }
  
  item.updatedAt = new Date().toISOString();
  kit.updatedAt = new Date().toISOString();
  saveKits(shop, kits);
  
  return { kit, item };
}

/**
 * Supprimer un composant
 */
function removeKitItem(shop, kitId, itemId) {
  const kits = loadKits(shop);
  const kit = kits.find(k => k.id === kitId);
  
  if (!kit) {
    throw new Error("Kit non trouvé");
  }
  
  const index = kit.items.findIndex(i => i.id === itemId);
  if (index === -1) {
    throw new Error("Composant non trouvé");
  }
  
  const removed = kit.items.splice(index, 1)[0];
  kit.updatedAt = new Date().toISOString();
  saveKits(shop, kits);
  
  return { kit, removed };
}

// ============================================
// CALCUL COÛTS & MARGES
// ============================================

/**
 * Calculer le coût et la marge d'un kit
 * @param {Object} kit - Le kit
 * @param {Object} productCosts - Map productId -> { cmp, stock, name }
 * @param {string} costMethod - "cmp" ou "fifo"
 */
function calculateKitCostAndMargin(kit, productCosts = {}, costMethod = "cmp") {
  let totalCost = 0;
  let componentsPriceSum = 0;
  const itemDetails = [];
  const stockIssues = [];
  
  for (const item of kit.items) {
    const productData = productCosts[item.productId] || {};
    const costPerUnit = item.priceOverride !== null ? item.priceOverride : (productData.cmp || 0);
    
    // Quantité avec pertes
    let effectiveQty = item.quantity;
    if (item.wastePct > 0) {
      effectiveQty = item.quantity * (1 + item.wastePct / 100);
    }
    
    // Arrondi si spécifié
    if (item.roundingRule) {
      const rule = parseFloat(item.roundingRule);
      if (rule > 0) {
        effectiveQty = Math.ceil(effectiveQty / rule) * rule;
      }
    }
    
    const itemCost = effectiveQty * costPerUnit;
    const itemPrice = item.isFreebie ? 0 : effectiveQty * costPerUnit; // Freebies = pas de revenu
    
    totalCost += itemCost;
    componentsPriceSum += itemPrice;
    
    // Vérifier stock disponible
    const availableStock = productData.stock || 0;
    const hasStockIssue = availableStock < effectiveQty;
    
    if (hasStockIssue) {
      stockIssues.push({
        productId: item.productId,
        productName: item.productName || productData.name || item.productId,
        required: effectiveQty,
        available: availableStock,
        missing: effectiveQty - availableStock,
      });
    }
    
    itemDetails.push({
      itemId: item.id,
      productId: item.productId,
      productName: item.productName || productData.name || item.productId,
      quantity: item.quantity,
      effectiveQuantity: effectiveQty,
      unitType: item.unitType,
      costPerUnit,
      itemCost,
      isFreebie: item.isFreebie,
      isOptional: item.isOptional,
      hasStockIssue,
      availableStock,
    });
  }
  
  // Calculer le prix de vente selon le mode
  let salePrice = 0;
  switch (kit.pricingMode) {
    case PRICING_MODE.FIXED:
      salePrice = kit.salePrice || 0;
      break;
    case PRICING_MODE.SUM_COMPONENTS:
      salePrice = componentsPriceSum;
      break;
    case PRICING_MODE.DISCOUNT_PCT:
      salePrice = componentsPriceSum * (1 - (kit.discountPercent || 0) / 100);
      break;
    default:
      salePrice = kit.salePrice || 0;
  }
  
  // Marge
  const margin = salePrice - totalCost;
  const marginPercent = salePrice > 0 ? (margin / salePrice) * 100 : 0;
  
  // Alertes
  const alerts = [];
  if (marginPercent < 0) {
    alerts.push({ type: "negative_margin", message: "Marge négative" });
  } else if (marginPercent < 15) {
    alerts.push({ type: "low_margin", message: "Marge faible (< 15%)" });
  }
  
  if (stockIssues.length > 0) {
    alerts.push({ type: "stock_issue", message: `${stockIssues.length} composant(s) en rupture`, stockIssues });
  }
  
  return {
    kitId: kit.id,
    kitName: kit.name,
    totalCost: Math.round(totalCost * 100) / 100,
    salePrice: Math.round(salePrice * 100) / 100,
    margin: Math.round(margin * 100) / 100,
    marginPercent: Math.round(marginPercent * 10) / 10,
    componentsPriceSum: Math.round(componentsPriceSum * 100) / 100,
    pricingMode: kit.pricingMode,
    itemCount: kit.items.length,
    itemDetails,
    stockIssues,
    alerts,
    hasIssues: alerts.length > 0,
  };
}

// ============================================
// ASSEMBLAGE DE KITS
// ============================================

/**
 * Assembler des kits (décrémenter composants, incrémenter stock kit)
 * @returns {Object} Résultat de l'assemblage
 */
function assembleKits(shop, kitId, quantity, options = {}) {
  const { stockManager, batchStore, allowNegative = false, notes = "" } = options;
  
  const kit = getKit(shop, kitId);
  if (!kit) {
    throw new Error("Kit non trouvé");
  }
  
  if (quantity <= 0) {
    throw new Error("Quantité invalide");
  }
  
  const consumed = [];
  const errors = [];
  
  // Pour chaque composant, vérifier et décrémenter le stock
  for (const item of kit.items) {
    if (item.isOptional) continue; // Skip optional items
    
    const qtyNeeded = item.quantity * quantity;
    
    // Appliquer pertes
    let effectiveQty = qtyNeeded;
    if (item.wastePct > 0) {
      effectiveQty = qtyNeeded * (1 + item.wastePct / 100);
    }
    
    // Vérifier stock disponible
    if (stockManager) {
      const currentStock = stockManager.getProductStock(shop, item.productId);
      
      if (currentStock < effectiveQty && !allowNegative) {
        errors.push({
          productId: item.productId,
          productName: item.productName,
          required: effectiveQty,
          available: currentStock,
          missing: effectiveQty - currentStock,
        });
        continue;
      }
    }
    
    consumed.push({
      productId: item.productId,
      productName: item.productName,
      quantityPerKit: item.quantity,
      totalQuantity: effectiveQty,
      unitType: item.unitType,
    });
  }
  
  // Si erreurs de stock, ne pas assembler
  if (errors.length > 0) {
    return {
      success: false,
      assembled: 0,
      errors,
      message: "Stock insuffisant pour certains composants",
    };
  }
  
  // Décrémenter les stocks des composants
  for (const c of consumed) {
    if (stockManager && typeof stockManager.adjustStock === "function") {
      stockManager.adjustStock(shop, c.productId, -c.totalQuantity, {
        reason: `Assemblage kit: ${kit.name} x${quantity}`,
        source: "kit_assembly",
        kitId: kit.id,
      });
    }
  }
  
  // Incrémenter le stock du kit si stockable
  if (kit.isStockable) {
    const kits = loadKits(shop);
    const kitToUpdate = kits.find(k => k.id === kitId);
    if (kitToUpdate) {
      kitToUpdate.stockQuantity = (kitToUpdate.stockQuantity || 0) + quantity;
      kitToUpdate.updatedAt = new Date().toISOString();
      saveKits(shop, kits);
    }
  }
  
  // Log event
  logEvent(shop, {
    type: EVENT_TYPE.ASSEMBLY,
    kitId: kit.id,
    kitName: kit.name,
    quantity,
    consumed,
    notes,
    source: "manual",
  });
  
  return {
    success: true,
    assembled: quantity,
    consumed,
    newKitStock: kit.isStockable ? (kit.stockQuantity || 0) + quantity : null,
    message: `${quantity} kit(s) assemblé(s) avec succès`,
  };
}

// ============================================
// CONSOMMATION LORS DE VENTES
// ============================================

/**
 * Consommer les composants d'un kit lors d'une vente
 */
function consumeKitForSale(shop, kitId, quantity, options = {}) {
  const { stockManager, orderId, orderNumber, source = "shopify" } = options;
  
  const kit = getKit(shop, kitId);
  if (!kit) {
    return { success: false, error: "Kit non trouvé" };
  }
  
  const consumed = [];
  
  for (const item of kit.items) {
    if (item.isOptional) continue;
    
    let effectiveQty = item.quantity * quantity;
    if (item.wastePct > 0) {
      effectiveQty = effectiveQty * (1 + item.wastePct / 100);
    }
    
    // Décrémenter le stock
    if (stockManager && typeof stockManager.adjustStock === "function") {
      stockManager.adjustStock(shop, item.productId, -effectiveQty, {
        reason: `Vente kit: ${kit.name} x${quantity}`,
        source: "kit_sale",
        kitId: kit.id,
        orderId,
      });
    }
    
    consumed.push({
      productId: item.productId,
      productName: item.productName,
      quantity: effectiveQty,
      unitType: item.unitType,
    });
  }
  
  // Si kit stockable, décrémenter aussi son stock
  if (kit.isStockable) {
    const kits = loadKits(shop);
    const kitToUpdate = kits.find(k => k.id === kitId);
    if (kitToUpdate && kitToUpdate.stockQuantity >= quantity) {
      kitToUpdate.stockQuantity -= quantity;
      kitToUpdate.updatedAt = new Date().toISOString();
      saveKits(shop, kits);
    }
  }
  
  // Log event
  logEvent(shop, {
    type: EVENT_TYPE.SALE_CONSUME,
    kitId: kit.id,
    kitName: kit.name,
    quantity,
    consumed,
    orderId,
    orderNumber,
    source,
  });
  
  return {
    success: true,
    consumed,
    kitId: kit.id,
    kitName: kit.name,
    quantity,
  };
}

// ============================================
// SIMULATION
// ============================================

/**
 * Simuler la vente de X kits
 */
function simulateKitSales(shop, kitId, quantity, productCosts = {}) {
  const kit = getKit(shop, kitId);
  if (!kit) {
    throw new Error("Kit non trouvé");
  }
  
  const costData = calculateKitCostAndMargin(kit, productCosts);
  
  // Calculer les stocks restants après vente
  const stockAfterSale = [];
  for (const item of costData.itemDetails) {
    const currentStock = productCosts[item.productId]?.stock || 0;
    const consumed = item.effectiveQuantity * quantity;
    const remaining = currentStock - consumed;
    
    stockAfterSale.push({
      productId: item.productId,
      productName: item.productName,
      currentStock,
      consumed,
      remaining,
      inShortage: remaining < 0,
    });
  }
  
  return {
    kitId: kit.id,
    kitName: kit.name,
    quantitySimulated: quantity,
    
    // Revenus
    totalRevenue: Math.round(costData.salePrice * quantity * 100) / 100,
    totalCost: Math.round(costData.totalCost * quantity * 100) / 100,
    totalMargin: Math.round(costData.margin * quantity * 100) / 100,
    marginPercent: costData.marginPercent,
    
    // Stock après simulation
    stockAfterSale,
    hasShortage: stockAfterSale.some(s => s.inShortage),
    
    // Capacité max de production
    maxProducible: calculateMaxProducible(kit, productCosts),
  };
}

/**
 * Calculer le nombre max de kits produisibles
 */
function calculateMaxProducible(kit, productCosts = {}) {
  let maxKits = Infinity;
  
  for (const item of kit.items) {
    if (item.isOptional) continue;
    
    const availableStock = productCosts[item.productId]?.stock || 0;
    let qtyNeeded = item.quantity;
    if (item.wastePct > 0) {
      qtyNeeded = qtyNeeded * (1 + item.wastePct / 100);
    }
    
    if (qtyNeeded > 0) {
      const possible = Math.floor(availableStock / qtyNeeded);
      maxKits = Math.min(maxKits, possible);
    }
  }
  
  return maxKits === Infinity ? 0 : maxKits;
}

// ============================================
// MAPPING SHOPIFY
// ============================================

/**
 * Mapper un kit à un produit/variant Shopify
 */
function mapKitToShopify(shop, kitId, shopifyProductId, shopifyVariantId = null) {
  const kits = loadKits(shop);
  const kit = kits.find(k => k.id === kitId);
  
  if (!kit) {
    throw new Error("Kit non trouvé");
  }
  
  // Vérifier qu'aucun autre kit n'utilise ce variant
  if (shopifyVariantId) {
    const existing = kits.find(k => 
      k.id !== kitId && k.shopifyVariantId === String(shopifyVariantId)
    );
    if (existing) {
      throw new Error(`Ce variant est déjà mappé au kit "${existing.name}"`);
    }
  }
  
  kit.shopifyProductId = shopifyProductId ? String(shopifyProductId) : null;
  kit.shopifyVariantId = shopifyVariantId ? String(shopifyVariantId) : null;
  kit.updatedAt = new Date().toISOString();
  
  saveKits(shop, kits);
  
  return kit;
}

/**
 * Supprimer le mapping Shopify
 */
function unmapKitFromShopify(shop, kitId) {
  return mapKitToShopify(shop, kitId, null, null);
}

// ============================================
// EVENTS / AUDIT
// ============================================

function logEvent(shop, eventData) {
  const events = loadEvents(shop);
  
  const event = {
    id: generateEventId(),
    ...eventData,
    createdAt: new Date().toISOString(),
  };
  
  events.push(event);
  saveEvents(shop, events);
  
  return event;
}

function getKitEvents(shop, kitId, options = {}) {
  const { limit = 50, type } = options;
  let events = loadEvents(shop);
  
  events = events.filter(e => e.kitId === kitId);
  
  if (type) {
    events = events.filter(e => e.type === type);
  }
  
  events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return events.slice(0, limit);
}

// ============================================
// STATS & KPIs
// ============================================

function getKitStats(shop, options = {}) {
  const kits = listKits(shop, { includeArchived: false });
  const events = loadEvents(shop);
  
  const { from, to } = options;
  
  // Filtrer events par période
  let periodEvents = events;
  if (from) {
    periodEvents = periodEvents.filter(e => new Date(e.createdAt) >= new Date(from));
  }
  if (to) {
    periodEvents = periodEvents.filter(e => new Date(e.createdAt) <= new Date(to));
  }
  
  // Stats
  const salesEvents = periodEvents.filter(e => e.type === EVENT_TYPE.SALE_CONSUME);
  const assemblyEvents = periodEvents.filter(e => e.type === EVENT_TYPE.ASSEMBLY);
  
  const kitSalesMap = {};
  for (const e of salesEvents) {
    if (!kitSalesMap[e.kitId]) {
      kitSalesMap[e.kitId] = { kitId: e.kitId, kitName: e.kitName, quantity: 0, events: 0 };
    }
    kitSalesMap[e.kitId].quantity += e.quantity || 0;
    kitSalesMap[e.kitId].events++;
  }
  
  const topKitsBySales = Object.values(kitSalesMap)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);
  
  return {
    totalKits: kits.length,
    activeKits: kits.filter(k => k.status === KIT_STATUS.ACTIVE).length,
    draftKits: kits.filter(k => k.status === KIT_STATUS.DRAFT).length,
    
    // Période
    periodSales: salesEvents.reduce((sum, e) => sum + (e.quantity || 0), 0),
    periodAssemblies: assemblyEvents.reduce((sum, e) => sum + (e.quantity || 0), 0),
    
    topKitsBySales,
    
    // Alertes
    unmappedKits: kits.filter(k => k.type === KIT_TYPE.BUNDLE && !k.shopifyVariantId).length,
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Constants
  KIT_TYPE,
  KIT_STATUS,
  PRICING_MODE,
  UNIT_TYPE,
  EVENT_TYPE,
  
  // CRUD
  createKit,
  getKit,
  getKitBySku,
  getKitByShopifyVariant,
  updateKit,
  archiveKit,
  deleteKit,
  listKits,
  
  // BOM Items
  addKitItem,
  updateKitItem,
  removeKitItem,
  
  // Calculs
  calculateKitCostAndMargin,
  calculateMaxProducible,
  
  // Actions
  assembleKits,
  consumeKitForSale,
  simulateKitSales,
  
  // Shopify
  mapKitToShopify,
  unmapKitFromShopify,
  
  // Events
  logEvent,
  getKitEvents,
  
  // Stats
  getKitStats,
  
  // Raw access
  loadKits,
  saveKits,
};