// connectors/d4dConnector.js
// SmartBasket D4D Bahrain connector.
// Purpose: use D4D as a public special-price aggregator source.
// These prices should be shown as "special prices" with Medium confidence,
// not guaranteed checkout prices.

const BASE = "https://d4donline.com/en/bahrain/bahrain";

function cleanText(value) {
  return String(value || "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function parsePrice(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") {
    const keys = ["price", "value", "amount", "offer_price", "offerPrice", "sale_price", "salePrice", "special_price", "specialPrice", "final_price", "finalPrice"];
    for (const key of keys) {
      if (value[key] != null) {
        const parsed = parsePrice(value[key]);
        if (parsed) return parsed;
      }
    }
    return null;
  }
  const text = String(value).replace(/,/g, "");
  const match = text.match(/(?:BD|BHD|د\.ب|bhd)?\s*([0-9]+(?:\.[0-9]{1,3})?)/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function inferSize(title) {
  const text = cleanText(title);
  const patterns = [
    /\b\d+\s?[xX]\s?\d+(?:\.\d+)?\s?(?:ml|l|ltr|liter|litre|g|gm|kg|pcs|pc|rolls|sheets|tabs|packs?)\b/i,
    /\b\d+(?:\.\d+)?\s?(?:kg|kgs|g|gm|grams|ml|l|ltr|litre|liter|pcs|pc|pieces|rolls|sheets|tabs|capsules|packs?)\b/i,
    /\b\d+\s?pack\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return "1 unit";
}

function inferBrand(title) {
  const words = cleanText(title).split(" ").filter(Boolean);
  const stopWords = new Set(["fresh", "large", "small", "medium", "premium", "organic", "full", "low", "fat", "long", "grain", "basmati", "white", "brown", "powder", "liquid", "offer", "special", "pack"]);
  for (const word of words.slice(0, 3)) {
    const lower = word.toLowerCase();
    if (!stopWords.has(lower) && !/^\d/.test(word) && word.length > 1) return word;
  }
  return "Generic";
}

function normalizeProductName(title, size) {
  let value = cleanText(title);
  if (size && size !== "1 unit") value = value.replace(size, "");
  value = value.replace(/\bBD\s*[0-9]+(?:\.[0-9]{1,3})?\b/gi, "").replace(/\bBHD\s*[0-9]+(?:\.[0-9]{1,3})?\b/gi, "");
  return cleanText(value) || cleanText(title);
}

function itemFromQuery(query) {
  return String(query || "grocery").toLowerCase().trim();
}

function normalizeStoreName(value) {
  const text = cleanText(value);
  if (!text) return "D4D Store";
  const known = ["LuLu", "Lulu", "Carrefour", "Nesto", "Al Jazira", "Aljazira", "Talabat Mart", "HyperMax", "Ramez", "Mega Mart", "Al Helli", "Talal Market", "Talal Markets", "Ansar Gallery", "VIVA", "Sharaf DG"];
  const lower = text.toLowerCase();
  for (const name of known) {
    if (lower.includes(name.toLowerCase())) {
      if (name === "Lulu") return "LuLu";
      if (name === "Aljazira") return "Al Jazira";
      return name;
    }
  }
  return text.length > 40 ? "D4D Store" : text;
}

function likelyTitle(obj) {
  const keys = ["name", "title", "productName", "product_name", "displayName", "display_name", "item_name", "itemName", "label"];
  for (const key of keys) {
    if (typeof obj[key] === "string" && cleanText(obj[key]).length > 2) return cleanText(obj[key]);
  }
  return null;
}

function likelyStore(obj) {
  const keys = ["store", "store_name", "storeName", "merchant", "merchant_name", "merchantName", "retailer", "retailer_name", "market", "shop", "shop_name"];
  for (const key of keys) {
    if (typeof obj[key] === "string" && cleanText(obj[key]).length > 1) return normalizeStoreName(obj[key]);
    if (obj[key] && typeof obj[key] === "object") {
      const nested = likelyTitle(obj[key]) || obj[key].name || obj[key].title;
      if (nested) return normalizeStoreName(nested);
    }
  }
  return "D4D Store";
}

function likelyUrl(obj) {
  const keys = ["url", "slug", "productUrl", "product_url", "absolute_url", "link", "share_url"];
  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key]) {
      const value = obj[key];
      if (value.startsWith("http")) return value;
      if (value.startsWith("/")) return `https://d4donline.com${value}`;
      return `${BASE}/${value.replace(/^\/+/, "")}`;
    }
  }
  return BASE;
}

function likelyPrice(obj) {
  const keys = ["price", "offer_price", "offerPrice", "sale_price", "salePrice", "special_price", "specialPrice", "final_price", "finalPrice", "amount", "value"];
  for (const key of keys) {
    if (obj[key] != null) {
      const parsed = parsePrice(obj[key]);
      if (parsed) return parsed;
    }
  }
  return null;
}

function traverse(value, callback, depth = 0) {
  if (depth > 12 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) traverse(item, callback, depth + 1);
    return;
  }
  if (typeof value === "object") {
    callback(value);
    for (const key of Object.keys(value)) traverse(value[key], callback, depth + 1);
  }
}

