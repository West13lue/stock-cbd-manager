// inventoryCountStore.js - Sessions d'inventaire, comptage, écarts et audit
// v1.0 - Stocktake, Review, Apply, Audit Trail

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/var/data";

// ============================================
// CONSTANTES
// ============================================

const SESSION_STATUS = {
  DRAFT: "draft",
  IN_PROGRESS: "in_progress",
  REVIEWED: "reviewed",
  APPLIED: "applied",
  ARCHIVED: "archived",
};

const SCOPE_TYPE = {
  ALL: "all",
  CATEGORY: "category",
  SELECTION: "selection",
};

const COUNTING_MODE = {
  TOTAL_ONLY: "totalOnly",
  VARIANTS: "variants",
  BATCHES: "batches",
};

const ITEM_STATUS = {
  NOT_COUNTED: "notCounted",
  COUNTED: "counted",
  FLAGGED: "flagged",
};

const EVENT_SOURCE = {
  INVENTORY: "inventory",
  MANUAL: "manual",
  SHOPIFY_SYNC: "shopifySync",
  ORDER: "order",
  IMPORT: "import",
};

const ADJUSTMENT_REASONS = [
  { id: "breakage", label: "Casse" },
  { id: "theft", label: "Vol" },
  { id: "error", label: "Erreur de saisie" },
  { id: "return", label: "Retour" },
  { id: "sampling", label: "Échantillon" },
  { id: "expired", label: "Périmé" },
  { id: "damaged", label: "Endommagé" },
  { id: "found", label: "Retrouvé" },
  { id: "other", label: "Autre" },
];

// ============================================
// HELPERS
// ============================================

function inventoryDir(shop) {
  const dir = path.join(DATA_DIR, shop, "inventory");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionsFile(shop) {
  return path.join(inventoryDir(shop), "sessions.json");
}

function itemsFile(shop, sessionId) {
  return path.join(inventoryDir(shop), `items_${sessionId}.json`);
}

function eventsFile(shop) {
  return path.join(inventoryDir(shop), "events.json");
}

function loadSessions(shop) {
  try {
    const file = sessionsFile(shop);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(data.sessions) ? data.sessions : [];
    }
  } catch (e) {
    console.warn("Erreur lecture sessions inventaire:", e.message);
  }
  return [];
}

function saveSessions(shop, sessions) {
  const file = sessionsFile(shop);
  const data = { updatedAt: new Date().toISOString(), sessions };
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(file + ".tmp", file);
  return sessions;
}

function loadItems(shop, sessionId) {
  try {
    const file = itemsFile(shop, sessionId);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(data.items) ? data.items : [];
    }
  } catch (e) {
    console.warn("Erreur lecture items inventaire:", e.message);
  }
  return [];
}

function saveItems(shop, sessionId, items) {
  const file = itemsFile(shop, sessionId);
  const data = { sessionId, updatedAt: new Date().toISOString(), items };
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(file + ".tmp", file);
  return items;
}

function loadEvents(shop) {
  try {
    const file = eventsFile(shop);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(data.events) ? data.events : [];
    }
  } catch (e) {
    console.warn("Erreur lecture events inventaire:", e.message);
  }
  return [];
}

function saveEvents(shop, events) {
  const file = eventsFile(shop);
  // Garder les 2000 derniers événements
  const trimmed = events.slice(-2000);
  const data = { updatedAt: new Date().toISOString(), events: trimmed };
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(file + ".tmp", file);
  return trimmed;
}

function generateId(prefix = "inv") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================
// SESSIONS CRUD
// ============================================

/**
 * Créer une nouvelle session d'inventaire
 */
function createSession(shop, sessionData) {
  const sessions = loadSessions(shop);
  
  if (!sessionData.name || !sessionData.name.trim()) {
    throw new Error("Nom de session requis");
  }
  
  const session = {
    id: generateId("sess"),
    name: sessionData.name.trim(),
    scopeType: sessionData.scopeType || SCOPE_TYPE.ALL,
    scopeIds: Array.isArray(sessionData.scopeIds) ? sessionData.scopeIds : [],
    countingMode: sessionData.countingMode || COUNTING_MODE.TOTAL_ONLY,
    status: SESSION_STATUS.DRAFT,
    
    // Assignation (Business)
    assigneeId: sessionData.assigneeId || null,
    assigneeName: sessionData.assigneeName || null,
    
    // Notes
    notes: sessionData.notes || "",
    
    // Totaux (calculés)
    totals: {
      itemsTotal: 0,
      itemsCounted: 0,
      itemsWithDiff: 0,
      totalDeltaQty: 0,
      totalDeltaValue: 0,
    },
    
    // Timestamps
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    reviewedAt: null,
    appliedAt: null,
  };
  
  sessions.push(session);
  saveSessions(shop, sessions);
  
  return session;
}

