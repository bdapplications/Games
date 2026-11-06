// Plays head-to-head hands against a live server with two simulated players.
// Run: npm test  (starts its own server on a spare port)
process.env.PORT = process.env.TEST_PORT || "3999";
const { server } = await import("../server.js");
const { compareHands } = await import("../public/js/cards.js");
const BASE = `http://localhost:${process.env.PORT}`;

let failures = 0;
const check = (ok, msg) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + msg);
  if (!ok) failures++;
};

const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};

// Minimal SSE reader that keeps the latest state.
function listen(code, token) {
  const ctrl = new AbortController();
  const client = { latest: null, waiters: [], close: () => ctrl.abort() };
  (async () => {
    const r = await fetch(`${BASE}/api/rooms/${code}/events?token=${token}`, { signal: ctrl.signal });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (line && !block.includes("event: closed")) {
            client.latest = JSON.parse(line.slice(6));
            client.waiters = client.waiters.filter((w) => !w(client.latest));
          }
        }
      }
    } catch {}
  })();
  client.until = (pred) =>
    new Promise((resolve, reject) => {
      if (client.latest && pred(client.latest)) return resolve(client.latest);
      const t = setTimeout(() => reject(new Error("timeout waiting for state")), 3000);
      client.waiters.push((s) => (pred(s) ? (clearTimeout(t), resolve(s), true) : false));
    });
  return client;
}

console.log("Head-to-head video poker:");
const host = await post("/api/rooms", { name: "Bryan" });
check(host.status === 200 && /^[A-Z]{4}$/.test(host.json.code), `host created room ${host.json.code}`);
const code = host.json.code;
const A = listen(code, host.json.token);
await A.until((s) => s.phase === "waiting");
check(true, "host sees 'waiting for opponent'");

const guest = await post(`/api/rooms/${code.toLowerCase()}/join`, { name: "Guest<script>" });
check(guest.status === 200 && guest.json.seat === 1, "guest joined with lowercase code");
const B = listen(code, guest.json.token);

const third = await post(`/api/rooms/${code}/join`, { name: "Third" });
check(third.status === 409, "a third player is turned away");

let a = await A.until((s) => s.phase === "draw" && s.opp?.online);
let b = await B.until((s) => s.phase === "draw");
check(b.me.name === "Guestscript", "player names are sanitized");
check(a.me.hand.length === 5 && b.me.hand.length === 5, "both players dealt 5 cards");
check(a.opp.hand.every((c) => c === null), "opponent's cards are hidden before showdown");
check(new Set([...a.me.hand, ...b.me.hand]).size === 10, "both hands come from one deck (no duplicates)");
check(a.pot === 50 && a.me.chips === 475, "ante of 25 each in the pot");

const bad = await post(`/api/rooms/${code}/draw`, { token: "not-a-player", holds: [] });
check(bad.status === 403, "draw with a bad token is rejected");

let chipsTotalOk = true;
let winnerOk = true;
for (let hand = 1; hand <= 20; hand++) {
  // Host holds everything, guest throws everything away.
  await post(`/api/rooms/${code}/draw`, { token: host.json.token, holds: [true, true, true, true, true] });
  const mid = await B.until((s) => s.opp.drawn && s.handNo === hand);
  if (hand === 1) check(mid.phase === "draw" && mid.opp.hand.every((c) => c === null), "opponent drew, cards still hidden");
  await post(`/api/rooms/${code}/draw`, { token: guest.json.token, holds: [false, false, false, false, false] });
  a = await A.until((s) => (s.phase === "showdown" || s.phase === "over") && s.handNo === hand);
  const cmp = Math.sign(compareHands(a.me.hand, a.opp.hand));
  const expectWinner = cmp > 0 ? 0 : cmp < 0 ? 1 : null;
  if (a.result.winner !== expectWinner) winnerOk = false;
  if (a.me.chips + a.opp.chips !== 1000) chipsTotalOk = false;
  if (hand === 1) {
    check(a.opp.hand.every(Boolean), "showdown reveals the opponent's hand");
    check(new Set([...a.me.hand, ...a.opp.hand]).size === 10, "drawn cards come from the same deck");
  }
  if (a.phase === "over") break;
  await post(`/api/rooms/${code}/next`, { token: host.json.token });
  await post(`/api/rooms/${code}/next`, { token: guest.json.token });
  await A.until((s) => s.phase === "draw" && s.handNo === hand + 1);
}
check(winnerOk, `server picked the right winner every hand (through hand ${a.handNo})`);
check(chipsTotalOk, "chips are conserved (always 1,000 total)");

const left = await post(`/api/rooms/${code}/leave`, { token: host.json.token });
const gone = await post(`/api/rooms/${code}/join`, { name: "Late" });
check(left.status === 200 && gone.status === 404, "leaving closes the room");

A.close();
B.close();
server.close();
server.closeAllConnections?.();
console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
