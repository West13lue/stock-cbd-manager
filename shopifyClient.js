// shopifyClient.js — PRE-PROD / PROD SAFE + ✅ Billing helpers (GraphQL)
const Shopify = require("shopify-api-node");
const tokenStore = require("./utils/tokenStore");

// Cache par shop+token
const _clientCache = new Map();

// ==========================
// Utils
// ==========================
function normalizeShopDomain(shop) {
  const raw = String(shop || "").trim();
  if (!raw) return "";

  let noProto = raw.replace(/^https?:\/\//i, "").trim();
  noProto = noProto.split("/")[0].trim();
  noProto = noProto.replace(/\.+$/, "").trim();

  if (noProto.endsWith(".myshopify.com")) return noProto;
  return `${noProto}.myshopify.com`;
}

// shopify-api-node attend le SLUG (sans .myshopify.com)
function shopDomainToSlug(shopDomain) {
  const d = normalizeShopDomain(shopDomain);
  return d ? d.replace(/\.myshopify\.com$/i, "") : "";
}

// ==========================
// Token handling (OAuth ONLY)
// ==========================
function getAccessTokenForShop(shopDomain) {
  const shop = normalizeShopDomain(shopDomain);
  if (!shop) throw new Error("Shop invalide (token)");

  const token = tokenStore.loadToken(shop);
  if (!token) {
    throw new Error(
      `Aucun token OAuth pour ${shop}. Installe l'app ou relance /api/auth/start?shop=${shop}`
    );
  }
  return token;
}

// ==========================
// Client factory
// ==========================
function createShopifyClient(shopDomain, accessToken) {
  const domain = normalizeShopDomain(shopDomain);
  const shopName = shopDomainToSlug(domain);

  if (!shopName) throw new Error("Shop invalide pour Shopify client");

  return new Shopify({
    shopName, // ex: "cloud-store-test"
    accessToken,
    apiVersion: process.env.SHOPIFY_API_VERSION || "2025-10",
  });
}

function getShopifyClient(shop) {
  const shopDomain = normalizeShopDomain(shop);
  if (!shopDomain) throw new Error("Shop manquant pour Shopify client");

  const token = getAccessTokenForShop(shopDomain);

  // cache par shop + token (rotation safe)
  const cacheKey = `${shopDomain.toLowerCase()}::${token.slice(0, 8)}`;
  if (_clientCache.has(cacheKey)) return _clientCache.get(cacheKey);

  const client = createShopifyClient(shopDomain, token);
  _clientCache.set(cacheKey, client);
  return client;
}

// ==========================
// Helpers API REST
// ==========================
async function searchProducts(shop, opts = {}) {
  const client = getShopifyClient(shop);
  const query = String(opts.query || "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(opts.limit || 50), 1), 250);

  const products = await client.product.list({ limit });
  if (!query) return products;

  return products.filter((p) => String(p.title || "").toLowerCase().includes(query));
}

async function fetchProduct(shop, productId) {
  if (!productId) throw new Error("fetchProduct: productId manquant");
  const client = getShopifyClient(shop);
  return client.product.get(Number(productId));
}

async function testShopifyConnection(shop) {
  const client = getShopifyClient(shop);
  const info = await client.shop.get();

  return {
    ok: true,
    shop: info?.myshopify_domain || info?.domain || "",
    name: info?.name || "",
    plan: info?.plan_name || "",
  };
}

// =====================================================
// ✅ Billing / GraphQL helpers
// =====================================================

function toMoneyAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error("Montant invalide");
  // Shopify accepte string/decimal ; on normalise en string "12.34"
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Wrapper GraphQL sécurisé (shopify-api-node: client.graphql(query, variables))
 */
async function graphqlRequest(shop, query, variables = {}) {
  const client = getShopifyClient(shop);
  try {
    return await client.graphql(String(query), variables);
  } catch (e) {
    const statusCode = e?.statusCode || e?.response?.statusCode;
    const requestId = e?.response?.headers?.["x-request-id"] || e?.response?.headers?.["x-requestid"];
    const body = e?.response?.body;
    const message = e?.message || "GraphQL error";
    const err = new Error(message);
    err.statusCode = statusCode;
    err.requestId = requestId;
    err.body = body;
    throw err;
  }
}

/**
 * Lire les abonnements actifs de l’app (Billing status)
 * Utile pour savoir si shop est Free/Starter/Pro etc côté Shopify.
 */
async function getActiveAppSubscriptions(shop) {
  const query = `
    query ActiveSubs {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          trialDays
          createdAt
          lineItems {
            id
            plan {
              pricingDetails {
                __typename
                ... on AppRecurringPricing {
                  interval
                  price {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  const data = await graphqlRequest(shop, query, {});
  const subs = data?.currentAppInstallation?.activeSubscriptions || [];
  return Array.isArray(subs) ? subs : [];
}

/**
 * Créer un abonnement récurrent (AppSubscriptionCreate)
 * Retourne { confirmationUrl, subscriptionId, userErrors }
 *
 * @param {string} shop
 * @param {object} opts
 * @param {string} opts.name - nom du plan (ex: "Starter")
 * @param {string} opts.returnUrl - URL où Shopify renvoie après acceptation
 * @param {number} opts.price - montant mensuel/annuel
 * @param {string} [opts.currencyCode="EUR"]
 * @param {"EVERY_30_DAYS"|"ANNUAL"} [opts.interval="EVERY_30_DAYS"]
 * @param {number} [opts.trialDays=0]
 * @param {boolean} [opts.test=false] - mode test (pour dev)
 */
async function createAppSubscription(shop, opts = {}) {
  const name = String(opts.name || "").trim();
  const returnUrl = String(opts.returnUrl || "").trim();
  if (!name) throw new Error("Billing: name manquant");
  if (!returnUrl) throw new Error("Billing: returnUrl manquant");

  const currencyCode = String(opts.currencyCode || "EUR").trim().toUpperCase();
  const interval = String(opts.interval || "EVERY_30_DAYS").trim().toUpperCase();
  const trialDays = Number.isFinite(Number(opts.trialDays)) ? Number(opts.trialDays) : 0;
  const test = opts.test === true;

  const amount = toMoneyAmount(opts.price);

  const mutation = `
    mutation CreateSub($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!, $trialDays: Int, $test: Boolean) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        lineItems: $lineItems
        trialDays: $trialDays
        test: $test
      ) {
        confirmationUrl
        appSubscription {
          id
          name
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    name,
    returnUrl,
    trialDays: trialDays > 0 ? trialDays : null,
    test,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount, currencyCode },
            interval, // EVERY_30_DAYS ou ANNUAL
          },
        },
      },
    ],
  };

  const data = await graphqlRequest(shop, mutation, variables);
  const payload = data?.appSubscriptionCreate || {};
  const userErrors = payload?.userErrors || [];

  return {
    confirmationUrl: payload?.confirmationUrl || null,
    subscriptionId: payload?.appSubscription?.id || null,
    status: payload?.appSubscription?.status || null,
    userErrors,
  };
}