/**
 * Récupérer une session par ID
 */
function getSession(shop, sessionId) {
  const sessions = loadSessions(shop);
  return sessions.find(s => s.id === sessionId) || null;
}

/**
 * Mettre à jour une session
 */
function updateSession(shop, sessionId, updates) {
  const sessions = loadSessions(shop);
  const index = sessions.findIndex(s => s.id === sessionId);
  
  if (index === -1) {
    throw new Error("Session non trouvée");
  }
  
  const session = sessions[index];
  
  // Champs modifiables selon le statut
  if ([SESSION_STATUS.DRAFT, SESSION_STATUS.IN_PROGRESS].includes(session.status)) {
    if (updates.name !== undefined) session.name = updates.name;
    if (updates.notes !== undefined) session.notes = updates.notes;
    if (updates.assigneeId !== undefined) session.assigneeId = updates.assigneeId;
    if (updates.assigneeName !== undefined) session.assigneeName = updates.assigneeName;
  }
  
  session.updatedAt = new Date().toISOString();
  saveSessions(shop, sessions);
  
  return session;
}

/**
 * Démarrer une session (passe de draft à in_progress)
 */
function startSession(shop, sessionId, productsData = []) {
  const sessions = loadSessions(shop);
  const session = sessions.find(s => s.id === sessionId);
  
  if (!session) {
    throw new Error("Session non trouvée");
  }
  
  if (session.status !== SESSION_STATUS.DRAFT) {
    throw new Error("Session déjà démarrée");
  }
  
  // Filtrer les produits selon le scope
  let products = productsData;
  if (session.scopeType === SCOPE_TYPE.CATEGORY && session.scopeIds.length > 0) {
    products = products.filter(p => 
      p.categoryIds && p.categoryIds.some(cid => session.scopeIds.includes(cid))
    );
  } else if (session.scopeType === SCOPE_TYPE.SELECTION && session.scopeIds.length > 0) {
    products = products.filter(p => session.scopeIds.includes(p.productId));
  }
  
  // Créer les items de comptage
  const items = [];
  
  for (const product of products) {
    if (session.countingMode === COUNTING_MODE.VARIANTS && product.variants) {
      // Mode variantes : une ligne par variante
      for (const [label, variant] of Object.entries(product.variants)) {
        items.push({
          id: generateId("item"),
          sessionId,
          productId: product.productId,
          productName: product.name,
          variantLabel: label,
          variantId: variant.variantId || null,
          batchId: null,
          expectedQty: variant.gramsPerUnit || 0, // Stock par variante = gramsPerUnit (à améliorer)
          countedQty: null,
          delta: null,
          unitType: "g",
          status: ITEM_STATUS.NOT_COUNTED,
          reason: null,
          note: null,
          flagged: false,
          cmp: product.averageCostPerGram || 0,
          deltaValue: null,
          updatedAt: null,
        });
      }
    } else {
      // Mode total : une ligne par produit
      items.push({
        id: generateId("item"),
        sessionId,
        productId: product.productId,
        productName: product.name,
        variantLabel: null,
        variantId: null,
        batchId: null,
        expectedQty: product.totalGrams || 0,
        countedQty: null,
        delta: null,
        unitType: "g",
        status: ITEM_STATUS.NOT_COUNTED,
        reason: null,
        note: null,
        flagged: false,
        cmp: product.averageCostPerGram || 0,
        deltaValue: null,
        updatedAt: null,
      });
    }
  }
  
  // Sauvegarder les items
  saveItems(shop, sessionId, items);
  
  // Mettre à jour la session
  session.status = SESSION_STATUS.IN_PROGRESS;
  session.startedAt = new Date().toISOString();
  session.totals.itemsTotal = items.length;
  session.updatedAt = new Date().toISOString();
  saveSessions(shop, sessions);
  
  return { session, itemsCount: items.length };
}

/**
 * Lister les sessions avec filtres
 */
function listSessions(shop, options = {}) {
  let sessions = loadSessions(shop);
  
  const { status, includeArchived, limit = 50 } = options;
  
  if (!includeArchived) {
    sessions = sessions.filter(s => s.status !== SESSION_STATUS.ARCHIVED);
  }
  
  if (status) {
    sessions = sessions.filter(s => s.status === status);
  }
  
  // Tri par date décroissante
  sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return sessions.slice(0, limit);
}

