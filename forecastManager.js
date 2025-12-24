// forecastManager.js - Prévisions de stock, ruptures et recommandations d'achat
// v1.0 - Forecast, Days of Stock, Reorder suggestions

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/var/data";

// ============================================
// CONSTANTES
// ============================================

const FORECAST_STATUS = {
  OK: "ok",               // > 30 jours de stock
  WATCH: "watch",         // 14-30 jours
  URGENT: "urgent",       // < 14 jours
  CRITICAL: "critical",   // < 7 jours
  OUT_OF_STOCK: "out",    // Rupture
  NO_DATA: "nodata",      // Pas de données de vente
  OVERSTOCK: "overstock", // Surstock (> 90 jours)
};

const DEFAULT_SETTINGS = {
  windowDays: 30,           // Fenêtre d'analyse des ventes
  forecastHorizon: 30,      // Horizon de prévision
  alertThresholdDays: 14,   // Seuil d'alerte rupture
  targetCoverageDays: 30,   // Couverture cible pour réassort
  reorderPointDays: 14,     // Point de réapprovisionnement
  includeReturns: false,    // Prendre en compte les retours
  ignoreZeroDays: false,    // Ignorer les jours sans ventes
  useVariants: false,       // Mode variantes
  outlierCapping: false,    // Cappage des outliers (Pro)
  outlierPercentile: 95,    // Percentile pour outliers
};

// ============================================
// HELPERS
// ============================================

