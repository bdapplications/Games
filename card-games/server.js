// Card Games server — serves the web app and runs head-to-head video poker rooms.
// No dependencies: uses only Node's built-in modules. Start with `npm start`.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { shuffledDeck, evaluate, compareHands } from "./public/js/cards.js";

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

const START_CHIPS = 500;
const ANTE = 25;
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000; // rooms vanish after 3 idle hours
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O (look like 1 and 0)

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ---------------- Rooms ----------------

/** @type {Map<string, any>} */
const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function newPlayer(name) {
  return {
    token: randomUUID(),
    name: cleanName(name),
    chips: START_CHIPS,
    hand: [],
    drawn: false,
    ready: false,
    streams: new Set(),
  };
}

function cleanName(name) {
  const n = String(name || "").replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 16);
  return n || "Player";
}

function dealHand(room) {
  room.deck = shuffledDeck();
  room.handNo += 1;
  room.result = null;
  room.pot = 0;
  for (const p of room.players) {
    p.chips -= ANTE;
    room.pot += ANTE;
    p.hand = room.deck.splice(0, 5);
    p.drawn = false;
    p.ready = false;
  }
  room.phase = "draw";
}

function showdown(room) {
  const [a, b] = room.players;
  const cmp = compareHands(a.hand, b.hand);
  let winner = null;
  if (cmp > 0) winner = 0;
  else if (cmp < 0) winner = 1;
  if (winner === null) {
    a.chips += room.pot / 2;
    b.chips += room.pot / 2;
  } else {
    room.players[winner].chips += room.pot;
  }
  room.result = {
    winner, // 0, 1, or null for a split pot
    pot: room.pot,
    hands: [evaluate(a.hand).name, evaluate(b.hand).name],
  };
  room.phase = room.players.some((p) => p.chips < ANTE) ? "over" : "showdown";
}

// What one player is allowed to see. The opponent's cards stay hidden until showdown.
function viewFor(room, seat) {
  const me = room.players[seat];
  const opp = room.players[1 - seat];
  const reveal = room.phase === "showdown" || room.phase === "over";
  return {
    code: room.code,
    phase: room.phase, // waiting | draw | showdown | over
    seat,
    ante: ANTE,
    pot: room.pot,
    handNo: room.handNo,
    result: room.result,
    me: { name: me.name, chips: me.chips, hand: me.hand, drawn: me.drawn, ready: me.ready },
    opp: opp
      ? {
          name: opp.name,
          chips: opp.chips,
          drawn: opp.drawn,
          ready: opp.ready,
          online: opp.streams.size > 0,
          hand: reveal ? opp.hand : opp.hand.map(() => null),
        }
      : null,
  };
}

function broadcast(room) {
  room.lastActivity = Date.now();
  room.players.forEach((p, seat) => {
    const data = `data: ${JSON.stringify(viewFor(room, seat))}\n\n`;
    for (const res of p.streams) res.write(data);
  });
}

function findSeat(room, token) {
  return room.players.findIndex((p) => p.token === token);
}

// Clean up idle rooms.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_IDLE_MS) {
      for (const p of room.players) for (const res of p.streams) res.end();
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

// ---------------- HTTP helpers ----------------

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10_000) throw new Error("Body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: "Forbidden" });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(filePath);
    const type = MIME[extname(filePath)] || "application/octet-stream";
    // The service worker and HTML should always be fresh so updates reach phones quickly.
    const noCache = filePath.endsWith("sw.js") || type.startsWith("text/html");
    res.writeHead(200, { "Content-Type": type, "Cache-Control": noCache ? "no-cache" : "public, max-age=300" });
    res.end(body);
  } catch {
    // Unknown path: fall back to the app shell.
    const body = await readFile(join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
    res.end(body);
  }
}

