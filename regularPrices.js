// regularPrices.js
// SmartBasket v15 regular price layer.
// Purpose:
// D4D/flyer data only covers offers. Regular store prices may still exist even when not on offer.
// This file gives the Agent a second layer: regular / last-known / estimated prices.
//
// IMPORTANT:
// Replace these starter values with your own verified prices before production.
// Use price_type to be transparent in the UI:
// - regular_price: verified regular shelf/app price
// - last_known_price: previously verified, may have changed
// - estimated_regular_price: estimate only, not live-confirmed

function nowIso() {
  return new Date().toISOString();
}

const REGULAR_PRICE_ROWS = [
  {
    store: "LuLu Hypermarket",
    item: "bread",
    brand: "Lusine",
    product: "Lusine bread",
    size: "1 pack",
    price: 0.650,
    price_type: "estimated_regular_price",
    source_type: "manual_regular_price",
    confidence: "Medium",
    match: 82,
    area: "ALL",
    last_verified: null,
    source_note: "Regular price layer. Replace with verified LuLu price when available."
  },
  {
    store: "Carrefour",
    item: "bread",
    brand: "Lusine",
    product: "Lusine bread",
    size: "1 pack",
    price: 0.690,
    price_type: "estimated_regular_price",
    source_type: "manual_regular_price",
    confidence: "Low",
    match: 76,
    area: "ALL",
    last_verified: null,
    source_note: "Regular price layer. Replace with verified Carrefour price when available."
  },
  {
    store: "Al Jazira Supermarket",
    item: "bread",
    brand: "Alternative",
    product: "Bread / buns alternative",
    size: "1 pack",
    price: 0.550,
    price_type: "estimated_regular_price",
    source_type: "manual_regular_price",
    confidence: "Low",
    match: 64,
    area: "ALL",
    last_verified: null,
    source_note: "Regular price alternative. Exact Lusine brand not confirmed."
  },
  {
    store: "LuLu Hypermarket",
    item: "croissants",
    brand: "Generic",
    product: "Croissants",
    size: "1 pack / piece",
    price: 0.990,
    price_type: "estimated_regular_price",
    source_type: "manual_regular_price",
    confidence: "Low",
    match: 70,
    area: "ALL",
    last_verified: null,
    source_note: "Regular price layer. Replace with verified price when available."
  },
  {
    store: "Carrefour",
    item: "croissants",
    brand: "Generic",
    product: "Croissants",
    size: "1 pack / piece",
    price: 1.100,
    price_type: "estimated_regular_price",
    source_type: "manual_regular_price",
    confidence: "Low",
    match: 68,
    area: "ALL",
    last_verified: null,
    source_note: "Regular price layer. Replace with verified price when available."
  },
  {
    store: "LuLu Hypermarket",
    item: "eggs",
    brand: "Generic",
    product: "Eggs 30 pcs",
    size: "30 pcs",
    price: 1.850,
    price_type: "estimated_regular_price",
    source_type: "manual_regular_price",
    confidence: "Low",
    match: 72,
    area: "ALL",
    last_verified: null,
    source_note: "Regular price layer. Replace with verified LuLu price when available."
  },
  {
    store: "Carrefour",
    item: "eggs",
    brand: "Generic",
    product: "Eggs 30 pcs",
    size: "30 pcs",
    price: 1.950,
    price_type: "estimated_regular_price",
    source_type: "manual_regular_price",
    confidence: "Low",
    match: 70,
    area: "ALL",
    last_verified: null,
    source_note: "Regular price layer. Replace with verified Carrefour price when available."
  }
];

function rowsForArea(area) {
  const selectedArea = String(area || "").toLowerCase();

  return REGULAR_PRICE_ROWS
    .filter((row) => {
      const rowArea = String(row.area || "ALL").toLowerCase();
      return rowArea === "all" || !selectedArea || rowArea === selectedArea;
    })
    .map((row) => ({
      ...row,
      source: row.price_type || "regular_price",
      source_url: null,
      last_checked: nowIso(),
      is_active: true,
      needs_review: false,
      product_is_exact: row.brand !== "Alternative",
      exact_brand: row.brand !== "Alternative",
      is_regular_price_layer: true
    }));
}

module.exports = {
  rowsForArea,
  REGULAR_PRICE_ROWS
};
