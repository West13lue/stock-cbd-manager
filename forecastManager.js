// forecastManager.js — Prévisions de rupture de stock (IA basique)
// Analyse l'historique des ventes pour prédire les ruptures

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/var/data";

// ============================================
// ALGORITHME DE PRÉVISION
// ============================================
// 1. Calcule la vélocité moyenne (grammes vendus/jour)
// 2. Applique une pondération récente (derniers jours comptent plus)
// 3. Détecte la saisonnalité (jours de la semaine)
// 4. Prédit le nombre de jours avant rupture
// 5. Suggère la quantité à commander

// ============================================
// Helpers
// ============================================

function sanitizeShop(shop) {
  const s = String(shop || "").trim().toLowerCase();
  return s ? s.replace(/[^a-z0-9._-]/g, "_") : "default";
}

function getMovementDir(shop) {
  return path.join(DATA_DIR, sanitizeShop(shop), "movements");
}

function getAnalyticsDir(shop) {
  return path.join(DATA_DIR, sanitizeShop(shop), "analytics");
}

/**
 * Charge les mouvements de stock (pour calculer la vélocité)
 */
function loadMovements(shop, days = 90) {
  const dir = getMovementDir(shop);
  if (!fs.existsSync(dir)) return [];

  const movements = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".ndjson"));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      const lines = content.split("\n").filter(Boolean);
      for (const line of lines) {
        const m = JSON.parse(line);
        if (new Date(m.ts) >= cutoff) {
          movements.push(m);
        }
      }
    } catch (e) {
      // Ignorer les erreurs de parsing
    }
  }

  return movements;
}

/**
 * Charge les ventes analytics (pour une meilleure précision)
 */
function loadSales(shop, days = 90) {
  const dir = getAnalyticsDir(shop);
  if (!fs.existsSync(dir)) return [];

  const sales = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".ndjson"));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      const lines = content.split("\n").filter(Boolean);
      for (const line of lines) {
        const s = JSON.parse(line);
        if (new Date(s.orderDate) >= cutoff) {
          sales.push(s);
        }
      }
    } catch (e) {
      // Ignorer
    }
  }

  return sales;
}

// ============================================
// CALCUL DE VÉLOCITÉ
// ============================================

/**
 * Calcule la vélocité de vente d'un produit (grammes/jour)
 */
function calculateVelocity(shop, productId, options = {}) {
  const {
    days = 30,           // Période d'analyse
    useWeighting = true, // Pondération récente
    excludeOutliers = true, // Exclure les valeurs aberrantes
  } = options;

  const sales = loadSales(shop, days);
  const productSales = sales.filter(s => s.productId === productId);

  if (productSales.length === 0) {
    return {
      velocity: 0,
      velocityPerWeek: 0,
      salesCount: 0,
      dataPoints: 0,
      confidence: 0,
      method: "no_data",
    };
  }

  // Grouper par jour
  const dailySales = {};
  const now = new Date();

  for (const sale of productSales) {
    const dateKey = sale.orderDate.slice(0, 10);
    dailySales[dateKey] = (dailySales[dateKey] || 0) + (sale.totalGrams || 0);
  }

  // Créer un tableau avec tous les jours (même sans ventes)
  const dailyData = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    dailyData.push({
      date: key,
      grams: dailySales[key] || 0,
      daysAgo: i,
      dayOfWeek: date.getDay(),
    });
  }

  // Exclure les outliers (top/bottom 5%)
  let dataForCalc = dailyData;
  if (excludeOutliers && dailyData.length >= 20) {
    const sorted = [...dailyData].sort((a, b) => a.grams - b.grams);
    const cutLow = Math.floor(sorted.length * 0.05);
    const cutHigh = Math.floor(sorted.length * 0.95);
    const filtered = sorted.slice(cutLow, cutHigh);
    dataForCalc = dailyData.filter(d => 
      d.grams >= filtered[0].grams && d.grams <= filtered[filtered.length - 1].grams
    );
  }

  // Calculer la vélocité (avec ou sans pondération)
  let totalGrams = 0;
  let totalWeight = 0;

  for (const day of dataForCalc) {
    let weight = 1;

    if (useWeighting) {
      // Les jours récents comptent plus (décroissance exponentielle)
      weight = Math.exp(-day.daysAgo / 15); // demi-vie de ~15 jours
    }

    totalGrams += day.grams * weight;
    totalWeight += weight;
  }

  const velocity = totalWeight > 0 ? totalGrams / totalWeight : 0;

  // Calculer la confiance (basée sur le nombre de données et la variance)
  const variance = calculateVariance(dataForCalc.map(d => d.grams));
  const cv = velocity > 0 ? Math.sqrt(variance) / velocity : 1; // Coefficient de variation
  const dataConfidence = Math.min(1, productSales.length / 30); // Plus de données = plus confiant
  const consistencyConfidence = Math.max(0, 1 - cv); // Moins de variance = plus confiant
  const confidence = (dataConfidence * 0.6 + consistencyConfidence * 0.4);

  return {
    velocity: roundTo(velocity, 2),
    velocityPerWeek: roundTo(velocity * 7, 2),
    velocityPerMonth: roundTo(velocity * 30, 2),
    salesCount: productSales.length,
    dataPoints: dataForCalc.length,
    confidence: roundTo(confidence, 2),
    method: useWeighting ? "weighted" : "average",
    period: days,
  };
}

