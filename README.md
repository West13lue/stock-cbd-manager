# 📊 Stock Manager - Analytics & Plans

## Vue d'ensemble

Ce module ajoute :
1. **Dashboard Analytics** complet avec KPIs, graphiques et exports
2. **Système de Plans** (Free/Standard/Premium) avec limites
3. **Collecte minimale** des données (RGPD-friendly, pas de PII)
4. **Calcul de marge réelle** (après réductions, hors shipping)

---

## 💰 Plans et Tarification

### Free (0€)
| Fonctionnalité | Inclus |
|----------------|--------|
| Produits | 2 max |
| Gestion stock + synchro Shopify | ✅ |
| CMP (coût moyen au gramme) | ✅ |
| Ajustements stock manuels | ✅ |
| Export CSV basique | ✅ |
| Historique mouvements | 7 jours |
| Catégories | ❌ |
| Import Shopify | ❌ |
| Valeur totale stock | ❌ |
| Analytics | ❌ |

### Standard (14,99€/mois)
| Fonctionnalité | Inclus |
|----------------|--------|
| Produits | 25 max |
| Tout Free | ✅ |
| Catégories + filtres | ✅ |
| Import Shopify | ✅ |
| Historique mouvements | 30 jours |
| Valeur totale stock (CMP) | ✅ |
| Exports CSV avancés | ✅ |
| Analytics | ❌ |

### Premium (39,99€/mois)
| Fonctionnalité | Inclus |
|----------------|--------|
| Produits | Illimité |
| Tout Standard | ✅ |
| **Marge & ventes** | ✅ |
| - Global (CA, coût, marge) | ✅ |
| - Par produit (top marge/volume/CA) | ✅ |
| - Par période (7j/30j/custom) | ✅ |
| Tableau de bord tendances | ✅ |
| Historique mouvements | 365 jours |
| Export premium | ✅ |

---

## 🔒 Politique de Confidentialité - Collecte Minimale

### Données collectées (strictement nécessaires)

```javascript
{
  orderId: "123456",           // ID commande uniquement
  orderDate: "2025-01-15",     // Date
  productId: "789",            // ID produit
  quantity: 2,                 // Quantité
  totalGrams: 100,             // Grammes vendus
  grossPrice: 50.00,           // Prix brut
  discountAmount: 5.00,        // Réductions
  netRevenue: 45.00,           // Prix réel encaissé
  costPerGram: 4.50,           // CMP snapshot
  totalCost: 450.00,           // Coût total
  margin: -405.00,             // Marge calculée
}
```

### ❌ Données JAMAIS collectées

- Nom du client
- Email du client
- Adresse de livraison/facturation
- Téléphone
- IP ou cookies
- Données de navigation

### Message pour l'App Store Shopify

> "Cette application collecte des données de commandes uniquement pour calculer les stocks et marges commerciales. **Aucune donnée personnelle client n'est stockée** (pas de nom, email, adresse, téléphone). Seuls les identifiants de commande, produits, quantités et prix sont conservés pour le calcul des KPIs."

---

## 📈 Calcul de Marge Réelle

La marge est calculée sur le **prix réellement encaissé**, pas le prix catalogue :

```
Prix brut (catalogue)    = 50,00€
- Réduction ligne        = -5,00€   (code promo sur le produit)
- Réduction commande     = -2,50€   (réparti proportionnellement)
────────────────────────────────────
= Revenu NET             = 42,50€

Coût (CMP × grammes)     = 40,00€

════════════════════════════════════
Marge                    = 2,50€ (5.9%)
```

### Éléments EXCLUS du calcul de marge

