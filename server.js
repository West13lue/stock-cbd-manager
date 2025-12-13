const express = require("express");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");
const cors = require("cors");

const { listCategories, createCategory, deleteCategory } = require("./catalogStore");
const { addMovement } = require("./movementStore");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Middlewares
app.use(cors());
app.use(bodyParser.json());

// ===== API - Categories
app.get("/api/categories", (req, res) => {
  try {
    res.json(listCategories());
  } catch (e) {
    console.error("GET categories error:", e);
    res.status(500).json({ error: "Erreur serveur catégories" });
  }
});

app.post("/api/categories", (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Nom requis" });

    const category = createCategory(name);

    // movement NON bloquant
    try {
      addMovement({ type: "CATEGORY_CREATE", label: name });
    } catch (e) {
      console.warn("Movement ignored:", e.message);
    }

    res.json(category);
  } catch (e) {
    console.error("POST category error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/categories/:id", (req, res) => {
  try {
    const ok = deleteCategory(req.params.id);
    if (!ok) return res.status(404).json({ error: "Catégorie introuvable" });
    res.json({ success: true });
  } catch (e) {
    console.error("DELETE category error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ===== Front: folder auto-detect
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const STATIC_DIR = fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : ROOT_DIR;

const INDEX_PATH = path.join(STATIC_DIR, "index.html");
if (!fs.existsSync(INDEX_PATH)) {
  console.warn("⚠️ index.html introuvable dans:", STATIC_DIR);
  console.warn("⚠️ Vérifie où est ton front (public/, client/, etc.)");
}

app.use(express.static(STATIC_DIR));

// ✅ Catch-all SAFE Express 5 (évite /api)
app.get(/^\/(?!api\/).*/, (req, res) => {
  if (fs.existsSync(INDEX_PATH)) return res.sendFile(INDEX_PATH);
  return res.status(500).send("index.html introuvable sur le serveur");
});

app.listen(PORT, () => {
  console.log("✅ Server running on port", PORT);
});
