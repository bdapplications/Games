# Card Games

Tic-tac-toe, blackjack (21), Jacks-or-Better video poker and air hockey, plus head-to-head video poker
between two phones. It installs on an iPhone from Safari (no App Store) and has no npm dependencies.

## Deploy on Render

1. Put this folder in a GitHub repo: create a new repo on github.com, then use **Add file → Upload files**
   and drag in everything here, including the hidden `.gitignore`.
2. In Render: **New → Web Service**, then pick the repo.
   - Runtime: **Node**
   - Build command: `true` (there's nothing to install)
   - Start command: `node server.js`
   - Instance type: Free is fine
   You can also use **New → Blueprint**, which reads `render.yaml` and fills these in for you.
3. When it's live, open the `https://<name>.onrender.com` URL in **Safari** on the iPhone and tap
   **Share → Add to Home Screen**.

## Playing head-to-head

One person opens **Head-to-Head Poker** and taps **Start a new game**. That gives a 4-letter code
and an **Send invite** button that texts a link. The other person enters the code or taps the link,
and the server deals both hands from one deck. Each player holds cards and draws once, and the best
hand takes the pot. Everyone starts with 500 chips and the ante is 25. When one player runs out,
**Play again** resets both to 500.

The server does all the dealing and decides each hand, so neither phone can see the other's cards
before the showdown. If a phone locks mid-game, reopening the app reconnects to the same game.

## Things to know about Render's free plan

- The server **goes to sleep after about 15 minutes with no visitors**. The first visit after that takes
  roughly a minute to wake it up, and the app shows a "Waking up the server" message while it waits.
  The single-player games keep working while it sleeps because they're stored on the phone.
- Games in progress are kept in memory, so a restart or redeploy ends any head-to-head games.
  Chip banks for blackjack and video poker are saved on each phone, so those aren't affected.
- A paid Render instance stays awake if the wake-up delay gets annoying.

## Updating

After changing any file, bump `VERSION` in `public/sw.js` (e.g. `"v2"`) so phones pick up the new
version. Then close and reopen the app.

## Rules used

- **Blackjack:** 6-deck shoe, reshuffled when about 75% has been dealt. The dealer stands on all 17s,
  blackjack pays 3:2, and the dealer checks for blackjack right away. You can double on any first two
  cards, including after a split, and split once. Split aces get one card each.
- **Video poker:** Jacks or Better, full-pay 9/6 table. A royal flush pays 4,000 when you bet 5.
- **Head-to-head:** straight showdown, standard poker hand rankings, and identical hands split the pot.
- **Air hockey:** first to 7. Play the phone on Easy, Medium or Hard, or two people on one phone, each
  using their own half of the table. It's on one phone only; online air hockey would lag too much over
  this kind of server.

## Tests

`npm test` does two things:
- It checks the hand evaluator against all 2,598,960 possible 5-card hands, which must match the
  published count for every category. It also checks tiebreaks, payouts and shuffle fairness.
- It plays 20 head-to-head hands between two simulated players against a real server.
