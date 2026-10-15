#!/usr/bin/env node
/**
 * Sneaker Market Dashboard – zero-dependency server
 *
 * Trending sneakers, new releases, biggest resale premiums and best sellers from
 * StockX, with per-size market data and colorways.
 *
 * API:     https://rapidapi.com/belchiorarkad-FqvHs2EDOtP/api/sneaker-database-stockx
 * Support: Telegram @pintoflow
 *
 *   RAPIDAPI_KEY=your_key node server.js   -> live data
 *   node server.js                         -> demo mode with sample data
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3001;
const KEY = process.env.RAPIDAPI_KEY || '';
const HOST = 'sneaker-database-stockx.p.rapidapi.com';
const DEMO = !KEY || process.env.DEMO === '1';
const PUBLIC = path.join(__dirname, 'public');

// Only these routes and params are forwarded, with the same cache times the API uses.
const ALLOWED = {
  '/stockx/browse': { params: ['category', 'sort', 'query', 'page', 'limit', 'currency', 'country'], ttl: 10 * 60e3 },
  '/stockx/market-data': { params: ['urlKey', 'currency', 'country'], ttl: 5 * 60e3 },
  '/stockx/colorways': { params: ['urlKey', 'currency', 'country'], ttl: 60 * 60e3 },
};
const cache = new Map();
const demo = DEMO ? JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-data.json'), 'utf8')) : null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (u.pathname === '/api/config') return send(res, 200, { demo: DEMO });
      if (u.pathname.startsWith('/api/')) {
        const route = u.pathname.slice(4);
        const rule = ALLOWED[route];
        if (!rule) return send(res, 404, { message: 'Unknown route' });
        if (DEMO) return send(res, 200, demoAnswer(route, u.searchParams));
        const url = new URL(`https://${HOST}${route}`);
        rule.params.forEach((p) => u.searchParams.has(p) && url.searchParams.set(p, u.searchParams.get(p)));
        const ck = url.toString();
        const hit = cache.get(ck);
        if (hit && Date.now() - hit.t < rule.ttl) return send(res, hit.status, hit.body);
        const r = await fetch(url, { headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': KEY } });
        const body = await r.text();
        if (r.ok) cache.set(ck, { t: Date.now(), status: r.status, body });
        return send(res, r.status, body);
      }
      const file = path.join(PUBLIC, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
      send(res, 502, { message: e.message });
    }
  })
  .listen(PORT, () => console.log(`Sneaker market dashboard on http://localhost:${PORT}${DEMO ? '  (DEMO mode – sample data, set RAPIDAPI_KEY for live data)' : ''}`));

function demoAnswer(route, q) {
  if (route === '/stockx/market-data') return { success: true, data: { sizes: demo.sizes } };
  if (route === '/stockx/colorways') return { success: true, data: demo.products.slice(3, 9) };
  const sort = q.get('sort') || 'most-active';
  const list = [...demo.products];
  const by = { release_date: (a, b) => b.releaseDate.localeCompare(a.releaseDate), price_premium: (a, b) => b.pricePremium - a.pricePremium, deadstock_sold: (a, b) => b.salesLast72Hours - a.salesLast72Hours, lowest_ask: (a, b) => a.lowestAsk - b.lowestAsk };
  if (by[sort]) list.sort(by[sort]);
  const qq = (q.get('query') || '').toLowerCase();
  return { success: true, data: list.filter((p) => !qq || p.title.toLowerCase().includes(qq)) };
}