/**
 * Archiver une session
 */
function archiveSession(shop, sessionId) {
  const sessions = loadSessions(shop);
  const session = sessions.find(s => s.id === sessionId);
  
  if (!session) {
    throw new Error("Session non trouvée");
  }
  
  session.status = SESSION_STATUS.ARCHIVED;
  session.updatedAt = new Date().toISOString();
  saveSessions(shop, sessions);
  
  return session;
}

/**
 * Dupliquer une session (crée une nouvelle en draft)
 */
function duplicateSession(shop, sessionId) {
  const original = getSession(shop, sessionId);
  if (!original) {
    throw new Error("Session non trouvée");
  }
  
  return createSession(shop, {
    name: `${original.name} (copie)`,
    scopeType: original.scopeType,
    scopeIds: [...original.scopeIds],
    countingMode: original.countingMode,
    notes: original.notes,
  });
}

// ============================================
// ITEMS (COMPTAGE)
// ============================================

/**
 * Récupérer les items d'une session
 */
function getSessionItems(shop, sessionId, options = {}) {
  let items = loadItems(shop, sessionId);
  
  const { status, search, onlyDiffs, onlyFlagged } = options;
  
  if (status) {
    items = items.filter(i => i.status === status);
  }
  
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(i => 
      i.productName.toLowerCase().includes(q) ||
      (i.variantLabel && i.variantLabel.toLowerCase().includes(q))
    );
  }
  
  if (onlyDiffs) {
    items = items.filter(i => i.delta !== null && i.delta !== 0);
  }
  
  if (onlyFlagged) {
    items = items.filter(i => i.flagged);
  }
  
  return items;
}

/**
 * Mettre à jour un item (comptage)
 */
function updateItem(shop, sessionId, itemId, updates) {
  const items = loadItems(shop, sessionId);
  const item = items.find(i => i.id === itemId);
  
  if (!item) {
    throw new Error("Item non trouvé");
  }
  
  // Mise à jour du comptage
  if (updates.countedQty !== undefined) {
    item.countedQty = updates.countedQty === null ? null : Number(updates.countedQty);
    
    if (item.countedQty !== null) {
      item.delta = item.countedQty - item.expectedQty;
      item.deltaValue = item.delta * (item.cmp || 0);
      item.status = ITEM_STATUS.COUNTED;
    } else {
      item.delta = null;
      item.deltaValue = null;
      item.status = ITEM_STATUS.NOT_COUNTED;
    }
  }
  
  if (updates.reason !== undefined) item.reason = updates.reason;
  if (updates.note !== undefined) item.note = updates.note;
  if (updates.flagged !== undefined) {
    item.flagged = updates.flagged;
    if (updates.flagged) item.status = ITEM_STATUS.FLAGGED;
  }
  
  item.updatedAt = new Date().toISOString();
  saveItems(shop, sessionId, items);
  
  // Recalculer les totaux de la session
  recalculateSessionTotals(shop, sessionId);
  
  return item;
}

/**
 * Mise à jour en masse (autosave)
 */
function bulkUpsertItems(shop, sessionId, itemsUpdates) {
  const items = loadItems(shop, sessionId);
  const results = [];
  
  for (const update of itemsUpdates) {
    const item = items.find(i => i.id === update.id);
    if (!item) continue;
    
    if (update.countedQty !== undefined) {
      item.countedQty = update.countedQty === null ? null : Number(update.countedQty);
      
      if (item.countedQty !== null) {
        item.delta = item.countedQty - item.expectedQty;
        item.deltaValue = item.delta * (item.cmp || 0);
        item.status = ITEM_STATUS.COUNTED;
      } else {
        item.delta = null;
        item.deltaValue = null;
        item.status = ITEM_STATUS.NOT_COUNTED;
      }
    }
    
    if (update.reason !== undefined) item.reason = update.reason;
    if (update.note !== undefined) item.note = update.note;
    if (update.flagged !== undefined) {
      item.flagged = update.flagged;
      if (update.flagged) item.status = ITEM_STATUS.FLAGGED;
    }
    
    item.updatedAt = new Date().toISOString();
    results.push(item);
  }
  
  saveItems(shop, sessionId, items);
  recalculateSessionTotals(shop, sessionId);
  
  return results;
}

/**
 * Recalculer les totaux d'une session
 */
