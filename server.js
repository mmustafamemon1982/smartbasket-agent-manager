// server.js
// SmartBasket Agent Manager backend.
// v3: AI-style grocery request agent.
// Customer can type: "Need 30 eggs, 2 Lusine bread and 3 croissants"
// Agent parses request, matches available prices, and optimises by store rules.

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const {
  runAgentOnce,
  makeSupabaseAdmin,
  fetchD4DCategoryPreview,
  listD4DCategoriesPreview
} = require("./agent");

const {
  parseGroceryRequest,
  matchGroceryItems,
  optimiseMatchedBasket
} = require("./shoppingAgent");

const {
  fetchD4DRequestRows,
  getLastD4DRequestDiagnostics
} = require("./connectors/d4dRequestSearchConnector");

const app = express();
const port = process.env.PORT || 8787;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function adminKey(req) {
  return req.query.key || req.headers["x-agent-run-key"];
}

function isAuthorized(req) {
  return process.env.AGENT_RUN_KEY && adminKey(req) === process.env.AGENT_RUN_KEY;
}

function isNoisyCatalogRow(row) {
  const text = [
    row.item,
    row.brand,
    row.product,
    row.size,
    row.source
  ].join(" ").toLowerCase();

  const badPhrases = [
    "sort by",
    "price range",
    "newest first",
    "expiring soon",
    "best match",
    "low to high",
    "high to low",
    "offers in bahrain",
    "view product",
    "official flyer",
    "prices are ai-generated",
    "google_vignette",
    "privacy policy",
    "terms and conditions"
  ];

  if (String(row.source || "").toLowerCase().includes("fallback")) return true;
  if (String(row.product || "").length > 85) return true;
  if (String(row.product || "").trim().startsWith("--")) return true;
  if (badPhrases.some((phrase) => text.includes(phrase))) return true;

  return false;
}

function isAllowedCustomerPriceSource(row) {
  // Default: customer app should only see live/category-fetched rows.
  // Set PRICE_SOURCE_MODE=all only for testing.
  const mode = String(process.env.PRICE_SOURCE_MODE || "category_only").toLowerCase();
  if (mode === "all") return true;

  const source = String(row.source || "").toLowerCase();

  if (source.includes("fallback")) return false;
  if (mode === "category_only") {
    return source.includes("d4d") && source.includes("category");
  }

  if (mode === "online_only") {
    return source.includes("d4d") || source.includes("online");
  }

  return source.includes("d4d") && source.includes("category");
}

function categoryForItem(item) {
  const value = String(item || "").toLowerCase();

  if (["milk", "yogurt", "cheese", "butter", "cream", "laban", "labneh", "dairy", "eggs"].includes(value)) return "Dairy & Eggs";
  if (["rice", "pasta", "flour", "sugar", "oil", "olive oil", "salt", "grocery", "food"].includes(value)) return "Food - Grocery";
  if (["chicken", "beef", "mutton", "fish", "meat", "poultry"].includes(value)) return "Chicken, Meat & Fish";
  if (["bananas", "banana", "apple", "apples", "tomato", "potato", "onion", "vegetable", "fruit"].includes(value)) return "Fruits & Vegetable";
  if (["detergent", "dishwash", "tissue", "cleaner", "laundry", "cleaning"].includes(value)) return "Laundry & Cleaning";
  if (["water", "juice", "soft drink", "cola", "drinks", "beverages"].includes(value)) return "Drinks & Beverages";
  if (["bread", "bakery", "biscuits", "snacks", "chocolate", "croissant", "croissants"].includes(value)) return "Bakery & Snacks";
  if (["diapers", "baby wipes", "formula", "baby"].includes(value)) return "Baby & Mom Care";

  return "Grocery";
}

function normalizeProductId(row) {
  return [row.item, row.brand, row.product, row.size]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function getCustomerVisiblePrices() {
  const supabase = makeSupabaseAdmin();

  const { data, error } = await supabase
    .from("prices")
    .select("store,item,brand,product,size,price,match,confidence,source,source_url,last_checked,is_active,needs_review")
    .eq("is_active", true)
    .eq("needs_review", false)
    .order("store", { ascending: true });

  if (error) throw error;

  return (data || [])
    .filter((row) => !isNoisyCatalogRow(row))
    .filter((row) => isAllowedCustomerPriceSource(row));
}

async function getStoreRules(area) {
  const supabase = makeSupabaseAdmin();

  let query = supabase
    .from("store_rules")
    .select("store,area,is_available,delivery_fee,free_delivery_above,minimum_order,updated_at")
    .order("area", { ascending: true })
    .order("store", { ascending: true });

  if (area) query = query.eq("area", String(area));

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "smartbasket-agent-manager",
    mode: "ai_grocery_request_agent",
    time: new Date().toISOString()
  });
});

