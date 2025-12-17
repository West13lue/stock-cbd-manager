// app.js - Stock Manager Pro - Main Application (FIXED)
(function() {
  'use strict';

  var API_BASE = '/api';
  var appBridgeApp = null;
  var sessionToken = null;
  var apiKeyCache = null;

  function getHostFromUrl() {
    var urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('host');
  }

  async function loadPublicConfig() {
    if (apiKeyCache) return apiKeyCache;
    var res = await fetch('/api/public/config', { headers: { 'Accept': 'application/json' } });
    var json = await res.json().catch(function() { return {}; });
    apiKeyCache = String(json.apiKey || '').trim();
    return apiKeyCache;
  }

  async function initAppBridge() {
    var host = getHostFromUrl();
    if (!host) {
      console.warn('[AppBridge] host manquant dans URL');
      return false;
    }

    var apiKey = await loadPublicConfig();
    if (!apiKey) {
      console.warn('[AppBridge] apiKey introuvable');
      return false;
    }

    var AB = window['app-bridge'];
    if (!AB || typeof AB.createApp !== 'function') {
      console.warn('[AppBridge] non charge');
      return false;
    }

    appBridgeApp = AB.createApp({ apiKey: apiKey, host: host, forceRedirect: true });
    console.log('[AppBridge] OK');
    return true;
  }

  async function getSessionToken() {
    if (sessionToken) return sessionToken;
    if (!appBridgeApp) return null;

    var ABU = window['app-bridge-utils'];
    if (!ABU || typeof ABU.getSessionToken !== 'function') {
      console.warn('[AppBridge] getSessionToken indisponible');
      return null;
    }

    try {
      sessionToken = await ABU.getSessionToken(appBridgeApp);
      return sessionToken;
    } catch (e) {
      console.warn('[AppBridge] Erreur getSessionToken:', e);
      return null;
    }
  }

  function clearSessionToken() { sessionToken = null; }

  async function authFetch(url, options) {
    options = options || {};
    var token = await getSessionToken();
    var headers = Object.assign({}, options.headers || {}, { 'Accept': 'application/json' });

    var hasBody = options.body !== undefined && options.body !== null;
    if (hasBody && !(options.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    var doFetch = function() { return fetch(url, Object.assign({}, options, { headers: headers })); };
    var res = await doFetch();

    if (res.status === 401 && token) {
      console.warn('[Auth] 401 -> refresh token');
      clearSessionToken();
      var token2 = await getSessionToken();
      if (token2) headers['Authorization'] = 'Bearer ' + token2;
      else delete headers['Authorization'];
      res = await doFetch();
    }

    return res;
  }

  function getShopFromUrl() {
    var urlParams = new URLSearchParams(window.location.search);
    var shopParam = urlParams.get('shop');
    if (shopParam) return shopParam;

    var hostParam = urlParams.get('host');
    if (hostParam) {
      try {
        var decoded = atob(hostParam);
        var match = decoded.match(/([^/]+\.myshopify\.com)/);
        if (match) return match[1];
      } catch (e) {}
    }

    var cached = localStorage.getItem('stockmanager_shop');
    if (cached) return cached;
    return null;
  }

  var CURRENT_SHOP = getShopFromUrl();
  if (CURRENT_SHOP) {
    localStorage.setItem('stockmanager_shop', CURRENT_SHOP);
    console.log('[Shop] Detecte:', CURRENT_SHOP);
  }

  function apiUrl(endpoint) {
    if (!CURRENT_SHOP) return null;
    var separator = endpoint.includes('?') ? '&' : '?';
    return API_BASE + endpoint + separator + 'shop=' + encodeURIComponent(CURRENT_SHOP);
  }

  var FEATURES = {
    hasBatchTracking: { plan: 'pro', name: 'Lots & DLC', icon: '📦' },
    hasSuppliers: { plan: 'pro', name: 'Fournisseurs', icon: '🏭' },
    hasPurchaseOrders: { plan: 'business', name: 'Bons de commande', icon: '📝' },
    hasForecast: { plan: 'business', name: 'Previsions', icon: '🔮' },
    hasKits: { plan: 'business', name: 'Kits & Bundles', icon: '🧩' },
    hasAnalytics: { plan: 'pro', name: 'Analytics', icon: '📈' },
    hasInventoryCount: { plan: 'pro', name: 'Inventaire', icon: '📋' }
  };

  var PLAN_HIERARCHY = ['free', 'starter', 'pro', 'business', 'enterprise'];

  var state = {
    currentTab: 'dashboard',
    plan: { id: 'free', limits: { maxProducts: 2 } },
    planLimits: {}, // Stocke toutes les limites du plan (hasAnalytics, hasBatchTracking, etc.)
    products: [],
    loading: false,
    sidebarOpen: true,
    shop: CURRENT_SHOP
  };

  async function init() {
    console.log('[Init] Stock Manager Pro...');

    if (!CURRENT_SHOP || window.top === window.self) {
      console.warn('[Init] App hors iframe Shopify');
      document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif"><h2>Application Shopify</h2><p>Cette application doit etre ouverte depuis l\'admin Shopify.</p></div>';
      return;
    }

    var bridgeReady = await initAppBridge();
    if (!bridgeReady) {
      console.warn('[Init] App Bridge non pret');
      return;
    }

    setupNavigation();
    await loadPlanInfo();
    await loadProducts();
    renderTab('dashboard');
    updatePlanWidget();
    console.log('[Init] Ready - Plan:', state.plan.id);
  }

  function setupNavigation() {
    document.querySelectorAll('.nav-item[data-tab]').forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.preventDefault();
        var tab = item.dataset.tab;
        var feature = item.dataset.feature;
        if (feature && !hasFeature(feature)) {
          showFeatureLockedModal(feature);
          return;
        }
        navigateTo(tab);
      });
    });
  }

  function navigateTo(tab) {
    state.currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(function(item) {
      item.classList.toggle('active', item.dataset.tab === tab);
    });
    renderTab(tab);
  }

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    var el = document.getElementById('sidebar');
    if (el) el.classList.toggle('collapsed', !state.sidebarOpen);
  }

  function renderTab(tab) {
    var content = document.getElementById('pageContent');
    if (!content) return;

    var renderers = {
      dashboard: renderDashboard,
      products: renderProducts,
      batches: function(c) { renderFeatureTab(c, 'hasBatchTracking', 'Lots & DLC', '📦'); },
      suppliers: function(c) { renderFeatureTab(c, 'hasSuppliers', 'Fournisseurs', '🏭'); },
      orders: function(c) { renderFeatureTab(c, 'hasPurchaseOrders', 'Bons de commande', '📝'); },
      forecast: function(c) { renderFeatureTab(c, 'hasForecast', 'Previsions', '🔮'); },
      kits: function(c) { renderFeatureTab(c, 'hasKits', 'Kits & Bundles', '🧩'); },
      analytics: function(c) { renderFeatureTab(c, 'hasAnalytics', 'Analytics', '📈'); },
      inventory: function(c) { renderFeatureTab(c, 'hasInventoryCount', 'Inventaire', '📋'); },
      settings: renderSettings
    };

    var renderer = renderers[tab] || renderDashboard;
    if (typeof renderer === 'function') renderer(content);
  }

  function renderFeatureTab(c, featureKey, title, icon) {
    if (!hasFeature(featureKey)) {
      renderLockedFeature(c, featureKey);
    } else {
      c.innerHTML = '<div class="page-header"><div><h1 class="page-title">' + icon + ' ' + title + '</h1><p class="page-subtitle">Fonctionnalite disponible</p></div></div>' +
        '<div class="card"><div class="card-body"><div class="empty-state" style="min-height:250px"><div class="empty-icon">' + icon + '</div><p class="empty-description">Aucun element pour le moment</p></div></div></div>';
    }
  }

  function renderLockedFeature(c, featureKey) {
    var f = FEATURES[featureKey] || { name: 'Feature', plan: 'pro', icon: '🔒' };
    c.innerHTML = '<div class="page-header"><h1 class="page-title">' + f.icon + ' ' + f.name + '</h1></div>' +
      '<div class="card" style="min-height:400px;display:flex;align-items:center;justify-content:center">' +
      '<div class="text-center"><div style="font-size:64px;margin-bottom:16px">🔒</div>' +
      '<h2>Fonctionnalite ' + f.plan.toUpperCase() + '</h2>' +
      '<p class="text-secondary mb-lg">Passez au plan ' + f.plan.toUpperCase() + ' pour debloquer cette fonctionnalite.</p>' +
      '<button class="btn btn-upgrade btn-lg" onclick="app.showUpgradeModal(\'' + f.plan + '\')">Upgrader vers ' + f.plan.toUpperCase() + '</button>' +
      '<p class="text-secondary text-sm mt-md">A partir de ' + getPlanPrice(f.plan) + ' EUR/mois</p></div></div>';
  }

  function renderDashboard(c) {
    var totalStock = state.products.reduce(function(s, p) { return s + (p.totalGrams || 0); }, 0);
    var totalValue = state.products.reduce(function(s, p) { return s + ((p.totalGrams || 0) * (p.averageCostPerGram || 0)); }, 0);
    var lowStock = state.products.filter(function(p) { return (p.totalGrams || 0) < 100; }).length;

    c.innerHTML = '<div class="page-header"><div><h1 class="page-title">Tableau de bord</h1><p class="page-subtitle">Vue d\'ensemble de votre stock</p></div><div class="page-actions"><button class="btn btn-secondary" onclick="app.syncShopify()">Sync</button><button class="btn btn-primary" onclick="app.showAddProductModal()">+ Produit</button></div></div>' +
      '<div class="stats-grid">' +
      '<div class="stat-card"><div class="stat-icon">📦</div><div class="stat-value">' + state.products.length + '</div><div class="stat-label">Produits</div></div>' +
      '<div class="stat-card"><div class="stat-icon">⚖️</div><div class="stat-value">' + formatWeight(totalStock) + '</div><div class="stat-label">Stock total</div></div>' +
      '<div class="stat-card"><div class="stat-icon">💰</div><div class="stat-value">' + formatCurrency(totalValue) + '</div><div class="stat-label">Valeur</div></div>' +
      '<div class="stat-card"><div class="stat-icon">⚠️</div><div class="stat-value' + (lowStock > 0 ? ' text-warning' : '') + '">' + lowStock + '</div><div class="stat-label">Stock bas</div></div>' +
      '</div>' +
      '<div class="card mt-lg"><div class="card-header"><h3 class="card-title">Produits recents</h3><button class="btn btn-ghost btn-sm" onclick="app.navigateTo(\'products\')">Voir tout</button></div><div class="card-body" style="padding:0">' + (state.products.length > 0 ? renderProductsTable(state.products.slice(0, 5)) : renderEmptyProducts()) + '</div></div>';
  }

  function renderProducts(c) {
    c.innerHTML = '<div class="page-header"><div><h1 class="page-title">Produits</h1><p class="page-subtitle">' + state.products.length + ' produit(s)</p></div><div class="page-actions"><button class="btn btn-secondary" onclick="app.showImportModal()">Import Shopify</button><button class="btn btn-primary" onclick="app.showAddProductModal()">+ Ajouter</button></div></div>' +
      '<div class="card"><div class="card-body" style="padding:0">' + (state.products.length > 0 ? renderProductsTable(state.products) : renderEmptyProducts()) + '</div></div>';
  }

  function renderProductsTable(products) {
    var rows = products.map(function(p) {
      var stock = p.totalGrams || 0;
      var cmp = p.averageCostPerGram || 0;
      var status = getStockStatus(stock);
      return '<tr><td><div class="cell-primary">' + escapeHtml(p.name || p.title || 'Sans nom') + '</div></td>' +
        '<td class="cell-mono font-bold">' + formatWeight(stock) + '</td>' +
        '<td class="cell-mono">' + formatCurrency(cmp) + '/g</td>' +
        '<td class="cell-mono">' + formatCurrency(stock * cmp) + '</td>' +
        '<td><span class="stock-badge ' + status.class + '">' + status.icon + ' ' + status.label + '</span></td>' +
        '<td class="cell-actions"><button class="btn btn-ghost btn-xs" onclick="app.showRestockModal(\'' + p.productId + '\')">+</button><button class="btn btn-ghost btn-xs" onclick="app.showAdjustModal(\'' + p.productId + '\')">Edit</button></td></tr>';
    }).join('');

    return '<div class="table-container"><table class="data-table"><thead><tr><th>Produit</th><th>Stock</th><th>CMP</th><th>Valeur</th><th>Statut</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderEmptyProducts() {
    return '<div class="empty-state"><div class="empty-icon">📦</div><h3 class="empty-title">Aucun produit</h3><p class="empty-description">Ajoutez votre premier produit ou importez depuis Shopify.</p><button class="btn btn-primary" onclick="app.showAddProductModal()">+ Ajouter</button> <button class="btn btn-secondary" onclick="app.showImportModal()">Import Shopify</button></div>';
  }

  function renderSettings(c) {
    var max = state.plan.limits.maxProducts === Infinity ? 'Illimite' : state.plan.limits.maxProducts;
    c.innerHTML = '<div class="page-header"><h1 class="page-title">Parametres</h1></div>' +
      '<div class="card mb-lg"><div class="card-header"><h3 class="card-title">Mon plan</h3></div><div class="card-body"><div class="flex items-center justify-between"><div><div class="font-bold">' + getPlanName(state.plan.id) + '</div><div class="text-secondary text-sm">' + state.products.length + '/' + max + ' produits</div></div>' + (state.plan.id !== 'enterprise' ? '<button class="btn btn-upgrade" onclick="app.showUpgradeModal()">Upgrade</button>' : '<span class="badge badge-success">Plan complet</span>') + '</div></div></div>';
  }

  // IMPORTANT: Verifie si une feature est disponible
  // Utilise SOIT le planLimits du backend, SOIT la hierarchie des plans
  function hasFeature(featureKey) {
    // Si on a les limites directement du backend, les utiliser
    if (state.planLimits && state.planLimits[featureKey] !== undefined) {
      console.log('[Feature] ' + featureKey + ' from backend limits:', state.planLimits[featureKey]);
      return state.planLimits[featureKey] === true;
    }
    
    // Sinon, utiliser la hierarchie des plans
    var planIdx = PLAN_HIERARCHY.indexOf(state.plan.id);
    var reqIdx = PLAN_HIERARCHY.indexOf((FEATURES[featureKey] || {}).plan || 'free');
    var result = planIdx >= reqIdx;
    console.log('[Feature] ' + featureKey + ' from hierarchy: plan=' + state.plan.id + '(' + planIdx + ') >= ' + ((FEATURES[featureKey] || {}).plan || 'free') + '(' + reqIdx + ') = ' + result);
    return result;
  }

  function showModal(opts) {
    closeModal();
    var container = document.getElementById('modalsContainer');
    if (!container) return;
    container.innerHTML = '<div class="modal-backdrop active" onclick="app.closeModal()"></div><div class="modal active ' + (opts.size ? 'modal-' + opts.size : '') + '"><div class="modal-header"><h2 class="modal-title">' + opts.title + '</h2><button class="modal-close" onclick="app.closeModal()">X</button></div><div class="modal-body">' + opts.content + '</div>' + (opts.footer ? '<div class="modal-footer">' + opts.footer + '</div>' : '') + '</div>';
  }

  function closeModal() {
    var el = document.getElementById('modalsContainer');
    if (el) el.innerHTML = '';
  }

  function showAddProductModal() {
    showModal({
      title: 'Ajouter un produit',
      content: '<div class="form-group"><label class="form-label required">Nom</label><input type="text" class="form-input" id="productName" placeholder="CBD Premium"></div><div class="form-row"><div class="form-group"><label class="form-label">Stock initial</label><div class="input-group"><input type="number" class="form-input" id="productStock" value="0" min="0"><span class="input-suffix">g</span></div></div><div class="form-group"><label class="form-label">Cout</label><div class="input-group"><input type="number" class="form-input" id="productCost" value="0" min="0" step="0.01"><span class="input-suffix">EUR/g</span></div></div></div>',
      footer: '<button class="btn btn-ghost" onclick="app.closeModal()">Annuler</button><button class="btn btn-primary" onclick="app.saveProduct()">Ajouter</button>'
    });
  }

  function showImportModal() {
    showModal({
      title: 'Importer depuis Shopify',
      content: '<div class="text-center mb-lg"><div style="font-size:48px">🛍️</div></div>' +
        '<p class="text-secondary mb-lg">Selectionnez les produits Shopify a importer dans votre gestionnaire de stock.</p>' +
        '<div id="shopifyProductsList"><p class="text-center">Chargement des produits Shopify...</p></div>',
      footer: '<button class="btn btn-ghost" onclick="app.closeModal()">Annuler</button><button class="btn btn-primary" onclick="app.doImportShopify()" id="btnImport" disabled>Importer</button>'
    });
    loadShopifyProducts();
  }

  async function loadShopifyProducts() {
    var container = document.getElementById('shopifyProductsList');
    if (!container) return;
    
    try {
      var res = await authFetch(apiUrl('/shopify/products'));
      if (!res.ok) throw new Error('Erreur chargement');
      var data = await res.json();
      var products = data.products || data || [];
      
      if (products.length === 0) {
        container.innerHTML = '<p class="text-center text-secondary">Aucun produit trouve sur Shopify.</p>';
        return;
      }
      
      var html = '<div style="max-height:300px;overflow-y:auto">';
      products.forEach(function(p) {
        html += '<label style="display:flex;align-items:center;padding:8px;border-bottom:1px solid var(--border-primary);cursor:pointer">' +
          '<input type="checkbox" class="shopify-product-cb" value="' + p.id + '" data-title="' + escapeHtml(p.title) + '" style="margin-right:12px">' +
          '<span>' + escapeHtml(p.title) + '</span></label>';
      });
      html += '</div>';
      container.innerHTML = html;
      
      var btn = document.getElementById('btnImport');
      if (btn) btn.disabled = false;
    } catch (e) {
      container.innerHTML = '<p class="text-center text-danger">Erreur: ' + e.message + '</p>';
    }
  }

  async function doImportShopify() {
    var checkboxes = document.querySelectorAll('.shopify-product-cb:checked');
    if (checkboxes.length === 0) {
      showToast('Selectionnez au moins un produit', 'warning');
      return;
    }
    
    var btn = document.getElementById('btnImport');
    if (btn) { btn.disabled = true; btn.textContent = 'Import en cours...'; }
    
    var imported = 0;
    var errors = 0;
    
    for (var i = 0; i < checkboxes.length; i++) {
      var cb = checkboxes[i];
      try {
        var res = await authFetch(apiUrl('/import/product'), {
          method: 'POST',
          body: JSON.stringify({ productId: cb.value })
        });
        if (res.ok) imported++;
        else errors++;
      } catch (e) { errors++; }
    }
    
    closeModal();
    if (imported > 0) {
      showToast(imported + ' produit(s) importe(s)', 'success');
      await loadProducts();
      renderTab(state.currentTab);
    }
    if (errors > 0) {
      showToast(errors + ' erreur(s) lors de l\'import', 'error');
    }
  }

  function showRestockModal(productId) {
    var opts = state.products.map(function(p) {
      return '<option value="' + p.productId + '"' + (p.productId === productId ? ' selected' : '') + '>' + escapeHtml(p.name || p.title || 'Sans nom') + '</option>';
    }).join('');

    showModal({
      title: 'Reapprovisionner',
      content: '<div class="form-group"><label class="form-label">Produit</label><select class="form-select" id="restockProduct">' + opts + '</select></div><div class="form-row"><div class="form-group"><label class="form-label required">Quantite</label><div class="input-group"><input type="number" class="form-input" id="restockQty" min="1" placeholder="500"><span class="input-suffix">g</span></div></div><div class="form-group"><label class="form-label">Prix d\'achat</label><div class="input-group"><input type="number" class="form-input" id="restockPrice" min="0" step="0.01" placeholder="4.50"><span class="input-suffix">EUR/g</span></div></div></div>',
      footer: '<button class="btn btn-ghost" onclick="app.closeModal()">Annuler</button><button class="btn btn-primary" onclick="app.saveRestock()">Valider</button>'
    });
  }

  function showAdjustModal(productId) {
    var opts = state.products.map(function(p) {
      return '<option value="' + p.productId + '"' + (p.productId === productId ? ' selected' : '') + '>' + escapeHtml(p.name || p.title || 'Sans nom') + ' (' + formatWeight(p.totalGrams || 0) + ')</option>';
    }).join('');

    showModal({
      title: 'Ajuster le stock',
      content: '<div class="form-group"><label class="form-label">Produit</label><select class="form-select" id="adjustProduct">' + opts + '</select></div><div class="form-group"><label class="form-label">Type</label><div style="display:flex;gap:16px"><label><input type="radio" name="adjustType" value="add" checked> Ajouter</label><label><input type="radio" name="adjustType" value="remove"> Retirer</label></div></div><div class="form-group"><label class="form-label required">Quantite</label><div class="input-group"><input type="number" class="form-input" id="adjustQty" min="0" placeholder="100"><span class="input-suffix">g</span></div></div>',
      footer: '<button class="btn btn-ghost" onclick="app.closeModal()">Annuler</button><button class="btn btn-primary" onclick="app.saveAdjustment()">Appliquer</button>'
    });
  }

  function showUpgradeModal(recommended) {
    var plans = [
      { id: 'starter', name: 'Starter', price: 14.99, products: 15, features: ['Categories', 'Import Shopify', 'Valeur stock'] },
      { id: 'pro', name: 'Pro', price: 39.99, products: 75, badge: 'POPULAIRE', features: ['Lots & DLC', 'Fournisseurs', 'Analytics', 'Inventaire'] },
      { id: 'business', name: 'Business', price: 79.99, products: 'Illimite', badge: 'BEST', features: ['Previsions IA', 'Kits', 'Commandes', 'Multi-users'] }
    ];

    var cards = plans.map(function(p) {
      var featuresList = p.features.map(function(f) { return '<li style="padding:4px 0">✓ ' + f + '</li>'; }).join('');
      var btnClass = state.plan.id === p.id ? 'btn-secondary' : 'btn-primary';
      var btnAttr = state.plan.id === p.id ? 'disabled' : 'onclick="app.upgradeTo(\'' + p.id + '\')"';
      var btnText = state.plan.id === p.id ? 'Actuel' : 'Choisir';
      var border = p.id === recommended ? 'border:2px solid var(--accent-primary)' : '';
      var badge = p.badge ? '<div class="badge badge-info" style="position:absolute;top:-8px;right:16px">' + p.badge + '</div>' : '';
      return '<div class="card" style="' + border + '">' + badge + '<div class="card-body text-center" style="position:relative"><h3>' + p.name + '</h3><div style="font-size:28px;font-weight:700">' + p.price + '<span style="font-size:12px;color:var(--text-secondary)">EUR/mois</span></div><div class="text-secondary text-sm mb-md">' + p.products + ' produits</div><ul style="text-align:left;list-style:none;margin-bottom:16px">' + featuresList + '</ul><button class="btn ' + btnClass + ' btn-sm" style="width:100%" ' + btnAttr + '>' + btnText + '</button></div></div>';
    }).join('');

    showModal({
      title: 'Choisir un plan',
      size: 'xl',
      content: '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">' + cards + '</div>',
      footer: '<button class="btn btn-ghost" onclick="app.closeModal()">Fermer</button>'
    });
  }

  function showFeatureLockedModal(featureKey) {
    var f = FEATURES[featureKey] || { name: 'Feature', plan: 'pro', icon: '🔒' };
    showModal({
      title: f.name,
      content: '<div class="text-center"><div style="font-size:48px;margin-bottom:16px">' + f.icon + '</div><h3>Passez au ' + f.plan.toUpperCase() + '</h3><p class="text-secondary mb-lg">Cette fonctionnalite necessite un plan superieur.</p><p class="text-secondary text-sm">A partir de <strong>' + getPlanPrice(f.plan) + ' EUR/mois</strong></p></div>',
      footer: '<button class="btn btn-ghost" onclick="app.closeModal()">Plus tard</button><button class="btn btn-upgrade" onclick="app.showUpgradeModal(\'' + f.plan + '\')">Upgrader</button>'
    });
  }

  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration !== undefined ? duration : 4000;
    var container = document.getElementById('toastContainer');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    var icons = { success: '✓', error: 'X', warning: '!', info: 'i' };
    toast.innerHTML = '<span class="toast-icon">' + icons[type] + '</span><div class="toast-content"><div class="toast-message">' + escapeHtml(message) + '</div></div><button class="toast-close" onclick="this.parentElement.remove()">X</button>';
    container.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add('visible'); });
    if (duration > 0) setTimeout(function() { toast.classList.add('removing'); setTimeout(function() { toast.remove(); }, 300); }, duration);
  }

  async function loadPlanInfo() {
    var url = apiUrl('/plan');
    if (!url) return;
    try {
      var res = await authFetch(url);
      if (res.ok) {
        var data = await res.json();
        console.log('[Plan] Response:', JSON.stringify(data));
        
        // Extraire le planId
        var planId = 'free';
        if (data.current && data.current.planId) planId = data.current.planId;
        else if (data.planId) planId = data.planId;
        
        // Extraire les limites
        var limits = data.limits || { maxProducts: 2 };
        
        state.plan = { id: planId, limits: limits };
        state.planLimits = limits; // Stocker toutes les limites (hasAnalytics, etc.)
        
        console.log('[Plan] Loaded: id=' + state.plan.id + ', limits=', state.planLimits);
        updatePlanWidget();
      } else {
        console.warn('[Plan] Error response:', res.status);
      }
    } catch (e) { console.warn('[Plan] Load error', e); }
  }

  async function loadProducts() {
    var url = apiUrl('/stock');
    if (!url) return;
    try {
      var res = await authFetch(url);
      if (!res.ok) { state.products = []; return; }
      var data = await res.json().catch(function() { return {}; });
      state.products = Array.isArray(data.products) ? data.products : [];
      console.log('[Products] Loaded:', state.products.length);
    } catch (e) { console.warn('[Products] Error', e); state.products = []; }
    finally { updatePlanWidget(); }
  }

  async function saveProduct() {
    var name = (document.getElementById('productName') || {}).value;
    var stock = parseFloat((document.getElementById('productStock') || {}).value) || 0;
    var cost = parseFloat((document.getElementById('productCost') || {}).value) || 0;
    if (!name) { showToast('Nom requis', 'error'); return; }

    try {
      var res = await authFetch(apiUrl('/products'), { method: 'POST', body: JSON.stringify({ name: name, totalGrams: stock, averageCostPerGram: cost }) });
      if (res.ok) {
        showToast('Produit ajoute', 'success');
        closeModal();
        await loadProducts();
        renderTab(state.currentTab);
      } else {
        var err = await res.json().catch(function() { return {}; });
        showToast(err.message || err.error || 'Erreur', 'error');
      }
    } catch (e) { showToast('Erreur', 'error'); }
  }

  async function saveRestock() {
    var productId = (document.getElementById('restockProduct') || {}).value;
    var qty = parseFloat((document.getElementById('restockQty') || {}).value);
    var price = parseFloat((document.getElementById('restockPrice') || {}).value) || 0;
    if (!productId || !qty) { showToast('Champs requis', 'error'); return; }

    try {
      var res = await authFetch(apiUrl('/restock'), { method: 'POST', body: JSON.stringify({ productId: productId, grams: qty, purchasePricePerGram: price }) });
      if (res.ok) {
        showToast('Stock mis a jour', 'success');
        closeModal();
        await loadProducts();
        renderTab(state.currentTab);
      } else {
        var data = await res.json().catch(function() { return {}; });
        showToast(data.error || 'Erreur', 'error');
      }
    } catch (e) { showToast('Erreur', 'error'); }
  }

  async function saveAdjustment() {
    var productId = (document.getElementById('adjustProduct') || {}).value;
    var type = (document.querySelector('input[name="adjustType"]:checked') || {}).value;
    var qty = parseFloat((document.getElementById('adjustQty') || {}).value);
    if (!productId || !qty) { showToast('Champs requis', 'error'); return; }

    var gramsDelta = type === 'remove' ? -Math.abs(qty) : Math.abs(qty);

    try {
      var res = await authFetch(apiUrl('/products/' + encodeURIComponent(productId) + '/adjust-total'), { method: 'POST', body: JSON.stringify({ gramsDelta: gramsDelta }) });
      if (res.ok) {
        showToast('Ajustement applique', 'success');
        closeModal();
        await loadProducts();
        renderTab(state.currentTab);
      } else {
        var data = await res.json().catch(function() { return {}; });
        showToast(data.error || 'Erreur', 'error');
      }
    } catch (e) { showToast('Erreur', 'error'); }
  }

  function syncShopify() { showToast('Synchronisation...', 'info'); }

  async function upgradeTo(planId, interval) {
    interval = interval || 'monthly';
    try {
      showToast('Redirection vers Shopify Billing...', 'info', 2000);
      var res = await authFetch(apiUrl('/plan/upgrade'), { method: 'POST', body: JSON.stringify({ planId: planId, interval: interval }) });
      var data = await res.json();
      if (data.bypass) { showToast('Plan active', 'success'); await loadPlanInfo(); closeModal(); return; }
      if (data.confirmationUrl) { window.top.location.href = data.confirmationUrl; return; }
      throw new Error('Pas de confirmationUrl');
    } catch (e) { console.error('[Billing] Error', e); showToast('Erreur activation plan', 'error'); }
  }

  function updatePlanWidget() {
    var w = document.getElementById('planWidget');
    if (!w) return;
    var max = state.plan.limits.maxProducts;
    if (max === Infinity || max === 'Illimite' || max > 9999) max = 'Illimite';
    w.innerHTML = '<div class="plan-info"><span class="plan-name">Plan ' + getPlanName(state.plan.id) + '</span><span class="plan-usage">' + state.products.length + '/' + max + ' produits</span></div>' + (state.plan.id !== 'enterprise' ? '<button class="btn btn-upgrade btn-sm" onclick="app.showUpgradeModal()">Upgrade</button>' : '<span class="badge badge-success" style="font-size:10px">ENTERPRISE</span>');
  }

  function getPlanName(id) { return { free: 'Free', starter: 'Starter', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' }[id] || 'Free'; }
  function getPlanPrice(id) { return { starter: 14.99, pro: 39.99, business: 79.99, enterprise: 199 }[id] || 0; }
  function formatWeight(g) { return g >= 1000 ? (g / 1000).toFixed(2) + ' kg' : g.toFixed(0) + ' g'; }
  function formatCurrency(a) { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(a); }
  function getStockStatus(g) {
    if (g <= 0) return { class: 'critical', label: 'Rupture', icon: '⛔' };
    if (g < 50) return { class: 'critical', label: 'Critique', icon: '🔴' };
    if (g < 200) return { class: 'low', label: 'Bas', icon: '🟡' };
    return { class: 'good', label: 'OK', icon: '🟢' };
  }
  function escapeHtml(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
  function toggleNotifications() { showToast('Notifications bientot disponibles', 'info'); }
  function toggleUserMenu() { showToast('Menu utilisateur bientot disponible', 'info'); }

  window.app = {
    init: init, navigateTo: navigateTo, toggleSidebar: toggleSidebar, toggleNotifications: toggleNotifications, toggleUserMenu: toggleUserMenu,
    showModal: showModal, closeModal: closeModal, showAddProductModal: showAddProductModal, showImportModal: showImportModal, doImportShopify: doImportShopify,
    showRestockModal: showRestockModal, showAdjustModal: showAdjustModal, showUpgradeModal: showUpgradeModal, showFeatureLockedModal: showFeatureLockedModal,
    saveProduct: saveProduct, saveRestock: saveRestock, saveAdjustment: saveAdjustment, syncShopify: syncShopify, upgradeTo: upgradeTo, showToast: showToast,
    get state() { return state; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
