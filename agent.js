// agent.js
// SmartBasket Agent core.
// Active source: D4D Bahrain category crawler.
// LuLu connector can remain in repo but is disabled by default.

const { randomUUID } = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const {
  fetchD4DCategoryRows,
  listD4DCategories,
  validateD4DRowIsActive
} = require("./connectors/d4dCategoryConnector");

function makeSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or Supabase key environment variable");
  }

  return createClient(url, key);
}

async function fetchLocalSeedRows() {
  try {
    const rootFeed = require("./sampleAgentFeed");
    if (typeof rootFeed.fetchSampleAgentFeed === "function") {
      return await rootFeed.fetchSampleAgentFeed();
    }
  } catch (_) {}

  try {
    const connectorFeed = require("./connectors/sampleAgentFeed");
    if (typeof connectorFeed.fetchSampleAgentFeed === "function") {
      return await connectorFeed.fetchSampleAgentFeed();
    }
  } catch (_) {}

  return [];
}

function normalizeRow(row) {
  const normalized = {
    store: row.store || "D4D Store",
    item: String(row.item || "").toLowerCase().trim(),
    brand: row.brand || "Generic",
    product: row.product || row.name || "",
    size: row.size || "1 unit",
    price: Number(row.price),
    match: Number(row.match || 85),
    confidence: row.confidence || "Medium",
    source: row.source || "d4d_special_price_category",
    source_url: row.source_url || null,
    last_checked: row.last_checked || new Date().toISOString(),
    is_active: row.is_active !== false,
    needs_review: row.needs_review === true,
    review_reason: row.review_reason || null,
    updated_at: new Date().toISOString()
  };

  return normalized;
}

function isValidRow(row) {
  return Boolean(
    row.store &&
    row.item &&
    row.product &&
    row.size &&
    Number.isFinite(Number(row.price)) &&
    Number(row.price) > 0
  );
}

async function findExistingPrice(supabase, row) {
  const { data, error } = await supabase
    .from("prices")
    .select("price")
    .eq("store", row.store)
    .eq("item", row.item)
    .eq("brand", row.brand)
    .eq("product", row.product)
    .eq("size", row.size)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data;
}

function reviewIfSuspicious(row, existing) {
  if (!existing || !existing.price) return row;

  const oldPrice = Number(existing.price);
  const newPrice = Number(row.price);
  if (!oldPrice || !newPrice) return row;

  const change = Math.abs(newPrice - oldPrice) / oldPrice;

  if (change > 0.45) {
    return {
      ...row,
      needs_review: true,
      confidence: "Low",
      review_reason: `Price changed by ${Math.round(change * 100)}% from previous value`
    };
  }

  return row;
}

async function createRun(supabase) {
  const runId = randomUUID();

  const { error } = await supabase.from("agent_runs").insert({
    id: runId,
    status: "running",
    rows_seen: 0,
    rows_accepted: 0,
    rows_review: 0,
    started_at: new Date().toISOString()
  });

  if (error) {
    console.warn("Could not create agent run row:", error.message);
  }

  return runId;
}

async function finishRun(supabase, runId, payload) {
  const { error } = await supabase
    .from("agent_runs")
    .update({
      ...payload,
      finished_at: new Date().toISOString()
    })
    .eq("id", runId);

  if (error) {
    console.warn("Could not update agent run row:", error.message);
  }
}

async function fetchD4DRows() {
  if (process.env.D4D_FETCH_ENABLED === "false") return [];

  const limitCategories = Number(process.env.D4D_MAX_CATEGORIES || 20);
  const limitPerCategory = Number(process.env.D4D_MAX_PRODUCTS_PER_CATEGORY || 40);

  return await fetchD4DCategoryRows({
    limitCategories,
    limitPerCategory
  });
}

async function fetchLuLuRowsIfEnabled() {
  if (process.env.LULU_FETCH_ENABLED !== "true") return [];

  try {
    const { fetchLuLuOnlineProducts } = require("./connectors/luluOnlineConnector");
    const queries = ["milk", "eggs", "rice", "water"];
    const all = [];

    for (const query of queries) {
      try {
        const rows = await fetchLuLuOnlineProducts({ query, limit: 8 });
        all.push(...rows);
      } catch (error) {
        console.warn(`LuLu fetch failed for "${query}":`, error.message);
      }
    }

    return all;
  } catch (error) {
    console.warn("LuLu connector not available:", error.message);
    return [];
  }
}

async function listD4DCategoriesPreview() {
  return await listD4DCategories();
}

async function fetchD4DCategoryPreview({ limitCategories = 8, limitPerCategory = 20 } = {}) {
  const categories = await listD4DCategories();
  const rows = await fetchD4DCategoryRows({ limitCategories, limitPerCategory });

  return {
    source: "D4D",
    mode: "category_crawler",
    categories_seen: categories.length,
    categories_used: categories.slice(0, limitCategories),
    count: rows.length,
    rows
  };
}

async function runAgentOnce() {
  const supabase = makeSupabaseAdmin();
  const runId = await createRun(supabase);

  let rowsSeen = 0;
  let rowsAccepted = 0;
  let rowsReview = 0;

  try {
    const seedRows = process.env.SEED_FETCH_ENABLED === "false" ? [] : await fetchLocalSeedRows();
    const d4dRows = await fetchD4DRows();
    const luluRows = await fetchLuLuRowsIfEnabled();

    const allRows = [...seedRows, ...d4dRows, ...luluRows];
    rowsSeen = allRows.length;

    for (const raw of allRows) {
      let row = normalizeRow(raw);
      if (!isValidRow(row)) continue;

      const existing = await findExistingPrice(supabase, row);
      row = reviewIfSuspicious(row, existing);

      if (String(row.source || "").toLowerCase().includes("d4d")) {
        const validation = await validateD4DRowIsActive(row);
        if (!validation.active) {
          row = {
            ...row,
            is_active: false,
            needs_review: true,
            confidence: "Low",
            review_reason: validation.reason || "expired_or_unavailable_source_page"
          };
        }
      }

      const { error } = await supabase
        .from("prices")
        .upsert(row, { onConflict: "store,item,brand,product,size" });

      if (error) {
        console.warn("Price upsert failed:", error.message, row.product);
        continue;
      }

      if (row.needs_review) rowsReview += 1;
      else rowsAccepted += 1;
    }

    await finishRun(supabase, runId, {
      status: "success",
      rows_seen: rowsSeen,
      rows_accepted: rowsAccepted,
      rows_review: rowsReview,
      error: null
    });

    return {
      ok: true,
      run_id: runId,
      active_source: "d4d_category_crawler",
      rows_seen: rowsSeen,
      rows_accepted: rowsAccepted,
      rows_review: rowsReview
    };
  } catch (error) {
    await finishRun(supabase, runId, {
      status: "failed",
      rows_seen: rowsSeen,
      rows_accepted: rowsAccepted,
      rows_review: rowsReview,
      error: error.message
    });

    throw error;
  }
}

module.exports = {
  makeSupabaseAdmin,
  runAgentOnce,
  listD4DCategoriesPreview,
  fetchD4DCategoryPreview
};