app.get("/api/prices", async (req, res) => {
  try {
    const rows = await getCustomerVisiblePrices();
    res.json({ count: rows.length, rows });
  } catch (error) {
    res.status(500).json({ error: "PRICE_FETCH_FAILED", message: error.message, rows: [] });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const rows = await getCustomerVisiblePrices();
    const map = new Map();

    for (const row of rows || []) {
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

    const products = Array.from(map.values()).sort((a, b) => {
      const ca = `${a.category} ${a.item} ${a.brand} ${a.product} ${a.size}`;
      const cb = `${b.category} ${b.item} ${b.brand} ${b.product} ${b.size}`;
      return ca.localeCompare(cb);
    });

    res.json({ count: products.length, rows: products });
  } catch (error) {
    res.status(500).json({ error: "PRODUCT_FETCH_FAILED", message: error.message, rows: [] });
  }
});

app.get("/api/store-rules", async (req, res) => {
  try {
    const rows = await getStoreRules(req.query.area);
    res.json({ count: rows.length, rows });
  } catch (error) {
    res.status(500).json({ error: "STORE_RULE_FETCH_FAILED", message: error.message, rows: [] });
  }
});

// AI-style grocery request endpoint.
// Supports GET for browser testing and POST for customer app.
app.all("/api/agent/grocery-request", async (req, res) => {
  try {
    const text = String(req.body?.text || req.query.text || req.query.q || "").trim();
    const area = String(req.body?.area || req.query.area || "Saar");
    const delivery = String(req.body?.delivery ?? req.query.delivery ?? "true") !== "false";
    const maxStores = Number(req.body?.maxStores || req.query.maxStores || 2);

    if (!text) {
      res.status(400).json({
        error: "MISSING_TEXT",
        message: "Please provide grocery request text, for example: Need 30 eggs, 2 Lusine bread and 3 croissants."
      });
      return;
    }

    const parsed = parseGroceryRequest(text);

    // Start with approved stored rows.
    let prices = await getCustomerVisiblePrices();

    // v5: request-specific online price search.
    // This searches only the customer's requested items.
    // Keep it enabled by default; set REQUEST_SEARCH_ENABLED=false to disable.
    let requestSearchRows = [];
    if (process.env.REQUEST_SEARCH_ENABLED !== "false") {
      requestSearchRows = await fetchD4DRequestRows(parsed.items, {
        limitPerItem: Number(process.env.REQUEST_SEARCH_LIMIT_PER_ITEM || 8)
      });
      prices = [...requestSearchRows, ...prices];
    }

    const storeRules = await getStoreRules(area);

    const matched = matchGroceryItems(parsed.items, prices);
    const recommendation = optimiseMatchedBasket({
      matchedItems: matched,
      storeRules,
      area,
      delivery,
      maxStores
    });

    res.json({
      ok: true,
      area,
      delivery,
      request_text: text,
      parsed_items: parsed.items,
      request_search: {
        enabled: process.env.REQUEST_SEARCH_ENABLED !== "false",
        rows_found: requestSearchRows.length
      },
      unmatched_items: matched.filter((item) => !item.matches.length),
      matched_items: matched,
      recommendation,
      note: "Prices and availability can change. Some source pages expose item-level price cards rather than exact SKU names. Verify final checkout price before buying."
    });
  } catch (error) {
    res.status(500).json({ error: "GROCERY_AGENT_FAILED", message: error.message });
  }
});


app.all("/api/agent/d4d-request-search", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const text = String(req.body?.text || req.query.text || req.query.q || "").trim();
    if (!text) {
      res.status(400).json({
        error: "MISSING_TEXT",
        message: "Provide text, for example: ?text=Need 30 eggs, 2 Lusine bread and 3 croissants"
      });
      return;
    }

    const parsed = parseGroceryRequest(text);
    const rows = await fetchD4DRequestRows(parsed.items, {
      limitPerItem: Number(req.query.limitPerItem || process.env.REQUEST_SEARCH_LIMIT_PER_ITEM || 8)
    });

    res.json({
      ok: true,
      parsed_items: parsed.items,
      count: rows.length,
      rows,
      diagnostics: getLastD4DRequestDiagnostics()
    });
  } catch (error) {
    res.status(500).json({ error: "D4D_REQUEST_SEARCH_FAILED", message: error.message });
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

app.get("/api/agent/d4d-categories", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const categories = await listD4DCategoriesPreview();
    res.json({ ok: true, count: categories.length, categories });
  } catch (error) {
    res.status(500).json({ error: "D4D_CATEGORY_LIST_FAILED", message: error.message });
  }
});

app.get("/api/agent/fetch-d4d-categories", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const limitCategories = Number(req.query.limitCategories || 8);
    const limitPerCategory = Number(req.query.limitPerCategory || 20);
    const result = await fetchD4DCategoryPreview({ limitCategories, limitPerCategory });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ error: "D4D_CATEGORY_FETCH_FAILED", message: error.message });
  }
});

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

app.all("/api/admin/cleanup-legacy-prices", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const supabase = makeSupabaseAdmin();

    const { data, error } = await supabase
      .from("prices")
      .select("store,item,brand,product,size,source,is_active")
      .eq("is_active", true);

    if (error) throw error;

    const rows = data || [];
    const legacyRows = rows.filter((row) => !isAllowedCustomerPriceSource(row));
    let deactivated = 0;
    const examples = [];

    for (const row of legacyRows) {
      const { error: updateError } = await supabase
        .from("prices")
        .update({
          is_active: false,
          needs_review: true,
          review_reason: "Removed legacy seed/admin/test price row",
          updated_at: new Date().toISOString()
        })
        .eq("store", row.store)
        .eq("item", row.item)
        .eq("brand", row.brand)
        .eq("product", row.product)
        .eq("size", row.size);

      if (!updateError) {
        deactivated += 1;
        if (examples.length < 10) {
          examples.push({
            store: row.store,
            product: row.product,
            source: row.source || null
          });
        }
      }
    }

    res.json({
      ok: true,
      scanned_active: rows.length,
      legacy_found: legacyRows.length,
      deactivated,
      examples
    });
  } catch (error) {
    res.status(500).json({ error: "LEGACY_CLEANUP_FAILED", message: error.message });
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