function forecastDir(shop) {
  const dir = path.join(DATA_DIR, shop, "forecast");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function settingsFile(shop) {
  return path.join(forecastDir(shop), "settings.json");
}

function cacheFile(shop) {
  return path.join(forecastDir(shop), "cache.json");
}

function loadForecastSettings(shop) {
  try {
    const file = settingsFile(shop);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return { ...DEFAULT_SETTINGS, ...data };
    }
  } catch (e) {
    console.warn("Erreur lecture settings forecast:", e.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveForecastSettings(shop, settings) {
  const file = settingsFile(shop);
  const data = { ...DEFAULT_SETTINGS, ...settings, updatedAt: new Date().toISOString() };
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(file + ".tmp", file);
  return data;
}

function loadCache(shop) {
  try {
    const file = cacheFile(shop);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      // Cache valide 1 heure
      if (data.timestamp && (Date.now() - new Date(data.timestamp).getTime()) < 3600000) {
        return data;
      }
    }
  } catch (e) {}
  return null;
}

function saveCache(shop, data) {
  const file = cacheFile(shop);
  const cached = { ...data, timestamp: new Date().toISOString() };
  try {
    fs.writeFileSync(file + ".tmp", JSON.stringify(cached, null, 2), "utf8");
    fs.renameSync(file + ".tmp", file);
  } catch (e) {}
  return cached;
}

// ============================================
// CALCULS DE PRÉVISION
// ============================================

/**
 * Calculer le taux de vente journalier
 * @param {Array} salesData - Données de ventes [{date, qty}, ...]
 * @param {number} windowDays - Fenêtre d'analyse
 * @param {Object} options - Options (ignoreZeroDays, outlierCapping)
 */
function calculateDailyRate(salesData, windowDays, options = {}) {
  if (!salesData || salesData.length === 0) {
    return { dailyRate: 0, hasData: false, dataPoints: 0 };
  }
  
  const { ignoreZeroDays = false, outlierCapping = false, outlierPercentile = 95 } = options;
  
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - windowDays);
  
  // Filtrer par fenêtre
  let filtered = salesData.filter(s => new Date(s.date) >= windowStart);
  
  if (filtered.length === 0) {
    return { dailyRate: 0, hasData: false, dataPoints: 0 };
  }
  
  // Agréger par jour
  const dailyTotals = {};
  for (const sale of filtered) {
    const day = sale.date.split("T")[0];
    dailyTotals[day] = (dailyTotals[day] || 0) + (sale.qty || 0);
  }
  
  let dailyValues = Object.values(dailyTotals);
  
  // Cappage des outliers (Pro)
  if (outlierCapping && dailyValues.length > 5) {
    const sorted = [...dailyValues].sort((a, b) => a - b);
    const percentileIndex = Math.floor(sorted.length * (outlierPercentile / 100));
    const cap = sorted[percentileIndex] || sorted[sorted.length - 1];
    dailyValues = dailyValues.map(v => Math.min(v, cap));
  }
  
  // Calcul de la moyenne
  let totalQty = dailyValues.reduce((sum, v) => sum + v, 0);
  let daysCount = ignoreZeroDays ? dailyValues.filter(v => v > 0).length : windowDays;
  
  if (daysCount === 0) daysCount = 1;
  
  const dailyRate = totalQty / daysCount;
  
  return {
    dailyRate: Math.round(dailyRate * 100) / 100,
    hasData: true,
    dataPoints: filtered.length,
    totalSold: totalQty,
    daysWithSales: Object.keys(dailyTotals).length,
  };
}

/**
 * Calculer les jours de couverture
 */
function calculateDaysOfStock(currentStock, dailyRate) {
  if (dailyRate <= 0) {
    return currentStock > 0 ? Infinity : 0;
  }
  return Math.round((currentStock / dailyRate) * 10) / 10;
}

/**
 * Calculer la date de rupture estimée
 */
function calculateStockoutDate(daysOfStock) {
  if (daysOfStock === Infinity || daysOfStock <= 0) {
    return null;
  }
  
  const date = new Date();
  date.setDate(date.getDate() + Math.floor(daysOfStock));
  return date.toISOString().split("T")[0];
}

/**
 * Calculer la quantité à recommander
 */
function calculateReorderQuantity(currentStock, dailyRate, targetCoverageDays, minOrderQty = 0) {
  if (dailyRate <= 0) {
    return 0;
  }
  
  const targetStock = dailyRate * targetCoverageDays;
  const needed = Math.max(0, targetStock - currentStock);
  
  // Arrondir selon la quantité
  let rounded;
  if (needed < 10) {
    rounded = Math.ceil(needed * 10) / 10; // Arrondi à 0.1
  } else if (needed < 100) {
    rounded = Math.ceil(needed); // Arrondi à 1
  } else {
    rounded = Math.ceil(needed / 10) * 10; // Arrondi à 10
  }
  
  return Math.max(rounded, minOrderQty);
}

/**
 * Déterminer le statut du forecast
 */
function determineStatus(daysOfStock, dailyRate, alertThreshold = 14) {
  if (dailyRate <= 0) {
    return FORECAST_STATUS.NO_DATA;
  }
  
  if (daysOfStock <= 0) {
    return FORECAST_STATUS.OUT_OF_STOCK;
  }
  
  if (daysOfStock > 90) {
    return FORECAST_STATUS.OVERSTOCK;
  }
  
  if (daysOfStock < 7) {
    return FORECAST_STATUS.CRITICAL;
  }
  
  if (daysOfStock < alertThreshold) {
    return FORECAST_STATUS.URGENT;
  }
  
  if (daysOfStock < 30) {
    return FORECAST_STATUS.WATCH;
  }
  
  return FORECAST_STATUS.OK;
}

/**
 * Calculer la date limite de commande (avec lead time)
 */
function calculateOrderDeadline(stockoutDate, leadTimeDays) {
  if (!stockoutDate || !leadTimeDays) {
    return null;
  }
  
  const deadline = new Date(stockoutDate);
  deadline.setDate(deadline.getDate() - leadTimeDays);
  return deadline.toISOString().split("T")[0];
}

// ============================================
// FORECAST PRINCIPAL
// ============================================

/**
 * Générer les prévisions pour tous les produits
 */
function generateForecast(shop, productsData, salesData, options = {}) {
  const settings = { ...loadForecastSettings(shop), ...options };
  const {
    windowDays,
    alertThresholdDays,
    targetCoverageDays,
    ignoreZeroDays,
    outlierCapping,
    outlierPercentile,
  } = settings;
  
  // Indexer les ventes par produit
  const salesByProduct = {};
  for (const sale of salesData) {
    const pid = sale.productId;
    if (!salesByProduct[pid]) salesByProduct[pid] = [];
    salesByProduct[pid].push(sale);
  }
  
  const forecasts = [];
  
  for (const product of productsData) {
    const productSales = salesByProduct[product.productId] || [];
    
    const rateData = calculateDailyRate(productSales, windowDays, {
      ignoreZeroDays,
      outlierCapping,
      outlierPercentile,
    });
    
    const currentStock = product.totalGrams || 0;
    const daysOfStock = calculateDaysOfStock(currentStock, rateData.dailyRate);
    const stockoutDate = calculateStockoutDate(daysOfStock);
    const status = determineStatus(daysOfStock, rateData.dailyRate, alertThresholdDays);
    const reorderQty = calculateReorderQuantity(currentStock, rateData.dailyRate, targetCoverageDays);
    
    // Lead time fournisseur (si disponible)
    const leadTimeDays = product.leadTimeDays || null;
    const orderDeadline = calculateOrderDeadline(stockoutDate, leadTimeDays);
    
    // Calculer si commande urgente
    let isOrderUrgent = false;
    if (orderDeadline) {
      const today = new Date().toISOString().split("T")[0];
      isOrderUrgent = orderDeadline <= today;
    }
    
    forecasts.push({
      productId: product.productId,
      productName: product.name,
      sku: product.sku || null,
      categoryIds: product.categoryIds || [],
      supplierId: product.supplierId || null,
      
      // Stock
      currentStock,
      averageCostPerGram: product.averageCostPerGram || 0,
      stockValue: currentStock * (product.averageCostPerGram || 0),
      
      // Ventes
      dailyRate: rateData.dailyRate,
      hasData: rateData.hasData,
      dataPoints: rateData.dataPoints,
      totalSoldInWindow: rateData.totalSold || 0,
      
      // Prévisions
      daysOfStock,
      stockoutDate,
      status,
      
      // Recommandations
      reorderQty,
      reorderValue: reorderQty * (product.averageCostPerGram || 0),
      targetCoverageDays,
      
      // Lead time
      leadTimeDays,
      orderDeadline,
      isOrderUrgent,
      
      // Meta
      windowDays,
    });
  }
  
  // Trier par urgence (date de rupture la plus proche)
  forecasts.sort((a, b) => {
    if (a.status === FORECAST_STATUS.OUT_OF_STOCK) return -1;
    if (b.status === FORECAST_STATUS.OUT_OF_STOCK) return 1;
    if (a.daysOfStock === Infinity && b.daysOfStock !== Infinity) return 1;
    if (b.daysOfStock === Infinity && a.daysOfStock !== Infinity) return -1;
    return a.daysOfStock - b.daysOfStock;
  });
  
  return forecasts;
}

/**
 * Générer les prévisions détaillées pour un produit
 */
function generateProductForecast(shop, product, salesData, options = {}) {
  const settings = { ...loadForecastSettings(shop), ...options };
  const { windowDays, forecastHorizon, targetCoverageDays } = settings;
  
  // Filtrer les ventes de ce produit
  const productSales = salesData.filter(s => s.productId === product.productId);
  
  // Calcul de base
  const rateData = calculateDailyRate(productSales, windowDays, settings);
  const currentStock = product.totalGrams || 0;
  const daysOfStock = calculateDaysOfStock(currentStock, rateData.dailyRate);
  const stockoutDate = calculateStockoutDate(daysOfStock);
  const status = determineStatus(daysOfStock, rateData.dailyRate, settings.alertThresholdDays);
  const reorderQty = calculateReorderQuantity(currentStock, rateData.dailyRate, targetCoverageDays);
  
  // Historique journalier (30 derniers jours)
  const dailyHistory = buildDailyHistory(productSales, 30);
  
  // Scénarios
  const scenarios = {
    pessimistic: {
      multiplier: 1.2, // Ventes plus élevées = rupture plus rapide
      dailyRate: rateData.dailyRate * 1.2,
      daysOfStock: calculateDaysOfStock(currentStock, rateData.dailyRate * 1.2),
    },
    normal: {
      multiplier: 1.0,
      dailyRate: rateData.dailyRate,
      daysOfStock: daysOfStock,
    },
    optimistic: {
      multiplier: 0.8, // Ventes plus faibles = stock dure plus
      dailyRate: rateData.dailyRate * 0.8,
      daysOfStock: calculateDaysOfStock(currentStock, rateData.dailyRate * 0.8),
    },
  };
  
  // Projection sur l'horizon
  const projection = buildProjection(currentStock, rateData.dailyRate, forecastHorizon);
  
  // Explication du calcul
  const explanation = buildExplanation(rateData, windowDays, currentStock, daysOfStock);
  
  return {
    productId: product.productId,
    productName: product.name,
    
    currentStock,
    dailyRate: rateData.dailyRate,
    hasData: rateData.hasData,
    totalSoldInWindow: rateData.totalSold || 0,
    daysWithSales: rateData.daysWithSales || 0,
    
    daysOfStock,
    stockoutDate,
    status,
    
    reorderQty,
    reorderValue: reorderQty * (product.averageCostPerGram || 0),
    targetCoverageDays,
    
    dailyHistory,
    scenarios,
    projection,
    explanation,
    
    settings,
  };
}

/**
 * Construire l'historique journalier
 */
function buildDailyHistory(salesData, days) {
  const history = [];
  const now = new Date();
  
  // Créer un map des ventes par jour
  const salesByDay = {};
  for (const sale of salesData) {
    const day = sale.date.split("T")[0];
    salesByDay[day] = (salesByDay[day] || 0) + (sale.qty || 0);
  }
  
  // Remplir les jours
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dayStr = date.toISOString().split("T")[0];
    
    history.push({
      date: dayStr,
      qty: salesByDay[dayStr] || 0,
    });
  }
  
  return history;
}