/**
 * Analyse la saisonnalité (jours de la semaine)
 */
function analyzeSeasonality(shop, productId, days = 90) {
  const sales = loadSales(shop, days);
  const productSales = sales.filter(s => s.productId === productId);

  // Grouper par jour de la semaine
  const byDayOfWeek = [0, 0, 0, 0, 0, 0, 0]; // Dim, Lun, Mar, ...
  const countByDay = [0, 0, 0, 0, 0, 0, 0];

  for (const sale of productSales) {
    const dayOfWeek = new Date(sale.orderDate).getDay();
    byDayOfWeek[dayOfWeek] += sale.totalGrams || 0;
    countByDay[dayOfWeek]++;
  }

  // Calculer la moyenne par jour
  const avgByDay = byDayOfWeek.map((total, i) => 
    countByDay[i] > 0 ? total / countByDay[i] : 0
  );

  // Normaliser (pourcentage de la moyenne)
  const overallAvg = avgByDay.reduce((a, b) => a + b, 0) / 7;
  const normalizedByDay = avgByDay.map(v => 
    overallAvg > 0 ? v / overallAvg : 1
  );

  const dayNames = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

  return {
    byDayOfWeek: dayNames.map((name, i) => ({
      day: name,
      dayIndex: i,
      averageGrams: roundTo(avgByDay[i], 2),
      indexVsAverage: roundTo(normalizedByDay[i], 2), // 1.0 = moyenne, 1.5 = 50% au-dessus
    })),
    peakDay: dayNames[normalizedByDay.indexOf(Math.max(...normalizedByDay))],
    lowDay: dayNames[normalizedByDay.indexOf(Math.min(...normalizedByDay))],
    hasStrongPattern: Math.max(...normalizedByDay) - Math.min(...normalizedByDay) > 0.5,
  };
}

// ============================================
// PRÉVISION DE RUPTURE
// ============================================

/**
 * Prédit quand un produit sera en rupture de stock
 */
function predictStockout(shop, productId, currentStock, options = {}) {
  const {
    velocityDays = 30,
    safetyStockDays = 7, // Stock de sécurité en jours
    leadTimeDays = 3,     // Délai de livraison fournisseur
  } = options;

  const velocity = calculateVelocity(shop, productId, { days: velocityDays });

  if (velocity.velocity <= 0) {
    return {
      productId,
      currentStock,
      velocity: velocity.velocity,
      daysUntilStockout: Infinity,
      stockoutDate: null,
      urgency: "none",
      message: "Pas de données de vente, impossible de prédire",
      confidence: 0,
    };
  }

  const daysUntilStockout = currentStock / velocity.velocity;
  const stockoutDate = new Date();
  stockoutDate.setDate(stockoutDate.getDate() + Math.floor(daysUntilStockout));

  // Déterminer l'urgence
  let urgency = "none";
  let message = "";

  if (daysUntilStockout <= leadTimeDays) {
    urgency = "critical";
    message = `⚠️ CRITIQUE: Rupture prévue avant la prochaine livraison possible!`;
  } else if (daysUntilStockout <= leadTimeDays + safetyStockDays) {
    urgency = "high";
    message = `🔴 Commander immédiatement pour éviter la rupture`;
  } else if (daysUntilStockout <= 14) {
    urgency = "medium";
    message = `🟡 Réapprovisionnement recommandé cette semaine`;
  } else if (daysUntilStockout <= 30) {
    urgency = "low";
    message = `🟢 Stock suffisant, surveiller`;
  } else {
    urgency = "none";
    message = `✅ Stock confortable`;
  }

  return {
    productId,
    currentStock,
    velocity: velocity.velocity,
    velocityPerWeek: velocity.velocityPerWeek,
    daysUntilStockout: roundTo(daysUntilStockout, 1),
    stockoutDate: stockoutDate.toISOString().slice(0, 10),
    urgency,
    message,
    confidence: velocity.confidence,
    safetyStockGrams: roundTo(velocity.velocity * safetyStockDays, 0),
  };
}

