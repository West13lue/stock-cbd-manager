// server.js — FIX "Réponse non-JSON du serveur" + Multi-shop safe + Express 5 safe

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const path = require("path");
const crypto = require("crypto");

// --- logger (compat : ./utils/logger OU ./logger)
let logEvent = (event, data = {}, level = "info") =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }));
try {
  ({ logEvent } = require("./utils/logger"));
} catch {
  try {
    ({ logEvent } = require("./logger"));
  } catch {}
}

// --- Shopify
const { getShopifyClient } = require("./shopifyClient");
const shopify = getShopifyClient();

// --- Stock (source de vérité app)
const stock = require("./stockManager");

// --- Catalog/categories (multi-shop)
const catalogStore = require("./catalogStore");

// --- Movements (multi-shop)
const movementStore = require("./movementStore");

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_HTML = path.join(PUBLIC_DIR, "index.html");

// =========================
// Helpers
// =========================
function getShop(req) {
  // 1) query string (iframe admin) -> ?shop=xxx.myshopify.com
  const q = String(req.query?.shop || "").trim();
  if (q) return q;

  // 2) header Shopify (webhooks)
  const h = String(req.get("X-Shopify-Shop-Domain") || "").trim();
  if (h) return h;

  // 3) fallback env (si tu n’as qu’un shop)
  const envShopName = String(process.env.SHOP_NAME || "").trim();
  if (envShopName && envShopName.includes(".myshopify.com")) return envShopName;
  if (envShopName) return `${envShopName}.myshopify.com`;

  return "default";
}

function verifyShopifyWebhook(rawBodyBuffer, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return true; // dev
  const hash = crypto.createHmac("sha256", secret).update(rawBodyBuffer).digest("base64");
  return hash === hmacHeader;
}

function apiError(res, code, message, extra) {
  return res.status(code).json({ error: message, ...(extra ? { extra } : {}) });
}

function safeJson(res, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      return out.catch((e) => {
        logEvent("api_error", { message: e?.message }, "error");
        return apiError(res, 500, e?.message || "Erreur serveur");
      });
    }
    return out;
  } catch (e) {
    logEvent("api_error", { message: e?.message }, "error");
    return apiError(res, 500, e?.message || "Erreur serveur");
  }
}

function parseGramsFromVariant(v) {
  // Essaie plusieurs champs Shopify (robuste)
  const candidates = [v?.option1, v?.option2, v?.option3, v?.title, v?.sku].filter(Boolean);
  for (const c of candidates) {
    const m = String(c).match(/([\d.,]+)/);
    if (!m) continue;
    const g = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(g) && g > 0) return g;
  }
  return null;
}

async function pushProductInventoryToShopify(productView) {
  const locationId = process.env.LOCATION_ID;
  if (!locationId) return;
  if (!productView?.variants) return;

  for (const [, v] of Object.entries(productView.variants)) {
    const inventoryItemId = Number(v.inventoryItemId || 0);
    const unitsAvailable = Number(v.canSell || 0);
    if (!inventoryItemId) continue;

    await shopify.inventoryLevel.set({
      location_id: locationId,
      inventory_item_id: inventoryItemId,
      available: unitsAvailable,
    });
  }
}

// =========================
// 1) MIDDLEWARES
// =========================

// JSON parser AVANT /api (sinon req.body undefined)
app.use("/api", express.json({ limit: "2mb" }));

// CORS simple
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Shopify-Hmac-Sha256");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// CSP Shopify admin iframe
app.use((req, res, next) => {
  const envShopName = String(process.env.SHOP_NAME || "").trim();
  const shopDomain = envShopName
    ? envShopName.includes(".myshopify.com")
      ? `https://${envShopName}`
      : `https://${envShopName}.myshopify.com`
    : "*";

  res.setHeader("Content-Security-Policy", `frame-ancestors https://admin.shopify.com ${shopDomain};`);
  next();
});

// Health
app.get("/health", (req, res) => res.status(200).send("ok"));

// =========================
// 2) WEBHOOKS (RAW BODY)
// =========================
app.post("/webhooks/orders/create", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const hmac = req.get("X-Shopify-Hmac-Sha256");
    const shop = getShop(req);

    if (process.env.NODE_ENV === "production" && process.env.SHOPIFY_WEBHOOK_SECRET) {
      if (!hmac || !verifyShopifyWebhook(req.body, hmac)) return res.sendStatus(401);
    }

    // Si tu veux remettre le traitement commande ici, fais-le.
    // (Ton système “stock vrac” décrémente et push ensuite l’inventaire Shopify)

    return res.sendStatus(200);
  } catch (e) {
    logEvent("webhook_error", { message: e.message }, "error");
    return res.sendStatus(500);
  }
});

