// catalogStore.js
const fs = require("fs");
const path = require("path");

const FILE = process.env.CATALOG_FILE || "/var/data/catalog.json";

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    ensureDir();
    if (!fs.existsSync(FILE)) return { categories: [], productMeta: {} };
    const raw = fs.readFileSync(FILE, "utf8");
    const json = JSON.parse(raw);
    return {
      categories: Array.isArray(json.categories) ? json.categories : [],
      productMeta: json.productMeta && typeof json.productMeta === "object" ? json.productMeta : {},
    };
  } catch {
    return { categories: [], productMeta: {} };
  }
}

function save(data) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

function uid() {
  return "cat_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function listCategories() {
  return load().categories;
}

function createCategory(name) {
  const db = load();
  const cat = { id: uid(), name };
  db.categories.push(cat);
  save(db);
  return cat;
}

function renameCategory(id, name) {
  const db = load();
  const c = db.categories.find((x) => x.id === id);
  if (!c) return null;
  c.name = name;
  save(db);
  return c;
}

function deleteCategory(id) {
  const db = load();
  const before = db.categories.length;
  db.categories = db.categories.filter((x) => x.id !== id);

  // retire aussi la catégorie des produits
  for (const pid of Object.keys(db.productMeta || {})) {
    const meta = db.productMeta[pid] || {};
    meta.categoryIds = Array.isArray(meta.categoryIds)
      ? meta.categoryIds.filter((c) => c !== id)
      : [];
    db.productMeta[pid] = meta;
  }

  save(db);
  return db.categories.length !== before;
}

function getProductMeta(productId) {
  const db = load();
  return db.productMeta?.[productId] || { categoryIds: [] };
}

function setProductMeta(productId, meta) {
  const db = load();
  db.productMeta = db.productMeta || {};
  db.productMeta[productId] = {
    ...(db.productMeta[productId] || {}),
    ...(meta || {}),
  };
  save(db);
  return true;
}

module.exports = {
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  getProductMeta,
  setProductMeta,
};
