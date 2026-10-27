import { DurableObject } from 'cloudflare:workers';
import { blank, deal, act, drawCards, resolveExpose, view, log, START } from '../public/engine.js';

const CODE = /^\/ws\/([A-Z2-9]{4,8})$/;
const IDLE_MS = 3 * 24 * 3600 * 1000; // tables are wiped after 3 idle days

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(CODE);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426 });
      return env.TABLES.get(env.TABLES.idFromName(m[1])).fetch(req);
    }
    return env.ASSETS.fetch(req);
  }
};

const cleanName = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

export class Table extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.g = null; }

  async load() {
    if (!this.g) this.g = (await this.ctx.storage.get('g')) || blank();
    return this.g;
  }

  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ token: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const g = await this.load();
    const att = ws.deserializeAttachment() || {};
    if (m.t === 'hello') {
      att.token = typeof m.token === 'string' ? m.token.slice(0, 64) : null;
      ws.serializeAttachment(att);
      this.send(ws, g);
      return;
    }
    const seat = att.token ? g.tokens.indexOf(att.token) : -1;
    try {
      this.handle(g, m, seat, att.token);
    } catch (e) {
      ws.send(JSON.stringify({ t: 'error', msg: e.message || 'That move is not allowed.' }));
      this.send(ws, g);
      return;
    }
    g.v++;
    await this.ctx.storage.put('g', g);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    this.broadcast(g);
  }

  handle(g, m, seat, token) {
    const need = c => { if (!c) throw new Error('That move is not allowed right now.'); };
    switch (m.t) {
      case 'sit': {
        const s = m.seat;
        need(token && (s === 0 || s === 1));
        if (seat >= 0) throw new Error('You already have a seat.');
        if (g.tokens[s]) throw new Error('That seat is taken.');
        const name = cleanName(m.name);
        if (!name) throw new Error('Enter your name first.');
        g.tokens[s] = token; g.names[s] = name;
        log(g, `@${s} sits down.`, true);
        return;
      }
      case 'leave': {
        need(seat >= 0);
        if (!['waiting', 'over', 'matchover'].includes(g.phase)) throw new Error('Finish the hand before leaving.');
        log(g, `@${seat} leaves the table.`, true);
        g.tokens[seat] = null; g.names[seat] = '';
        g.stacks = [START, START]; g.handNo = 0; g.button = 1; g.phase = 'waiting'; g.hands = null; g.result = null;
        return;
      }
      case 'deal': {
        need(seat >= 0 && g.tokens[0] && g.tokens[1]);
        if (g.phase === 'over') need(seat === 1 - g.button);
        else need(g.phase === 'waiting');
        deal(g); return;
      }
      case 'newmatch': {
        need(seat >= 0 && g.phase === 'matchover' && g.tokens[0] && g.tokens[1]);
        g.stacks = [START, START]; g.handNo = 0; g.button = 1;
        log(g, 'New match.', true); deal(g); return;
      }
      case 'act': {
        need(seat >= 0 && g.phase === 'bet' && g.toAct === seat && ['fold', 'call', 'raise'].includes(m.type));
        act(g, seat, m.type, m.amt); return;
      }
      case 'draw': {
        need(seat >= 0 && g.phase === 'draw' && g.drawer === seat && Array.isArray(m.idx));
        const idx = [...new Set(m.idx)].filter(k => Number.isInteger(k) && k >= 0 && k < 5).sort((a, b) => a - b);
        drawCards(g, seat, idx); return;
      }
      case 'expose': {
        need(seat >= 0 && g.phase === 'expose' && g.drawer === seat);
        resolveExpose(g, seat, !!m.keep); return;
      }
      case 'reset': {
        need(seat >= 0);
        const v = g.v; Object.keys(g).forEach(k => delete g[k]); Object.assign(g, blank(v));
        log(g, 'Table reset.', true); return;
      }
      default: throw new Error('Unknown move.');
    }
  }

  send(ws, g) {
    const att = ws.deserializeAttachment() || {};
    const seat = att.token ? g.tokens.indexOf(att.token) : -1;
    try { ws.send(JSON.stringify(view(g, seat))); } catch { }
  }
  broadcast(g) { for (const ws of this.ctx.getWebSockets()) this.send(ws, g); }

  async webSocketClose(ws, code, reason) { try { ws.close(code, reason); } catch { } }
  async webSocketError() { }
  async alarm() { await this.ctx.storage.deleteAll(); this.g = null; }
}
