# 🚀 Stock CBD Manager PRO

## Application professionnelle de gestion de stock pour Shopify

---

## 📦 Modules inclus

| Module | Fichier | Description |
|--------|---------|-------------|
| **Plans** | `planManager.js` | Free/Starter/Pro/Business/Enterprise |
| **Paramètres** | `settingsManager.js` | Configuration complète internationale |
| **Lots & DLC** | `batchStore.js` | Traçabilité, péremption, FIFO |
| **Fournisseurs** | `supplierStore.js` | Carnet d'adresses, prix |
| **Bons de commande** | `purchaseOrderStore.js` | Workflow PO complet |
| **Prévisions** | `forecastManager.js` | Prédiction ruptures, vélocité |
| **Kits/Bundles** | `kitStore.js` | Produits composés |
| **Inventaire** | `inventoryCountStore.js` | Comptage physique, écarts |
| **Analytics** | `analyticsManager.js` | CA, marges, tendances |

---

## 💰 Plans & Tarification

```
┌─────────────┬─────────┬──────────┬─────────────────────────────────────┐
│ PLAN        │ PRIX    │ PRODUITS │ FONCTIONNALITÉS                     │
├─────────────┼─────────┼──────────┼─────────────────────────────────────┤
│ Free        │ 0€      │ 2        │ Stock, CMP, Export basique          │
├─────────────┼─────────┼──────────┼─────────────────────────────────────┤
│ Starter     │ 14,99€  │ 15       │ + Catégories, Import, Valeur stock  │
├─────────────┼─────────┼──────────┼─────────────────────────────────────┤
│ Pro         │ 39,99€  │ 75       │ + Lots/DLC, Fournisseurs,           │
│             │         │          │   Inventaire, Analytics,            │
│             │         │          │   Notifications                     │
├─────────────┼─────────┼──────────┼─────────────────────────────────────┤
│ Business    │ 79,99€  │ Illimité │ + Prévisions IA, Kits/Bundles,      │
│             │         │          │   Bons de commande, Multi-users,    │
│             │         │          │   Automatisations, Intégrations,    │
│             │         │          │   Rapports email, Support prio      │
├─────────────┼─────────┼──────────┼─────────────────────────────────────┤
│ Enterprise  │ 199€+   │ Illimité │ + Multi-boutiques, API, SLA,        │
│             │         │          │   Account manager, Users illimités  │
└─────────────┴─────────┴──────────┴─────────────────────────────────────┘
```

---

## 📦 Gestion des Lots (Pro+)

### Fonctionnalités
- Numéro de lot unique auto-généré
- Date de péremption (DLC/DLUO)
- Traçabilité fournisseur
- Déstockage FIFO automatique
- Alertes lots expirants

### Exemple d'utilisation
```javascript
const batchStore = require('./batchStore');

// Créer un lot
const batch = batchStore.createBatch(shop, productId, {
  grams: 500,
  purchasePricePerGram: 4.50,
  expiryType: 'dlc',
  expiryDate: '2025-07-15',
  supplierId: 'sup_123',
});

// Déstocker en FIFO
const result = batchStore.deductGramsFIFO(shop, productId, 100);
// → Utilise automatiquement les lots les plus anciens/proches péremption

// Alertes péremption
const expiring = batchStore.getExpiringBatches(shop, { daysThreshold: 30 });
```

---

## 🏭 Gestion Fournisseurs (Pro+)

### Fonctionnalités
- Carnet d'adresses complet
- Conditions commerciales (délais, minimum, franco)
- Prix par produit
- Comparaison entre fournisseurs

### Exemple
```javascript
const supplierStore = require('./supplierStore');

// Créer un fournisseur
const supplier = supplierStore.createSupplier(shop, {
  name: 'CBD Wholesale France',
  code: 'CBDWF',
  contact: { email: 'contact@cbdwf.fr', phone: '+33123456789' },
  terms: { deliveryDays: 3, minOrderAmount: 500 },
});

// Ajouter prix pour un produit
supplierStore.setProductPrice(shop, supplier.id, productId, 4.50);

// Comparer les prix
const comparison = supplierStore.comparePrices(shop, productId, 1000);
// → Liste triée par prix avec économies
```

