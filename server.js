// server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { logEvent } = require("./utils/logger");

// Modules
const stock = require("./stockManager");
const catalog = require("./catalogStore");
const movements = require("./movementStore");
const shopify = require("./shopifyClient");

const app = express();
app.set("trust proxy", 1);

// -----------------------------
// SECURITY / MIDDLEWARES
// -----------------------------
app.use(
  helmet({
    // ✅ Autoriser l’embed dans l’admin Shopify (iframe)
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "frame-ancestors": [
          "https://admin.shopify.com",
          "https://*.myshopify.com",
          "https://admin.myshopify.com",
        ],
      },
    },
    // ✅ éviter X-Frame-Options bloquant
    frameguard: false,
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ✅ Parsers robustes (fix catégories / body vide)
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.text({ type: ["text/*"] }));

// -----------------------------
// STATIC FRONT
// -----------------------------
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/health", (req, res) => res.json({ ok: true }));

// -----------------------------
// HELPERS
// -----------------------------
function getShop(req) {
  // Shopify admin iframe ajoute ?shop=xxxx.myshopify.com
  const q = req.query?.shop;
  const b = req.body?.shop;
  const h = req.headers["x-shopify-shop-domain"];
  const shop = (q || b || h || "").toString().trim();
  // fallback: mono-shop (env)
  return shop || process.env.SHOP_NAME || "default";
}

function pickName(req) {
  // accepte plusieurs formats
  const raw =
    req.body?.name ??
    req.body?.categoryName ??
    req.body?.title ??
    req.body?.value ??
    (typeof req.body === "string" ? req.body : "") ??
    req.query?.name ??
    "";
  return String(raw || "").trim();
}

// Adapters pour compat mono/multi shop selon ta version des modules
function callStock(fnName, shop, ...args) {
  const fn = stock?.[fnName];
  if (typeof fn !== "function") throw new Error(`stockManager.${fnName} introuvable`);
  // si la fonction attend shop en premier (multi-shop), elle a souvent +1 argument
  // ex: restockProduct(shop, productId, grams)
  if (fn.length >= args.length + 1) return fn(shop, ...args);
  return fn(...args);
}

function callCatalog(fnName, shop, ...args) {
  const fn = catalog?.[fnName];
  if (typeof fn !== "function") throw new Error(`catalogStore.${fnName} introuvable`);
  if (fn.length >= args.length + 1) return fn(shop, ...args);
  return fn(...args);
}

function callMovements(fnName, shop, ...args) {
  const fn = movements?.[fnName];
  if (typeof fn !== "function") throw new Error(`movementStore.${fnName} introuvable`);
  // movementStore addMovement(shop, movement) OU addMovement(movement)
  if (fnName === "addMovement") {
    // si 2 args attendus, on passe shop
    if (fn.length >= 2) return fn(shop, ...args);
    return fn(...args);
  }
  // listMovements(shop, opts) existe chez toi -> on passe shop si possible
  if (fn.length >= args.length + 1) return fn(shop, ...args);
  return fn(...args);
}

function csvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// -----------------------------
// API - SERVER INFO
// -----------------------------
app.get("/api/server-info", (req, res) => {
  const shop = getShop(req);
  try {
    const snap = callStock("getStockSnapshot", shop);
    res.json({
      ok: true,
      env: process.env.NODE_ENV || "development",
      dataDir: process.env.DATA_DIR || "/var/data",
      shop,
      productCount: Object.keys(snap || {}).length,
    });
  } catch (e) {
    logEvent("server_info_error", { message: e.message }, "error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -----------------------------
// API - STOCK (catalog snapshot)
// -----------------------------
app.get("/api/stock", (req, res) => {
  const shop = getShop(req);
  try {
    const out = callStock("getCatalogSnapshot", shop);
    res.json({ ok: true, shop, ...out });
  } catch (e) {
    logEvent("api_stock_error", { shop, message: e.message }, "error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -----------------------------
// API - CATEGORIES
// -----------------------------
app.get("/api/categories", (req, res) => {
  const shop = getShop(req);
  try {
    const categories = callCatalog("listCategories", shop);
    res.json({ ok: true, shop, categories });
  } catch (e) {
    logEvent("categories_list_error", { shop, message: e.message }, "error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/categories", (req, res) => {
  const shop = getShop(req);
  try {
    const name = pickName(req);
    if (!name) return res.status(400).json({ ok: false, error: "Nom de catégorie invalide" });

    const category = callCatalog("createCategory", shop, name);
    const categories = callCatalog("listCategories", shop);

    res.json({ ok: true, shop, category, categories });
  } catch (e) {
    logEvent("category_create_error", { shop, message: e.message }, "error");
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.put("/api/categories/:id", (req, res) => {
  const shop = getShop(req);
  try {
    const name = pickName(req);
    if (!name) return res.status(400).json({ ok: false, error: "Nom de catégorie invalide" });

    const category = callCatalog("renameCategory", shop, req.params.id, name);
    const categories = callCatalog("listCategories", shop);

    res.json({ ok: true, shop, category, categories });
  } catch (e) {
    logEvent("category_rename_error", { shop, message: e.message }, "error");
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.delete("/api/categories/:id", (req, res) => {
  const shop = getShop(req);
  try {
    callCatalog("deleteCategory", shop, req.params.id);
    const categories = callCatalog("listCategories", shop);
    res.json({ ok: true, shop, categories });
  } catch (e) {
    logEvent("category_delete_error", { shop, message: e.message }, "error");
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Assigner des catégories à un produit
app.post("/api/products/:id/categories", (req, res) => {
  const shop = getShop(req);
  try {
    const categoryIds = Array.isArray(req.body?.categoryIds) ? req.body.categoryIds : [];
    const okSet = callStock("setProductCategories", shop, req.params.id, categoryIds);
    if (!okSet) return res.status(404).json({ ok: false, error: "Produit introuvable" });
    res.json({ ok: true, shop });
  } catch (e) {
    logEvent("product_set_categories_error", { shop, message: e.message }, "error");
    res.status(400).json({ ok: false, error: e.message });
  }
});

// -----------------------------
// API - RESTOCK / ADJUST
// -----------------------------
app.post("/api/restock", async (req, res) => {
  const shop = getShop(req);
  try {
    const productId = String(req.body?.productId || "").trim();
    const grams = Number(req.body?.grams || 0);

    if (!productId) return res.status(400).json({ ok: false, error: "productId manquant" });
    if (!Number.isFinite(grams) || grams <= 0) return res.status(400).json({ ok: false, error: "grams invalide" });

    const product = await callStock("restockProduct", shop, productId, grams);
    if (!product) return res.status(404).json({ ok: false, error: "Produit introuvable" });

    callMovements("addMovement", shop, {
      type: "restock",
      source: "ui",
      productId,
      productName: product.name,
      gramsDelta: grams,
      totalAfter: product.totalGrams,
    });

    res.json({ ok: true, shop, product });
  } catch (e) {
    logEvent("restock_error", { shop, message: e.message }, "error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Ajuster le total +/- (si ton UI l’utilise)
app.post("/api/products/:id/adjust-total", async (req, res) => {
  const shop = getShop(req);
  try {
    const gramsDelta = Number(req.body?.gramsDelta || 0);
    if (!Number.isFinite(gramsDelta) || gramsDelta === 0) {
      return res.status(400).json({ ok: false, error: "gramsDelta invalide" });
    }

    let product = null;
    if (gramsDelta > 0) product = await callStock("restockProduct", shop, req.params.id, gramsDelta);
    else product = await callStock("applyOrderToProduct", shop, req.params.id, Math.abs(gramsDelta));

    if (!product) return res.status(404).json({ ok: false, error: "Produit introuvable" });

    callMovements("addMovement", shop, {
      type: "adjust_total",
      source: "ui",
      productId: req.params.id,
      productName: product.name,
      gramsDelta,
      totalAfter: product.totalGrams,
    });

    res.json({ ok: true, shop, product });
  } catch (e) {
    logEvent("adjust_total_error", { shop, message: e.message }, "error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Supprimer un produit (config app, pas Shopify)
app.delete("/api/products/:id", (req, res) => {
  const shop = getShop(req);
  try {
    const okDel = callStock("removeProduct", shop, req.params.id);
    if (!okDel) return res.status(404).json({ ok: false, error: "Produit introuvable" });
    res.json({ ok: true, shop });
  } catch (e) {
    logEvent("remove_product_error", { shop, message: e.message }, "error");
    res.status(400).json({ ok: false, error: e.message });
  }
});

// -----------------------------
// API - MOVEMENTS
// -----------------------------
app.get("/api/movements", (req, res) => {
  const shop = getShop(req);
  try {
    const days = Number(req.query.days || 7);
    const limit = Number(req.query.limit || 300);
    const data = callMovements("listMovements", shop, { days, limit });
    res.json({ ok: true, shop, data });
  } catch (e) {
    logEvent("movements_list_error", { shop, message: e.message }, "error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/movements.csv", (req, res) => {
  const shop = getShop(req);
  try {
    const days = Number(req.query.days || 30);
    const limit = Number(req.query.limit || 5000);
    const rows = callMovements("listMovements", shop, { days, limit });
    const csv = movements.toCSV(rows);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="movements-${shop}.csv"`);
    res.send(csv);
  } catch (e) {
    logEvent("movements_csv_error", { shop, message: e.message }, "error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Stock CSV (simple)
app.get("/api/stock.csv", (req, res) => {
  const shop = getShop(req);
  try {
    const snap = callStock("getStockSnapshot", shop);

    const rows = Object.values(snap || {}).map((p) => {
      const variants = p?.variants || {};
      const canSell = Object.entries(variants)
        .map(([k, v]) => `${k}g:${v?.canSell ?? ""}`)
        .join(" | ");

      return {
        productId: p?.productId || "",
        name: p?.name || "",
        totalGrams: p?.totalGrams ?? 0,
        categoryIds: (p?.categoryIds || []).join("|"),
        canSell,
        shop,
      };
    });

    const cols = ["productId", "name", "totalGrams", "categoryIds", "canSell", "shop"];
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(","))].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="stock-${shop}.csv"`);
    res.send(csv);
  } catch (e) {
    logEvent("stock_csv_error", { shop, message: e.message }, "error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -----------------------------
// API - SHOPIFY (import UI)
// -----------------------------
app.get("/api/shopify/products", async (req, res) => {
  const shopName = getShop(req);
  try {
    const query = String(req.query.query || "");
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 250));

    // ✅ utilise searchProducts si dispo, sinon fallback list
    if (typeof shopify.searchProducts === "function") {
      const products = await shopify.searchProducts(shopName, { query, limit });
      return res.json({ ok: true, shop: shopName, products });
    }

    // Fallback (si ancienne version du fichier)
    const client = shopify.getShopifyClient();
    const products = await client.product.list({ limit });
    const q = query.trim().toLowerCase();
    const filtered = q ? products.filter((p) => String(p.title || "").toLowerCase().includes(q)) : products;

    res.json({ ok: true, shop: shopName, products: filtered });
  } catch (e) {
    logEvent("shopify_products_error", { shop: shopName, message: e.message }, "error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Import d’un produit Shopify dans la config locale
app.post("/api/import/product", async (req, res) => {
  const shopName = getShop(req);
  try {
    const productId = String(req.body?.productId || "").trim();
    const categoryIds = Array.isArray(req.body?.categoryIds) ? req.body.categoryIds : [];

    if (!productId) return res.status(400).json({ ok: false, error: "productId manquant" });

    let p = null;
    if (typeof shopify.fetchProduct === "function") {
      p = await shopify.fetchProduct(shopName, productId);
    } else {
      const client = shopify.getShopifyClient();
      p = await client.product.get(Number(productId));
    }
    if (!p) return res.status(404).json({ ok: false, error: "Produit Shopify introuvable" });

    const variants = {};
    for (const v of p.variants || []) {
      const title = String(v.title || "").trim();
      const num = title.replace(",", ".").match(/(\d+(\.\d+)?)/)?.[1];
      if (!num) continue;

      variants[num] = {
        gramsPerUnit: Number(num),
        inventoryItemId: Number(v.inventory_item_id || v.inventoryItemId || 0),
      };
    }

    const product = callStock("upsertImportedProductConfig", shopName, {
      productId: String(p.id),
      name: String(p.title || p.name || p.id),
      totalGrams: 0,
      variants,
      categoryIds,
    });

    callMovements("addMovement", shopName, {
      type: "import",
      source: "ui",
      productId: product.productId,
      productName: product.name,
      gramsDelta: 0,
      totalAfter: product.totalGrams,
    });

    res.json({ ok: true, shop: shopName, product });
  } catch (e) {
    logEvent("import_product_error", { shop: shopName, message: e.message }, "error");
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -----------------------------
// 404
// -----------------------------
app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logEvent("server_started", { port: PORT });
  console.log(`✅ Server running on port ${PORT}`);
});
