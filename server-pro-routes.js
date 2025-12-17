// server-pro-routes.js — Routes API pour les modules PRO
// À inclure dans server.js avec: require('./server-pro-routes')(app);

module.exports = function(app) {
  
  // ============================================
  // IMPORTS
  // ============================================
  
  let batchStore, supplierStore, purchaseOrderStore, forecastManager, kitStore, inventoryCountStore, planManager;
  
  try { batchStore = require('./batchStore'); } catch(e) { console.warn('batchStore not loaded'); }
  try { supplierStore = require('./supplierStore'); } catch(e) { console.warn('supplierStore not loaded'); }
  try { purchaseOrderStore = require('./purchaseOrderStore'); } catch(e) { console.warn('purchaseOrderStore not loaded'); }
  try { forecastManager = require('./forecastManager'); } catch(e) { console.warn('forecastManager not loaded'); }
  try { kitStore = require('./kitStore'); } catch(e) { console.warn('kitStore not loaded'); }
  try { inventoryCountStore = require('./inventoryCountStore'); } catch(e) { console.warn('inventoryCountStore not loaded'); }
  try { planManager = require('./planManager'); } catch(e) { console.warn('planManager not loaded'); }

  // Helper: vérifier feature
  function checkFeature(req, res, feature) {
    const shop = req.query.shop || req.headers['x-shop-domain'];
    if (!shop) {
      res.status(400).json({ error: 'Shop requis' });
      return false;
    }
    if (planManager && !planManager.hasFeature(shop, feature)) {
      res.status(403).json({ 
        error: 'Feature non disponible', 
        feature,
        upgrade: true,
        message: `Cette fonctionnalité nécessite un plan supérieur.`
      });
      return false;
    }
    return shop;
  }

  // ============================================
  // BATCHES (Lots)
  // ============================================

  if (batchStore) {
    // Liste des lots
    app.get('/api/batches', (req, res) => {
      const shop = checkFeature(req, res, 'hasBatchTracking');
      if (!shop) return;
      
      try {
        const { productId, status, expiringSoon } = req.query;
        let batches = batchStore.listBatches(shop, { productId });
        
        if (status) {
          batches = batches.filter(b => b.status === status);
        }
        if (expiringSoon === 'true') {
          batches = batchStore.getExpiringSoon(shop, 30);
        }
        
        res.json(batches);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Créer un lot
    app.post('/api/batches', (req, res) => {
      const shop = checkFeature(req, res, 'hasBatchTracking');
      if (!shop) return;
      
      try {
        const batch = batchStore.createBatch(shop, req.body);
        res.status(201).json(batch);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Détail d'un lot
    app.get('/api/batches/:batchId', (req, res) => {
      const shop = checkFeature(req, res, 'hasBatchTracking');
      if (!shop) return;
      
      try {
        const batch = batchStore.getBatch(shop, req.params.batchId);
        if (!batch) return res.status(404).json({ error: 'Lot non trouvé' });
        res.json(batch);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Consommer un lot (FIFO)
    app.post('/api/batches/consume', (req, res) => {
      const shop = checkFeature(req, res, 'hasBatchTracking');
      if (!shop) return;
      
      try {
        const { productId, grams, reason } = req.body;
        const result = batchStore.consumeStock(shop, productId, grams, reason);
        res.json(result);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Lots expirés
    app.get('/api/batches/expired', (req, res) => {
      const shop = checkFeature(req, res, 'hasBatchTracking');
      if (!shop) return;
      
      try {
        const expired = batchStore.getExpiredBatches(shop);
        res.json(expired);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  }

  // ============================================
  // SUPPLIERS (Fournisseurs)
  // ============================================

  if (supplierStore) {
    // Liste des fournisseurs
    app.get('/api/suppliers', (req, res) => {
      const shop = checkFeature(req, res, 'hasSuppliers');
      if (!shop) return;
      
      try {
        const suppliers = supplierStore.listSuppliers(shop);
        res.json(suppliers);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Créer un fournisseur
    app.post('/api/suppliers', (req, res) => {
      const shop = checkFeature(req, res, 'hasSuppliers');
      if (!shop) return;
      
      try {
        const supplier = supplierStore.createSupplier(shop, req.body);
        res.status(201).json(supplier);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Détail fournisseur
    app.get('/api/suppliers/:supplierId', (req, res) => {
      const shop = checkFeature(req, res, 'hasSuppliers');
      if (!shop) return;
      
      try {
        const supplier = supplierStore.getSupplier(shop, req.params.supplierId);
        if (!supplier) return res.status(404).json({ error: 'Fournisseur non trouvé' });
        res.json(supplier);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Modifier fournisseur
    app.put('/api/suppliers/:supplierId', (req, res) => {
      const shop = checkFeature(req, res, 'hasSuppliers');
      if (!shop) return;
      
      try {
        const supplier = supplierStore.updateSupplier(shop, req.params.supplierId, req.body);
        res.json(supplier);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Supprimer fournisseur
    app.delete('/api/suppliers/:supplierId', (req, res) => {
      const shop = checkFeature(req, res, 'hasSuppliers');
      if (!shop) return;
      
      try {
        supplierStore.deleteSupplier(shop, req.params.supplierId);
        res.json({ success: true });
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Comparaison prix
    app.get('/api/suppliers/compare/:productId', (req, res) => {
      const shop = checkFeature(req, res, 'hasSuppliers');
      if (!shop) return;
      
      try {
        const comparison = supplierStore.compareSupplierPrices(shop, req.params.productId);
        res.json(comparison);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  }

  // ============================================
  // PURCHASE ORDERS (Bons de commande)
  // ============================================

  if (purchaseOrderStore) {
    // Liste des PO
    app.get('/api/purchase-orders', (req, res) => {
      const shop = checkFeature(req, res, 'hasPurchaseOrders');
      if (!shop) return;
      
      try {
        const { year, status, supplierId } = req.query;
        const orders = purchaseOrderStore.listPurchaseOrders(shop, { 
          year: year ? parseInt(year) : undefined, 
          status, 
          supplierId 
        });
        res.json(orders);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Créer PO
    app.post('/api/purchase-orders', (req, res) => {
      const shop = checkFeature(req, res, 'hasPurchaseOrders');
      if (!shop) return;
      
      try {
        const po = purchaseOrderStore.createPurchaseOrder(shop, req.body);
        res.status(201).json(po);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Détail PO
    app.get('/api/purchase-orders/:poId', (req, res) => {
      const shop = checkFeature(req, res, 'hasPurchaseOrders');
      if (!shop) return;
      
      try {
        const po = purchaseOrderStore.getPurchaseOrder(shop, req.params.poId);
        if (!po) return res.status(404).json({ error: 'Commande non trouvée' });
        res.json(po);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Envoyer PO
    app.post('/api/purchase-orders/:poId/send', (req, res) => {
      const shop = checkFeature(req, res, 'hasPurchaseOrders');
      if (!shop) return;
      
      try {
        const po = purchaseOrderStore.sendPurchaseOrder(shop, req.params.poId);
        res.json(po);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Confirmer PO
    app.post('/api/purchase-orders/:poId/confirm', (req, res) => {
      const shop = checkFeature(req, res, 'hasPurchaseOrders');
      if (!shop) return;
      
      try {
        const { expectedDeliveryAt } = req.body;
        const po = purchaseOrderStore.confirmPurchaseOrder(shop, req.params.poId, expectedDeliveryAt);
        res.json(po);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Recevoir articles
    app.post('/api/purchase-orders/:poId/receive', (req, res) => {
      const shop = checkFeature(req, res, 'hasPurchaseOrders');
      if (!shop) return;
      
      try {
        const { lines, createBatches } = req.body;
        const po = purchaseOrderStore.receiveItems(shop, req.params.poId, lines, { createBatches });
        res.json(po);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Stats PO
    app.get('/api/purchase-orders/stats/:year', (req, res) => {
      const shop = checkFeature(req, res, 'hasPurchaseOrders');
      if (!shop) return;
      
      try {
        const stats = purchaseOrderStore.getPOStats(shop, parseInt(req.params.year));
        res.json(stats);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  }

  // ============================================
  // FORECAST (Prévisions)
  // ============================================

  if (forecastManager) {
    // Vélocité d'un produit
    app.get('/api/forecast/velocity/:productId', (req, res) => {
      const shop = checkFeature(req, res, 'hasForecast');
      if (!shop) return;
      
      try {
        const { days } = req.query;
        const velocity = forecastManager.calculateVelocity(shop, req.params.productId, { 
          days: days ? parseInt(days) : 30 
        });
        res.json(velocity);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Prédiction rupture
    app.get('/api/forecast/stockout/:productId', (req, res) => {
      const shop = checkFeature(req, res, 'hasForecast');
      if (!shop) return;
      
      try {
        const { currentStock, safetyStockDays, leadTimeDays } = req.query;
        const prediction = forecastManager.predictStockout(shop, req.params.productId, parseFloat(currentStock) || 0, {
          safetyStockDays: safetyStockDays ? parseInt(safetyStockDays) : 7,
          leadTimeDays: leadTimeDays ? parseInt(leadTimeDays) : 5
        });
        res.json(prediction);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Suggestion réapprovisionnement
    app.get('/api/forecast/reorder/:productId', (req, res) => {
      const shop = checkFeature(req, res, 'hasForecast');
      if (!shop) return;
      
      try {
        const { currentStock, targetStockDays } = req.query;
        const suggestion = forecastManager.suggestReorderQuantity(shop, req.params.productId, parseFloat(currentStock) || 0, {
          targetStockDays: targetStockDays ? parseInt(targetStockDays) : 30
        });
        res.json(suggestion);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Alertes restock
    app.post('/api/forecast/alerts', (req, res) => {
      const shop = checkFeature(req, res, 'hasForecast');
      if (!shop) return;
      
      try {
        const { stockSnapshot } = req.body;
        const alerts = forecastManager.getRestockAlerts(shop, stockSnapshot);
        res.json(alerts);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Rapport complet
    app.post('/api/forecast/report', (req, res) => {
      const shop = checkFeature(req, res, 'hasForecast');
      if (!shop) return;
      
      try {
        const { stockSnapshot } = req.body;
        const report = forecastManager.generateForecastReport(shop, stockSnapshot);
        res.json(report);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  }

  // ============================================
  // KITS (Bundles)
  // ============================================

  if (kitStore) {
    // Liste des kits
    app.get('/api/kits', (req, res) => {
      const shop = checkFeature(req, res, 'hasKits');
      if (!shop) return;
      
      try {
        const kits = kitStore.listKits(shop);
        res.json(kits);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Créer kit
    app.post('/api/kits', (req, res) => {
      const shop = checkFeature(req, res, 'hasKits');
      if (!shop) return;
      
      try {
        const kit = kitStore.createKit(shop, req.body);
        res.status(201).json(kit);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Détail kit
    app.get('/api/kits/:kitId', (req, res) => {
      const shop = checkFeature(req, res, 'hasKits');
      if (!shop) return;
      
      try {
        const kit = kitStore.getKit(shop, req.params.kitId);
        if (!kit) return res.status(404).json({ error: 'Kit non trouvé' });
        res.json(kit);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Stock kit calculé
    app.post('/api/kits/:kitId/stock', (req, res) => {
      const shop = checkFeature(req, res, 'hasKits');
      if (!shop) return;
      
      try {
        const { stockSnapshot } = req.body;
        const stock = kitStore.calculateKitStock(shop, req.params.kitId, stockSnapshot);
        res.json(stock);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Déduire composants
    app.post('/api/kits/:kitId/deduct', (req, res) => {
      const shop = checkFeature(req, res, 'hasKits');
      if (!shop) return;
      
      try {
        const { quantity, stockManager } = req.body;
        const result = kitStore.deductKitComponents(shop, req.params.kitId, quantity || 1, stockManager);
        res.json(result);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Stats kits
    app.post('/api/kits/stats', (req, res) => {
      const shop = checkFeature(req, res, 'hasKits');
      if (!shop) return;
      
      try {
        const { stockSnapshot } = req.body;
        const stats = kitStore.getKitStats(shop, stockSnapshot);
        res.json(stats);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  }

  // ============================================
  // INVENTORY COUNT (Inventaire)
  // ============================================

  if (inventoryCountStore) {
    // Liste des inventaires
    app.get('/api/inventory-counts', (req, res) => {
      const shop = checkFeature(req, res, 'hasInventoryCount');
      if (!shop) return;
      
      try {
        const counts = inventoryCountStore.listInventoryCounts(shop);
        res.json(counts);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Créer inventaire
    app.post('/api/inventory-counts', (req, res) => {
      const shop = checkFeature(req, res, 'hasInventoryCount');
      if (!shop) return;
      
      try {
        const { stockSnapshot, scope, categoryIds, productIds, name } = req.body;
        const count = inventoryCountStore.createInventoryCount(shop, stockSnapshot, { 
          scope, categoryIds, productIds, name 
        });
        res.status(201).json(count);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Détail inventaire
    app.get('/api/inventory-counts/:countId', (req, res) => {
      const shop = checkFeature(req, res, 'hasInventoryCount');
      if (!shop) return;
      
      try {
        const count = inventoryCountStore.getInventoryCount(shop, req.params.countId);
        if (!count) return res.status(404).json({ error: 'Inventaire non trouvé' });
        res.json(count);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Mettre à jour comptage
    app.put('/api/inventory-counts/:countId/products/:productId', (req, res) => {
      const shop = checkFeature(req, res, 'hasInventoryCount');
      if (!shop) return;
      
      try {
        const { countedGrams, notes, countedBy } = req.body;
        const count = inventoryCountStore.updateProductCount(shop, req.params.countId, req.params.productId, countedGrams, { notes, countedBy });
        res.json(count);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Soumettre pour review
    app.post('/api/inventory-counts/:countId/submit', (req, res) => {
      const shop = checkFeature(req, res, 'hasInventoryCount');
      if (!shop) return;
      
      try {
        const count = inventoryCountStore.submitForReview(shop, req.params.countId);
        res.json(count);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Approuver et ajuster
    app.post('/api/inventory-counts/:countId/approve', (req, res) => {
      const shop = checkFeature(req, res, 'hasInventoryCount');
      if (!shop) return;
      
      try {
        const { approvedBy } = req.body;
        // Note: stockManager doit être passé depuis server.js
        const count = inventoryCountStore.approveAndAdjust(shop, req.params.countId, approvedBy);
        res.json(count);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    // Rapport écarts
    app.get('/api/inventory-counts/:countId/variance-report', (req, res) => {
      const shop = checkFeature(req, res, 'hasInventoryCount');
      if (!shop) return;
      
      try {
        const report = inventoryCountStore.generateVarianceReport(shop, req.params.countId);
        res.json(report);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  }

  console.log('✅ Routes PRO chargées');
};
