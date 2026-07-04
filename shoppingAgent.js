// shoppingAgent.js
// Lightweight grocery request agent.
// v4 parser fix:
// - Understands "Need 30 eggs" as quantity 30 eggs, not quantity 1.
// - Removes common request words: need, want, buy, get, add, please, etc.
// - Keeps brand hints like Lusine/Lupine/Lupin => Lusine.
// No paid AI API required for MVP.
// Later this can be upgraded to OpenAI/LLM parsing and item-specific web/API search.

const ITEM_ALIASES = {
  egg: "eggs",
  eggs: "eggs",
  bread: "bread",
  "lusine bread": "bread",
  "lupine bread": "bread",
  "lupin bread": "bread",
  croissant: "croissants",
  croissants: "croissants",
  milk: "milk",
  laban: "milk",
  water: "water",
  rice: "rice",
  chicken: "chicken",
  detergent: "detergent",
  tissue: "tissue",
  tissues: "tissue",
  diapers: "diapers",
  diaper: "diapers",
  cheese: "cheese",
  yogurt: "yogurt",
  yoghurt: "yogurt",
  oil: "oil",
  "olive oil": "oil",
  pasta: "pasta",
  flour: "flour",
  sugar: "sugar",
  coffee: "coffee",
  tea: "coffee"
};

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  half: 0.5
};

function cleanText(value) {
  return String(value || "")
    .replace(/[،]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function stripRequestWords(value) {
  let text = cleanText(value);

  // Remove polite/request prefixes repeatedly.
  // Examples:
  // "Need 30 eggs" -> "30 eggs"
  // "I want 2 milk" -> "2 milk"
  // "Please add 3 croissants" -> "3 croissants"
  let changed = true;
  while (changed) {
    const before = text;
    text = text
      .replace(/^(hi|hello|hey)\s+/i, "")
      .replace(/^(please\s+)?(can you|could you|kindly)\s+/i, "")
      .replace(/^(i\s+)?(need|want|wants|would like|am looking for|looking for)\s+/i, "")
      .replace(/^(please\s+)?(add|buy|get|bring|order|find|search for|look for)\s+/i, "")
      .replace(/^grocery\s*[:\-]?\s*/i, "")
      .replace(/^groceries\s*[:\-]?\s*/i, "")
      .replace(/^shopping\s*list\s*[:\-]?\s*/i, "")
      .replace(/^list\s*[:\-]?\s*/i, "")
      .replace(/^(of\s+)/i, "")
      .trim();
    changed = before !== text;
  }

  return text;
}

function singular(value) {
  return String(value || "").toLowerCase().replace(/s$/, "");
}

function canonicalItem(name) {
  const lower = String(name || "").toLowerCase().trim();

  if (ITEM_ALIASES[lower]) return ITEM_ALIASES[lower];

  for (const [alias, item] of Object.entries(ITEM_ALIASES)) {
    if (lower.includes(alias)) return item;
  }

  return singular(lower);
}

function inferUnit(productText) {
  const lower = String(productText || "").toLowerCase();

  if (lower.includes("kg") || lower.includes("kilo")) return "kg";
  if (lower.includes("liter") || lower.includes("litre") || lower.includes("ltr")) return "L";
  if (lower.includes("ml")) return "ml";
  if (lower.includes("pack")) return "pack";
  if (lower.includes("carton")) return "carton";
  if (lower.includes("dozen")) return "pcs";

  return "pcs";
}

function normaliseQuantity(raw) {
  if (!raw) return 1;

  const value = String(raw).toLowerCase().trim();
  if (NUMBER_WORDS[value] != null) return NUMBER_WORDS[value];

  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;

  if (value.includes("dozen")) return 12;

  return 1;
}

function parseGroceryRequest(text) {
  const original = cleanText(text);

  // Keep comma separation, but also split normal "and" lists.
  // We strip words like "Need" per chunk after splitting.
  const normalised = original
    .replace(/\band\b/gi, ",")
    .replace(/\+/g, ",")
    .replace(/;/g, ",")
    .replace(/\n/g, ",")
    .replace(/\s+/g, " ");

  const chunks = normalised
    .split(",")
    .map((x) => cleanText(x))
    .filter(Boolean);

  const items = [];

  for (const rawChunk of chunks) {
    const chunk = stripRequestWords(rawChunk);

    if (!chunk) continue;

    // Examples:
    // 30 eggs
    // 2 Lusine bread
    // 3 croissants
    // two milk
    // 1 dozen eggs
    // eggs 30 pcs
    // milk 2 ltr
    let match = chunk.match(/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)\s+(.+)$/i);
    let quantity = 1;
    let phrase = chunk;

    if (match) {
      quantity = normaliseQuantity(match[1]);

      // Special case: "1 dozen eggs" means 12 eggs, not 1.
      const rest = cleanText(match[2]);
      const dozenMatch = rest.match(/^dozen\s+(.+)$/i);
      if (dozenMatch) {
        quantity = Number(match[1]) * 12;
        phrase = cleanText(dozenMatch[1]);
      } else {
        phrase = rest;
      }
    } else {
      match = chunk.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(pcs|pc|kg|g|l|ltr|ml|pack|packs)?$/i);
      if (match) {
        phrase = cleanText(match[1]);
        quantity = normaliseQuantity(match[2]);
      }
    }

    phrase = stripRequestWords(phrase);

    const unit = inferUnit(phrase);
    const item = canonicalItem(phrase);

    let brand = "Any";
    const lower = phrase.toLowerCase();
    if (lower.includes("lusine") || lower.includes("lupine") || lower.includes("lupin")) {
      brand = "Lusine";
    }

    items.push({
      original: rawChunk,
      item,
      phrase,
      brand,
      quantity,
      unit,
      confidence: phrase.length > 1 ? "Medium" : "Low"
    });
  }

  return { original, items };
}

