const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get("/", (req, res) => {
  res.send("Road Racer Online Server is running!");
});

const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  for (const player of room.players) {
    send(player.ws, data);
  }
}

function makeId() {
  return crypto.randomUUID();
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code;

  do {
    code = "";

    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));

  return code;
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    settings: room.settings,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name
    }))
  };
}

function sendRoom(room) {
  broadcast(room, {
    type: "room",
    room: publicRoom(room)
  });

  broadcast(room, {
    type: "players",
    players: room.players.map(p => ({
      id: p.id,
      name: p.name
    }))
  });
}

wss.on("connection", ws => {
  const playerId = makeId();

  let currentRoom = null;

  send(ws, {
    type: "welcome",
    id: playerId
  });

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, {
        type: "error",
        message: "Неверный запрос"
      });
      return;
    }

    // СОЗДАНИЕ ЛОББИ
    if (msg.type === "createRoom") {
      if (currentRoom) {
        send(ws, {
          type: "error",
          message: "Ты уже находишься в лобби"
        });
        return;
      }

      const code = makeRoomCode();

      const room = {
        code,
        hostId: playerId,
        settings: {
          map: msg.settings?.map || "desert",
          laps: Number(msg.settings?.laps) || 2,
          obstacles: msg.settings?.obstacles || {}
        },
        players: []
      };

      const player = {
        id: playerId,
        name: String(msg.name || "Гонщик").slice(0, 16),
        ws
      };

      room.players.push(player);

      rooms.set(code, room);
      currentRoom = code;

      sendRoom(room);
      return;
    }

    // ВХОД В ЛОББИ
    if (msg.type === "joinRoom") {
      const code = String(msg.code || "").toUpperCase();
      const room = rooms.get(code);

      if (!room) {
        send(ws, {
          type: "error",
          message: "Лобби не найдено"
        });
        return;
      }

      if (room.players.length >= 8) {
        send(ws, {
          type: "error",
          message: "Лобби заполнено"
        });
        return;
      }

      if (currentRoom) {
        send(ws, {
          type: "error",
          message: "Ты уже находишься в лобби"
        });
        return;
      }

      room.players.push({
        id: playerId,
        name: String(msg.name || "Гонщик").slice(0, 16),
        ws
      });

      currentRoom = code;

      sendRoom(room);
      return;
    }

    // ИЗМЕНЕНИЕ НАСТРОЕК
    if (msg.type === "settings") {
      if (!currentRoom) return;

      const room = rooms.get(currentRoom);
      if (!room) return;

      if (room.hostId !== playerId) {
        send(ws, {
          type: "error",
          message: "Только хост может менять настройки"
        });
        return;
      }

      room.settings = {
        map: msg.settings?.map || room.settings.map,
        laps: Number(msg.settings?.laps) || room.settings.laps,
        obstacles: msg.settings?.obstacles || room.settings.obstacles
      };

      sendRoom(room);
      return;
    }

    // ЗАПУСК ГОНКИ
    if (
      msg.type === "startRace" ||
      msg.type === "startGame"
    ) {
      if (!currentRoom) return;

      const room = rooms.get(currentRoom);
      if (!room) return;

      if (room.hostId !== playerId) {
        send(ws, {
          type: "error",
          message: "Только хост может начать гонку"
        });
        return;
      }

      broadcast(room, {
        type: "raceStart",
        settings: room.settings
      });

      return;
    }


// ПЕРЕДАЧА СОСТОЯНИЯ ИГРОКОВ
if (msg.type === "update") {
  if (!currentRoom) return;

  const room = rooms.get(currentRoom);
  if (!room) return;

  const player = room.players.find(p => p.id === playerId);
  if (!player) return;

  player.state = {
    lane: Number(msg.lane) || 0,
    distance: Number(msg.distance) || 0,
    speed: Number(msg.speed) || 0,
    color: msg.color || "#ffffff",
    car: msg.car || "default"
  };

  broadcast(room, {
    type: "players",
    players: room.players
      .filter(p => p.id !== playerId)
      .map(p => ({
        id: p.id,
        name: p.name,
        lane: p.state?.lane || 0,
        distance: p.state?.distance || 0,
        speed: p.state?.speed || 0,
        color: p.state?.color || "#ffffff",
        car: p.state?.car || "default"
      }))
  });

  return;
}

  ws.on("close", () => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== playerId);

    if (room.players.length === 0) {
      rooms.delete(currentRoom);
      return;
    }

    // Если хост вышел — передаём хостинг следующему игроку
    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
    }

    sendRoom(room);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Road Racer Online Server running on port ${PORT}`);
});