/**
 * Construire la projection de stock
 */
function buildProjection(currentStock, dailyRate, horizonDays) {
  const projection = [];
  let stock = currentStock;
  const now = new Date();
  
  for (let i = 0; i <= horizonDays; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    
    projection.push({
      date: date.toISOString().split("T")[0],
      stock: Math.max(0, Math.round(stock * 10) / 10),
    });
    
    stock -= dailyRate;
  }
  
  return projection;
}

/**
 * Construire l'explication du calcul
 */
function buildExplanation(rateData, windowDays, currentStock, daysOfStock) {
  const lines = [];
  
  lines.push(`Analyse sur les ${windowDays} derniers jours`);
  
  if (!rateData.hasData) {
    lines.push("Aucune donnée de vente disponible");
    return lines;
  }
  
  lines.push(`Total vendu: ${rateData.totalSold?.toFixed(1) || 0}g sur ${rateData.daysWithSales || 0} jour(s)`);
  lines.push(`Moyenne journalière: ${rateData.dailyRate?.toFixed(2) || 0}g/jour`);
  lines.push(`Stock actuel: ${currentStock?.toFixed(1) || 0}g`);
  
  if (daysOfStock === Infinity) {
    lines.push("Couverture: Illimitée (pas de ventes récentes)");
  } else {
    lines.push(`Couverture estimée: ${daysOfStock?.toFixed(0) || 0} jours`);
  }
  
  return lines;
}

