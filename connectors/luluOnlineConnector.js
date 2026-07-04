// connectors/luluOnlineConnector.js
// Starter online connector for LuLu Bahrain.
// It fetches public LuLu pages and tries to extract product JSON from the page.
// Some online grocery sites change structure or block automated access.
// If this connector returns zero rows, the next step is to inspect the response and tune selectors/API calls.

const BASE = "https://gcc.luluhypermarket.com/en-bh";

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(value) {
  if (value == null) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "object") {
    const keys = [
      "value",
      "amount",
      "price",
      "final_price",
      "finalPrice",
      "selling_price",
      "sellingPrice",
      "special_price",
      "specialPrice"
    ];

    for (const key of keys) {
      if (value[key] != null) {
        const parsed = parsePrice(value[key]);
        if (parsed) return parsed;
      }
    }

    return null;
  }

  const text = String(value).replace(/,/g, "");
  const match = text.match(/(?:BD|BHD|Ø¯\.Ø¨)?\s*([0-9]+(?:\.[0-9]{1,3})?)/i);
  if (!match) return null;

  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function inferSize(title) {
  const text = cleanText(title);

  const patterns = [
    /\b\d+(?:\.\d+)?\s?(?:kg|kgs|g|gm|grams|ml|l|ltr|litre|liter|pcs|pc|pieces|rolls|sheets|tabs|capsules)\b/i,
    /\b\d+\s?[xX]\s?\d+(?:\.\d+)?\s?(?:ml|l|g|gm|kg|pcs|pc)\b/i,
    /\b\d+\s?pack\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }

  return "1 unit";
}

function inferBrand(title) {
  const stopWords = new Set([
    "fresh",
    "large",
    "small",
    "medium",
    "premium",
    "organic",
    "full",
    "low",
    "fat",
    "long",
    "grain",
    "basmati",
    "white",
    "brown",
    "powder",
    "liquid"
  ]);

  const first = cleanText(title).split(" ")[0] || "Generic";
  if (!first || stopWords.has(first.toLowerCase()) || /^\d/.test(first)) return "Generic";
  return first;
}

function normalizeProductName(title, size) {
  let value = cleanText(title);
  if (size && size !== "1 unit") {
    value = value.replace(size, "");
  }
  return cleanText(value) || cleanText(title);
}

function itemFromQuery(query) {
  return String(query || "grocery").toLowerCase().trim();
}

function getLikelyTitle(obj) {
  const keys = [
    "name",
    "title",
    "productName",
    "product_name",
    "displayName",
    "display_name",
    "skuName",
    "sku_name",
    "label"
  ];

  for (const key of keys) {
    if (typeof obj[key] === "string" && cleanText(obj[key]).length > 2) {
      return cleanText(obj[key]);
    }
  }

  return null;
}

function getLikelyUrl(obj) {
  const keys = ["url", "slug", "productUrl", "product_url", "absolute_url", "link"];

  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key]) {
      const value = obj[key];
      if (value.startsWith("http")) return value;
      if (value.startsWith("/")) return `https://gcc.luluhypermarket.com${value}`;
      return `${BASE}/${value.replace(/^\/+/, "")}`;
    }
  }

  return BASE;
}

function getLikelyPrice(obj) {
  const keys = [
    "price",
    "final_price",
    "finalPrice",
    "selling_price",
    "sellingPrice",
    "special_price",
    "specialPrice",
    "offer_price",
    "offerPrice",
    "base_price",
    "basePrice"
  ];

  for (const key of keys) {
    if (obj[key] != null) {
      const parsed = parsePrice(obj[key]);
      if (parsed) return parsed;
    }
  }

  if (obj.offers) {
    const parsed = parsePrice(obj.offers);
    if (parsed) return parsed;
  }

  return null;
}

function traverse(value, callback, depth = 0) {
  if (depth > 10 || value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) traverse(item, callback, depth + 1);
    return;
  }

  if (typeof value === "object") {
    callback(value);
    for (const key of Object.keys(value)) {
      traverse(value[key], callback, depth + 1);
    }
  }
}