/**
 * Suggère la quantité à commander
 */
function suggestReorderQuantity(shop, productId, currentStock, options = {}) {
  const {
    targetStockDays = 30, // Stock cible en jours
    safetyStockDays = 7,
    leadTimeDays = 3,
    roundToNearest = 50, // Arrondir à 50g près
    minOrderGrams = 100,
  } = options;

  const velocity = calculateVelocity(shop, productId, { days: 30 });

  if (velocity.velocity <= 0) {
    return {
      suggestedQuantity: minOrderGrams,
      reason: "Pas d'historique de ventes, quantité minimum suggérée",
      confidence: 0,
    };
  }

  // Stock nécessaire pour couvrir la période cible + sécurité + délai livraison
  const targetStock = velocity.velocity * (targetStockDays + safetyStockDays);
  const neededDuringLeadTime = velocity.velocity * leadTimeDays;
  
  // Quantité à commander = stock cible - stock actuel + consommation pendant livraison
  let quantity = targetStock - currentStock + neededDuringLeadTime;

  // Arrondir
  if (roundToNearest > 0) {
    quantity = Math.ceil(quantity / roundToNearest) * roundToNearest;
  }

  // Minimum
  quantity = Math.max(quantity, minOrderGrams);

  return {
    suggestedQuantity: roundTo(quantity, 0),
    breakdown: {
      targetStock: roundTo(targetStock, 0),
      currentStock: roundTo(currentStock, 0),
      leadTimeConsumption: roundTo(neededDuringLeadTime, 0),
    },
    coverageDays: roundTo((currentStock + quantity) / velocity.velocity, 1),
    velocity: velocity.velocity,
    confidence: velocity.confidence,
    reason: `Couvre ${targetStockDays} jours + ${safetyStockDays} jours de sécurité`,
  };
}

// ============================================
// ALERTES & DASHBOARD
// ============================================

/**
 * Récupère tous les produits nécessitant un réapprovisionnement
 */
function getRestockAlerts(shop, stockSnapshot, options = {}) {
  const {
    criticalDays = 7,
    warningDays = 14,
    leadTimeDays = 3,
  } = options;

  const alerts = [];
  const products = Object.entries(stockSnapshot);

  for (const [productId, product] of products) {
    const currentStock = product.totalGrams || 0;
    const prediction = predictStockout(shop, productId, currentStock, { leadTimeDays });

    if (prediction.urgency !== "none" && prediction.daysUntilStockout < 30) {
      const suggestion = suggestReorderQuantity(shop, productId, currentStock, { leadTimeDays });

      alerts.push({
        productId,
        productName: product.name || productId,
        currentStock,
        ...prediction,
        suggestedQuantity: suggestion.suggestedQuantity,
        estimatedCost: suggestion.suggestedQuantity * (product.averageCostPerGram || 0),
      });
    }
  }

  // Trier par urgence (critical > high > medium > low)
  const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
  alerts.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return {
    alerts,
    summary: {
      critical: alerts.filter(a => a.urgency === "critical").length,
      high: alerts.filter(a => a.urgency === "high").length,
      medium: alerts.filter(a => a.urgency === "medium").length,
      low: alerts.filter(a => a.urgency === "low").length,
      totalAlerts: alerts.length,
    },
  };
}

/**
 * Génère un rapport de prévision complet
 */
function generateForecastReport(shop, stockSnapshot, options = {}) {
  const alerts = getRestockAlerts(shop, stockSnapshot, options);
  
  // Top 10 produits les plus vendus
  const velocities = [];
  for (const [productId, product] of Object.entries(stockSnapshot)) {
    const v = calculateVelocity(shop, productId, { days: 30 });
    if (v.velocity > 0) {
      velocities.push({
        productId,
        productName: product.name || productId,
        velocity: v.velocity,
        velocityPerWeek: v.velocityPerWeek,
        currentStock: product.totalGrams || 0,
        confidence: v.confidence,
      });
    }
  }
  velocities.sort((a, b) => b.velocity - a.velocity);

  return {
    generatedAt: new Date().toISOString(),
    alerts: alerts.alerts,
    summary: alerts.summary,
    topProducts: velocities.slice(0, 10),
    totalProducts: Object.keys(stockSnapshot).length,
    productsWithData: velocities.length,
  };
}

// ============================================
// HELPERS
// ============================================

function roundTo(num, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

function calculateVariance(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

// ============================================
// Exports
// ============================================

module.exports = {
  // Vélocité
  calculateVelocity,
  analyzeSeasonality,
  
  // Prévisions
  predictStockout,
  suggestReorderQuantity,
  
  // Alertes
  getRestockAlerts,
  generateForecastReport,
};