- ✅ Frais de livraison (ne font pas partie du CA produit)
- ✅ Taxes (TVA collectée pour l'État)
- ✅ Pourboires
- ✅ Produits offerts (prix = 0)

---

## 📁 Fichiers fournis

### Nouveaux fichiers

| Fichier | Description |
|---------|-------------|
| `planManager.js` | Gestion des plans et limites |
| `analyticsStore.js` | Persistance des ventes (NDJSON) |
| `analyticsManager.js` | Logique métier analytics |
| `public/js/analytics.js` | UI dashboard |

### Fichiers modifiés

| Fichier | Modifications |
|---------|---------------|
| `server.js` | Routes plans + analytics + vérification limites |
| `stockManager.js` | Fonctions CMP snapshot |
| `public/css/style.css` | Styles tabs + dashboard + plans |
| `public/index.html` | Chargement analytics.js |

---

## 🚀 Installation

### 1. Copier les fichiers

```bash
# Nouveaux fichiers
cp planManager.js /votre-projet/
cp analyticsStore.js /votre-projet/
cp analyticsManager.js /votre-projet/

# Fichiers modifiés (remplacer les existants)
cp server.js /votre-projet/
cp stockManager.js /votre-projet/
cp public/js/analytics.js /votre-projet/public/js/
cp public/css/style.css /votre-projet/public/css/
cp public/index.html /votre-projet/public/
```

### 2. Redémarrer le serveur

```bash
npm start
# ou
node server.js
```

---

## 🔌 API Endpoints

### Plans

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/plan` | Info plan actuel + limites |
| GET | `/api/plans` | Liste des plans disponibles |
| POST | `/api/plan/upgrade` | Changer de plan |
| POST | `/api/plan/cancel` | Annuler l'abonnement |
| GET | `/api/plan/check/:action` | Vérifier une limite |

### Analytics (Premium)

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/analytics/summary` | KPIs globaux |
| GET | `/api/analytics/timeseries` | Données graphiques |
| GET | `/api/analytics/orders` | Commandes récentes |
| GET | `/api/analytics/products/top` | Top produits |
| GET | `/api/analytics/export.csv` | Export CSV |
| GET | `/api/analytics/export.json` | Export JSON |

### Paramètres communs

| Param | Type | Description |
|-------|------|-------------|
| `from` | date | Date début (YYYY-MM-DD) |
| `to` | date | Date fin (YYYY-MM-DD) |
| `bucket` | string | Agrégation: day, week, month |
| `limit` | number | Nombre max résultats |
| `by` | string | Tri: revenue, margin, grams |

---

## 🔐 Intégration Shopify Billing (Production)

En production, remplacez le code de simulation dans `/api/plan/upgrade` par l'appel à l'API Shopify Billing :

```javascript
// server.js - Route /api/plan/upgrade

// 1. Créer un AppSubscription via GraphQL
const mutation = `
  mutation {
    appSubscriptionCreate(
      name: "Premium Plan"
      returnUrl: "${process.env.RENDER_PUBLIC_URL}/api/plan/callback"
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: 39.99, currencyCode: EUR }
            interval: EVERY_30_DAYS
          }
        }
      }]
    ) {
      appSubscription { id }
      confirmationUrl
    }
  }
`;

// 2. Rediriger vers confirmationUrl
// 3. Shopify redirige vers returnUrl après paiement
// 4. Webhook app_subscriptions/update pour confirmer
```

---

## 📊 Structure des données

### Sale (vente enregistrée)

```javascript
{
  id: "1234567890_abc123",
  ts: "2025-01-15T14:30:00.000Z",
  orderDate: "2025-01-15T14:30:00.000Z",
  orderId: "5678901234567",
  orderNumber: "#1042",
  
  productId: "9876543210",
  productName: "Produit Test",
  variantId: 11111111,
  variantTitle: "50g",
  categoryIds: ["cat-1"],
  
  quantity: 2,
  gramsPerUnit: 50,
  totalGrams: 100,
  
  grossPrice: 50.00,      // Prix brut
  discountAmount: 5.00,   // Réductions
  netRevenue: 45.00,      // Prix réel
  currency: "EUR",
  
  costPerGram: 4.50,      // CMP snapshot
  totalCost: 450.00,
  margin: -405.00,
  marginPercent: -900.00,
  
  shop: "ma-boutique.myshopify.com",
  source: "webhook"
}
```

### Plan (configuration shop)

```javascript
{
  planId: "premium",
  subscription: {
    id: "sub_123",
    status: "active",
    startedAt: "2025-01-01T00:00:00Z",
    expiresAt: null,
    chargeId: "charge_456"
  },
  updatedAt: "2025-01-15T10:00:00Z"
}
```

---

## ⚠️ Notes importantes

1. **Webhook orders/create** : Assurez-vous qu'il est bien configuré dans Shopify pour enregistrer les ventes automatiquement

2. **HMAC validation** : Les webhooks sont validés via `SHOPIFY_WEBHOOK_SECRET`

3. **Stockage** : Les données sont stockées dans `/var/data/{shop}/`

4. **Pas de dépendances supplémentaires** : Tout fonctionne avec les dépendances existantes + Chart.js (CDN)

---

*Module Analytics & Plans v2.0 - Compatible avec Stock Manager multi-shop*
