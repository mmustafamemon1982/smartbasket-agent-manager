// connectors/d4dRequestSearchConnector.js
// SmartBasket v10 request-specific online price search.
// Fixes:
// - Never shows bad generated names like "available at HyperMax in Bahrain".
// - Shows clean item-option labels.
// - Treats brand-specific bread as "alternative" unless source confirms the brand.
// - Tries multiple image formats, but keeps "No image" if source does not expose product image to Render.

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

function absoluteUrl(url, baseUrl) {
  if (!url) return null;
  try {
    return new URL(url, baseUrl || BASE).toString();
  } catch {
    return null;
  }
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

    const requestOptions = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 SmartBasketBH/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-BH,en;q=0.9,ar-BH;q=0.8",
        "Cache-Control": "no-cache"
      },
      timeout: 15000
    };

    if (url.startsWith("https:") && process.env.D4D_IGNORE_TLS_ERRORS !== "false") {
      requestOptions.rejectUnauthorized = false;
    }

    const req = lib.get(url, requestOptions, (res) => {
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
        resolve({ status, finalUrl: url, html: data });
      });
    });

    req.on("timeout", () => req.destroy(new Error("Request timed out")));
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
  return Array.from(String(text || "").matchAll(/\b(?:BHD|BD)\s*([0-9]+(?:\.[0-9]{1,3})?)/gi))
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function visibleCurrentPrice(segmentText) {
  const prices = pricesFromText(segmentText);
  if (!prices.length) return null;
  return prices[prices.length - 1];
}

function visibleOriginalPrice(segmentText) {
  const prices = pricesFromText(segmentText);
  if (prices.length >= 2) return prices[0];
  return null;
}

function inferSizeFromRequest(item) {
  if (item.item === "eggs" && Number(item.quantity || 0) >= 12) return `${Number(item.quantity)} pcs requested`;
  if (item.unit && item.unit !== "pcs") return `${item.quantity || 1} ${item.unit}`;
  return "price card";
}

function firstImageFromHtml(segmentHtml, sourceUrl) {
  const html = String(segmentHtml || "");

  const imgMatches = Array.from(html.matchAll(/<img[^>]+>/gi));
  for (const m of imgMatches) {
    const tag = m[0];
    let src =
      (tag.match(/\sdata-src=["']([^"']+)["']/i) || [])[1] ||
      (tag.match(/\sdata-original=["']([^"']+)["']/i) || [])[1] ||
      (tag.match(/\sdata-lazy=["']([^"']+)["']/i) || [])[1] ||
      (tag.match(/\ssrc=["']([^"']+)["']/i) || [])[1];

    if (!src) {
      const srcset = (tag.match(/\ssrcset=["']([^"']+)["']/i) || [])[1];
      if (srcset) src = srcset.split(",")[0].trim().split(" ")[0];
    }

    if (!src || src.startsWith("data:")) continue;

    const url = absoluteUrl(src, sourceUrl);
    if (url) return url;
  }

  const bg = (html.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i) || [])[1];
  if (bg && !bg.startsWith("data:")) return absoluteUrl(bg, sourceUrl);

  return null;
}

function badGeneratedName(text, store) {
  const t = cleanText(text).toLowerCase();
  if (!t) return true;

  const s = String(store || "").toLowerCase();

  if (t === "title") return true;
  if (t === "maximize_icon") return true;
  if (t === "minimize_icon") return true;
  if (t === "close_icon") return true;
  if (t.includes("maximize_icon")) return true;
  if (t.includes("minimize_icon")) return true;
  if (t.includes("close_icon")) return true;
  if (t.includes("_icon")) return true;
  if (/^[a-z0-9_-]*icon[a-z0-9_-]*$/i.test(t)) return true;
  if (/\.(svg|png|jpg|jpeg|webp)$/i.test(t)) return true;
  if (t.includes("view product")) return true;
  if (t.includes("sort by")) return true;
  if (t.includes("price range")) return true;
  if (t.includes("official flyer prices")) return true;
  if (t.includes("prices are ai-generated")) return true;
  if (t.includes("available at") && t.includes("bahrain")) return true;
  if (s && (t === s || t.includes(`available at ${s}`))) return true;

  return false;
}

