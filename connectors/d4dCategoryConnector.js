// connectors/d4dCategoryConnector.js
// SmartBasket D4D Bahrain category crawler.
// It discovers grocery-related D4D category pages and extracts visible special prices.
// D4D prices should be shown as visible special prices, not guaranteed checkout prices.

const BASE = "https://d4donline.com/en/bahrain/bahrain";
const ALT_BASE = "https://bh.d4donline.com/en/bahrain/bahrain";

const CATEGORY_ALLOW_WORDS = [
  "grocery",
  "rice",
  "oil",
  "ghee",
  "canned",
  "packeted",
  "flour",
  "baking",
  "sauces",
  "spreads",
  "pasta",
  "noodles",
  "cereals",
  "bars",
  "salts",
  "spices",
  "paste",
  "sugar",
  "sweetener",
  "pulses",
  "beans",
  "grains",
  "fruits",
  "vegetable",
  "vegetables",
  "dairy",
  "eggs",
  "milk",
  "laban",
  "yogurt",
  "labneh",
  "cheese",
  "cream",
  "butter",
  "margarine",
  "condensed",
  "chicken",
  "meat",
  "fish",
  "poultry",
  "deli",
  "frozen",
  "drinks",
  "beverages",
  "tea",
  "coffee",
  "juices",
  "water",
  "soft drinks",
  "bakery",
  "bread",
  "buns",
  "biscuits",
  "snacks",
  "laundry",
  "cleaning",
  "dishwasher",
  "tissue",
  "disposables",
  "toilet",
  "paper",
  "facial",
  "baby diapers",
  "baby feeding",
  "baby care"
];

const CATEGORY_BLOCK_WORDS = [
  "electronics",
  "mobiles",
  "tv",
  "printer",
  "smart watch",
  "computer",
  "appliance",
  "camera",
  "gaming",
  "fragrance",
  "cosmetics",
  "clothing",
  "footwear",
  "luggage",
  "watch",
  "furniture",
  "tools",
  "hardware",
  "school",
  "stationary",
  "sports",
  "fitness",
  "car care"
];

const FALLBACK_CATEGORIES = [
  { name: "Food - Grocery", url: `${BASE}/products/33/food-grocery`, item: "grocery" },
  { name: "Milk & Laban", url: `${BASE}/products/40/milk-laban`, item: "milk" },
  { name: "Tissue & Disposables", url: `${BASE}/products/111/tissue-disposables`, item: "tissue" },
  { name: "Bakery & Confectionary", url: `${BASE}/products/107/bakery-confectionary`, item: "bakery" }
];

function cleanText(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(href) {
  if (!href) return BASE;
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `https://d4donline.com${href}`;
  return `${BASE}/${href.replace(/^\/+/, "")}`;
}

function parsePrice(value) {
  if (value == null) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "object") {
    const keys = [
      "price",
      "value",
      "amount",
      "offer_price",
      "offerPrice",
      "sale_price",
      "salePrice",
      "special_price",
      "specialPrice",
      "final_price",
      "finalPrice",
      "discounted_price",
      "discountedPrice"
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
  const matches = Array.from(text.matchAll(/(?:BD|BHD|د\.ب)\s*([0-9]+(?:\.[0-9]{1,3})?)/gi));
  if (matches.length) {
    const number = Number(matches[matches.length - 1][1]);
    return Number.isFinite(number) ? number : null;
  }

  const simple = text.match(/\b([0-9]+(?:\.[0-9]{1,3})?)\b/);
  if (!simple) return null;

  const number = Number(simple[1]);
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
    "liquid",
    "offer",
    "special",
    "pack",
    "unit",
    "qty",
    "discount"
  ]);

  for (const word of words.slice(0, 3)) {
    const lower = word.toLowerCase();
    if (!stopWords.has(lower) && !/^\d/.test(word) && word.length > 1) return word;
  }

  return "Generic";
}

function normalizeProductName(title, size) {
  let value = cleanText(title);

  if (size && size !== "1 unit") {
    value = value.replace(size, "");
  }

  value = value
    .replace(/\bUnit:\s*/gi, "")
    .replace(/\bQty:\s*\d+/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s?%\s?Off\b/gi, "")
    .replace(/\bBD\s*[0-9]+(?:\.[0-9]{1,3})?\b/gi, "")
    .replace(/\bBHD\s*[0-9]+(?:\.[0-9]{1,3})?\b/gi, "")
    .replace(/⚠️.*$/g, "")
    .replace(/Prices are AI-generated.*$/gi, "")
    .replace(/Official flyer prices prevail.*$/gi, "");

  return cleanText(value) || cleanText(title);
}

function normalizeStoreName(value) {
  const text = cleanText(value);
  if (!text) return "D4D Store";

  const known = [
    "LuLu Hypermarket",
    "LuLu",
    "Lulu",
    "Carrefour",
    "Nesto",
    "Al Jazira",
    "Aljazira",
    "Talabat Mart",
    "HyperMax",
    "Ramez",
    "MegaMart & Macro Mart",
    "Mega Mart",
    "Al Helli",
    "Talal Market",
    "Talal Markets",
    "Ansar Gallery",
    "Prime Markets",
    "Multi Market",
    "Sharaf DG"
  ];

  const lower = text.toLowerCase();
  for (const name of known) {
    if (lower.includes(name.toLowerCase())) {
      if (name === "Lulu") return "LuLu";
      if (name === "Aljazira") return "Al Jazira";
      return name;
    }
  }

  if (text.length > 45) return "D4D Store";
  return text;
}