---

## 📝 Bons de Commande (Business+)

### Workflow
```
Brouillon → Envoyé → Confirmé → Reçu partiellement → Complet
                                      ↓
                              Création lots auto
```

### Exemple
```javascript
const poStore = require('./purchaseOrderStore');

// Créer un PO
const po = poStore.createPurchaseOrder(shop, {
  supplierId: 'sup_123',
  supplierName: 'CBD Wholesale',
  lines: [
    { productId: 'prod_1', productName: 'CBD Premium', grams: 500, pricePerGram: 4.50 },
    { productId: 'prod_2', productName: 'CBD Relax', grams: 300, pricePerGram: 5.00 },
  ],
  shippingCost: 15,
});

// Envoyer au fournisseur
poStore.sendPurchaseOrder(shop, po.id);

// Réceptionner (crée les lots automatiquement)
const result = poStore.receiveItems(shop, po.id, [
  { lineId: 'line_1', receivedGrams: 500, expiryDate: '2025-06-15' },
  { lineId: 'line_2', receivedGrams: 300, expiryDate: '2025-06-15' },
]);
```

---

## 🔮 Prévisions de Rupture (Business+)

### Algorithme
1. Calcul vélocité pondérée (jours récents comptent plus)
2. Analyse saisonnalité (jours de la semaine)
3. Prédiction date de rupture
4. Suggestion quantité à commander

### Exemple
```javascript
const forecast = require('./forecastManager');

// Prédire la rupture
const prediction = forecast.predictStockout(shop, productId, currentStock);
// → { daysUntilStockout: 12, urgency: 'medium', message: '🟡 Commander cette semaine' }

// Suggestion de commande
const suggestion = forecast.suggestReorderQuantity(shop, productId, currentStock, {
  targetStockDays: 30,
  safetyStockDays: 7,
});
// → { suggestedQuantity: 500, coverageDays: 45 }

// Alertes globales
const alerts = forecast.getRestockAlerts(shop, stockSnapshot);
// → Liste triée par urgence avec quantités suggérées
```

---

## 🧩 Kits & Bundles (Business+)

### Fonctionnalités
- Recettes (composition du kit)
- Stock calculé automatiquement (min des composants)
- Coût = somme des CMP
- Déstockage auto des composants

### Exemple
```javascript
const kitStore = require('./kitStore');

// Créer un kit
const kit = kitStore.createKit(shop, {
  name: 'Pack Découverte',
  sku: 'PACK-DECOUVERTE',
  components: [
    { productId: 'prod_1', productName: 'CBD Premium', grams: 10 },
    { productId: 'prod_2', productName: 'CBD Relax', grams: 10 },
    { productId: 'prod_3', productName: 'CBD Sport', grams: 5 },
  ],
  sellingPrice: 75,
});

// Calculer le stock disponible
const stock = kitStore.calculateKitStock(shop, kit.id, stockSnapshot);
// → { stock: 15, limitingFactor: { productId: 'prod_3', kitsPossible: 15 } }

// Calculer coût et marge
const costs = kitStore.calculateKitCost(shop, kit.id, stockSnapshot);
// → { totalCost: 52.50, margin: 22.50, marginPercent: 30 }
```

---

## 📋 Inventaire Physique (Pro+)

### Workflow
```
Création → Saisie comptage → Validation → Ajustements appliqués
```

### Exemple
```javascript
const invStore = require('./inventoryCountStore');

// Créer un inventaire
const count = invStore.createInventoryCount(shop, stockSnapshot, {
  name: 'Inventaire Q1 2025',
  scope: 'full',
});

// Saisir les comptages
invStore.updateProductCount(shop, count.id, 'prod_1', 485, {
  notes: 'Légère perte conditionnement',
});

// Soumettre pour validation
invStore.submitForReview(shop, count.id);

// Approuver et appliquer les ajustements
const result = invStore.approveAndAdjust(shop, count.id, 'user_123', stockManager);
// → { adjustments: [...], summary: { totalVariance: -15, totalValueImpact: -67.50 } }

// Rapport d'écarts
const report = invStore.generateVarianceReport(shop, count.id);
```

