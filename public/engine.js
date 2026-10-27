// Sviten Special engine, shared by the server (authoritative) and the page (hand reads, bet limits).
export const BB = 2, START = 200;
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RN = r => ({ 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' }[r] || String(r));
const RW = r => ({ 14: 'Aces', 13: 'Kings', 12: 'Queens', 11: 'Jacks', 10: 'Tens', 9: 'Nines', 8: 'Eights', 7: 'Sevens', 6: 'Sixes', 5: 'Fives', 4: 'Fours', 3: 'Threes', 2: 'Twos' }[r]);
const RH = r => ({ 14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack' }[r] || String(r));
export const cs = c => RN(c.r) + SUITS[c.s];
export const same = (a, b) => !!a && !!b && a.r === b.r && a.s === b.s;

function randInt(n) {
  const buf = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(buf); while (buf[0] >= lim);
  return buf[0] % n;
}
export function fullDeck() { const d = []; for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s }); return d; }
export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function eval5(cards) {
  const r = cards.map(c => c.r).sort((a, b) => b - a);
  const fl = cards.every(c => c.s === cards[0].s);
  const cnt = {}; for (const x of r) cnt[x] = (cnt[x] || 0) + 1;
  const g = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
  let st = 0;
  if (g.length === 5) { if (r[0] - r[4] === 4) st = r[0]; else if (r[0] === 14 && r[1] === 5) st = 5; }
  let cat, k;
  if (st && fl) { cat = 8; k = [st]; }
  else if (cnt[g[0]] === 4) { cat = 7; k = g; }
  else if (cnt[g[0]] === 3 && cnt[g[1]] === 2) { cat = 6; k = g; }
  else if (fl) { cat = 5; k = r; }
  else if (st) { cat = 4; k = [st]; }
  else if (cnt[g[0]] === 3) { cat = 3; k = g; }
  else if (cnt[g[0]] === 2 && cnt[g[1]] === 2) { cat = 2; k = g; }
  else if (cnt[g[0]] === 2) { cat = 1; k = g; }
  else { cat = 0; k = r; }
  let v = cat; for (let i = 0; i < 5; i++) v = v * 15 + (k[i] || 0);
  return v;
}
const P5 = 15 ** 5;
export function handName(v) {
  const cat = Math.floor(v / P5), k0 = Math.floor(v / 15 ** 4) % 15, k1 = Math.floor(v / 15 ** 3) % 15;
  switch (cat) {
    case 8: return k0 === 14 ? 'Royal flush' : `Straight flush, ${RH(k0)} high`;
    case 7: return `Quad ${RW(k0)}`;
    case 6: return `${RW(k0)} full of ${RW(k1)}`;
    case 5: return `Flush, ${RH(k0)} high`;
    case 4: return `Straight, ${RH(k0)} high`;
    case 3: return `Trip ${RW(k0)}`;
    case 2: return `Two pair, ${RW(k0)} and ${RW(k1)}`;
    case 1: return `Pair of ${RW(k0)}`;
    default: return `${RH(k0)} high`;
  }
}
const H2 = [], B3 = [];
for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) H2.push([i, j]);
for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) for (let k = j + 1; k < 5; k++) B3.push([i, j, k]);
export function omaha(h, b) {
  if (b.length < 3) return 0;
  const combos = B3.filter(t => t.every(x => x < b.length));
  let best = 0;
  for (const [i, j] of H2) for (const [x, y, z] of combos) { const v = eval5([h[i], h[j], b[x], b[y], b[z]]); if (v > best) best = v; }
  return best;
}

/* ---- table state (server side) ---- */
export function blank(v) { return { tokens: [null, null], names: ['', ''], stacks: [START, START], button: 1, handNo: 0, phase: 'waiting', log: [], v: v || 0 }; }
function log(g, t, hl) { g.log.push({ t, hl: !!hl }); if (g.log.length > 60) g.log.splice(0, g.log.length - 60); }
export { log };
function post(g, i, a) { a = Math.min(a, g.stacks[i]); g.stacks[i] -= a; g.bets[i] += a; }
export const maxBet = g => Math.max(g.bets[0], g.bets[1]);
export const potTotal = g => g.pot + g.bets[0] + g.bets[1];

