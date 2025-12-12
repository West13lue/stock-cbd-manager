// stockState.js
const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const { logEvent } = require("./utils/logger");

// ============================
// PERSISTENCE (Render Disk)
// ============================
// Render Persistent Disk monté sur /var/data
// Tu peux override avec DATA_DIR ou STOCK_STATE_FILE
const DATA_DIR = process.env.DATA_DIR || "/var/data";
const STATE_FILE =
  process.env.STOCK_STATE_FILE || path.join(DATA_DIR, "stock-state.json");

// ============================
// Utils
// ============================
function ensureDirSync(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    logEvent("stock_state_ensure_dir_error", { dir, message: e.message }, "error");
  }
}

async function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
  } catch (e) {
    logEvent("stock_state_ensure_dir_error", { dir, message: e.message }, "error");
  }
}

function safeParseJSON(raw) {
  try {
    if (!raw || !String(raw).trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// ============================
// Load (SYNC) - pour init
// ============================
// Tu veux un load sync au boot : OK.
// Ça évite les soucis d'init avant que le serveur ne réponde.
function loadState() {
  try {
    const dir = path.dirname(STATE_FILE);
    ensureDirSync(dir);

    if (!fs.existsSync(STATE_FILE)) return {};
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = safeParseJSON(raw);

    logEvent("stock_state_loaded", {
      file: STATE_FILE,
      keys: Object.keys(parsed || {}).length,
    });

    return parsed;
  } catch (e) {
    logEvent("stock_state_load_error", { file: STATE_FILE, message: e.message }, "error");
    return {};
  }
}

// ============================
// Save (ASYNC) - atomic write
// ============================
async function saveState(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    await ensureDir(dir);

    const tmp = STATE_FILE + ".tmp";
    const payload = JSON.stringify(state || {}, null, 2);

    await fsp.writeFile(tmp, payload, "utf8");
    await fsp.rename(tmp, STATE_FILE);

    logEvent("stock_state_saved", {
      file: STATE_FILE,
      keys: Object.keys(state || {}).length,
    });

    return true;
  } catch (e) {
    logEvent("stock_state_save_error", { file: STATE_FILE, message: e.message }, "error");
    return false;
  }
}

module.exports = { loadState, saveState, STATE_FILE, DATA_DIR };