// =========================
// 3) API (TOUJOURS JSON)
// =========================

app.get("/api/server-info", (req, res) => {
  const productCount = stock?.PRODUCT_CONFIG ? Object.keys(stock.PRODUCT_CONFIG).length : 0;
  res.json({
    mode: process.env.NODE_ENV || "development",
    port: PORT,
    productCount,
    lowStockThreshold: Number(process.env.LOW_STOCK_THRESHOLD || 10),
  });
});

// ---- Stock (ce que ton front attend : { products:[...], categories:[...] })
app.get("/api/stock", (req, res) => {
  safeJson(res, () => {
    const shop = getShop(req);
    const { sort = "alpha", category = "" } = req.query;

    const snapshot = typeof stock.getCatalogSnapshot === "function"
      ? stock.getCatalogSnapshot()
      : { products: [], categories: [] };

    // ⚠️ catégories doivent venir du store multi-shop
    const categories = catalogStore.listCategories ? catalogStore.listCategories(shop) : [];
    let products = Array.isArray(snapshot.products) ? snapshot.products.slice() : [];

    if (category) {
      products = products.filter((p) => Array.isArray(p.categoryIds) && p.categoryIds.includes(String(category)));
    }

    if (sort === "alpha") {
      products.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "fr", { sensitivity: "base" })
      );
    }

    res.json({ products, categories });
  });
});

// ---- Catégories
app.get("/api/categories", (req, res) => {
  safeJson(res, () => {
    const shop = getShop(req);
    const categories = catalogStore.listCategories ? catalogStore.listCategories(shop) : [];
    res.json({ categories });
  });
});

app.post("/api/categories", (req, res) => {
  safeJson(res, () => {
    const shop = getShop(req);
    const name = String(req.body?.name ?? req.body?.categoryName ?? "").trim();
    if (!name) return apiError(res, 400, "Nom de catégorie invalide");

    const created = catalogStore.createCategory(shop, name);

    // log movement (optionnel)
    if (movementStore.addMovement) {
      movementStore.addMovement(
        { source: "category_create", gramsDelta: 0, meta: { categoryId: created.id, name: created.name } },
        shop
      );
    }

    res.json({ success: true, category: created });
  });
});

app.put("/api/categories/:id", (req, res) => {
  safeJson(res, () => {
    const shop = getShop(req);
    const id = String(req.params.id);
    const name = String(req.body?.name || "").trim();
    if (!name) return apiError(res, 400, "Nom invalide");

    const updated = catalogStore.renameCategory(shop, id, name);

    if (movementStore.addMovement) {
      movementStore.addMovement(
        { source: "category_rename", gramsDelta: 0, meta: { categoryId: id, name } },
        shop
      );
    }

    res.json({ success: true, category: updated });
  });
});

app.delete("/api/categories/:id", (req, res) => {
  safeJson(res, () => {
    const shop = getShop(req);
    const id = String(req.params.id);

    catalogStore.deleteCategory(shop, id);

    if (movementStore.addMovement) {
      movementStore.addMovement(
        { source: "category_delete", gramsDelta: 0, meta: { categoryId: id } },
        shop
      );
    }

    res.json({ success: true });
  });
});

// ---- Mouvements (ton front attend {count,data})
app.get("/api/movements", (req, res) => {
  safeJson(res, () => {
    const shop = getShop(req);
    const limit = Math.min(Number(req.query.limit || 200), 2000);
    const days = Math.min(Math.max(Number(req.query.days || 7), 1), 365);

    const rows = movementStore.listMovements
      ? movementStore.listMovements({ shop, days, limit })
      : [];

    res.json({ count: rows.length, data: rows });
  });
});

app.get("/api/movements.csv", (req, res) => {
  safeJson(res, () => {
    const shop = getShop(req);
    const limit = Math.min(Number(req.query.limit || 2000), 10000);
    const days = Math.min(Math.max(Number(req.query.days || 30), 1), 365);

    const rows = movementStore.listMovements
      ? movementStore.listMovements({ shop, days, limit })
      : [];

    const csv = movementStore.toCSV ? movementStore.toCSV(rows) : "ts,source,productId\n";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="stock-movements.csv"');
    res.send(csv);
  });
});

