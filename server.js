const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get("/", (req, res) => res.send("Road Racer Online Server is running!"));

const lobbies = new Map();
const send = (ws, data) => ws.readyState === 1 && ws.send(JSON.stringify(data));
const broadcast = (lobby, data) => lobby.players.forEach(p => send(p.ws, data));

wss.on("connection", ws => {
  let lobbyCode = null;
  let name = "Player";
  send(ws, { type: "connected" });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: "error", message: "Invalid message" }); }

    if (msg.type === "createLobby") {
      let code;
      do { code = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (lobbies.has(code));
      name = msg.name || "Player";
      const lobby = { code, players: [{ ws, name }] };
      lobbies.set(code, lobby);
      lobbyCode = code;
      return send(ws, { type: "lobbyCreated", code, players: [name] });
    }

    if (msg.type === "joinLobby") {
      const code = String(msg.code || "").toUpperCase();
      const lobby = lobbies.get(code);
      if (!lobby) return send(ws, { type: "error", message: "Лобби не найдено" });
      if (lobby.players.length >= 8) return send(ws, { type: "error", message: "Лобби заполнено" });
      name = msg.name || "Player";
      lobby.players.push({ ws, name });
      lobbyCode = code;
      return broadcast(lobby, { type: "players", players: lobby.players.map(p => p.name) });
    }

    if (msg.type === "startGame" && lobbyCode) {
      const lobby = lobbies.get(lobbyCode);
      if (lobby) broadcast(lobby, { type: "gameStarted" });
    }

    if (msg.type === "state" && lobbyCode) {
      const lobby = lobbies.get(lobbyCode);
      if (lobby) broadcast(lobby, { type: "state", player: name, state: msg.state });
    }
  });

  ws.on("close", () => {
    if (!lobbyCode) return;
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) return;
    lobby.players = lobby.players.filter(p => p.ws !== ws);
    if (!lobby.players.length) lobbies.delete(lobbyCode);
    else broadcast(lobby, { type: "players", players: lobby.players.map(p => p.name) });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Road Racer Online Server running on port ${PORT}`));