---

## ⚙️ Paramètres (Tous plans)

### Catégories de paramètres
- **Général** : Langue, timezone, formats date/heure
- **Unités** : g/kg/oz/lb, précision, arrondi
- **Monnaie** : EUR/USD/GBP, séparateurs
- **Stock** : Seuil bas, CMP figé, source de vérité
- **Locations** : Location par défaut, multi-locations
- **Exports** : Délimiteur CSV, encodage, colonnes
- **Sécurité** : Mode lecture seule, PIN, confirmations
- **Notifications** : Slack, Discord, déclencheurs

---

## 🔌 API Endpoints

### Plans
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/plan` | Info plan actuel |
| POST | `/api/plan/upgrade` | Changer de plan |
| POST | `/api/plan/trial` | Démarrer essai |

### Lots (Pro+)
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/batches/:productId` | Liste lots d'un produit |
| POST | `/api/batches/:productId` | Créer un lot |
| GET | `/api/batches/expiring` | Lots expirants |

### Fournisseurs (Pro+)
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/suppliers` | Liste fournisseurs |
| POST | `/api/suppliers` | Créer fournisseur |
| GET | `/api/suppliers/:id/products` | Prix par produit |

### Bons de commande (Business+)
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/purchase-orders` | Liste PO |
| POST | `/api/purchase-orders` | Créer PO |
| POST | `/api/purchase-orders/:id/send` | Envoyer |
| POST | `/api/purchase-orders/:id/receive` | Réceptionner |

### Prévisions (Business+)
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/forecast/:productId` | Prévision produit |
| GET | `/api/forecast/alerts` | Alertes réappro |
| GET | `/api/forecast/report` | Rapport complet |

### Kits (Business+)
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/kits` | Liste kits |
| POST | `/api/kits` | Créer kit |
| GET | `/api/kits/:id/stock` | Stock calculé |

### Inventaire (Pro+)
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/inventory-counts` | Liste inventaires |
| POST | `/api/inventory-counts` | Créer inventaire |
| POST | `/api/inventory-counts/:id/approve` | Approuver |

---

## 📁 Structure des fichiers

```
stock-cbd-manager/
├── server.js                 # Serveur principal + routes
├── planManager.js            # Gestion des plans
├── settingsManager.js        # Paramètres avancés
├── stockManager.js           # Gestion stock (existant)
├── analyticsStore.js         # Persistance analytics
├── analyticsManager.js       # Calculs analytics
├── batchStore.js             # Lots & DLC
├── supplierStore.js          # Fournisseurs
├── purchaseOrderStore.js     # Bons de commande
├── forecastManager.js        # Prévisions
├── kitStore.js               # Kits/Bundles
├── inventoryCountStore.js    # Inventaire physique
├── catalogStore.js           # Catégories (existant)
├── movementStore.js          # Mouvements (existant)
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js
│       ├── analytics.js
│       └── settings.js
└── README-PRO.md
```

---

## 🚀 Installation

```bash
# 1. Extraire l'archive
unzip stock-manager-pro-v2.zip

# 2. Copier les fichiers dans votre projet
cp *.js /votre-projet/
cp -r public/* /votre-projet/public/

# 3. Installer les dépendances (si nécessaire)
npm install

# 4. Démarrer
npm start
```

---

## 🔒 Conformité & Sécurité

### Collecte minimale (RGPD)
- ❌ Pas de nom client
- ❌ Pas d'email client
- ❌ Pas d'adresse
- ✅ Uniquement : orderId, productId, qty, prix, coût, marge

### Traçabilité (CBD/Alimentaire)
- ✅ Numéros de lots
- ✅ Dates de péremption
- ✅ Lien fournisseur
- ✅ Historique complet

---

## 📞 Support

- **Free** : Documentation uniquement
- **Starter/Pro** : Email sous 48h
- **Business** : Email sous 24h + Chat
- **Enterprise** : Téléphone + Account manager

---

*Stock CBD Manager PRO v2.0 — © 2025*
