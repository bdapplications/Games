// Solo video poker — Jacks or Better, full-pay 9/6 table.
import { shuffledDeck, JOB_PAYTABLE, jobPayout } from "./cards.js";
import { bank, store, cardHTML, toast, buzz, START_BANK, freshTracker } from "./ui.js";

export function mount(root) {
  let bet = store.get("vp:bet", 5);
  let phase = "ready"; // ready | hold | done
  let deck = [];
  let hand = store.get("vp:lastHand", []);
  let held = [false, false, false, false, false];
  let result = null;
  const fresh = freshTracker();

  function render() {
    const win = result?.row?.key;
    const rows = JOB_PAYTABLE.map((r) => {
      const cols = [1, 2, 3, 4, 5].map((b) => {
        const pay = r.key === "royal" && b === 5 ? 4000 : r.pay * b;
        return `<td class="${b === bet ? "col" : ""}">${pay}</td>`;
      });
      return `<tr class="${win === r.key && phase === "done" ? "hit" : ""}"><td>${r.name}</td>${cols.join("")}</tr>`;
    }).join("");

    const cards = hand.length === 5 ? hand : [null, null, null, null, null];
    const msg =
      phase === "done"
        ? result.win
          ? `<div class="msg win">${result.row.name}! +${result.win}</div>`
          : `<div class="msg">No win</div>`
        : phase === "hold"
        ? `<div class="msg" style="font-size:16px;font-weight:600">Tap cards to hold, then Draw</div>`
        : `<div class="msg"></div>`;

    root.innerHTML = `
      <div class="panel"><table class="paytable">${rows}</table></div>
      ${msg}
      <div class="vp-hand">
        ${cards
          .map(
            (c, i) => `<button class="cardbtn ${held[i] && phase === "hold" ? "held" : ""}" data-i="${i}" ${phase !== "hold" ? "disabled" : ""}>
              <span class="held-tag">HELD</span>${cardHTML(c, fresh(i, c))}</button>`
          )
          .join("")}
      </div>
      <div class="bet-display" style="margin:14px 0">Bet<b>${bet}</b></div>
      <div class="row">
        <button class="btn secondary" id="betOne" ${phase === "hold" ? "disabled" : ""}>Bet One</button>
        <button class="btn secondary" id="betMax" ${phase === "hold" ? "disabled" : ""}>Bet Max</button>
        <button class="btn" id="go">${phase === "hold" ? "Draw" : "Deal"}</button>
      </div>
      ${bank.get() < 1 && phase !== "hold" ? `<p class="sub">Out of chips. <button class="linkbtn" id="refill">Refill to ${START_BANK}</button></p>` : ""}
      <p class="sub">Bet 5 for the 4,000-chip royal flush bonus</p>`;

    root.querySelectorAll(".cardbtn").forEach((b) =>
      b.addEventListener("click", () => {
        held[+b.dataset.i] = !held[+b.dataset.i];
        b.classList.toggle("held", held[+b.dataset.i]);
        buzz(8);
      })
    );
    const on = (id, fn) => root.querySelector(id)?.addEventListener("click", fn);
    on("#betOne", () => setBet(bet >= 5 ? 1 : bet + 1));
    on("#betMax", () => {
      setBet(5);
      if (phase !== "hold") deal();
    });
    on("#go", () => (phase === "hold" ? drawCards() : deal()));
    on("#refill", () => { bank.set(START_BANK); render(); });
  }

  function setBet(n) {
    bet = n;
    store.set("vp:bet", bet);
    if (phase === "done") phase = "ready";
    render();
  }

  function deal() {
    if (bank.get() < bet) {
      if (bank.get() < 1) return render();
      bet = bank.get();
      toast(`Bet lowered to ${bet}`);
    }
    bank.add(-bet);
    deck = shuffledDeck();
    hand = deck.splice(0, 5);
    held = [false, false, false, false, false];
    result = null;
    phase = "hold";
    render();
  }

  function drawCards() {
    hand = hand.map((c, i) => (held[i] ? c : deck.shift()));
    result = jobPayout(hand, bet);
    if (result.win) bank.add(result.win);
    store.set("vp:lastHand", hand);
    buzz(result.win ? 40 : 10);
    phase = "done";
    render();
  }

  render();
  return () => {
    // Leaving with a hand on screen: draw it as-is so the bet isn't lost or duplicated.
    if (phase === "hold") drawCards();
  };
}
