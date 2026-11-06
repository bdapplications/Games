// Blackjack: 6-deck shoe, dealer stands on soft 17, blackjack pays 3:2,
// double on any first two cards, split once (split aces get one card each).
import { shuffledDeck, rankValue } from "./cards.js";
import { bank, store, cardHTML, toast, buzz, sleep, START_BANK, freshTracker } from "./ui.js";

const DECKS = 6;

function cardPoints(c) {
  const v = rankValue(c);
  return v === 14 ? 11 : Math.min(v, 10);
}

export function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    total += cardPoints(c);
    if (c[0] === "A") aces++;
  }
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

export function mount(root) {
  let shoe = shuffledDeck(DECKS);
  let bet = store.get("bj:lastBet", 25);
  let phase = "bet"; // bet | play | dealer | done
  let dealer = [];
  let hands = []; // { cards, bet, done, doubled, fromSplit, result }
  let active = 0;
  let message = "";
  let alive = true;
  const fresh = freshTracker();

  const draw = () => {
    if (shoe.length < DECKS * 52 * 0.25) {
      shoe = shuffledDeck(DECKS);
      toast("Shuffling a fresh shoe");
    }
    return shoe.pop();
  };

  function render() {
    if (!alive) return;
    const showHole = phase === "dealer" || phase === "done";
    const dealerCards = dealer.map((c, i) => (i === 1 && !showHole ? "back" : c));
    const dv = showHole ? handValue(dealer).total : dealer.length ? cardPoints(dealer[0]) : "";

    let html = `
      <div class="panel">
        <div class="label">Dealer ${dealer.length ? `<span class="total">${dv}</span>` : ""}</div>
        <div class="hand spread">${dealer.length ? dealerCards.map((c, i) => cardHTML(c, fresh("d" + i, c))).join("") : cardHTML("") + cardHTML("")}</div>
      </div>
      <div class="msg ${/win|Blackjack!/i.test(message) ? "win" : /lose|bust/i.test(message) ? "lose" : ""}">${message}</div>`;

    if (phase === "bet") {
      html += `
        <div class="bet-display">Your bet<b>${bet.toLocaleString()}</b></div>
        <div class="chips">
          ${[10, 25, 50, 100].map((v) => `<button class="chip c${v}" data-chip="${v}">${v}</button>`).join("")}
        </div>
        <div class="row">
          <button class="btn secondary" id="clear">Clear</button>
          <button class="btn" id="deal" ${bet < 1 || bet > bank.get() ? "disabled" : ""}>Deal</button>
        </div>
        ${bank.get() < 10 ? `<p class="sub">Out of chips. <button class="linkbtn" id="refill">Refill to ${START_BANK}</button></p>` : ""}
        <p class="sub">Dealer stands on soft 17 · Blackjack pays 3:2</p>`;
    } else {
      html += `<div class="bj-hands">${hands
        .map((h, i) => {
          const v = handValue(h.cards);
          const tag = h.result ? ` — ${h.result}` : "";
          return `<div class="panel bj-hand ${phase === "play" && i === active && hands.length > 1 ? "active" : ""}">
            <div class="label"><b>${hands.length > 1 ? `Hand ${i + 1}` : "You"}</b> · bet ${h.bet}${tag} <span class="total">${v.soft && v.total < 21 && !h.done ? `${v.total - 10}/${v.total}` : v.total}</span></div>
            <div class="hand spread">${h.cards.map((c, j) => cardHTML(c, fresh(`h${i}-${j}`, c))).join("")}</div></div>`;
        })
        .join("")}</div>`;

      if (phase === "play") {
        const h = hands[active];
        const canDouble = h.cards.length === 2 && bank.get() >= h.bet && !h.fromSplitAces;
        const canSplit = hands.length === 1 && h.cards.length === 2 && cardPoints(h.cards[0]) === cardPoints(h.cards[1]) && bank.get() >= h.bet;
        html += `
          <div class="row">
            <button class="btn" id="hit">Hit</button>
            <button class="btn" id="stand">Stand</button>
          </div>
          <div class="row" style="margin-top:10px">
            <button class="btn secondary" id="double" ${canDouble ? "" : "disabled"}>Double</button>
            <button class="btn secondary" id="split" ${canSplit ? "" : "disabled"}>Split</button>
          </div>`;
      } else if (phase === "done") {
        html += `<div class="row"><button class="btn" id="again">New hand</button></div>`;
      }
    }

    root.innerHTML = html;
    const on = (id, fn) => root.querySelector(id)?.addEventListener("click", fn);
    root.querySelectorAll("[data-chip]").forEach((b) =>
      b.addEventListener("click", () => {
        const v = +b.dataset.chip;
        if (bet + v > bank.get()) return toast("Not enough chips");
        bet += v;
        buzz();
        render();
      })
    );
    on("#clear", () => { bet = 0; render(); });
    on("#refill", () => { bank.set(START_BANK); render(); });
    on("#deal", deal);
    on("#hit", hit);
    on("#stand", stand);
    on("#double", doubleDown);
    on("#split", split);
    on("#again", () => {
      phase = "bet";
      message = "";
      dealer = [];
      hands = [];
      if (bet > bank.get()) bet = Math.min(25, bank.get());
      render();
    });
  }

  function deal() {
    if (bet < 1 || bet > bank.get()) return;
    store.set("bj:lastBet", bet);
    bank.add(-bet);
    hands = [{ cards: [draw()], bet, done: false }];
    dealer = [draw()];
    hands[0].cards.push(draw());
    dealer.push(draw());
    active = 0;
    message = "";
    phase = "play";

    const playerBJ = isBlackjack(hands[0].cards);
    const dealerBJ = isBlackjack(dealer); // dealer checks for blackjack right away (US style)
    if (playerBJ || dealerBJ) {
      phase = "done";
      if (playerBJ && dealerBJ) {
        bank.add(bet);
        message = "Push — both have blackjack";
        hands[0].result = "push";
      } else if (playerBJ) {
        const win = bet + Math.floor(bet * 1.5);
        bank.add(win);
        message = `Blackjack! +${win - bet}`;
        hands[0].result = "blackjack";
      } else {
        message = "Dealer has blackjack — you lose";
        hands[0].result = "lose";
      }
    }
    render();
  }

  function nextHand() {
    hands[active].done = true;
    if (active < hands.length - 1) {
      active++;
      const h = hands[active];
      if (h.cards.length === 1) h.cards.push(draw()); // second card for a split hand
      if (h.fromSplitAces || handValue(h.cards).total === 21) return nextHand();
      render();
    } else {
      dealerPlay();
    }
  }

  function hit() {
    const h = hands[active];
    h.cards.push(draw());
    buzz();
    const t = handValue(h.cards).total;
    if (t > 21) {
      h.result = "bust";
      nextHand();
    } else if (t === 21) nextHand();
    else render();
  }

  function stand() {
    nextHand();
  }

  function doubleDown() {
    const h = hands[active];
    bank.add(-h.bet);
    h.bet *= 2;
    h.doubled = true;
    h.cards.push(draw());
    if (handValue(h.cards).total > 21) h.result = "bust";
    nextHand();
  }

  function split() {
    const h = hands[0];
    bank.add(-h.bet);
    const aces = h.cards[0][0] === "A";
    hands = [
      { cards: [h.cards[0], draw()], bet: h.bet, done: false, fromSplitAces: aces },
      { cards: [h.cards[1]], bet: h.bet, done: false, fromSplitAces: aces },
    ];
    active = 0;
    if (aces || handValue(hands[0].cards).total === 21) return nextHand();
    render();
  }

  async function dealerPlay() {
    phase = "dealer";
    render();
    if (hands.some((h) => h.result !== "bust")) {
      while (handValue(dealer).total < 17) { // dealer stands on all 17s, soft or hard
        await sleep(550);
        if (!alive) return;
        dealer.push(draw());
        render();
      }
    }
    await sleep(350);
    if (alive) settle();
  }

  // Leaving mid-hand: stand on everything and finish the hand instantly so chips stay correct.
  function finishNow() {
    if (phase !== "play" && phase !== "dealer") return;
    for (const h of hands) if (h.cards.length === 1) h.cards.push(draw());
    if (hands.some((h) => h.result !== "bust")) while (handValue(dealer).total < 17) dealer.push(draw());
    settle();
  }

  function settle() {
    const d = handValue(dealer).total;
    let net = 0;
    for (const h of hands) {
      if (h.result === "bust") {
        net -= h.bet;
        continue;
      }
      const p = handValue(h.cards).total;
      if (d > 21 || p > d) {
        h.result = "win";
        bank.add(h.bet * 2);
        net += h.bet;
      } else if (p === d) {
        h.result = "push";
        bank.add(h.bet);
      } else {
        h.result = "lose";
        net -= h.bet;
      }
    }
    const bust = d > 21 ? "Dealer busts. " : "";
    message = net > 0 ? `${bust}You win +${net}` : net < 0 ? `${bust}You lose −${-net}` : `${bust}Push`;
    if (hands.length === 1 && hands[0].result === "bust") message = `Bust — you lose −${hands[0].bet}`;
    phase = "done";
    render();
  }

  render();
  return () => {
    alive = false;
    finishNow();
  };
}