function recalculateSessionTotals(shop, sessionId) {
  const sessions = loadSessions(shop);
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;
  
  const items = loadItems(shop, sessionId);
  
  const counted = items.filter(i => i.status === ITEM_STATUS.COUNTED || i.status === ITEM_STATUS.FLAGGED);
  const withDiff = items.filter(i => i.delta !== null && i.delta !== 0);
  
  session.totals = {
    itemsTotal: items.length,
    itemsCounted: counted.length,
    itemsWithDiff: withDiff.length,
    totalDeltaQty: withDiff.reduce((sum, i) => sum + (i.delta || 0), 0),
    totalDeltaValue: withDiff.reduce((sum, i) => sum + (i.deltaValue || 0), 0),
  };
  
  session.updatedAt = new Date().toISOString();
  saveSessions(shop, sessions);
  
  return session.totals;
}

// ============================================
// REVIEW & APPLY
// ============================================

/**
 * Marquer une session comme reviewed
 */
function reviewSession(shop, sessionId) {
  const sessions = loadSessions(shop);
  const session = sessions.find(s => s.id === sessionId);
  
  if (!session) {
    throw new Error("Session non trouvée");
  }
  
  if (session.status !== SESSION_STATUS.IN_PROGRESS) {
    throw new Error("La session doit être en cours pour être validée");
  }
  
  // Vérifier qu'il y a des items comptés
  const items = loadItems(shop, sessionId);
  const counted = items.filter(i => i.status !== ITEM_STATUS.NOT_COUNTED);
  
  if (counted.length === 0) {
    throw new Error("Aucun item n'a été compté");
  }
  
  session.status = SESSION_STATUS.REVIEWED;
  session.reviewedAt = new Date().toISOString();
  session.updatedAt = new Date().toISOString();
  saveSessions(shop, sessions);
  
  return session;
}

/**
 * Appliquer les ajustements (irréversible)
 */
function applySession(shop, sessionId, options = {}) {
  const { stockManager, allowNegative = false } = options;
  
  const sessions = loadSessions(shop);
  const session = sessions.find(s => s.id === sessionId);
  
  if (!session) {
    throw new Error("Session non trouvée");
  }
  
  if (session.status !== SESSION_STATUS.REVIEWED) {
    throw new Error("La session doit être validée avant application");
  }
  
  const items = loadItems(shop, sessionId);
  const toApply = items.filter(i => i.delta !== null && i.delta !== 0);
  
  if (toApply.length === 0) {
    throw new Error("Aucun écart à appliquer");
  }
  
  const results = {
    applied: 0,
    clamped: 0,
    errors: [],
    events: [],
  };
  
  for (const item of toApply) {
    try {
      let deltaToApply = item.delta;
      let wasClamped = false;
      
      // Vérifier si on doit clamper à 0
      if (!allowNegative && stockManager) {
        const currentStock = stockManager.getProductStock?.(shop, item.productId) || item.expectedQty;
        const newStock = currentStock + deltaToApply;
        
        if (newStock < 0) {
          deltaToApply = -currentStock; // Ramène à 0
          wasClamped = true;
          results.clamped++;
        }
      }
      
      // Appliquer l'ajustement au stock
      if (stockManager && typeof stockManager.adjustStock === "function") {
        stockManager.adjustStock(shop, item.productId, deltaToApply, {
          reason: `Inventaire: ${session.name}`,
          source: "inventory_session",
          sessionId: session.id,
          itemReason: item.reason,
        });
      }
      
      // Créer un événement d'audit
      const event = {
        id: generateId("evt"),
        sessionId: session.id,
        sessionName: session.name,
        productId: item.productId,
        productName: item.productName,
        variantId: item.variantId,
        variantLabel: item.variantLabel,
        batchId: item.batchId,
        expectedQty: item.expectedQty,
        countedQty: item.countedQty,
        deltaQty: deltaToApply,
        deltaValue: deltaToApply * (item.cmp || 0),
        reason: item.reason,
        note: item.note,
        wasClamped,
        source: EVENT_SOURCE.INVENTORY,
        createdAt: new Date().toISOString(),
      };
      
      results.events.push(event);
      results.applied++;
      
    } catch (e) {
      results.errors.push({ itemId: item.id, productId: item.productId, error: e.message });
    }
  }
  
  // Sauvegarder les événements
  const events = loadEvents(shop);
  events.push(...results.events);
  saveEvents(shop, events);
  
  // Marquer la session comme appliquée
  session.status = SESSION_STATUS.APPLIED;
  session.appliedAt = new Date().toISOString();
  session.updatedAt = new Date().toISOString();
  saveSessions(shop, sessions);
  
  return {
    session,
    ...results,
  };
}

// ============================================
// EVENTS / AUDIT
// ============================================

