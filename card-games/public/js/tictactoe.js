import { store, buzz } from "./ui.js";

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function winner(b) {
  for (const l of LINES) {
    const [a, c, d] = l;
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { mark: b[a], line: l };
  }
  return b.every(Boolean) ? { mark: "draw", line: [] } : null;
}

// Minimax: perfect play for the computer (O). Prefers faster wins / slower losses.
function minimax(b, turn, depth = 0) {
  const w = winner(b);
  if (w) return { score: w.mark === "O" ? 10 - depth : w.mark === "X" ? depth - 10 : 0 };
  let best = { score: turn === "O" ? -Infinity : Infinity, move: -1 };
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = turn;
    const { score } = minimax(b, turn === "O" ? "X" : "O", depth + 1);
    b[i] = null;
    if (turn === "O" ? score > best.score : score < best.score) best = { score, move: i };
  }
  return best;
}

function computerMove(b, level) {
  const open = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (level === "easy") {
    // Takes a win if it sees one, otherwise plays randomly.
    for (const i of open) {
      const t = [...b];
      t[i] = "O";
      if (winner(t)?.mark === "O") return i;
    }
    return open[Math.floor(Math.random() * open.length)];
  }
  if (level === "medium" && Math.random() < 0.35) return open[Math.floor(Math.random() * open.length)];
  return minimax([...b], "O").move;
}

export function mount(root) {
  let mode = store.get("ttt:mode", "hard"); // easy | medium | hard | friend
  let score = store.get("ttt:score", { X: 0, O: 0, draw: 0 });
  let board, turn, done, starter = "X", timer;

  function reset() {
    board = Array(9).fill(null);
    done = null;
    turn = starter;
    starter = starter === "X" ? "O" : "X"; // alternate who goes first
    render();
    if (mode !== "friend" && turn === "O") think();
  }

  function play(i) {
    if (done || board[i]) return;
    board[i] = turn;
    buzz();
    done = winner(board);
    if (done) {
      score[done.mark] += 1;
      store.set("ttt:score", score);
    } else turn = turn === "X" ? "O" : "X";
    render();
    if (!done && mode !== "friend" && turn === "O") think();
  }

  function think() {
    timer = setTimeout(() => play(computerMove(board, mode)), 380);
  }

  function status() {
    const vs = mode !== "friend";
    if (done?.mark === "draw") return "It's a draw";
    if (done) return vs ? (done.mark === "X" ? "You win!" : "Phone wins") : `${done.mark} wins!`;
    return vs ? (turn === "X" ? "Your turn (X)" : "Phone is thinking…") : `${turn}'s turn`;
  }

  function render() {
    const names = mode === "friend" ? ["X", "O"] : ["You", "Phone"];
    root.innerHTML = `
      <div class="seg" role="tablist">
        ${["easy", "medium", "hard", "friend"].map((m) => `<button data-mode="${m}" class="${m === mode ? "on" : ""}">${{ easy: "Easy", medium: "Medium", hard: "Unbeatable", friend: "2 Players" }[m]}</button>`).join("")}
      </div>
      <div class="msg ${done && done.mark === "X" ? "win" : ""}">${status()}</div>
      <div class="ttt">
        ${board.map((v, i) => `<button data-i="${i}" class="${(v || "").toLowerCase()} ${done?.line.includes(i) ? "win" : ""}" aria-label="square ${i + 1}">${v || ""}</button>`).join("")}
      </div>
      <div class="panel score">
        <div><b>${score.X}</b><span>${names[0]}</span></div>
        <div><b>${score.draw}</b><span>Draws</span></div>
        <div><b>${score.O}</b><span>${names[1]}</span></div>
      </div>
      <div class="row">
        <button class="btn" id="again">${done ? "Play again" : "Restart"}</button>
        <button class="btn secondary small" id="clear">Clear score</button>
      </div>`;
    root.querySelectorAll(".ttt button").forEach((b) =>
      b.addEventListener("click", () => {
        if (mode !== "friend" && turn === "O") return;
        play(+b.dataset.i);
      })
    );
    root.querySelectorAll("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.mode === mode) return;
        mode = b.dataset.mode;
        store.set("ttt:mode", mode);
        score = { X: 0, O: 0, draw: 0 };
        store.set("ttt:score", score);
        clearTimeout(timer);
        starter = "X";
        reset();
      })
    );
    root.querySelector("#again").addEventListener("click", () => {
      clearTimeout(timer);
      reset();
    });
    root.querySelector("#clear").addEventListener("click", () => {
      score = { X: 0, O: 0, draw: 0 };
      store.set("ttt:score", score);
      render();
    });
  }

  reset();
  return () => clearTimeout(timer);
}
