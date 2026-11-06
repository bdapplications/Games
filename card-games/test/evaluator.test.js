// Checks the poker evaluator against every possible 5-card hand (2,598,960 of them)
// and a set of head-to-head tiebreak cases. Run: npm test
import { newDeck, evaluate, compareHands, shuffledDeck, jobPayout } from "../public/js/cards.js";

let failures = 0;
const check = (ok, msg) => {
  if (ok) console.log("  ✓ " + msg);
  else {
    console.log("  ✗ " + msg);
    failures++;
  }
};

// 1. Every hand, counted by category — must match the published frequencies exactly.
const EXPECTED = {
  "Royal Flush": 4,
  "Straight Flush": 36,
  "Four of a Kind": 624,
  "Full House": 3744,
  "Flush": 5108,
  "Straight": 10200,
  "Three of a Kind": 54912,
  "Two Pair": 123552,
  "One Pair": 1098240,
  "High Card": 1302540,
};
const deck = newDeck();
const tally = {};
let total = 0;
for (let a = 0; a < 48; a++)
  for (let b = a + 1; b < 49; b++)
    for (let c = b + 1; c < 50; c++)
      for (let d = c + 1; d < 51; d++)
        for (let e = d + 1; e < 52; e++) {
          const name = evaluate([deck[a], deck[b], deck[c], deck[d], deck[e]]).name;
          tally[name] = (tally[name] || 0) + 1;
          total++;
        }
console.log("All 5-card hands:");
check(total === 2598960, `total hands = ${total.toLocaleString()}`);
for (const [name, n] of Object.entries(EXPECTED))
  check(tally[name] === n, `${name}: ${(tally[name] || 0).toLocaleString()} (expected ${n.toLocaleString()})`);

// 2. Head-to-head comparisons.
console.log("Showdown comparisons:");
const H = (s) => s.split(" ");
const cases = [
  ["As Ks Qs Js Ts", "9h 9d 9s 9c 2h", 1, "royal beats quads"],
  ["5h 4h 3h 2h Ah", "6c 5c 4c 3c 2c", -1, "6-high straight flush beats the wheel"],
  ["Ah 2d 3c 4s 5h", "Kh Kd Kc 2s 3h", 1, "wheel straight beats trips"],
  ["Ah 2d 3c 4s 5h", "2h 3d 4c 5s 6h", -1, "6-high straight beats the wheel"],
  ["Kh Kd 4c 4s 2h", "Kc Ks 4h 4d 3c", -1, "two pair: kicker decides"],
  ["Qh Qd 9c 7s 2h", "Qc Qs 9h 7d 2c", 0, "identical pair hands split"],
  ["Ah Jh 8h 6h 3h", "Ad Jd 8d 6d 2d", 1, "flush: last card decides"],
  ["3h 3d 3c Ks Kh", "2h 2d 2c As Ah", 1, "full house: trips rank first"],
  ["Ah Kd Qc Js 9h", "Ad Kc Qh Jd 8s", 1, "high card kicker"],
  ["Th Td 5c 4s 2h", "9h 9d Ac Ks Qh", 1, "higher pair beats bigger kickers"],
];
for (const [a, b, want, label] of cases) {
  const got = Math.sign(compareHands(H(a), H(b)));
  check(got === want, label);
}

// 3. Video poker payouts.
console.log("Jacks or Better payouts (5 coins):");
check(jobPayout(H("As Ks Qs Js Ts"), 5).win === 4000, "royal at 5 coins pays 4000");
check(jobPayout(H("Jh Jd 4c 7s 2h"), 5).win === 5, "pair of jacks pays 5");
check(jobPayout(H("Th Td 4c 7s 2h"), 5).win === 0, "pair of tens pays nothing");
check(jobPayout(H("2h 2d 2c 7s 7h"), 1).win === 9, "full house pays 9 per coin");

// 4. Shuffle sanity: every card shows up in position 0 roughly equally often.
console.log("Shuffle fairness:");
const firsts = {};
const N = 104000;
for (let i = 0; i < N; i++) {
  const c = shuffledDeck()[0];
  firsts[c] = (firsts[c] || 0) + 1;
}
const counts = Object.values(firsts);
const expected = N / 52;
const chi = counts.reduce((s, n) => s + ((n - expected) ** 2) / expected, 0);
check(counts.length === 52 && chi < 90, `all 52 cards appear first; chi-square ${chi.toFixed(1)} (51 df, < 90 is fine)`);

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
