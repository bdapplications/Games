// App shell: menu + simple hash router.
import { bank, showBank, START_BANK, toast } from "./ui.js";
import * as tictactoe from "./tictactoe.js";
import * as blackjack from "./blackjack.js";
import * as videopoker from "./videopoker.js";
import * as headsup from "./headsup.js";
import * as airhockey from "./airhockey.js";

const app = document.getElementById("app");
const titleEl = document.getElementById("title");
const backBtn = document.getElementById("backBtn");
const bankEl = document.getElementById("bank");

const SCREENS = {
  ttt: { title: "Tic-Tac-Toe", mod: tictactoe, bank: false },
  bj: { title: "Blackjack", mod: blackjack, bank: true },
  vp: { title: "Video Poker", mod: videopoker, bank: true },
  h2h: { title: "Head-to-Head Poker", mod: headsup, bank: false },
  ah: { title: "Air Hockey", mod: airhockey, bank: false },
};

let cleanup = null;

function menu() {
  titleEl.textContent = "Card Games";
  backBtn.hidden = true;
  bankEl.hidden = false;
  showBank();
  app.innerHTML = `
    <div class="menu">
      <button class="tile" data-go="ttt"><div class="ico">⭕</div><div><b>Tic-Tac-Toe</b><span>vs. the phone or a friend</span></div></button>
      <button class="tile" data-go="bj"><div class="ico">🂡</div><div><b>Blackjack (21)</b><span>Beat the dealer · 3:2 blackjacks</span></div></button>
      <button class="tile" data-go="vp"><div class="ico">🃏</div><div><b>Video Poker</b><span>Jacks or Better · solo</span></div></button>
      <button class="tile" data-go="h2h"><div class="ico">🤝</div><div><b>Head-to-Head Poker</b><span>Play a friend on their phone</span></div></button>
      <button class="tile" data-go="ah"><div class="ico">🏒</div><div><b>Air Hockey</b><span>vs. the phone or a friend</span></div></button>
    </div>
    <div class="menu-foot">
      Blackjack and video poker share one chip bank.<br>
      <button class="linkbtn" id="resetBank">Reset chips to ${START_BANK.toLocaleString()}</button>
    </div>`;
  app.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => (location.hash = "#/" + b.dataset.go)));
  app.querySelector("#resetBank").addEventListener("click", () => {
    bank.set(START_BANK);
    toast("Chips reset");
  });
}

function route() {
  cleanup?.();
  cleanup = null;
  window.scrollTo(0, 0);
  const key = location.hash.replace(/^#\/?/, "").split("?")[0];
  const screen = SCREENS[key];
  if (!screen) return menu();
  titleEl.textContent = screen.title;
  backBtn.hidden = false;
  bankEl.hidden = !screen.bank;
  if (screen.bank) showBank();
  app.innerHTML = "";
  cleanup = screen.mod.mount(app) || null;
}

backBtn.addEventListener("click", () => (location.hash = "#/"));
window.addEventListener("hashchange", route);

// A shared invite link looks like  https://yourapp.onrender.com/?join=ABCD
const join = new URLSearchParams(location.search).get("join");
if (join) {
  sessionStorage.setItem("cg:joinCode", join.toUpperCase().slice(0, 4));
  history.replaceState(null, "", "/#/h2h");
}
route();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