function scoreRowForItem(row, item) {
  const haystack = [
    row.item,
    row.brand,
    row.product,
    row.size
  ].join(" ").toLowerCase();

  const itemNeedle = String(item.item || "").toLowerCase();
  const phraseWords = String(item.phrase || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["need", "want", "please", "add", "buy", "get"].includes(w));

  let score = 0;

  if (haystack.includes(itemNeedle)) score += 45;
  if (String(row.item || "").toLowerCase() === itemNeedle) score += 30;

  for (const word of phraseWords) {
    if (haystack.includes(word)) score += 10;
  }

  if (item.brand && item.brand !== "Any") {
    if (haystack.includes(item.brand.toLowerCase())) score += 25;
    else score -= 10;
  }

  if (item.item === "eggs") {
    if (haystack.includes("egg")) score += 25;
    if (Number(item.quantity) === 30 && haystack.includes("30")) score += 20;
  }

  if (item.item === "croissants") {
    if (haystack.includes("croissant")) score += 30;
    if (haystack.includes("bakery")) score += 5;
  }

  if (item.item === "bread") {
    if (haystack.includes("bread") || haystack.includes("bun")) score += 30;
  }

  return Math.max(0, Math.min(100, score));
}

function matchGroceryItems(items, priceRows) {
  return items.map((item) => {
    const matches = (priceRows || [])
      .map((row) => ({
        ...row,
        score: scoreRowForItem(row, item),
        requested_quantity: item.quantity
      }))
      .filter((row) => row.score >= 45)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return Number(a.price || 0) - Number(b.price || 0);
      })
      .slice(0, 8);

    return {
      ...item,
      matches,
      best_match: matches[0] || null
    };
  });
}

function ruleFor(storeRules, store, area) {
  return (storeRules || []).find((rule) => rule.store === store && rule.area === area) || {
    store,
    area,
    is_available: true,
    delivery_fee: 0,
    free_delivery_above: 0,
    minimum_order: 0
  };
}

function combinations(list, max) {
  const out = [];

  function walk(start, picked) {
    if (picked.length) out.push([...picked]);
    if (picked.length === max) return;

    for (let i = start; i < list.length; i += 1) {
      picked.push(list[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  }

  walk(0, []);
  return out;
}

function optimiseMatchedBasket({ matchedItems, storeRules, area = "Saar", delivery = true, maxStores = 2 }) {
  const unmatched = matchedItems.filter((item) => !item.matches.length);
  const matchable = matchedItems.filter((item) => item.matches.length);

  if (!matchable.length) {
    return {
      status: "no_matches",
      message: "I understood the request, but I could not find reliable price matches yet.",
      best: null,
      options: [],
      unmatched_count: unmatched.length
    };
  }

  const stores = Array.from(
    new Set(matchable.flatMap((item) => item.matches.map((match) => match.store)))
  ).filter((store) => ruleFor(storeRules, store, area).is_available !== false);

  const options = [];

  for (const storeList of combinations(stores, maxStores)) {
    const storeSet = new Set(storeList);
    const selected = [];
    let failed = false;

    for (const item of matchable) {
      const possible = item.matches.filter((match) => storeSet.has(match.store));
      if (!possible.length) {
        failed = true;
        break;
      }

      const chosen = possible.sort((a, b) => Number(a.price) - Number(b.price))[0];
      selected.push({
        request: item.original,
        item: item.item,
        quantity: item.quantity,
        store: chosen.store,
        brand: chosen.brand,
        product: chosen.product,
        size: chosen.size,
        unit_price: Number(chosen.price || 0),
        line_total: Number(chosen.price || 0) * Number(item.quantity || 1),
        confidence: chosen.confidence || "Medium",
        score: chosen.score
      });
    }

    if (failed) continue;

    const goods = selected.reduce((sum, row) => sum + row.line_total, 0);
    const byStore = selected.reduce((acc, row) => {
      acc[row.store] = (acc[row.store] || 0) + row.line_total;
      return acc;
    }, {});

    let deliveryCost = 0;
    let minimumGap = 0;
    const storeBreakdown = {};

    for (const [store, storeGoods] of Object.entries(byStore)) {
      const rule = ruleFor(storeRules, store, area);
      const storeDelivery = delivery && storeGoods < Number(rule.free_delivery_above || 0)
        ? Number(rule.delivery_fee || 0)
        : 0;
      const storeGap = storeGoods < Number(rule.minimum_order || 0)
        ? Number(rule.minimum_order || 0) - storeGoods
        : 0;

      deliveryCost += storeDelivery;
      minimumGap += storeGap;

      storeBreakdown[store] = {
        goods: storeGoods,
        delivery: storeDelivery,
        minimum_gap: storeGap,
        minimum_order: Number(rule.minimum_order || 0),
        free_delivery_above: Number(rule.free_delivery_above || 0)
      };
    }

    const hassleCost = Math.max(0, storeList.length - 1) * 0.5;
    const total = goods + deliveryCost + minimumGap + hassleCost;

    options.push({
      stores: storeList,
      selected,
      goods,
      delivery: deliveryCost,
      minimum_gap: minimumGap,
      hassle_cost: hassleCost,
      total,
      store_breakdown: storeBreakdown
    });
  }

  options.sort((a, b) => a.total - b.total);

  return {
    status: options.length ? "ok" : "partial",
    best: options[0] || null,
    options: options.slice(0, 5),
    unmatched_count: unmatched.length,
    unmatched
  };
}

module.exports = {
  parseGroceryRequest,
  matchGroceryItems,
  optimiseMatchedBasket
};