function itemFromCategory(categoryName, categoryUrl) {
  const value = `${categoryName} ${categoryUrl}`.toLowerCase();

  if (value.includes("milk") || value.includes("laban")) return "milk";
  if (value.includes("yogurt") || value.includes("labneh")) return "yogurt";
  if (value.includes("cheese")) return "cheese";
  if (value.includes("butter")) return "butter";
  if (value.includes("egg")) return "eggs";
  if (value.includes("rice")) return "rice";
  if (value.includes("oil") || value.includes("ghee")) return "oil";
  if (value.includes("water")) return "water";
  if (value.includes("chicken") || value.includes("poultry")) return "chicken";
  if (value.includes("meat")) return "meat";
  if (value.includes("fish")) return "fish";
  if (value.includes("bread") || value.includes("bakery")) return "bread";
  if (value.includes("coffee") || value.includes("tea")) return "coffee";
  if (value.includes("detergent") || value.includes("laundry")) return "detergent";
  if (value.includes("tissue")) return "tissue";
  if (value.includes("diaper")) return "diapers";
  if (value.includes("pasta")) return "pasta";
  if (value.includes("flour")) return "flour";
  if (value.includes("sugar")) return "sugar";
  if (value.includes("fruit")) return "fruits";
  if (value.includes("vegetable")) return "vegetables";
  if (value.includes("juice") || value.includes("drinks") || value.includes("beverages")) return "drinks";

  return "grocery";
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
    throw new Error(`D4D returned HTTP ${response.status} for ${url}`);
  }

  return html;
}

function categoryLooksRelevant(name, url) {
  const combined = `${name} ${url}`.toLowerCase();

  if (CATEGORY_BLOCK_WORDS.some((word) => combined.includes(word))) return false;
  return CATEGORY_ALLOW_WORDS.some((word) => combined.includes(word));
}

function extractCategoryLinks(html) {
  const found = new Map();

  const linkRegex = /<a[^>]+href=["']([^"']*\/products\/\d+\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html))) {
    const href = match[1];
    const inner = match[2].replace(/<[^>]+>/g, " ");
    const nameFromText = cleanText(inner);
    const url = absoluteUrl(href.split("#")[0]);
    const slug = url.split("/").pop().split("?")[0].replace(/-/g, " ");
    const name = nameFromText || slug;

    if (!categoryLooksRelevant(name, url)) continue;

    found.set(url, {
      name,
      url,
      item: itemFromCategory(name, url)
    });
  }

  return Array.from(found.values());
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
    if (start >= 0 && end > start) {
      blocks.push(content.slice(start, end + 1));
    }
  }

  return blocks;
}

function traverse(value, callback, depth = 0) {
  if (depth > 12 || value == null) return;

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

function likelyTitle(obj) {
  const keys = [
    "name",
    "title",
    "productName",
    "product_name",
    "displayName",
    "display_name",
    "item_name",
    "itemName",
    "label"
  ];

  for (const key of keys) {
    if (typeof obj[key] === "string" && cleanText(obj[key]).length > 2) {
      return cleanText(obj[key]);
    }
  }

  return null;
}

function likelyPrice(obj) {
  const keys = [
    "price",
    "offer_price",
    "offerPrice",
    "sale_price",
    "salePrice",
    "special_price",
    "specialPrice",
    "final_price",
    "finalPrice",
    "amount",
    "value"
  ];

  for (const key of keys) {
    if (obj[key] != null) {
      const parsed = parsePrice(obj[key]);
      if (parsed) return parsed;
    }
  }

  return null;
}

function likelyStore(obj) {
  const keys = [
    "store",
    "store_name",
    "storeName",
    "merchant",
    "merchant_name",
    "merchantName",
    "retailer",
    "retailer_name",
    "market",
    "shop",
    "shop_name"
  ];

  for (const key of keys) {
    if (typeof obj[key] === "string" && cleanText(obj[key]).length > 1) {
      return normalizeStoreName(obj[key]);
    }

    if (obj[key] && typeof obj[key] === "object") {
      const nested = likelyTitle(obj[key]) || obj[key].name || obj[key].title;
      if (nested) return normalizeStoreName(nested);
    }
  }

  return "D4D Store";
}

function likelyUrl(obj, fallbackUrl) {
  const keys = ["url", "slug", "productUrl", "product_url", "absolute_url", "link", "share_url"];

  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key]) {
      const value = obj[key];
      if (value.startsWith("http")) return value;
      if (value.startsWith("/")) return `https://d4donline.com${value}`;
      return `${BASE}/${value.replace(/^\/+/, "")}`;
    }
  }

  return fallbackUrl || BASE;
}

