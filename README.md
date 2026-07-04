# SmartBasket Agent Manager

This is the backend agent that should manage everything behind SmartBasket:

- Live price database updates
- Store delivery/minimum/free-delivery rules
- Source confidence
- Last checked timestamps
- Suspicious price review queue
- Customer-safe price API
- Scheduled price refresh

## Important

The agent cannot magically access grocery prices unless you connect a valid source:
- approved store API
- partner feed
- CSV/product feed
- permitted web connector
- manual/admin seed source for MVP

This package gives you the backend agent structure. It is designed so the customer never manages prices.

## How it works

Customer app:
GET /api/prices

Agent:
POST /api/agent/run?key=YOUR_SECRET

Admin/manual override:
POST /api/admin/price?key=YOUR_SECRET

## Setup

1. Create Supabase project.
2. Open SQL Editor.
3. Paste `supabase_agent_schema.sql` and Run.
4. Copy `.env.example` to `.env`.
5. Fill in:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY
   - AGENT_RUN_KEY
6. Install and run:

```bash
npm install
npm start
```

7. In another Terminal, run the agent once:

```bash
curl -X POST "http://localhost:8787/api/agent/run?key=change-this-secret"
```

8. Test prices:

```bash
http://localhost:8787/api/prices
```

## Deploy

Deploy this backend to Render, Railway, Fly.io, or another Node server.

Environment variables must be set on the backend server.

Never put `SUPABASE_SERVICE_ROLE_KEY` in the customer website.

## What to build next

1. Connect the customer site to this backend `/api/prices`.
2. Add a password-protected admin dashboard.
3. Add CSV upload for store price lists.
4. Add official/approved API connectors.
5. Add alerting when prices become stale or suspicious.
