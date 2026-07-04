// server.js
// SmartBasket Agent Manager backend.
// Agent manages online fetch, prices, store rules, and dynamic product catalogue.

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { runAgentOnce, makeSupabaseAdmin } = require("./agent");
const { fetchLuLuOnlineProducts } = require("./connectors/luluOnlineConnector");

const app = express();
const port = process.env.PORT || 8787;

app.use(cors());
app.use(express.json());

function adminKey(req) {
  return req.query.key || req.headers["x-agent-run-key"];
}

function isAuthorized(req) {
  return process.env.AGENT_RUN_KEY && adminKey(req) === process.env.AGENT_RUN_KEY;
}

function categoryForItem(item) {
  const value = String(item || "").toLowerCase();

  if (["milk", "yogurt", "cheese", "butter", "cream", "laban", "labneh"].includes(value)) return "Dairy";
  if (["eggs", "bread", "coffee", "cereal", "tea"].includes(value)) return "Breakfast";
  if (["rice", "pasta", "flour", "sugar", "oil", "olive oil", "salt"].includes(value)) return "Staples";
  if (["chicken", "beef", "mutton", "fish"].includes(value)) return "Meat";
  if (["bananas", "banana", "apple", "apples", "tomato", "potato", "onion"].includes(value)) return "Produce";
  if (["detergent", "dishwash", "tissue", "cleaner"].includes(value)) return "Cleaning";
  if (["water", "juice", "soft drink", "cola"].includes(value)) return "Drinks";
  if (["diapers", "baby wipes", "formula"].includes(value)) return "Baby";

  return "Grocery";
}

function normalizeProductId(row) {
  return [
    row.item,
    row.brand,
    row.product,
    row.size
  ]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "smartbasket-agent-manager",
    time: new Date().toISOString()
  });
});

app.get("/api/prices", async (req, res) => {
  try {
    const supabase = makeSupabaseAdmin();
    const { data, error } = await supabase
      .from("prices")
      .select("store,item,brand,product,size,price,match,confidence,source,source_url,last_checked,is_active,needs_review")
      .eq("is_active", true)
      .eq("needs_review", false)
      .order("store", { ascending: true });

    if (error) throw error;
    res.json({ count: data.length, rows: data });
  } catch (error) {
    res.status(500).json({ error: "PRICE_FETCH_FAILED", message: error.message, rows: [] });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const supabase = makeSupabaseAdmin();

    const { data, error } = await supabase
      .from("prices")
      .select("item,brand,product,size,is_active,needs_review")
      .eq("is_active", true)
      .eq("needs_review", false)
      .order("item", { ascending: true })
      .order("brand", { ascending: true })
      .order("product", { ascending: true });

    if (error) throw error;

    const map = new Map();

    for (const row of data || []) {
      const id = normalizeProductId(row);
      if (!map.has(id)) {
        map.set(id, {
          id,
          category: categoryForItem(row.item),
          item: row.item,
          brand: row.brand || "Generic",
          product: row.product,
          size: row.size
        });
      }
    }

    const rows = Array.from(map.values()).sort((a, b) => {
      const ca = `${a.category} ${a.item} ${a.brand} ${a.product} ${a.size}`;
      const cb = `${b.category} ${b.item} ${b.brand} ${b.product} ${b.size}`;
      return ca.localeCompare(cb);
    });

    res.json({ count: rows.length, rows });
  } catch (error) {
    res.status(500).json({ error: "PRODUCT_FETCH_FAILED", message: error.message, rows: [] });
  }
});

app.get("/api/store-rules", async (req, res) => {
  try {
    const supabase = makeSupabaseAdmin();

    let query = supabase
      .from("store_rules")
      .select("store,area,is_available,delivery_fee,free_delivery_above,minimum_order,updated_at")
      .order("area", { ascending: true })
      .order("store", { ascending: true });

    if (req.query.area) {
      query = query.eq("area", String(req.query.area));
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ count: data.length, rows: data });
  } catch (error) {
    res.status(500).json({ error: "STORE_RULE_FETCH_FAILED", message: error.message, rows: [] });
  }
});

