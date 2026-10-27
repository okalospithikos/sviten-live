# Sviten Special, heads-up online

Cloudflare Worker + Durable Object. The server holds the deck and deals; each player only receives their own cards.

## Deploy

    npm install
    npx wrangler login
    npx wrangler deploy

This publishes to poker.seragos.com (set in wrangler.jsonc under "routes"). Cloudflare creates the DNS record for the subdomain.

## Play

Open poker.seragos.com, tap Create a table, send the link. Tables are wiped after 3 idle days.

## Files

- src/worker.js: routing and the table server (one Durable Object per table code)
- public/engine.js: game rules and hand evaluation, shared by server and page
- public/index.html: the page
