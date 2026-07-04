// connectors/d4dRequestSearchConnector.js
// SmartBasket v5 request-specific online price search.
// This does NOT crawl all groceries.
// It searches only the items the customer asked for and creates honest "price card" rows.
// If the source page does not expose exact product names, the product is labelled as a requested item offer.

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
  "Talabat Mart",
  "D4D Store"
];

const ITEM_SEARCH_CONFIG = {
  eggs: [
    { label: "Eggs", url: `${BASE}/products/114/eggs` },
    { label: "Eggs", url: `${BASE}/products/114/eggs?search=egg` }
  ],
  bread: [
    { label: "Bread & Buns", url: `${BASE}/products/76/bread-buns` },
    { label: "Bread & Buns", url: `${BASE}/products/76/bread-buns?search=lusine` },
    { label: "Bread & Buns", url: `${BASE}/products/76/bread-buns?search=bread` }
  ],
  croissants: [
    { label: "Cakes & Pastry", url: `${BASE}/products/8/cakes-pastry?search=croissant` },
    { label: "Cakes & Pastry", url: `${BASE}/products/8/cakes-pastry` },
    { label: "Bread & Buns", url: `${BASE}/products/76/bread-buns?search=croissant` }
  ],
  milk: [
    { label: "Milk & Laban", url: `${BASE}/products/40/milk-laban` },
    { label: "Milk & Laban", url: `${BASE}/products/40/milk-laban?search=milk` }
  ],
  water: [
    { label: "Water", url: `${BASE}/products/102/water` },
    { label: "Drinks & Beverages", url: `${BASE}/products?search=water` }
  ],
  rice: [
    { label: "Rice", url: `${BASE}/products/66/rice` },
    { label: "Rice", url: `${BASE}/products?search=rice` }
  ],
  chicken: [
    { label: "Chicken", url: `${BASE}/products?search=chicken` }
  ],
  oil: [
    { label: "Oil & Ghee", url: `${BASE}/products?search=oil` }
  ],
  tissue: [
    { label: "Tissue & Disposables", url: `${BASE}/products/111/tissue-disposables` },
    { label: "Tissue", url: `${BASE}/products?search=tissue` }
  ],
  diapers: [
    { label: "Baby Diapers", url: `${BASE}/products/44/baby-diapers` },
    { label: "Baby Diapers", url: `${BASE}/products?search=diaper` }
  ],
  detergent: [
    { label: "Laundry", url: `${BASE}/products?search=detergent` },
    { label: "Laundry", url: `${BASE}/products?search=laundry` }
  ]
};

function cleanText(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStoreName(text) {
  const value = cleanText(text);
  const lower = value.toLowerCase();

  for (const store of STORE_NAMES) {
    if (lower.includes(store.toLowerCase())) {
      if (store === "Lulu Hypermarket") return "LuLu Hypermarket";
      if (store === "Nesto") return "NESTO";
      return store;
    }
  }

  return "D4D Store";
}

function stripHtml(html) {
  return cleanText(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 SmartBasketBH/1.0",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-BH,en;q=0.9,ar-BH;q=0.8"
    }
  });

  const html = await response.text();

  if (!response.ok) {
    throw new Error(`D4D returned HTTP ${response.status}`);
  }

  return html;
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

function visibleCurrentPrice(segment) {
  const prices = Array.from(
    String(segment || "").matchAll(/\b(?:BD|BHD)\s*([0-9]+(?:\.[0-9]{1,3})?)/gi)
  ).map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0);

  if (!prices.length) return null;

  // On D4D cards the old price often appears before the offer price.
  // Use the last visible price as the current/sale price.
  return prices[prices.length - 1];
}

function visibleOriginalPrice(segment) {
  const prices = Array.from(
    String(segment || "").matchAll(/\b(?:BD|BHD)\s*([0-9]+(?:\.[0-9]{1,3})?)/gi)
  ).map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0);

  if (prices.length >= 2) return prices[0];
  return null;
}

function inferSizeFromRequest(item) {
  if (item.item === "eggs" && Number(item.quantity || 0) >= 12) {
    return `${Number(item.quantity)} pcs`;
  }

  if (item.unit && item.unit !== "pcs") {
    return `${item.quantity || 1} ${item.unit}`;
  }

  return "price card";
}

function requestedProductLabel(item, categoryLabel) {
  const requested = cleanText(item.phrase || item.item || "grocery item");

  if (item.item === "eggs" && Number(item.quantity || 0) >= 12) {
    return `${requested} offer - requested ${Number(item.quantity)} pcs`;
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

function extractPriceCardsFromHtml(html, item, sourceConfig, limit) {
  const text = stripHtml(html);
  const rows = [];
  const seen = new Set();

  // D4D visible pages are often text like:
  // View Product 19.2 % Off BHD 1.720 BHD 1.390 HyperMax
  // Split by View Product and parse each visible card.
  const segments = text.split(/View Product/i).slice(1);

  for (const raw of segments) {
    if (rows.length >= limit) break;

    const segment = cleanText(raw.slice(0, 350));
    if (!segment || segment.length < 8) continue;

    const lower = segment.toLowerCase();
    if (
      lower.includes("sort by") ||
      lower.includes("price range") ||
      lower.includes("view more products") ||
      lower.includes("login") ||
      lower.includes("privacy policy") ||
      lower.includes("terms of service")
    ) {
      continue;
    }

    const price = visibleCurrentPrice(segment);
    if (!price) continue;

    const store = normalizeStoreName(segment);
    if (store === "D4D Store") continue;

    const originalPrice = visibleOriginalPrice(segment);
    const product = requestedProductLabel(item, sourceConfig.label);
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
      match: item.brand && item.brand !== "Any" ? 70 : 76,
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
  const base = ITEM_SEARCH_CONFIG[key] || [
    { label: item.phrase || item.item || "Grocery", url: `${BASE}/products?search=${encodeURIComponent(item.phrase || item.item || "grocery")}` }
  ];

  // For brand-specific requests, prefer an on-page search URL first.
  if (item.brand && item.brand !== "Any") {
    const brandSearch = encodeURIComponent(item.brand);
    const first = base[0];
    return [
      { label: first.label, url: `${first.url.split("?")[0]}?search=${brandSearch}` },
      ...base
    ];
  }

  return base;
}

async function fetchD4DRequestRows(items, { limitPerItem = 8 } = {}) {
  const all = [];
  const seen = new Set();

  for (const item of items || []) {
    const configs = configsForItem(item);

    for (const config of configs) {
      if (all.filter((row) => row.item === item.item).length >= limitPerItem) break;

      try {
        const html = await fetchPage(config.url);
        if (pageLooksExpiredOrUnavailable(html)) continue;

        const rows = extractPriceCardsFromHtml(html, item, config, limitPerItem);

        for (const row of rows) {
          const key = `${row.store}|${row.item}|${row.brand}|${row.product}|${row.size}|${row.price}`;
          if (!seen.has(key)) {
            seen.add(key);
            all.push(row);
          }
        }
      } catch (error) {
        console.warn(`D4D request search failed for ${config.url}:`, error.message);
      }
    }
  }

  return all;
}

module.exports = {
  fetchD4DRequestRows
};