/**
 * Ajouter un événement manuel
 */
function addEvent(shop, eventData) {
  const events = loadEvents(shop);
  
  const event = {
    id: generateId("evt"),
    sessionId: eventData.sessionId || null,
    productId: eventData.productId,
    productName: eventData.productName || "",
    variantId: eventData.variantId || null,
    batchId: eventData.batchId || null,
    deltaQty: Number(eventData.deltaQty) || 0,
    deltaValue: Number(eventData.deltaValue) || 0,
    reason: eventData.reason || null,
    note: eventData.note || null,
    source: eventData.source || EVENT_SOURCE.MANUAL,
    userId: eventData.userId || null,
    createdAt: new Date().toISOString(),
  };
  
  events.push(event);
  saveEvents(shop, events);
  
  return event;
}

/**
 * Lister les événements avec filtres
 */
function listEvents(shop, options = {}) {
  let events = loadEvents(shop);
  
  const { sessionId, productId, source, from, to, limit = 100 } = options;
  
  if (sessionId) {
    events = events.filter(e => e.sessionId === sessionId);
  }
  
  if (productId) {
    events = events.filter(e => e.productId === productId);
  }
  
  if (source) {
    events = events.filter(e => e.source === source);
  }
  
  if (from) {
    events = events.filter(e => new Date(e.createdAt) >= new Date(from));
  }
  
  if (to) {
    events = events.filter(e => new Date(e.createdAt) <= new Date(to));
  }
  
  // Tri par date décroissante
  events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return events.slice(0, limit);
}

// ============================================
// STATS & KPIs
// ============================================

/**
 * Calculer les KPIs d'inventaire
 */
function getInventoryStats(shop, options = {}) {
  const { from, to } = options;
  
  let events = loadEvents(shop);
  
  // Filtrer par période
  if (from) {
    events = events.filter(e => new Date(e.createdAt) >= new Date(from));
  }
  if (to) {
    events = events.filter(e => new Date(e.createdAt) <= new Date(to));
  }
  
  // Stats globales
  const totalDeltaValue = events.reduce((sum, e) => sum + (e.deltaValue || 0), 0);
  const negativeDeltas = events.filter(e => e.deltaQty < 0);
  const shrinkageValue = negativeDeltas.reduce((sum, e) => sum + Math.abs(e.deltaValue || 0), 0);
  
  // Top produits à écarts
  const productDeltas = {};
  for (const e of events) {
    if (!productDeltas[e.productId]) {
      productDeltas[e.productId] = { 
        productId: e.productId, 
        productName: e.productName,
        totalDelta: 0,
        totalValue: 0,
        count: 0,
      };
    }
    productDeltas[e.productId].totalDelta += Math.abs(e.deltaQty || 0);
    productDeltas[e.productId].totalValue += Math.abs(e.deltaValue || 0);
    productDeltas[e.productId].count++;
  }
  
  const topProductsByDelta = Object.values(productDeltas)
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 10);
  
  // Raisons les plus fréquentes
  const reasonCounts = {};
  for (const e of events) {
    const r = e.reason || "non_specifie";
    reasonCounts[r] = (reasonCounts[r] || 0) + 1;
  }
  
  // Sessions récentes
  const sessions = listSessions(shop, { limit: 10 });
  const appliedSessions = sessions.filter(s => s.status === SESSION_STATUS.APPLIED);
  
  return {
    period: { from, to },
    totalEvents: events.length,
    totalDeltaValue: Math.round(totalDeltaValue * 100) / 100,
    shrinkageValue: Math.round(shrinkageValue * 100) / 100,
    topProductsByDelta,
    reasonBreakdown: reasonCounts,
    recentSessions: sessions.slice(0, 5),
    appliedSessionsCount: appliedSessions.length,
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Constants
  SESSION_STATUS,
  SCOPE_TYPE,
  COUNTING_MODE,
  ITEM_STATUS,
  EVENT_SOURCE,
  ADJUSTMENT_REASONS,
  
  // Sessions
  createSession,
  getSession,
  updateSession,
  startSession,
  listSessions,
  archiveSession,
  duplicateSession,
  
  // Items
  getSessionItems,
  updateItem,
  bulkUpsertItems,
  recalculateSessionTotals,
  
  // Review & Apply
  reviewSession,
  applySession,
  
  // Events
  addEvent,
  listEvents,
  
  // Stats
  getInventoryStats,
  
  // Raw access
  loadSessions,
  saveSessions,
  loadItems,
  saveItems,
  loadEvents,
  saveEvents,
};