function extractJsonScriptBlocks(html) {
  const blocks = [];
  const nextMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch) blocks.push(nextMatch[1]);
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*({[\s\S]*?});?\s*<\/script>/i);
  if (nuxtMatch) blocks.push(nuxtMatch[1]);
  const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = ldRegex.exec(html))) blocks.push(match[1]);
  const dataRegex = /<script[^>]*>([\s\S]*?(?:products|price|offers|merchant|retailer)[\s\S]*?)<\/script>/gi;
  while ((match = dataRegex.exec(html))) {
    const content = match[1];
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) blocks.push(content.slice(start, end + 1));
  }
  return blocks;
}

function extractProductsFromJson(jsonValue, query, limit) {
  const products = [];
  const seen = new Set();
  const queryWord = String(query || "").toLowerCase().split(" ")[0];
  traverse(jsonValue, (obj) => {
    const title = likelyTitle(obj);
    const price = likelyPrice(obj);
    if (!title || !price) return;
    const size = inferSize(title);
    const product = normalizeProductName(title, size);
    const brand = obj.brand?.name || obj.brand_name || obj.brand || inferBrand(title);
    const store = likelyStore(obj);
    const sourceUrl = likelyUrl(obj);
    const key = `${store}|${product}|${size}|${price}`;
    if (seen.has(key)) return;
    seen.add(key);
    const titleLower = title.toLowerCase();
    products.push({
      store,
      item: itemFromQuery(query),
      brand: cleanText(brand) || "Generic",
      product,
      size,
      price,
      match: queryWord && titleLower.includes(queryWord) ? 90 : 75,
      confidence: "Medium",
      source: "d4d_special_price",
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
  const queryWord = String(query || "").toLowerCase().split(" ")[0];
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const priceRegex = /(.{20,180}?)(?:BD|BHD|د\.ب)\s*([0-9]+(?:\.[0-9]{1,3})?)/gi;
  let match;
  while ((match = priceRegex.exec(text)) && products.length < limit) {
    const rawTitle = cleanText(match[1]);
    const price = Number(match[2]);
    if (!rawTitle || !price) continue;
    const lower = rawTitle.toLowerCase();
    if (lower.includes("official") || lower.includes("privacy") || lower.includes("terms") || lower.includes("download") || lower.includes("copyright") || rawTitle.length < 10) continue;
    const size = inferSize(rawTitle);
    const product = normalizeProductName(rawTitle, size);
    const store = normalizeStoreName(rawTitle);
    const brand = inferBrand(product);
    const key = `${store}|${product}|${size}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({
      store,
      item: itemFromQuery(query),
      brand,
      product,
      size,
      price,
      match: queryWord && product.toLowerCase().includes(queryWord) ? 82 : 70,
      confidence: "Low",
      source: "d4d_special_price_fallback",
      source_url: BASE,
      last_checked: new Date().toISOString(),
      is_active: true,
      needs_review: false
    });
  }
  return products;
}

function categoryUrlsForQuery(query) {
  const q = String(query || "").toLowerCase();
  const map = [
    { words: ["milk", "laban", "yogurt", "cheese", "butter"], id: 40, slug: "milk-laban" },
    { words: ["rice"], id: 34, slug: "rice" },
    { words: ["oil", "olive oil"], id: 37, slug: "oil" },
    { words: ["water"], id: 53, slug: "water" },
    { words: ["chicken", "meat"], id: 28, slug: "meat-poultry" },
    { words: ["eggs"], id: 39, slug: "eggs" },
    { words: ["detergent", "laundry"], id: 70, slug: "laundry" },
    { words: ["tissue"], id: 73, slug: "tissues" },
    { words: ["diapers", "baby"], id: 81, slug: "baby-products" },
    { words: ["coffee", "tea"], id: 47, slug: "tea-coffee" },
    { words: ["bread", "bakery"], id: 45, slug: "bakery" },
    { words: ["pasta"], id: 36, slug: "pasta-noodles" },
    { words: ["sugar", "flour"], id: 35, slug: "sugar-flour" }
  ];
  const found = map.find((entry) => entry.words.some((word) => q.includes(word)));
  if (!found) return [];
  return [
    `${BASE}/products/${found.id}/${found.slug}`,
    `${BASE}/products/${found.id}/${found.slug}?search=${encodeURIComponent(query)}`,
    `${BASE}/products/${found.id}/${found.slug}?keyword=${encodeURIComponent(query)}`
  ];
}

function searchUrls(query) {
  const encoded = encodeURIComponent(query);
  return [
    ...categoryUrlsForQuery(query),
    `${BASE}/products?search=${encoded}`,
    `${BASE}/products?keyword=${encoded}`,
    `${BASE}/search?keyword=${encoded}`,
    `${BASE}/search?q=${encoded}`,
    `${BASE}?search=${encoded}`
  ];
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
  if (!response.ok) throw new Error(`D4D returned HTTP ${response.status} for ${url}`);
  return { html, url };
}

async function fetchD4DProducts({ query = "milk", limit = 20 } = {}) {
  const urls = searchUrls(query);
  let lastError = null;
  for (const url of urls) {
    try {
      const { html } = await fetchPage(url);
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
  if (lastError) throw lastError;
  return [];
}

module.exports = { fetchD4DProducts };
