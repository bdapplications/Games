// Shared card logic — used by the browser and by the Node server.
// A card is a 2-character string: rank + suit, e.g. "As" (ace of spades), "Td" (ten of diamonds).

export const RANKS = "23456789TJQKA";
export const SUITS = "shdc";
export const SUIT_SYMBOL = { s: "♠", h: "♥", d: "♦", c: "♣" };
export const RANK_LABEL = { T: "10", J: "J", Q: "Q", K: "K", A: "A" };

export function rankValue(card) {
  return RANKS.indexOf(card[0]) + 2; // 2..14
}

export function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

// Unbiased random integer in [0, n) using the secure random generator.
function randomInt(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n; // reject values that would bias the result
  let x;
  do {
    globalThis.crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % n;
}

// Fisher–Yates shuffle (in place, returns the same array).
export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function shuffledDeck(count = 1) {
  let d = [];
  for (let i = 0; i < count; i++) d = d.concat(newDeck());
  return shuffle(d);
}

// ---------- 5-card poker hand evaluator ----------

export const HAND_NAMES = [
  "High Card",       // 0
  "One Pair",        // 1
  "Two Pair",        // 2
  "Three of a Kind", // 3
  "Straight",        // 4
  "Flush",           // 5
  "Full House",      // 6
  "Four of a Kind",  // 7
  "Straight Flush",  // 8
  "Royal Flush",     // 9
];

// Returns { cat, name, ranks } where `ranks` is the tiebreak list (highest first).
export function evaluate(hand) {
  if (hand.length !== 5) throw new Error("evaluate() needs exactly 5 cards");
  const values = hand.map(rankValue).sort((a, b) => b - a);
  const flush = hand.every((c) => c[1] === hand[0][1]);

  // Group by rank, ordered by count then rank: e.g. full house K-K-K-4-4 -> [[13,3],[4,2]]
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join("");
  const byGroup = groups.map((g) => g[0]);

  // Straight check (five distinct ranks in a run; ace may play low as A-2-3-4-5).
  let straightHigh = 0;
  if (groups.length === 5) {
    if (values[0] - values[4] === 4) straightHigh = values[0];
    else if (values.join(",") === "14,5,4,3,2") straightHigh = 5; // the "wheel"
  }

  let cat;
  let ranks = byGroup;
  if (straightHigh && flush) {
    cat = straightHigh === 14 ? 9 : 8;
    ranks = [straightHigh];
  } else if (shape === "41") cat = 7;
  else if (shape === "32") cat = 6;
  else if (flush) cat = 5;
  else if (straightHigh) {
    cat = 4;
    ranks = [straightHigh];
  } else if (shape === "311") cat = 3;
  else if (shape === "221") cat = 2;
  else if (shape === "2111") cat = 1;
  else cat = 0;

  return { cat, name: HAND_NAMES[cat], ranks };
}

// > 0 if a beats b, < 0 if b beats a, 0 if tied (split pot).
export function compareHands(a, b) {
  const ea = evaluate(a);
  const eb = evaluate(b);
  if (ea.cat !== eb.cat) return ea.cat - eb.cat;
  for (let i = 0; i < Math.max(ea.ranks.length, eb.ranks.length); i++) {
    const d = (ea.ranks[i] || 0) - (eb.ranks[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ---------- Jacks or Better (classic "9/6" full-pay table) ----------

export const JOB_PAYTABLE = [
  { key: "royal", name: "Royal Flush", pay: 250 }, // 800 per coin at 5 coins (4000 total)
  { key: "sflush", name: "Straight Flush", pay: 50 },
  { key: "quads", name: "Four of a Kind", pay: 25 },
  { key: "boat", name: "Full House", pay: 9 },
  { key: "flush", name: "Flush", pay: 6 },
  { key: "straight", name: "Straight", pay: 4 },
  { key: "trips", name: "Three of a Kind", pay: 3 },
  { key: "twopair", name: "Two Pair", pay: 2 },
  { key: "jacks", name: "Jacks or Better", pay: 1 },
];

// Returns the paytable row for a hand, or null if it doesn't pay.
export function jacksOrBetter(hand) {
  const e = evaluate(hand);
  const byCat = { 9: 0, 8: 1, 7: 2, 6: 3, 5: 4, 4: 5, 3: 6, 2: 7 };
  if (e.cat in byCat) return JOB_PAYTABLE[byCat[e.cat]];
  if (e.cat === 1 && e.ranks[0] >= 11) return JOB_PAYTABLE[8];
  return null;
}

export function jobPayout(hand, bet) {
  const row = jacksOrBetter(hand);
  if (!row) return { row: null, win: 0 };
  const win = row.key === "royal" && bet === 5 ? 4000 : row.pay * bet;
  return { row, win };
}
