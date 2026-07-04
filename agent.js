// agent.js
// Core SmartBasket Agent logic:
// 1. Reads enabled sources/connectors
// 2. Normalises price rows
// 3. Scores confidence
// 4. Upserts live prices
// 5. Flags suspicious rows for review

const { createClient } = require("@supabase/supabase-js");
const { fetchSampleAgentFeed } = require("./connectors/sampleAgentFeed");

function makeSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function normaliseText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseRow(row) {
  const price = Number(row.price);
  if (!price || price <= 0) return null;

  return {
    store: normaliseText(row.store),
    item: normaliseText(row.item).toLowerCase(),
    brand: normaliseText(row.brand || "Generic"),
    product: normaliseText(row.product),
    size: normaliseText(row.size || "1 pc"),
    price,
    match: Number(row.match || 90),
    confidence: row.confidence || "Medium",
    source: normaliseText(row.source || "agent"),
    source_url: row.source_url || null,
    last_checked: new Date().toISOString(),
    is_active: true
  };
}

function reviewCheck(row, previous) {
  if (!row) return { needsReview: true, reason: "Invalid row" };
  if (row.price <= 0) return { needsReview: true, reason: "Invalid price" };
  if (row.match < 75) return { needsReview: true, reason: "Low product match" };
  if (previous && previous.price > 0) {
    const change = Math.abs(row.price - previous.price) / previous.price;
    if (change > 0.35) return { needsReview: true, reason: "Price changed more than 35%" };
  }
  return { needsReview: false, reason: null };
}

async function getPreviousPrice(supabase, row) {
  const { data, error } = await supabase
    .from("prices")
    .select("id,price")
    .eq("store", row.store)
    .eq("item", row.item)
    .eq("brand", row.brand)
    .eq("product", row.product)
    .eq("size", row.size)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function upsertPrice(supabase, row, runId) {
  const previous = await getPreviousPrice(supabase, row);
  const review = reviewCheck(row, previous);

  const payload = {
    ...row,
    needs_review: review.needsReview,
    review_reason: review.reason,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("prices")
    .upsert(payload, { onConflict: "store,item,brand,product,size" })
    .select("id")
    .single();

  if (error) throw error;

  await supabase.from("price_observations").insert({
    run_id: runId,
    store: row.store,
    item: row.item,
    brand: row.brand,
    product: row.product,
    size: row.size,
    price: row.price,
    source: row.source,
    source_url: row.source_url,
    raw_payload: row
  });

  if (review.needsReview && data?.id) {
    await supabase.from("review_queue").insert({
      price_id: data.id,
      reason: review.reason
    });
  }

  return { accepted: !review.needsReview, review: review.needsReview };
}

async function fetchEnabledConnectorRows() {
  // MVP: one agent-managed sample feed.
  // Replace or add connectors here as sources become available.
  const rows = await fetchSampleAgentFeed();
  return rows;
}

async function runAgentOnce() {
  const supabase = makeSupabaseAdmin();

  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .insert({ status: "running" })
    .select("id")
    .single();

  if (runError) throw runError;

  let rowsSeen = 0;
  let rowsAccepted = 0;
  let rowsReview = 0;

  try {
    const rawRows = await fetchEnabledConnectorRows();
    rowsSeen = rawRows.length;

    for (const raw of rawRows) {
      const row = normaliseRow(raw);
      if (!row) {
        rowsReview += 1;
        continue;
      }

      const result = await upsertPrice(supabase, row, run.id);
      if (result.accepted) rowsAccepted += 1;
      if (result.review) rowsReview += 1;
    }

    await supabase
      .from("agent_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        rows_seen: rowsSeen,
        rows_accepted: rowsAccepted,
        rows_review: rowsReview
      })
      .eq("id", run.id);

    return { ok: true, run_id: run.id, rows_seen: rowsSeen, rows_accepted: rowsAccepted, rows_review: rowsReview };
  } catch (error) {
    await supabase
      .from("agent_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        rows_seen: rowsSeen,
        rows_accepted: rowsAccepted,
        rows_review: rowsReview,
        error: error.message
      })
      .eq("id", run.id);

    throw error;
  }
}

module.exports = { runAgentOnce, makeSupabaseAdmin };