// ============================================
// RECOMMANDATIONS D'ACHAT
// ============================================

/**
 * Générer les recommandations de commande groupées par fournisseur
 */
function generatePurchaseRecommendations(forecasts, options = {}) {
  const { 
    reorderPointDays = 14,
    targetCoverageDays = 30,
    suppliersData = [],
  } = options;
  
  // Filtrer les produits qui nécessitent un réassort
  const needsReorder = forecasts.filter(f => {
    if (f.status === FORECAST_STATUS.NO_DATA) return false;
    if (f.daysOfStock === Infinity) return false;
    return f.daysOfStock <= reorderPointDays || f.reorderQty > 0;
  });
  
  // Grouper par fournisseur
  const bySupplier = {};
  for (const f of needsReorder) {
    const supplierId = f.supplierId || "unknown";
    if (!bySupplier[supplierId]) {
      const supplier = suppliersData.find(s => s.id === supplierId);
      bySupplier[supplierId] = {
        supplierId,
        supplierName: supplier?.name || "Fournisseur inconnu",
        items: [],
        totalValue: 0,
        totalItems: 0,
      };
    }
    
    bySupplier[supplierId].items.push({
      productId: f.productId,
      productName: f.productName,
      currentStock: f.currentStock,
      daysOfStock: f.daysOfStock,
      stockoutDate: f.stockoutDate,
      reorderQty: f.reorderQty,
      reorderValue: f.reorderValue,
      isUrgent: f.status === FORECAST_STATUS.CRITICAL || f.status === FORECAST_STATUS.URGENT,
      orderDeadline: f.orderDeadline,
    });
    
    bySupplier[supplierId].totalValue += f.reorderValue || 0;
    bySupplier[supplierId].totalItems++;
  }
  
  // Convertir en array et trier par urgence
  const recommendations = Object.values(bySupplier).map(r => ({
    ...r,
    items: r.items.sort((a, b) => a.daysOfStock - b.daysOfStock),
    hasUrgent: r.items.some(i => i.isUrgent),
  }));
  
  recommendations.sort((a, b) => {
    if (a.hasUrgent && !b.hasUrgent) return -1;
    if (!a.hasUrgent && b.hasUrgent) return 1;
    return b.totalItems - a.totalItems;
  });
  
  return {
    recommendations,
    summary: {
      totalProducts: needsReorder.length,
      totalValue: recommendations.reduce((sum, r) => sum + r.totalValue, 0),
      urgentCount: needsReorder.filter(f => 
        f.status === FORECAST_STATUS.CRITICAL || f.status === FORECAST_STATUS.URGENT
      ).length,
    },
  };
}

