// planManager.js — Gestion des plans (Free/Standard/Premium) et limites
// Stockage sur disque, compatible multi-shop

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/var/data";

// ============================================
// DÉFINITION DES PLANS
// ============================================

const PLANS = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    currency: "EUR",
    limits: {
      maxProducts: 2,
      movementHistoryDays: 7,
      hasCategories: false,
      hasShopifyImport: false,
      hasStockValue: false,
      hasAnalytics: false,
      hasAdvancedExports: false,
      hasTrends: false,
    },
    features: [
      "Gestion stock + synchro Shopify",
      "CMP (coût moyen au gramme) basique",
      "Ajustements stock manuels",
      "Export CSV basique",
    ],
  },
  
  standard: {
    id: "standard",
    name: "Standard",
    price: 14.99,
    currency: "EUR",
    limits: {
      maxProducts: 25,
      movementHistoryDays: 30,
      hasCategories: true,
      hasShopifyImport: true,
      hasStockValue: true,
      hasAnalytics: false,
      hasAdvancedExports: true,
      hasTrends: false,
    },
    features: [
      "Tout Free",
      "Catégories + filtres + import Shopify",
      "Historique mouvements (30 jours)",
      "Valeur totale stock (CMP)",
      "Exports CSV (stock + mouvements)",
    ],
  },
  
  premium: {
    id: "premium",
    name: "Premium",
    price: 39.99,
    currency: "EUR",
    limits: {
      maxProducts: Infinity,
      movementHistoryDays: 365,
      hasCategories: true,
      hasShopifyImport: true,
      hasStockValue: true,
      hasAnalytics: true,
      hasAdvancedExports: true,
      hasTrends: true,
    },
    features: [
      "Tout Standard",
      "Marge & ventes (global, par produit, par période)",
      "Tableau de bord : tendances + comparaisons",
      "Export premium (CSV complet)",
      "Produits illimités",
    ],
  },
};

// ============================================
// Helpers
// ============================================

function sanitizeShop(shop) {
  const s = String(shop || "").trim().toLowerCase();
  if (!s) return "default";
  return s.replace(/[^a-z0-9._-]/g, "_");
}

function shopDir(shop) {
  return path.join(DATA_DIR, sanitizeShop(shop));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function planFile(shop) {
  const dir = shopDir(shop);
  ensureDir(dir);
  return path.join(dir, "plan.json");
}

// ============================================
// CRUD Plan
// ============================================

/**
 * Charge le plan actuel d'un shop
 * @returns {Object} { planId, plan, subscription, limits }
 */
function getShopPlan(shop) {
  const file = planFile(shop);
  
  let data = { planId: "free" };
  
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8");
      data = JSON.parse(raw);
    }
  } catch (e) {
    console.warn("Erreur lecture plan:", e.message);
  }
  
  const planId = String(data.planId || "free").toLowerCase();
  const plan = PLANS[planId] || PLANS.free;
  
  return {
    planId: plan.id,
    plan,
    subscription: data.subscription || null,
    limits: plan.limits,
    features: plan.features,
  };
}

/**
 * Met à jour le plan d'un shop
 */
function setShopPlan(shop, planId, subscription = null) {
  const file = planFile(shop);
  const normalizedPlanId = String(planId || "free").toLowerCase();
  
  if (!PLANS[normalizedPlanId]) {
    throw new Error(`Plan inconnu: ${planId}`);
  }
  
  const data = {
    planId: normalizedPlanId,
    subscription: subscription ? {
      id: subscription.id || null,
      status: subscription.status || "active",
      startedAt: subscription.startedAt || new Date().toISOString(),
      expiresAt: subscription.expiresAt || null,
      chargeId: subscription.chargeId || null,
    } : null,
    updatedAt: new Date().toISOString(),
  };
  
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
  
  return getShopPlan(shop);
}

/**
 * Annule l'abonnement (retour au plan Free)
 */
function cancelSubscription(shop) {
  return setShopPlan(shop, "free", null);
}

// ============================================
// VÉRIFICATION DES LIMITES
// ============================================

/**
 * Vérifie si une action est autorisée selon le plan
 * @returns {{ allowed: boolean, reason?: string, upgrade?: string }}
 */