// ---------------- API ----------------

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "rooms", CODE, action]
  const method = req.method;

  if (parts[1] === "health") return sendJSON(res, 200, { ok: true, rooms: rooms.size });
  if (parts[1] !== "rooms") return sendJSON(res, 404, { error: "Not found" });

  // POST /api/rooms  -> create a room
  if (parts.length === 2 && method === "POST") {
    const body = await readBody(req);
    const code = makeCode();
    const host = newPlayer(body.name);
    rooms.set(code, { code, players: [host], phase: "waiting", pot: 0, handNo: 0, result: null, deck: [], lastActivity: Date.now() });
    return sendJSON(res, 200, { code, token: host.token, seat: 0 });
  }

  const code = String(parts[2] || "").toUpperCase();
  const room = rooms.get(code);
  const action = parts[3];
  if (!room) return sendJSON(res, 404, { error: "No game with that code. Check the letters or start a new game." });

  // GET /api/rooms/CODE/events?token=...  -> live updates (Server-Sent Events)
  if (action === "events" && method === "GET") {
    const seat = findSeat(room, url.searchParams.get("token"));
    if (seat < 0) return sendJSON(res, 403, { error: "Not in this game" });
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 2000\n\n");
    const player = room.players[seat];
    player.streams.add(res);
    broadcast(room); // sends this player the current state and tells the opponent they're online
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ping);
      player.streams.delete(res);
      if (rooms.has(code)) broadcast(room);
    });
    return;
  }

  if (method !== "POST") return sendJSON(res, 405, { error: "Method not allowed" });
  const body = await readBody(req);

  // POST /api/rooms/CODE/join {name, token?}
  if (action === "join") {
    const existing = findSeat(room, body.token);
    if (existing >= 0) return sendJSON(res, 200, { code, token: body.token, seat: existing }); // rejoin
    if (room.players.length >= 2) return sendJSON(res, 409, { error: "That game already has two players." });
    const guest = newPlayer(body.name);
    room.players.push(guest);
    dealHand(room);
    broadcast(room);
    return sendJSON(res, 200, { code, token: guest.token, seat: 1 });
  }

  const seat = findSeat(room, body.token);
  if (seat < 0) return sendJSON(res, 403, { error: "Not in this game" });
  const me = room.players[seat];

  // POST /api/rooms/CODE/draw {token, holds:[true,false,...]}
  if (action === "draw") {
    if (room.phase !== "draw" || me.drawn) return sendJSON(res, 409, { error: "Not your turn to draw" });
    const holds = Array.isArray(body.holds) ? body.holds : [];
    me.hand = me.hand.map((card, i) => (holds[i] ? card : room.deck.shift()));
    me.drawn = true;
    if (room.players.every((p) => p.drawn)) showdown(room);
    broadcast(room);
    return sendJSON(res, 200, { ok: true });
  }

  // POST /api/rooms/CODE/next {token}  -> ready for the next hand (or a rematch when someone is out of chips)
  if (action === "next") {
    if (room.phase !== "showdown" && room.phase !== "over") return sendJSON(res, 409, { error: "Hand still in progress" });
    me.ready = true;
    if (room.players.length === 2 && room.players.every((p) => p.ready)) {
      if (room.phase === "over") for (const p of room.players) p.chips = START_CHIPS;
      dealHand(room);
    }
    broadcast(room);
    return sendJSON(res, 200, { ok: true });
  }

  // POST /api/rooms/CODE/leave {token}
  if (action === "leave") {
    for (const p of room.players) for (const res2 of p.streams) {
      res2.write(`event: closed\ndata: ${JSON.stringify({ by: me.name })}\n\n`);
      res2.end();
    }
    rooms.delete(code);
    return sendJSON(res, 200, { ok: true });
  }

  return sendJSON(res, 404, { error: "Unknown action" });
}

// ---------------- Server ----------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return sendJSON(res, 405, { error: "Method not allowed" });
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJSON(res, 400, { error: "Bad request" });
    else res.end();
  }
});

server.listen(PORT, () => console.log(`Card Games running on http://localhost:${PORT}`));

export { server, rooms };
