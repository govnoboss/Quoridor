# Quoridor - Online Board Game

A modern, professional implementation of the strategic board game Quoridor. Features real-time online matchmaking, private rooms with friends, and a powerful AI bot.

![Quoridor Gameplay Mockup](https://via.placeholder.com/800x400.png?text=Quoridor+Online+Gameplay)

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+)
- [Redis](https://redis.io/) (required for matchmaking and sessions)
- [MongoDB](https://www.mongodb.com/) (required for accounts and history)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/govnoboss/Quoridor.git
   cd Quoridor
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment:
   - Create a `.env` file based on `.env.example`.
   - Set `REDIS_URL`, `MONGODB_URI`, and `SESSION_SECRET`.

### Run the Server
```bash
npm start
```
The game will be available at `http://localhost:3000`.

## 🛠 Project Documentation

For deep dives into specific areas, see the documentation in the `/docs` folder:
- 🏗 **[Architecture Overview](docs/ARCHITECTURE.md)**: System design and data flow.
- 📂 **[Folder Structure](docs/FOLDER_STRUCTURE.md)**: Detailed layout of the project.
- 🧠 **[Game Logic](docs/GAME_LOGIC.md)**: Rules implementation and state management.
- 🤖 **[AI Agents Guide](docs/AGENTS_GUIDE.md)**: Manual for automated development on this codebase.

## 🧪 Testing
Run the unit test suite for the game engine:
```bash
npm test
```