function checkLimit(shop, action, context = {}) {
  const { limits, planId } = getShopPlan(shop);
  
  switch (action) {
    case "add_product": {
      const currentCount = Number(context.currentProductCount || 0);
      if (currentCount >= limits.maxProducts) {
        return {
          allowed: false,
          reason: `Limite de ${limits.maxProducts} produit(s) atteinte`,
          upgrade: planId === "free" ? "standard" : "premium",
          limit: limits.maxProducts,
          current: currentCount,
        };
      }
      return { allowed: true };
    }
    
    case "import_shopify": {
      if (!limits.hasShopifyImport) {
        return {
          allowed: false,
          reason: "Import Shopify non disponible avec le plan Free",
          upgrade: "standard",
        };
      }
      return { allowed: true };
    }
    
    case "view_categories": 
    case "manage_categories": {
      if (!limits.hasCategories) {
        return {
          allowed: false,
          reason: "Catégories non disponibles avec le plan Free",
          upgrade: "standard",
        };
      }
      return { allowed: true };
    }
    
    case "view_stock_value": {
      if (!limits.hasStockValue) {
        return {
          allowed: false,
          reason: "Valeur du stock non disponible avec le plan Free",
          upgrade: "standard",
        };
      }
      return { allowed: true };
    }
    
    case "view_analytics":
    case "export_analytics": {
      if (!limits.hasAnalytics) {
        return {
          allowed: false,
          reason: "Analytics non disponibles avec votre plan",
          upgrade: "premium",
        };
      }
      return { allowed: true };
    }
    
    case "view_trends": {
      if (!limits.hasTrends) {
        return {
          allowed: false,
          reason: "Tendances non disponibles avec votre plan",
          upgrade: "premium",
        };
      }
      return { allowed: true };
    }
    
    case "view_movements": {
      const requestedDays = Number(context.days || 7);
      if (requestedDays > limits.movementHistoryDays) {
        return {
          allowed: true, // On autorise mais on limite
          limitedTo: limits.movementHistoryDays,
          reason: `Historique limité à ${limits.movementHistoryDays} jours`,
          upgrade: planId === "free" ? "standard" : "premium",
        };
      }
      return { allowed: true };
    }
    
    case "advanced_export": {
      if (!limits.hasAdvancedExports) {
        return {
          allowed: false,
          reason: "Exports avancés non disponibles avec le plan Free",
          upgrade: "standard",
        };
      }
      return { allowed: true };
    }
    
    default:
      return { allowed: true };
  }
}

/**
 * Applique les limites du plan aux jours de l'historique
 */
function applyMovementDaysLimit(shop, requestedDays) {
  const { limits } = getShopPlan(shop);
  const max = limits.movementHistoryDays;
  return Math.min(Number(requestedDays || 7), max);
}

/**
 * Vérifie si le shop peut ajouter un produit
 */
function canAddProduct(shop, currentProductCount) {
  const result = checkLimit(shop, "add_product", { currentProductCount });
  return result.allowed;
}

/**
 * Retourne le nombre de produits restants
 */
function getRemainingProducts(shop, currentProductCount) {
  const { limits } = getShopPlan(shop);
  if (limits.maxProducts === Infinity) return Infinity;
  return Math.max(0, limits.maxProducts - currentProductCount);
}

// ============================================
// INFOS POUR LE FRONTEND
// ============================================

/**
 * Retourne les infos du plan pour l'affichage frontend
 */
function getPlanInfoForUI(shop, currentProductCount = 0) {
  const { planId, plan, subscription, limits, features } = getShopPlan(shop);
  
  return {
    current: {
      planId,
      name: plan.name,
      price: plan.price,
      currency: plan.currency,
      features,
    },
    limits: {
      maxProducts: limits.maxProducts === Infinity ? "Illimité" : limits.maxProducts,
      maxProductsNum: limits.maxProducts,
      movementHistoryDays: limits.movementHistoryDays,
      hasCategories: limits.hasCategories,
      hasShopifyImport: limits.hasShopifyImport,
      hasStockValue: limits.hasStockValue,
      hasAnalytics: limits.hasAnalytics,
      hasAdvancedExports: limits.hasAdvancedExports,
      hasTrends: limits.hasTrends,
    },
    usage: {
      productCount: currentProductCount,
      remainingProducts: getRemainingProducts(shop, currentProductCount),
      productLimitReached: !canAddProduct(shop, currentProductCount),
    },
    subscription: subscription ? {
      status: subscription.status,
      startedAt: subscription.startedAt,
      expiresAt: subscription.expiresAt,
    } : null,
    availablePlans: Object.values(PLANS).map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      currency: p.currency,
      features: p.features,
      isCurrent: p.id === planId,
    })),
  };
}

// ============================================
// Module Exports
// ============================================

module.exports = {
  PLANS,
  
  // CRUD
  getShopPlan,
  setShopPlan,
  cancelSubscription,
  
  // Vérification limites
  checkLimit,
  applyMovementDaysLimit,
  canAddProduct,
  getRemainingProducts,
  
  // Frontend
  getPlanInfoForUI,
  
  // Helpers
  sanitizeShop,
};
