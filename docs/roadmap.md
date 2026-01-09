# Quoridor: From Prototype to Product 🚀

This roadmap outlines the steps to transform the current Quoridor prototype into a polished, publishable, and profitable web game.

## 📅 Phase 1: Polish & User Experience (Next 2 Weeks)
**Goal:** Make the game look professional and feel responsive. Retain players who land on the site.

- [ ] **Mobile Responsiveness:**
    - Ensure the canvas scales correctly on phones.
    - Touch controls for moving pawns and placing walls (tap-to-move vs drag-and-drop).
- [ ] **UI Overhaul:**
    - Replace basic buttons with styled UI components (Tailwind or custom CSS).
    - Add sound effects (move, wall place, win/lose).
    - Add animations (smooth pawn sliding, wall appear effect).
- [ ] **Game Stability:**
    - Handle player disconnects gracefully (auto-surrender or reconnect).
    - Add a "Waiting for opponent" lobby animation.

## 👤 Phase 2: User System & Progression (Month 1)
**Goal:** Give players a reason to come back.

- [ ] **Authentication:**
    - Sign up / Login (Email, Google Auth).
    - Guest accounts (play without login, convert later).
- [ ] **Database Integration:**
    - Connect a database (e.g., MongoDB/PostgreSQL) to store users.
- [ ] **Progression:**
    - **ELO Rating System:** Match players of similar skill.
    - **Statistics:** Win/Loss ratio, total games, favorite strategies.
    - **Leaderboards:** Global and weekly top players.

## 💰 Phase 3: Monetization (Month 2)
**Goal:** Generate revenue without ruining the experience.

### Strategy: Freemium + Ads
1.  **Display Ads:**
    - Banner ads on the menu/lobby screens (not in-game).
    - Interstitial video ads between matches (skippable after 5s).
2.  **In-Game Store (Cosmetics):**
    - **Pawn Skins:** different shapes, colors, trails.
    - **Wall Skins:** neon, brick, wood textures.
    - **Board Themes:** Sci-fi, Classic Wood, Dark Mode.
    - *Note: These are purely cosmetic, no pay-to-win.*
3.  **Premium Subscription ($2-5/mo):**
    - No ads.
    - Gold nickname in chat.
    - Monthly exclusive skin.

## 🌐 Phase 4: Launch & Scaling (Month 3)
**Goal:** Go live and acquire users.

- [ ] **Deployment:**
    - Host on a scalable platform (Vercel/Netlify for frontend, Heroku/DigitalOcean for backend).
    - Set up a custom domain (e.g., `quoridor-online.com`).
- [ ] **Marketing:**
    - Share on Reddit (r/webgames, r/boardgames).
    - SEO optimization (meta tags, sitemap).
- [ ] **Community:**
    - Add In-Game Chat (with mute option).
    - Create a Discord server for the community.

## 🛠 Next Immediate Technical Steps
To start Phase 1, we should:
1.  Create `style.css` improvements for mobile.
2.  Add a `Lobby` class to handle matchmaking UI better.
3.  Implement a simple "Reconnect" feature in `server.js`.
