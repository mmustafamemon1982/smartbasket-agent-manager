// connectors/d4dRequestSearchConnector.js
// SmartBasket v6 request-specific online price search.
// Fixes v5 by using Node's built-in HTTPS client instead of global fetch.
// Also keeps diagnostics so we can see whether D4D returned product cards to Render.

const https = require("https");
const http = require("http");

const BASE = "https://d4donline.com/en/bahrain/bahrain";

const STORE_NAMES = [
  "LuLu Hypermarket",
  "Lulu Hypermarket",
  "Carrefour Bahrain",
  "Carrefour",
  "NESTO",
  "Nesto",
  "Al Jazira Supermarket",
  "Al Jazira",
  "Al Helli",
  "HyperMax",
  "Talal Markets",
  "Talal Market",
  "MegaMart & Macro Mart",
  "Mega Mart",
  "The Sultan Center",
  "Ansar Gallery",
  "Prime Markets",
  "Ramez",
  "Sama mart",
  "Midway Supermarket",
  "Bahrain Pride",
  "Al Sater Market",
  "Muntaza",
  "Day to Day Discount Center",
  "Multi Market",
  "Talabat Mart"
];

const ITEM_SEARCH_CONFIG = {
  eggs: [
    { label: "Eggs", url: `${BASE}/products/114/eggs` }
  ],
  bread: [
    { label: "Bread & Buns", url: `${BASE}/products/76/bread-buns` }
  ],
  croissants: [
    { label: "Cakes & Pastry", url: `${BASE}/products/8/cakes-pastry` },
    { label: "Bread & Buns", url: `${BASE}/products/76/bread-buns` }
  ],
  milk: [
    { label: "Milk & Laban", url: `${BASE}/products/40/milk-laban` }
  ],
  water: [
    { label: "Water", url: `${BASE}/products/102/water` }
  ],
  rice: [
    { label: "Rice", url: `${BASE}/products/66/rice` }
  ],
  tissue: [
    { label: "Toilet & Paper Tissue", url: `${BASE}/products/107/toilet-paper-tissue` }
  ],
  diapers: [
    { label: "Baby Diapers", url: `${BASE}/products/44/baby-diapers` }
  ]
};

let lastDiagnostics = [];

function cleanText(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html) {
  return cleanText(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function normalizeStoreName(text) {
  const lower = cleanText(text).toLowerCase();

  for (const store of STORE_NAMES) {
    if (lower.includes(store.toLowerCase())) {
      if (store === "Lulu Hypermarket") return "LuLu Hypermarket";
      if (store === "Nesto") return "NESTO";
      return store;
    }
  }

  return null;
}

function requestText(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;

    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 SmartBasketBH/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-BH,en;q=0.9,ar-BH;q=0.8",
        "Cache-Control": "no-cache"
      },
      timeout: 15000
    }, (res) => {
      const status = res.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        requestText(next, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }

      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        resolve({
          status,
          finalUrl: url,
          html: data
        });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Request timed out"));
    });

    req.on("error", reject);
  });
}

function pageLooksExpiredOrUnavailable(html) {
  const text = stripHtml(html).toLowerCase();
  return (
    text.includes("sorry, this flyer not available") ||
    text.includes("expired flyers") ||
    text.includes("expired offer") ||
    text.includes("this offer has expired")
  );
}