// ---- Ajuster total (ton front POST /api/products/:id/adjust-total)
app.post("/api/products/:productId/adjust-total", (req, res) => {
  safeJson(res, async () => {
    const shop = getShop(req);
    const productId = String(req.params.productId);
    const gramsDelta = Number(req.body?.gramsDelta);

    if (!Number.isFinite(gramsDelta) || gramsDelta === 0) {
      return apiError(res, 400, "gramsDelta invalide (ex: 50 ou -50)");
    }

    if (typeof stock.restockProduct !== "function") {
      return apiError(res, 500, "stock.restockProduct introuvable");
    }

    const updated = await stock.restockProduct(productId, gramsDelta);
    if (!updated) return apiError(res, 404, "Produit introuvable");

    try {
      await pushProductInventoryToShopify(updated);
    } catch (e) {
      logEvent("inventory_push_error", { productId, message: e?.message }, "error");
    }

    if (movementStore.addMovement) {
      movementStore.addMovement(
        {
          source: "adjust_total",
          productId,
          productName: updated.name,
          gramsDelta,
          totalAfter: updated.totalGrams,
        },
        shop
      );
    }

    res.json({ success: true, product: updated });
  });
});

// ---- Assigner catégories produit (ton front POST /api/products/:id/categories)
app.post("/api/products/:productId/categories", (req, res) => {
  safeJson(res, () => {
    const shop = getShop(req);
    const productId = String(req.params.productId);
    const categoryIds = Array.isArray(req.body?.categoryIds) ? req.body.categoryIds.map(String) : [];

    if (typeof stock.setProductCategories !== "function") {
      return apiError(res, 500, "stock.setProductCategories introuvable");
    }

    const ok = stock.setProductCategories(productId, categoryIds);
    if (!ok) return apiError(res, 404, "Produit introuvable (non configuré)");

    if (movementStore.addMovement) {
      movementStore.addMovement(
        { source: "product_set_categories", productId, gramsDelta: 0, meta: { categoryIds } },
        shop
      );
    }

    res.json({ success: true, productId, categoryIds });
  });
});

// ---- Shopify : lister produits (import UI)
app.get("/api/shopify/products", (req, res) => {
  safeJson(res, async () => {
    const limit = Math.min(Number(req.query.limit || 50), 250);
    const q = String(req.query.query || "").trim().toLowerCase();

    const products = await shopify.product.list({ limit });
    let out = (products || []).map((p) => ({
      id: String(p.id),
      title: String(p.title || ""),
      variantsCount: Array.isArray(p.variants) ? p.variants.length : 0,
    }));

    if (q) out = out.filter((p) => p.title.toLowerCase().includes(q));
    out.sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));

    res.json({ products: out });
  });
});

// ---- Import 1 produit Shopify -> upsert config
app.post("/api/import/product", (req, res) => {
  safeJson(res, async () => {
    const shop = getShop(req);

    const productId = req.body?.productId ?? req.body?.id;
    const categoryIds = Array.isArray(req.body?.categoryIds) ? req.body.categoryIds : [];

    if (!productId) return apiError(res, 400, "productId manquant");

    const p = await shopify.product.get(Number(productId));
    if (!p?.id) return apiError(res, 404, "Produit Shopify introuvable");

    const variants = {};
    for (const v of p.variants || []) {
      const grams = parseGramsFromVariant(v);
      if (!grams) continue;

      variants[String(grams)] = {
        gramsPerUnit: grams,
        inventoryItemId: Number(v.inventory_item_id),
      };
    }

    if (!Object.keys(variants).length) {
      return apiError(res, 400, "Aucune variante avec grammage détecté (option/title/sku).");
    }

    if (typeof stock.upsertImportedProductConfig !== "function") {
      return apiError(res, 500, "stock.upsertImportedProductConfig introuvable");
    }

    const imported = stock.upsertImportedProductConfig({
      productId: String(p.id),
      name: String(p.title || p.handle || p.id),
      variants,
      categoryIds,
    });

    if (movementStore.addMovement) {
      movementStore.addMovement(
        {
          source: "import_shopify_product",
          productId: String(p.id),
          productName: imported.name,
          gramsDelta: 0,
          meta: { categoryIds },
        },
        shop
      );
    }

    res.json({ success: true, product: imported });
  });
});

// ✅ IMPORTANT : si une route /api n’existe pas => JSON 404 (pas HTML)
app.use("/api", (req, res) => apiError(res, 404, "Route API non trouvée"));

// ✅ IMPORTANT : handler erreurs => JSON (pas HTML)
app.use((err, req, res, next) => {
  if (req.path.startsWith("/api")) {
    logEvent("api_uncaught_error", { message: err?.message }, "error");
    return apiError(res, 500, "Erreur serveur API");
  }
  next(err);
});

// =========================
// 4) FRONT
// =========================
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => res.sendFile(INDEX_HTML));

// Catch-all SPA : EXCLUT /api et /webhooks et /health (Express 5 safe)
app.get(/^\/(?!api\/|webhooks\/|health).*/, (req, res) => res.sendFile(INDEX_HTML));

// =========================
app.listen(PORT, "0.0.0.0", () => {
  logEvent("server_started", { port: PORT, publicDir: PUBLIC_DIR });
  console.log("✅ Server running on port", PORT);
});
