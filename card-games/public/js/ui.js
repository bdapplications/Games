// Small shared helpers for the screens.
import { SUIT_SYMBOL, RANK_LABEL } from "./cards.js";

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("cg:" + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("cg:" + key, JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem("cg:" + key);
    } catch {}
  },
};

// Shared chip bankroll for blackjack and video poker.
export const START_BANK = 1000;
export const bank = {
  get: () => store.get("bank", START_BANK),
  set(n) {
    store.set("bank", n);
    showBank(n);
  },
  add(n) {
    bank.set(bank.get() + n);
  },
};
export function showBank(n = bank.get()) {
  const el = document.getElementById("bank");
  el.textContent = Number(n).toLocaleString();
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function cardHTML(card, extra = "") {
  if (card === null || card === "back") return `<div class="card back ${extra}" aria-label="face-down card"></div>`;
  if (!card) return `<div class="card slot ${extra}"></div>`;
  const r = RANK_LABEL[card[0]] || card[0];
  const s = SUIT_SYMBOL[card[1]];
  const red = card[1] === "h" || card[1] === "d" ? "red" : "";
  return `<div class="card ${red} ${extra}" aria-label="${r} of ${{ s: "spades", h: "hearts", d: "diamonds", c: "clubs" }[card[1]]}">
    <div class="corner">${r}<small>${s}</small></div><div class="pip">${s}</div></div>`;
}

// Remembers which card sat in each spot on the last render, so only newly dealt cards animate.
// Usage: const fresh = freshTracker();  cardHTML(card, fresh("me0", card))
export function freshTracker() {
  const last = new Map();
  return (slot, card) => {
    const changed = last.get(slot) !== card;
    last.set(slot, card);
    return changed && card !== "" && card !== undefined ? "new" : "";
  };
}

let toastTimer;
export function toast(text, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

export function buzz(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