function extractProductsFromJson(jsonValue, category, limit) {
  const products = [];
  const seen = new Set();

  traverse(jsonValue, (obj) => {
    const title = likelyTitle(obj);
    const price = likelyPrice(obj);

    if (!title || !price) return;

    const size = inferSize(title);
    const product = normalizeProductName(title, size);
    const brand = obj.brand?.name || obj.brand_name || obj.brand || inferBrand(title);
    const store = likelyStore(obj);
    const sourceUrl = likelyUrl(obj, category.url);
    const key = `${store}|${product}|${size}|${price}`;

    if (seen.has(key)) return;
    seen.add(key);

    products.push({
      store,
      item: category.item || itemFromCategory(category.name, category.url),
      brand: cleanText(brand) || "Generic",
      product,
      size,
      price,
      match: 85,
      confidence: "Medium",
      source: "d4d_special_price_category",
      source_url: sourceUrl,
      last_checked: new Date().toISOString(),
      is_active: true,
      needs_review: false
    });
  });

  return products.slice(0, limit);
}

function extractProductsFromHtmlFallback(html, category, limit) {
  const products = [];
  const seen = new Set();

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

  // Captures product-ish text before the visible BHD price.
  const priceRegex = /(.{25,220}?)(?:BD|BHD|د\.ب)\s*([0-9]+(?:\.[0-9]{1,3})?)/gi;
  let match;

  while ((match = priceRegex.exec(text)) && products.length < limit) {
    const rawTitle = cleanText(match[1]);
    const price = Number(match[2]);
    if (!rawTitle || !price) continue;

    const lower = rawTitle.toLowerCase();
    if (
      lower.includes("official flyer") ||
      lower.includes("prices are ai-generated") ||
      lower.includes("privacy") ||
      lower.includes("terms") ||
      lower.includes("copyright") ||
      lower.includes("download") ||
      rawTitle.length < 12
    ) {
      continue;
    }

    const size = inferSize(rawTitle);
    const product = normalizeProductName(rawTitle, size);
    const brand = inferBrand(product);
    const store = normalizeStoreName(rawTitle);
    const key = `${store}|${product}|${size}|${price}`;

    if (seen.has(key)) continue;
    seen.add(key);

    products.push({
      store,
      item: category.item || itemFromCategory(category.name, category.url),
      brand,
      product,
      size,
      price,
      match: 75,
      confidence: "Low",
      source: "d4d_special_price_category_fallback",
      source_url: category.url,
      last_checked: new Date().toISOString(),
      is_active: true,
      needs_review: false
    });
  }

  return products;
}

async function listD4DCategories() {
  const seedUrls = [
    `${BASE}/products/40/milk-laban`,
    `${BASE}/products/111/tissue-disposables`,
    `${BASE}/products/107/bakery-confectionary`,
    `${ALT_BASE}/products/40/milk-laban`
  ];

  const all = new Map();

  for (const url of seedUrls) {
    try {
      const html = await fetchPage(url);
      for (const cat of extractCategoryLinks(html)) {
        all.set(cat.url, cat);
      }
    } catch (_) {}
  }

  for (const fallback of FALLBACK_CATEGORIES) {
    if (!all.has(fallback.url)) all.set(fallback.url, fallback);
  }

  return Array.from(all.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchCategoryRows(category, limitPerCategory) {
  const pageUrls = [
    category.url,
    `${category.url}?page=1`,
    `${category.url}?page=2`
  ];

  const rows = [];
  const seen = new Set();

  for (const url of pageUrls) {
    if (rows.length >= limitPerCategory) break;

    try {
      const html = await fetchPage(url);
      const blocks = extractJsonScriptBlocks(html);

      for (const block of blocks) {
        try {
          const json = JSON.parse(block);
          const parsed = extractProductsFromJson(json, { ...category, url }, limitPerCategory - rows.length);
          for (const row of parsed) {
            const key = `${row.store}|${row.product}|${row.size}|${row.price}`;
            if (!seen.has(key)) {
              seen.add(key);
              rows.push(row);
            }
          }
        } catch (_) {}
      }

      if (rows.length < limitPerCategory) {
        const fallback = extractProductsFromHtmlFallback(html, { ...category, url }, limitPerCategory - rows.length);
        for (const row of fallback) {
          const key = `${row.store}|${row.product}|${row.size}|${row.price}`;
          if (!seen.has(key)) {
            seen.add(key);
            rows.push(row);
          }
        }
      }
    } catch (error) {
      console.warn(`D4D category fetch failed for ${url}:`, error.message);
    }
  }

  return rows.slice(0, limitPerCategory);
}

async function fetchD4DCategoryRows({ limitCategories = 20, limitPerCategory = 40 } = {}) {
  const categories = await listD4DCategories();
  const selected = categories.slice(0, limitCategories);
  const rows = [];
  const seen = new Set();

  for (const category of selected) {
    const categoryRows = await fetchCategoryRows(category, limitPerCategory);

    for (const row of categoryRows) {
      const key = `${row.store}|${row.item}|${row.brand}|${row.product}|${row.size}|${row.price}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    }
  }

  return rows;
}

module.exports = {
  listD4DCategories,
  fetchD4DCategoryRows
};
