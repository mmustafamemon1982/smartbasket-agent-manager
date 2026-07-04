// server.js
// SmartBasket Agent Manager backend.
// This runs privately on a server. Customer website reads /api/prices.
// Agent runs scheduled or manually via /api/agent/run?key=...

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { runAgentOnce, makeSupabaseAdmin } = require("./agent");

const app = express();
const port = process.env.PORT || 8787;

app.use(cors());
app.use(express.json());

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

app.get("/api/store-rules", async (req, res) => {
  try {
    const supabase = makeSupabaseAdmin();
    const { data, error } = await supabase
      .from("store_rules")
      .select("*")
      .order("store", { ascending: true });

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

app.post("/api/agent/run", async (req, res) => {
  const key = req.query.key || req.headers["x-agent-run-key"];
  if (!process.env.AGENT_RUN_KEY || key !== process.env.AGENT_RUN_KEY) {
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
  const key = req.query.key || req.headers["x-agent-run-key"];
  if (!process.env.AGENT_RUN_KEY || key !== process.env.AGENT_RUN_KEY) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  try {
    const supabase = makeSupabaseAdmin();
    const row = {
      ...req.body,
      updated_at: new Date().toISOString(),
      last_checked: new Date().toISOString(),
      source: req.body.source || "admin_override",
      is_active: req.body.is_active !== false
    };

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