function candidateTitleFromHtml(segmentHtml, item, store) {
  const candidates = [];
  const html = String(segmentHtml || "");

  for (const attr of ["alt", "title", "aria-label"]) {
    const re = new RegExp(`${attr}=["']([^"']{4,140})["']`, "ig");
    for (const m of html.matchAll(re)) {
      const text = cleanText(m[1]);
      if (!badGeneratedName(text, store)) candidates.push(text);
    }
  }

  for (const cls of ["product-name", "product-title", "name", "title"]) {
    const re = new RegExp(`<[^>]+class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]{4,180}?)<\\/[^>]+>`, "ig");
    for (const m of html.matchAll(re)) {
      const text = stripHtml(m[1]);
      if (!badGeneratedName(text, store)) candidates.push(text);
    }
  }

  const itemWords = String(item.phrase || item.item || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const useful = candidates.find((text) => {
    const lower = text.toLowerCase();
    if (badGeneratedName(lower, store)) return false;
    if (item.brand && item.brand !== "Any" && lower.includes(item.brand.toLowerCase())) return true;
    return itemWords.some((w) => lower.includes(w)) || lower.includes(String(item.item || "").replace(/s$/, ""));
  });

  return useful || null;
}

function prettyItemName(item, confirmedBrand) {
  if (item.item === "eggs" && Number(item.quantity || 0) >= 12) return `Eggs ${Number(item.quantity)} pcs`;
  if (item.item === "croissants") return "Croissants";
  if (item.item === "bread") {
    if (confirmedBrand) return `${item.brand} bread`;
    return "Bread / buns";
  }

  const phrase = cleanText(item.phrase || item.item || "Grocery item");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function brandInfo(item, cardText) {
  const requestedBrand = item.brand && item.brand !== "Any" ? item.brand : null;
  const lower = String(cardText || "").toLowerCase();

  if (requestedBrand && lower.includes(requestedBrand.toLowerCase())) {
    return { brand: requestedBrand, exactBrand: true };
  }

  if (requestedBrand) {
    return { brand: "Alternative", exactBrand: false };
  }

  return { brand: "Generic", exactBrand: true };
}

function fallbackProductLabel(item, cardText, store) {
  const info = brandInfo(item, cardText);
  const name = prettyItemName(item, info.exactBrand);

  if (item.brand && item.brand !== "Any" && !info.exactBrand) {
    return `${name} alternative at ${store}`;
  }

  return `${name} option at ${store}`;
}

function segmentLikelyMatchesRequest(segmentText, item) {
  // Because pages are already item/category-specific, keep this broad.
  // Product names are often not exposed in server-readable text.
  return true;
}

function cardHtmlSegments(html) {
  const parts = String(html || "").split(/View Product/i);
  const out = [];

  for (let i = 1; i < parts.length; i += 1) {
    const before = parts[i - 1].slice(-1200);
    const after = parts[i].slice(0, 1800);
    out.push(before + " View Product " + after);
  }

  return out;
}

function extractRowsFromHtml(html, item, sourceConfig, limit) {
  const rows = [];
  const seen = new Set();
  const segments = cardHtmlSegments(html);

  for (const segmentHtml of segments) {
    if (rows.length >= limit) break;

    const segmentText = stripHtml(segmentHtml.slice(0, 2600));
    if (!segmentText) continue;

    const lower = segmentText.toLowerCase();
    if (
      lower.includes("sort by") ||
      lower.includes("price range") ||
      lower.includes("view more products") ||
      lower.includes("privacy policy") ||
      lower.includes("terms of service")
    ) continue;

    if (!segmentLikelyMatchesRequest(segmentText, item)) continue;

    const price = visibleCurrentPrice(segmentText);
    if (!price) continue;

    const store = normalizeStoreName(segmentText);
    if (!store) continue;

    const originalPrice = visibleOriginalPrice(segmentText);
    const title = candidateTitleFromHtml(segmentHtml, item, store);
    const image_url = firstImageFromHtml(segmentHtml, sourceConfig.url);
    const brandData = brandInfo(item, segmentText);

    const product = title || fallbackProductLabel(item, segmentText, store);
    const product_is_exact = !!title;
    const size = inferSizeFromRequest(item);

    const key = `${store}|${item.item}|${brandData.brand}|${product}|${size}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      store,
      item: item.item,
      brand: brandData.brand,
      product,
      product_is_exact,
      exact_brand: brandData.exactBrand,
      size,
      price,
      original_price: originalPrice,
      image_url,
      match: product_is_exact ? 82 : 72,
      confidence: product_is_exact ? "Medium" : "Low",
      source: "requested_item_online_price_card",
      source_url: sourceConfig.url,
      last_checked: new Date().toISOString(),
      is_active: true,
      needs_review: false,
      source_note: product_is_exact
        ? "Product title/image were extracted from the visible source card."
        : "Exact product name was not exposed by the source page; this is an item-specific price option."
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
        image_count: 0,
        price_count: 0,
        rows_extracted: 0,
        expired_or_unavailable: false,
        error: null,
        excerpt: null,
        tls_ignore_enabled: process.env.D4D_IGNORE_TLS_ERRORS !== "false"
      };

      try {
        const result = await requestText(config.url);
        diag.status = result.status;
        diag.html_length = result.html.length;
        diag.image_count = (result.html.match(/<img/gi) || []).length;

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

        const rows = extractRowsFromHtml(result.html, item, config, limitPerItem);
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