function pricesFromText(text) {
  return Array.from(
    String(text || "").matchAll(/\b(?:BHD|BD)\s*([0-9]+(?:\.[0-9]{1,3})?)/gi)
  )
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function visibleCurrentPrice(segment) {
  const prices = pricesFromText(segment);
  if (!prices.length) return null;

  // D4D commonly shows old price then current price. Use last price on card.
  return prices[prices.length - 1];
}

function visibleOriginalPrice(segment) {
  const prices = pricesFromText(segment);
  if (prices.length >= 2) return prices[0];
  return null;
}

function inferSizeFromRequest(item) {
  if (item.item === "eggs" && Number(item.quantity || 0) >= 12) {
    return `${Number(item.quantity)} pcs requested`;
  }

  if (item.unit && item.unit !== "pcs") {
    return `${item.quantity || 1} ${item.unit}`;
  }

  return "price card";
}

function requestedProductLabel(item) {
  const requested = cleanText(item.phrase || item.item || "grocery item");

  if (item.item === "eggs" && Number(item.quantity || 0) >= 12) {
    return `${requested} offer`;
  }

  if (item.brand && item.brand !== "Any" && !requested.toLowerCase().includes(item.brand.toLowerCase())) {
    return `${item.brand} ${requested} offer`;
  }

  return `${requested} offer`;
}

function brandFromItem(item) {
  if (item.brand && item.brand !== "Any") return item.brand;

  const phrase = String(item.phrase || "").toLowerCase();
  if (phrase.includes("lusine") || phrase.includes("lupine") || phrase.includes("lupin")) return "Lusine";

  return "Generic";
}

function extractRowsFromText(text, item, sourceConfig, limit) {
  const rows = [];
  const seen = new Set();

  // Use "View Product" as card separator. D4D server-readable text exposes cards this way.
  const pieces = String(text || "").split(/View Product/i).slice(1);

  for (const raw of pieces) {
    if (rows.length >= limit) break;

    const segment = cleanText(raw.slice(0, 450));
    if (!segment) continue;

    const lower = segment.toLowerCase();
    if (
      lower.includes("sort by") ||
      lower.includes("price range") ||
      lower.includes("view more products") ||
      lower.includes("privacy policy") ||
      lower.includes("terms of service")
    ) {
      continue;
    }

    const price = visibleCurrentPrice(segment);
    if (!price) continue;

    const store = normalizeStoreName(segment);
    if (!store) continue;

    const originalPrice = visibleOriginalPrice(segment);
    const product = requestedProductLabel(item);
    const size = inferSizeFromRequest(item);
    const brand = brandFromItem(item);

    const key = `${store}|${item.item}|${brand}|${product}|${size}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      store,
      item: item.item,
      brand,
      product,
      size,
      price,
      original_price: originalPrice,
      match: item.brand && item.brand !== "Any" ? 70 : 78,
      confidence: "Low",
      source: "requested_item_online_price_card",
      source_url: sourceConfig.url,
      last_checked: new Date().toISOString(),
      is_active: true,
      needs_review: false,
      source_note: "Exact product name was not exposed by the source page; this is an item-specific visible price card."
    });
  }

  return rows;
}

function configsForItem(item) {
  const key = String(item.item || "").toLowerCase();
  return ITEM_SEARCH_CONFIG[key] || [
    { label: item.phrase || item.item || "Grocery", url: `${BASE}/products?search=${encodeURIComponent(item.phrase || item.item || "grocery")}` }
  ];
}

async function fetchD4DRequestRows(items, { limitPerItem = 8 } = {}) {
  const all = [];
  const seen = new Set();
  const diagnostics = [];

  for (const item of items || []) {
    const configs = configsForItem(item);

    for (const config of configs) {
      if (all.filter((row) => row.item === item.item).length >= limitPerItem) break;

      const diag = {
        item: item.item,
        url: config.url,
        status: null,
        html_length: 0,
        text_length: 0,
        view_product_count: 0,
        price_count: 0,
        rows_extracted: 0,
        expired_or_unavailable: false,
        error: null,
        excerpt: null
      };

      try {
        const result = await requestText(config.url);
        diag.status = result.status;
        diag.html_length = result.html.length;

        if (result.status < 200 || result.status >= 400) {
          diag.error = `HTTP ${result.status}`;
          diagnostics.push(diag);
          continue;
        }

        const text = stripHtml(result.html);
        diag.text_length = text.length;
        diag.view_product_count = (text.match(/View Product/gi) || []).length;
        diag.price_count = pricesFromText(text).length;
        diag.expired_or_unavailable = pageLooksExpiredOrUnavailable(result.html);
        diag.excerpt = text.slice(0, 300);

        if (diag.expired_or_unavailable) {
          diagnostics.push(diag);
          continue;
        }

        const rows = extractRowsFromText(text, item, config, limitPerItem);
        diag.rows_extracted = rows.length;

        for (const row of rows) {
          const key = `${row.store}|${row.item}|${row.brand}|${row.product}|${row.size}|${row.price}`;
          if (!seen.has(key)) {
            seen.add(key);
            all.push(row);
          }
        }

        diagnostics.push(diag);
      } catch (error) {
        diag.error = error.message;
        diagnostics.push(diag);
      }
    }
  }

  lastDiagnostics = diagnostics;
  return all;
}

function getLastD4DRequestDiagnostics() {
  return lastDiagnostics;
}

module.exports = {
  fetchD4DRequestRows,
  getLastD4DRequestDiagnostics
};
