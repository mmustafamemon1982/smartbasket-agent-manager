// agent.js
// SmartBasket Agent core.
// Fetches local seed feed + online connector rows and saves approved rows into Supabase.

const { randomUUID } = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { fetchLuLuOnlineProducts } = require("./connectors/luluOnlineConnector");

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

function defaultOnlineQueries() {
  const raw = process.env.ONLINE_SEARCH_QUERIES;
  if (raw) {
    return raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  return [
    "milk",
    "eggs",
    "rice",
    "chicken",
    "bread",
    "yogurt",
    "bananas",
    "detergent",
    "coffee",
    "cereal",
    "olive oil",
    "water",
    "cheese",
    "sugar",
    "flour",
    "pasta",
    "tissue",
    "diapers"
  ];
}

function normalizeRow(row) {
  const normalized = {
    store: row.store || "Unknown",
    item: String(row.item || "").toLowerCase().trim(),
    brand: row.brand || "Generic",
    product: row.product || row.name || "",
    size: row.size || "1 unit",
    price: Number(row.price),
    match: Number(row.match || 85),
    confidence: row.confidence || "Medium",
    source: row.source || "agent",
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

  if (change > 0.35) {
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
    // If agent_runs insert fails, continue with a local id so the API still responds.
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

async function fetchOnlineRows() {
  if (process.env.ONLINE_FETCH_ENABLED === "false") return [];

  const limitPerQuery = Number(process.env.ONLINE_MAX_RESULTS_PER_QUERY || 8);
  const queries = defaultOnlineQueries();
  const all = [];

  for (const query of queries) {
    try {
      const rows = await fetchLuLuOnlineProducts({ query, limit: limitPerQuery });
      all.push(...rows);
    } catch (error) {
      console.warn(`LuLu online fetch failed for "${query}":`, error.message);
    }
  }

  return all;
}

async function runAgentOnce() {
  const supabase = makeSupabaseAdmin();
  const runId = await createRun(supabase);

  let rowsSeen = 0;
  let rowsAccepted = 0;
  let rowsReview = 0;

  try {
    const seedRows = await fetchLocalSeedRows();
    const onlineRows = await fetchOnlineRows();
    const allRows = [...seedRows, ...onlineRows];

    rowsSeen = allRows.length;

    for (const raw of allRows) {
      let row = normalizeRow(raw);
      if (!isValidRow(row)) continue;

      const existing = await findExistingPrice(supabase, row);
      row = reviewIfSuspicious(row, existing);

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
  runAgentOnce
};