export function deal(g) {
  if (g.stacks[0] <= 0 || g.stacks[1] <= 0) { g.phase = 'matchover'; return; }
  g.handNo++; g.button ^= 1;
  g.deck = shuffle(fullDeck());
  g.hands = [g.deck.splice(0, 5), g.deck.splice(0, 5)];
  g.board = []; g.pot = 0; g.bets = [0, 0]; g.acted = [false, false]; g.lastRaise = BB;
  g.street = 'Preflop'; g.phase = 'bet'; g.result = null; g.reveal = false;
  g.shown = [null, null]; g.drew = [null, null]; g.dead = []; g.expCard = null; g.expIdx = null; g.drawer = null;
  const sb = g.button, bb = 1 - sb;
  post(g, sb, 1); post(g, bb, BB);
  log(g, `Hand ${g.handNo}. @${sb} posts 1, @${bb} posts 2.`, true);
  g.toAct = sb; settle(g);
}
function settle(g) { if (g.phase === 'bet' && g.stacks[g.toAct] === 0) act(g, g.toAct, 'call'); }
export function legal(g, i) {
  const mb = maxBet(g), toCall = mb - g.bets[i], pt = potTotal(g), allInTo = g.bets[i] + g.stacks[i];
  const minTo = Math.min(mb + Math.max(g.lastRaise, BB), allInTo), maxTo = Math.min(mb + pt + toCall, allInTo);
  return { toCall, callAmt: Math.min(toCall, g.stacks[i]), minTo, maxTo, canRaise: g.stacks[i] > toCall && g.stacks[1 - i] > 0, mb, pt };
}
export function act(g, i, type, amt) {
  const L = legal(g, i);
  if (type === 'fold') {
    const w = 1 - i, won = potTotal(g);
    log(g, `@${i}: fold.`);
    g.stacks[w] += won; g.pot = 0; g.bets = [0, 0];
    g.result = { kind: 'fold', winner: w, tot: won };
    log(g, `@${w} takes ${won}.`, true);
    g.phase = 'over'; return;
  }
  if (type === 'call') {
    const c = L.callAmt; g.stacks[i] -= c; g.bets[i] += c;
    log(g, c === 0 ? `@${i}: check.` : `@${i}: call ${c}${g.stacks[i] === 0 ? ', all in' : ''}.`);
  }
  if (type === 'raise') {
    if (!L.canRaise) throw new Error('You cannot raise here.');
    amt = Math.max(L.minTo, Math.min(L.maxTo, Math.round(Number(amt) || 0)));
    g.stacks[i] -= amt - g.bets[i];
    const size = amt - L.mb; if (size >= g.lastRaise) g.lastRaise = size;
    g.bets[i] = amt; g.acted[1 - i] = false;
    log(g, `@${i}: ${L.mb === 0 ? 'bet ' + amt : 'raise to ' + amt}${g.stacks[i] === 0 ? ', all in' : ''}.`);
  }
  g.acted[i] = true;
  const mb = maxBet(g);
  if ([0, 1].every(p => g.stacks[p] === 0 || (g.acted[p] && g.bets[p] === mb))) { endRound(g); return; }
  g.toAct = 1 - i; settle(g);
}
function collect(g) {
  const m = Math.min(g.bets[0], g.bets[1]);
  for (let p = 0; p < 2; p++) { const ex = g.bets[p] - m; if (ex > 0) g.stacks[p] += ex; }
  g.pot += 2 * m; g.bets = [0, 0]; g.acted = [false, false]; g.lastRaise = BB;
}
function endRound(g) {
  collect(g);
  if (g.street === 'Preflop') { g.board.push(...g.deck.splice(0, 3)); g.street = 'Flop'; log(g, `Flop: ${g.board.map(cs).join(' ')}`, true); startBetting(g); }
  else if (g.street === 'Flop') { g.phase = 'draw'; g.street = 'Draw'; g.drawer = 1 - g.button; }
  else if (g.street === 'Turn') { g.board.push(g.deck.shift()); g.street = 'River'; log(g, `River: ${cs(g.board[4])}`, true); startBetting(g); }
  else if (g.street === 'River') showdown(g);
}
function startBetting(g) {
  g.phase = 'bet'; g.toAct = 1 - g.button;
  if (g.stacks[0] === 0 || g.stacks[1] === 0) { endRound(g); return; }
  settle(g);
}
export function drawCards(g, i, idx) {
  if (idx.length === 1) {
    g.expIdx = idx[0]; g.expCard = g.deck.shift(); g.phase = 'expose';
    log(g, `@${i} draws 1 face up: ${cs(g.expCard)}.`, true); return;
  }
  for (const k of idx) g.hands[i][k] = g.deck.shift();
  g.drew[i] = idx.length;
  log(g, idx.length ? `@${i} draws ${idx.length}.` : `@${i} stands pat.`, true);
  afterDraw(g, i);
}
export function resolveExpose(g, i, keep) {
  const c = g.expCard, k = g.expIdx;
  if (keep) { g.hands[i][k] = c; g.shown[i] = c; log(g, `@${i} keeps the ${cs(c)}.`); }
  else { g.dead.push(c); g.hands[i][k] = g.deck.shift(); log(g, `@${i} rejects the ${cs(c)} and takes a blind card.`); }
  g.drew[i] = 1; g.expCard = null; g.expIdx = null;
  afterDraw(g, i);
}
function afterDraw(g, i) {
  if (i !== g.button) { g.drawer = g.button; g.phase = 'draw'; return; }
  g.drawer = null; g.board.push(g.deck.shift()); g.street = 'Turn';
  log(g, `Turn: ${cs(g.board[3])}`, true);
  startBetting(g);
}
function showdown(g) {
  g.reveal = true; g.phase = 'over';
  const [h0, h1] = g.hands;
  const d0 = eval5(h0), d1 = eval5(h1), o0 = omaha(h0, g.board), o1 = omaha(h1, g.board);
  const tot = g.pot, dHalf = Math.ceil(tot / 2), oHalf = tot - dHalf, won = [0, 0];
  const split = (a, b, amt) => { if (a > b) won[0] += amt; else if (b > a) won[1] += amt; else { won[0] += Math.floor(amt / 2); won[1] += amt - Math.floor(amt / 2); } };
  split(d0, d1, dHalf); split(o0, o1, oHalf);
  g.stacks[0] += won[0]; g.stacks[1] += won[1]; g.pot = 0;
  const dw = d0 > d1 ? 0 : d1 > d0 ? 1 : -1, ow = o0 > o1 ? 0 : o1 > o0 ? 1 : -1;
  const who = w => w < 0 ? 'Split' : '@' + w;
  log(g, `Draw half: ${who(dw)}. @0 ${handName(d0)}, @1 ${handName(d1)}.`, true);
  log(g, `Omaha half: ${who(ow)}. @0 ${handName(o0)}, @1 ${handName(o1)}.`, true);
  g.result = { kind: 'showdown', dw, ow, won, tot };
}

/* What one seat is allowed to see. The deck and hidden cards never leave the server. */
export function view(g, seat) {
  const inHand = !!g.hands && g.phase !== 'waiting';
  const hide = i => g.hands[i].map(c => (i === seat || g.reveal || same(c, g.shown[i])) ? c : null);
  return {
    t: 'state', seat, names: g.names, seated: g.tokens.map(Boolean), stacks: g.stacks, button: g.button,
    handNo: g.handNo, phase: g.phase, street: g.street || '', board: inHand ? g.board : [], pot: g.pot || 0,
    bets: g.bets || [0, 0], lastRaise: g.lastRaise || BB, toAct: g.toAct, drawer: g.drawer,
    expIdx: g.expIdx, expCard: g.phase === 'expose' ? g.expCard : null, shown: g.shown || [null, null],
    drew: g.drew || [null, null], reveal: !!g.reveal, result: g.result || null, log: g.log,
    hands: inHand ? [hide(0), hide(1)] : null, v: g.v
  };
}
