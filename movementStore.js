// movementStore.js
// ============================================
// Persist movements to Render Disk (NDJSON/day)
// - BASE_DIR: /var/data/shops/<shop>/movements
// - Backward compatible:
//     addMovement(movement)
//     addMovement(shop, movement)
// ============================================

const fs = require("fs");
const path = require("path");
const { sanitizeShop, shopDir } = require("./stockState");

function baseDirForShop(shop) {
  return path.join(shopDir(shop), "movements");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fileForDate(dir, date) {
  const day = date.toISOString().slice(0, 10);
  return path.join(dir, `${day}.ndjson`);
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// Backward compat signature handler
function normalizeArgs(arg1, arg2) {
  // addMovement(movementObject)
  if (arg1 && typeof arg1 === "object" && !Array.isArray(arg1)) {
    return { shop: "default", movement: arg1 };
  }
  // addMovement(shop, movementObject)
  return { shop: arg1 || "default", movement: arg2 || {} };
}

function addMovement(arg1, arg2) {
  const { shop, movement } = normalizeArgs(arg1, arg2);

  const dir = baseDirForShop(shop);
  ensureDir(dir);

  const m = {
    id: movement.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ts: movement.ts || new Date().toISOString(),
    shop: sanitizeShop(shop),
    ...movement,
  };

  const file = fileForDate(dir, new Date());
  fs.appendFileSync(file, JSON.stringify(m) + "\n", "utf8");
  return m;
}

function listMovements(shop = "default", { days = 7, limit = 2000 } = {}) {
  const dir = baseDirForShop(shop);
  ensureDir(dir);

  const now = new Date();
  const out = [];

  const max = Math.max(1, Math.min(Number(limit) || 2000, 10000));
  const maxDays = Math.max(1, Math.min(Number(days) || 7, 365));

  for (let i = 0; i < maxDays; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);

    const file = fileForDate(dir, d);
    if (!fs.existsSync(file)) continue;

    const content = fs.readFileSync(file, "utf8");
    if (!content) continue;

    const lines = content.split("\n").filter(Boolean);
    for (const line of lines) {
      const obj = safeJsonParse(line);
      if (obj) out.push(obj);
    }

    if (out.length >= max * 3) break;
  }

  out.sort((a, b) => Date.parse(b?.ts || "") - Date.parse(a?.ts || ""));
  return out.slice(0, max);
}

function purgeOld(shop = "default", daysToKeep = 14) {
  const dir = baseDirForShop(shop);
  ensureDir(dir);

  const keep = Math.max(1, Math.min(Number(daysToKeep) || 14, 3650));
  const files = fs.readdirSync(dir);

  const limit = new Date();
  limit.setDate(limit.getDate() - keep);

  for (const f of files) {
    if (!f.endsWith(".ndjson")) continue;
    const dateStr = f.replace(".ndjson", "");
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) continue;
    if (d < limit) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {}
    }
  }
}

function clearMovements(shop = "default") {
  const dir = baseDirForShop(shop);
  ensureDir(dir);
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (!f.endsWith(".ndjson")) continue;
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {}
  }
}

function csvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(rows = []) {
  const cols = [
    "ts","type","source","orderId","orderName","productId","productName",
    "deltaGrams","gramsDelta","gramsBefore","gramsAfter","totalAfter",
    "variantTitle","lineTitle","requestId","shop",
  ];
  const header = cols.join(",");
  const lines = rows.map((r) => cols.map((c) => csvEscape(r?.[c])).join(","));
  return [header, ...lines].join("\n");
}

module.exports = { addMovement, listMovements, purgeOld, clearMovements, toCSV };
