// connectors/sampleAgentFeed.js
// This connector represents the agent's first managed source.
// Later, replace this with approved store APIs, partner feeds, CSV imports, or permitted web connectors.

const seedRows = require("../seed-prices.json");

async function fetchSampleAgentFeed() {
  return seedRows.map((row) => ({
    ...row,
    observed_at: new Date().toISOString(),
    source_url: null,
    raw_payload: row
  }));
}

module.exports = { fetchSampleAgentFeed };
