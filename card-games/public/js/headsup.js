// Head-to-head video poker: two phones, one deck, straight showdown.
// The server deals and decides the winner; each phone only ever sees its own cards until showdown.
import { store, esc, cardHTML, toast, buzz, freshTracker } from "./ui.js";

export function mount(root) {
  let session = store.get("h2h:session", null); // { code, token }
  let state = null;
  let es = null;
  let held = [false, false, false, false, false];
  let heldFor = 0; // hand number the holds belong to
  let busy = false;
  let alive = true;
  let lastPhase = null;
  const fresh = freshTracker();

  async function api(path, body) {
    const slow = setTimeout(() => toast("Waking up the server — this can take up to a minute…", 8000), 2500);
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(json.error || "Something went wrong"), { status: r.status });
      return json;
    } finally {
      clearTimeout(slow);
    }
  }

  // ---------- Lobby ----------
  function lobby(prefillCode = "") {
    state = null;
    const name = store.get("h2h:name", "");
    root.innerHTML = `
      <div class="panel">
        <div class="field">
          <label for="name">Your name</label>
          <input id="name" maxlength="16" autocomplete="nickname" value="${esc(name)}" placeholder="e.g. Bryan">
        </div>
        <button class="btn" id="create" style="width:100%">Start a new game</button>
        <div class="or">— or join a friend's game —</div>
        <div class="field">
          <label for="code">Game code</label>
          <input id="code" class="code" maxlength="4" autocapitalize="characters" autocomplete="off" value="${esc(prefillCode)}" placeholder="ABCD">
        </div>
        <button class="btn secondary" id="join" style="width:100%">Join game</button>
      </div>
      <p class="sub">Both players get 5 cards from the same deck, hold what you like and draw once. Best hand takes the pot. Everyone starts with 500 chips; the ante is 25.</p>`;

    const nameEl = root.querySelector("#name");
    const codeEl = root.querySelector("#code");
    const getName = () => {
      const n = nameEl.value.trim();
      store.set("h2h:name", n);
      return n || "Player";
    };
    codeEl.addEventListener("input", () => (codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z]/g, "")));
    root.querySelector("#create").addEventListener("click", async (e) => {
      if (busy) return;
      busy = true;
      e.target.disabled = true;
      try {
        const res = await api("/api/rooms", { name: getName() });
        start({ code: res.code, token: res.token });
      } catch (err) {
        toast(err.message);
        e.target.disabled = false;
      } finally {
        busy = false;
      }
    });
    root.querySelector("#join").addEventListener("click", async (e) => {
      const code = codeEl.value.trim().toUpperCase();
      if (code.length !== 4) return toast("Enter the 4-letter code");
      if (busy) return;
      busy = true;
      e.target.disabled = true;
      try {
        const res = await api(`/api/rooms/${code}/join`, { name: getName() });
        start({ code: res.code, token: res.token });
      } catch (err) {
        toast(err.message);
        e.target.disabled = false;
      } finally {
        busy = false;
      }
    });
  }

  // ---------- Connection ----------
  function start(s) {
    session = s;
    store.set("h2h:session", s);
    connect();
    root.innerHTML = `<div class="spinner"></div><p class="sub">Connecting…</p>`;
  }

  function connect() {
    es?.close();
    es = new EventSource(`/api/rooms/${session.code}/events?token=${encodeURIComponent(session.token)}`);
    es.onmessage = (ev) => {
      state = JSON.parse(ev.data);
      if (state.handNo !== heldFor) {
        held = [false, false, false, false, false];
        heldFor = state.handNo;
      }
      if (lastPhase && lastPhase !== state.phase) buzz(state.phase === "showdown" || state.phase === "over" ? 30 : 12);
      lastPhase = state.phase;
      render();
    };
    es.addEventListener("closed", (ev) => {
      const by = JSON.parse(ev.data).by;
      endSession(`${by} ended the game`);
    });
    es.onerror = async () => {
      // EventSource reconnects by itself; check whether the game still exists.
      if (!alive || !session) return;
      try {
        await api(`/api/rooms/${session.code}/join`, { token: session.token });
      } catch (err) {
        if (err.status === 404 || err.status === 403 || err.status === 409) endSession("That game has ended");
      }
    };
  }

  function endSession(text) {
    es?.close();
    es = null;
    session = null;
    store.remove("h2h:session");
    if (alive) {
      toast(text, 3000);
      lobby();
    }
  }

  async function act(action, extra = {}) {
    if (busy) return;
    busy = true;
    try {
      await api(`/api/rooms/${session.code}/${action}`, { token: session.token, ...extra });
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
    }
  }

  async function share() {
    const url = `${location.origin}/?join=${state.code}`;
    const text = `Play video poker with me! Game code ${state.code}`;
    try {
      if (navigator.share) return await navigator.share({ title: "Card Games", text, url });
      await navigator.clipboard.writeText(`${text}: ${url}`);
      toast("Invite link copied");
    } catch {}
  }

  // ---------- Table ----------
  function render() {
    if (!alive || !state) return;
    const { me, opp, phase } = state;

    if (phase === "waiting") {
      root.innerHTML = `
        <div class="panel" style="text-align:center">
          <div class="label">Game code</div>
          <div class="bigcode">${esc(state.code)}</div>
          <p class="sub">Have your friend open the app, tap Head-to-Head Poker and enter this code — or send them the link.</p>
          <button class="btn" id="share" style="width:100%">Send invite</button>
          <div class="spinner" style="margin-top:18px"></div>
          <p class="sub">Waiting for a friend to join…</p>
        </div>
        <div class="row"><button class="btn secondary small" id="leave">Cancel game</button></div>`;
      root.querySelector("#share").addEventListener("click", share);
      root.querySelector("#leave").addEventListener("click", () => act("leave"));
      return;
    }

    const reveal = phase === "showdown" || phase === "over";
    const r = state.result;
    let banner = "";
    if (reveal && r) {
      const mine = r.hands[state.seat], theirs = r.hands[1 - state.seat];
      if (r.winner === null) banner = `<div class="msg">Split pot — both ${esc(mine)}</div>`;
      else if (r.winner === state.seat) banner = `<div class="msg win">You win ${r.pot} with ${esc(mine)}!</div>`;
      else banner = `<div class="msg lose">${esc(opp.name)} wins with ${esc(theirs)}</div>`;
      if (phase === "over") {
        const champ = me.chips > opp.chips ? "You" : esc(opp.name);
        banner += `<p class="sub"><b>${champ}</b> won all the chips. Play again to start over at 500 each.</p>`;
      }
    }

    const oppStatus = reveal ? esc(r?.hands[1 - state.seat] || "") : opp.drawn ? "Drew — waiting on you" : "Choosing cards…";
    const myStatus = reveal ? esc(r?.hands[state.seat] || "") : me.drawn ? `Waiting for ${esc(opp.name)}…` : "Tap cards to hold, then Draw";

    let actions = "";
    if (phase === "draw" && !me.drawn) {
      const n = held.filter(Boolean).length;
      actions = `<button class="btn" id="draw" style="width:100%">${n === 5 ? "Stand pat" : `Draw ${5 - n}`}</button>`;
    } else if (reveal) {
      actions = me.ready
        ? `<p class="sub">Waiting for ${esc(opp.name)} to deal again…</p>`
        : `<button class="btn" id="next" style="width:100%">${phase === "over" ? "Play again" : "Next hand"}</button>`;
    }

    root.innerHTML = `
      <div class="panel">
        <div class="players"><span><i class="dot ${opp.online ? "" : "off"}"></i>${esc(opp.name)}</span><span class="chipcount">● ${opp.chips}</span></div>
        <div class="sub" style="margin:6px 0 8px">${opp.online ? oppStatus : "Offline — they'll be back when they reopen the app"}</div>
        <div class="vp-hand">${opp.hand.map((c, i) => `<div class="cardbtn">${cardHTML(c, fresh("o" + i, c))}</div>`).join("")}</div>
      </div>
      <div class="pot">Pot ${state.pot} · Hand ${state.handNo}</div>
      ${banner}
      <div class="panel">
        <div class="players"><span>${esc(me.name)} (you)</span><span class="chipcount">● ${me.chips}</span></div>
        <div class="sub" style="margin:6px 0 4px">${myStatus}</div>
        <div class="vp-hand">
          ${me.hand
            .map((c, i) => `<button class="cardbtn ${held[i] && phase === "draw" && !me.drawn ? "held" : ""}" data-i="${i}" ${phase === "draw" && !me.drawn ? "" : "disabled"}><span class="held-tag">HELD</span>${cardHTML(c, fresh("m" + i, c))}</button>`)
            .join("")}
        </div>
      </div>
      ${actions}
      <div class="row" style="margin-top:16px">
        <button class="btn secondary small" id="share">Invite link</button>
        <button class="btn secondary small" id="leave">End game</button>
      </div>`;

    root.querySelectorAll("button.cardbtn").forEach((b) =>
      b.addEventListener("click", () => {
        held[+b.dataset.i] = !held[+b.dataset.i];
        b.classList.toggle("held", held[+b.dataset.i]);
        const n = held.filter(Boolean).length;
        const drawBtn = root.querySelector("#draw");
        if (drawBtn) drawBtn.textContent = n === 5 ? "Stand pat" : `Draw ${5 - n}`;
        buzz(8);
      })
    );
    root.querySelector("#draw")?.addEventListener("click", () => act("draw", { holds: held }));
    root.querySelector("#next")?.addEventListener("click", () => act("next"));
    root.querySelector("#share").addEventListener("click", share);
    root.querySelector("#leave").addEventListener("click", () => {
      if (confirmLeave()) act("leave");
    });
  }

  // Two taps to end the game, without a blocking browser dialog.
  let leaveArmed = 0;
  function confirmLeave() {
    if (Date.now() - leaveArmed < 3000) return true;
    leaveArmed = Date.now();
    toast("Tap End game again to end it for both players");
    return false;
  }

  // Reconnect to a game in progress (e.g. after the phone locked), or open the lobby.
  const joinCode = sessionStorage.getItem("cg:joinCode");
  sessionStorage.removeItem("cg:joinCode");
  if (session && !joinCode) {
    root.innerHTML = `<div class="spinner"></div><p class="sub">Reconnecting…</p>`;
    connect();
  } else {
    if (joinCode && session) {
      store.remove("h2h:session");
      session = null;
    }
    lobby(joinCode || "");
  }

  return () => {
    alive = false;
    es?.close();
  };
}