function extractJsonScriptBlocks(html) {
  const blocks = [];

  const nextMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch) blocks.push(nextMatch[1]);

  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html))) {
    blocks.push(match[1]);
  }

  const genericJsonRegex = /<script[^>]*>([\s\S]*?(?:price|product|sku)[\s\S]*?)<\/script>/gi;
  while ((match = genericJsonRegex.exec(html))) {
    const content = match[1];
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      blocks.push(content.slice(start, end + 1));
    }
  }

  return blocks;
}

function extractProductsFromJson(jsonValue, query, limit) {
  const products = [];
  const seen = new Set();

  traverse(jsonValue, (obj) => {
    const title = getLikelyTitle(obj);
    const price = getLikelyPrice(obj);

    if (!title || !price) return;

    const lowerTitle = title.toLowerCase();
    const lowerQuery = String(query).toLowerCase();

    // Keep the connector focused on the search term where possible.
    if (lowerQuery && !lowerTitle.includes(lowerQuery.split(" ")[0])) {
      // Don't reject all items, but lower confidence later.
    }

    const size = inferSize(title);
    const product = normalizeProductName(title, size);
    const brand = obj.brand?.name || obj.brand || inferBrand(title);
    const sourceUrl = getLikelyUrl(obj);
    const key = `${product}|${size}|${price}|${sourceUrl}`;

    if (seen.has(key)) return;
    seen.add(key);

    products.push({
      store: "LuLu",
      item: itemFromQuery(query),
      brand: cleanText(brand) || "Generic",
      product,
      size,
      price,
      match: lowerTitle.includes(lowerQuery.split(" ")[0]) ? 90 : 72,
      confidence: lowerTitle.includes(lowerQuery.split(" ")[0]) ? "Medium" : "Low",
      source: "lulu_online",
      source_url: sourceUrl,
      last_checked: new Date().toISOString(),
      is_active: true,
      needs_review: false
    });
  });

  return products.slice(0, limit);
}

function extractProductsFromHtmlFallback(html, query, limit) {
  const products = [];
  const seen = new Set();

  // Basic fallback: pairs of visible product text and BD/BHD price near it.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

  const priceRegex = /(.{15,120}?)(?:BD|BHD)\s*([0-9]+(?:\.[0-9]{1,3})?)/gi;
  let match;

  while ((match = priceRegex.exec(text)) && products.length < limit) {
    const rawTitle = cleanText(match[1]);
    const price = Number(match[2]);
    if (!rawTitle || !price) continue;

    const size = inferSize(rawTitle);
    const product = normalizeProductName(rawTitle, size);
    const key = `${product}|${size}|${price}`;

    if (seen.has(key)) continue;
    seen.add(key);

    products.push({
      store: "LuLu",
      item: itemFromQuery(query),
      brand: inferBrand(product),
      product,
      size,
      price,
      match: product.toLowerCase().includes(String(query).toLowerCase().split(" ")[0]) ? 82 : 65,
      confidence: "Low",
      source: "lulu_online_fallback",
      source_url: BASE,
      last_checked: new Date().toISOString(),
      is_active: true,
      needs_review: false
    });
  }

  return products;
}

function searchUrls(query) {
  const encoded = encodeURIComponent(query);

  return [
    `${BASE}/search?q=${encoded}`,
    `${BASE}/search/?q=${encoded}`,
    `${BASE}/search?text=${encoded}`,
    `${BASE}/list/?search=${encoded}`,
    `${BASE}/list?q=${encoded}`
  ];
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 SmartBasketBH/1.0 (+https://smartbasket.example)",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-BH,en;q=0.9"
    }
  });

  const html = await response.text();

  if (!response.ok) {
    throw new Error(`LuLu returned HTTP ${response.status}`);
  }

  return html;
}

async function fetchLuLuOnlineProducts({ query = "milk", limit = 12 } = {}) {
  const urls = searchUrls(query);
  let lastError = null;

  for (const url of urls) {
    try {
      const html = await fetchPage(url);
      const blocks = extractJsonScriptBlocks(html);

      for (const block of blocks) {
        try {
          const json = JSON.parse(block);
          const rows = extractProductsFromJson(json, query, limit);
          if (rows.length) return rows;
        } catch (_) {}
      }

      const fallback = extractProductsFromHtmlFallback(html, query, limit);
      if (fallback.length) return fallback;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

module.exports = {
  fetchLuLuOnlineProducts
};