// ============================================
// STATS & KPIs
// ============================================

/**
 * Calculer les KPIs de prévision
 */
function getForecastStats(forecasts) {
  const total = forecasts.length;
  
  const byStatus = {};
  for (const status of Object.values(FORECAST_STATUS)) {
    byStatus[status] = forecasts.filter(f => f.status === status).length;
  }
  
  const totalStockValue = forecasts.reduce((sum, f) => sum + (f.stockValue || 0), 0);
  const totalReorderValue = forecasts.reduce((sum, f) => sum + (f.reorderValue || 0), 0);
  
  const urgentProducts = forecasts.filter(f => 
    f.status === FORECAST_STATUS.CRITICAL || 
    f.status === FORECAST_STATUS.URGENT ||
    f.status === FORECAST_STATUS.OUT_OF_STOCK
  );
  
  const avgDaysOfStock = forecasts
    .filter(f => f.daysOfStock !== Infinity && f.hasData)
    .reduce((sum, f, _, arr) => sum + f.daysOfStock / arr.length, 0);
  
  return {
    totalProducts: total,
    byStatus,
    totalStockValue: Math.round(totalStockValue * 100) / 100,
    totalReorderValue: Math.round(totalReorderValue * 100) / 100,
    urgentCount: urgentProducts.length,
    avgDaysOfStock: Math.round(avgDaysOfStock),
    healthScore: Math.round((1 - urgentProducts.length / Math.max(total, 1)) * 100),
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Constants
  FORECAST_STATUS,
  DEFAULT_SETTINGS,
  
  // Settings
  loadForecastSettings,
  saveForecastSettings,
  
  // Calculs
  calculateDailyRate,
  calculateDaysOfStock,
  calculateStockoutDate,
  calculateReorderQuantity,
  calculateOrderDeadline,
  determineStatus,
  
  // Forecast
  generateForecast,
  generateProductForecast,
  
  // Recommendations
  generatePurchaseRecommendations,
  
  // Stats
  getForecastStats,
  
  // Cache
  loadCache,
  saveCache,
};