app.get("/api/agent/status", async (req, res) => {
  try {
    const supabase = makeSupabaseAdmin();
    const { data, error } = await supabase
      .from("agent_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10);

    if (error) throw error;
    res.json({ runs: data });
  } catch (error) {
    res.status(500).json({ error: "AGENT_STATUS_FAILED", message: error.message });
  }
});

// Test connector without saving rows.
app.get("/api/agent/fetch-online", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const query = String(req.query.query || "milk");
    const limit = Number(req.query.limit || 12);
    const rows = await fetchLuLuOnlineProducts({ query, limit });
    res.json({ ok: true, store: "LuLu", query, count: rows.length, rows });
  } catch (error) {
    res.status(500).json({ error: "ONLINE_FETCH_FAILED", message: error.message });
  }
});

// Run agent and save fetched rows.
app.all("/api/agent/run", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const result = await runAgentOnce();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "AGENT_RUN_FAILED", message: error.message });
  }
});

app.post("/api/admin/price", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const supabase = makeSupabaseAdmin();
    const row = {
      store: req.body.store,
      item: String(req.body.item || "").toLowerCase(),
      brand: req.body.brand || "Generic",
      product: req.body.product,
      size: req.body.size,
      price: Number(req.body.price),
      match: Number(req.body.match || 90),
      confidence: req.body.confidence || "Medium",
      source: req.body.source || "admin_override",
      source_url: req.body.source_url || null,
      last_checked: new Date().toISOString(),
      is_active: req.body.is_active !== false,
      needs_review: req.body.needs_review === true,
      review_reason: req.body.review_reason || null,
      updated_at: new Date().toISOString()
    };

    if (!row.store || !row.item || !row.product || !row.size || !row.price) {
      res.status(400).json({ error: "MISSING_FIELDS", message: "store, item, product, size and price are required" });
      return;
    }

    const { data, error } = await supabase
      .from("prices")
      .upsert(row, { onConflict: "store,item,brand,product,size" })
      .select()
      .single();

    if (error) throw error;
    res.json({ ok: true, row: data });
  } catch (error) {
    res.status(500).json({ error: "ADMIN_PRICE_UPDATE_FAILED", message: error.message });
  }
});

app.post("/api/admin/store-rule", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const supabase = makeSupabaseAdmin();

    const row = {
      store: req.body.store,
      area: req.body.area,
      is_available: req.body.is_available !== false,
      delivery_fee: Number(req.body.delivery_fee || 0),
      free_delivery_above: Number(req.body.free_delivery_above || 0),
      minimum_order: Number(req.body.minimum_order || 0),
      updated_at: new Date().toISOString()
    };

    if (!row.store || !row.area) {
      res.status(400).json({ error: "MISSING_FIELDS", message: "store and area are required" });
      return;
    }

    const { data, error } = await supabase
      .from("store_rules")
      .upsert(row, { onConflict: "store,area" })
      .select()
      .single();

    if (error) throw error;
    res.json({ ok: true, row: data });
  } catch (error) {
    res.status(500).json({ error: "STORE_RULE_UPDATE_FAILED", message: error.message });
  }
});

app.listen(port, () => {
  console.log(`SmartBasket Agent Manager running on http://localhost:${port}`);

  const minutes = Number(process.env.AGENT_INTERVAL_MINUTES || 0);
  if (minutes > 0) {
    console.log(`Agent scheduled every ${minutes} minutes while server is running.`);
    setInterval(() => {
      runAgentOnce()
        .then((result) => console.log("Scheduled agent run:", result))
        .catch((error) => console.error("Scheduled agent failed:", error.message));
    }, minutes * 60 * 1000);
  }
});