/**
 * Annuler un abonnement (AppSubscriptionCancel)
 * @param {string} shop
 * @param {string} subscriptionGid - ex: "gid://shopify/AppSubscription/123"
 * @param {object} opts
 * @param {boolean} [opts.prorate=true]
 * @param {string} [opts.reason="OTHER"]
 */
async function cancelAppSubscription(shop, subscriptionGid, opts = {}) {
  const id = String(subscriptionGid || "").trim();
  if (!id) throw new Error("Billing: subscriptionGid manquant");

  const prorate = opts.prorate !== false; // true par défaut
  const reason = String(opts.reason || "OTHER").trim().toUpperCase();

  const mutation = `
    mutation CancelSub($id: ID!, $prorate: Boolean!, $reason: AppSubscriptionCancellationReason) {
      appSubscriptionCancel(id: $id, prorate: $prorate, cancellationReason: $reason) {
        appSubscription {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    id,
    prorate,
    reason,
  };

  const data = await graphqlRequest(shop, mutation, variables);
  const payload = data?.appSubscriptionCancel || {};
  const userErrors = payload?.userErrors || [];

  return {
    cancelledId: payload?.appSubscription?.id || null,
    status: payload?.appSubscription?.status || null,
    userErrors,
  };
}

module.exports = {
  // existant
  getShopifyClient,
  searchProducts,
  fetchProduct,
  normalizeShopDomain,
  testShopifyConnection,

  // ✅ Billing
  graphqlRequest,
  getActiveAppSubscriptions,
  createAppSubscription,
  cancelAppSubscription,
};
