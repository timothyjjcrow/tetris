// Simplified WebSocket server for Glitch
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// Create Express app
const app = express();
const server = http.createServer(app);

// Serve a simple status page
app.get("/", (req, res) => {
  res.send("Multiplayer Tetris WebSocket Server is running");
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

console.log("Server script starting...");

// Store client states
const clients = new Map();
// Game rooms management
const gameRooms = new Map();
const clientToRoom = new Map();

// Game constants
const COLS = 10;
const ROWS = 20;

/**
 * Generate a random 6-character game code
 */
function generateGameCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

/**
 * Create an empty board
 */
function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

/**
 * Get a random Tetromino piece
 */
function getRandomPiece() {
  const pieces = [
    {
      shape: [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      color: "#00FFFF",
    }, // I
    {
      shape: [
        [1, 1],
        [1, 1],
      ],
      color: "#FFFF00",
    }, // O
    {
      shape: [
        [0, 1, 0],
        [1, 1, 1],
        [0, 0, 0],
      ],
      color: "#800080",
    }, // T
    {
      shape: [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0],
      ],
      color: "#00FF00",
    }, // S
    {
      shape: [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0],
      ],
      color: "#FF0000",
    }, // Z
    {
      shape: [
        [1, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
      ],
      color: "#0000FF",
    }, // J
    {
      shape: [
        [0, 0, 1],
        [1, 1, 1],
        [0, 0, 0],
      ],
      color: "#FF7F00",
    }, // L
  ];

  return pieces[Math.floor(Math.random() * pieces.length)];
}

/**
 * Initialize a client state
 */
function initClientState() {
  const piece = getRandomPiece();
  return {
    id: clients.size + 1,
    board: createEmptyBoard(),
    currentPiece: piece,
    currentX: Math.floor(COLS / 2) - Math.floor(piece.shape[0].length / 2),
    currentY: 0,
    score: 0,
    linesCleared: 0,
    gameOver: false,
  };
}

/**
 * Send a message to a client
 */
function sendToClient(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Create a new game room
 */
function handleCreateGame(ws) {
  const clientData = clients.get(ws);
  if (!clientData) return;

  // Generate a unique code
  let gameCode;
  do {
    gameCode = generateGameCode();
  } while (gameRooms.has(gameCode));

  // Create the room
  const room = {
    code: gameCode,
    host: ws,
    hostId: clientData.id,
    guest: null,
    guestId: null,
    status: "waiting",
  };

  gameRooms.set(gameCode, room);
  clientToRoom.set(ws, gameCode);

  console.log(`Created game room ${gameCode} by player ${clientData.id}`);

  // Send confirmation to host
  sendToClient(ws, {
    type: "gameCreated",
    gameCode: gameCode,
    playerId: clientData.id,
    isHost: true,
  });
}

/**
 * Join an existing game
 */
function handleJoinGame(ws, data) {
  const clientData = clients.get(ws);
  if (!clientData) return;

  const gameCode = data.gameCode;
  const room = gameRooms.get(gameCode);

  if (!room || room.status !== "waiting" || room.guest !== null) {
    sendToClient(ws, {
      type: "error",
      message: room ? "Game is already full" : "Game not found",
    });
    return;
  }

  // Add guest to room
  room.guest = ws;
  room.guestId = clientData.id;
  room.status = "playing";
  clientToRoom.set(ws, gameCode);

  console.log(`Player ${clientData.id} joined game ${gameCode}`);

  // Notify players
  sendToClient(ws, {
    type: "gameJoined",
    gameCode: gameCode,
    playerId: clientData.id,
    opponentId: room.hostId,
    isHost: false,
  });

  sendToClient(room.host, {
    type: "playerJoined",
    gameCode: gameCode,
    opponentId: clientData.id,
  });

  // Send initial states
  sendGameState(ws);
  sendGameState(room.host);
}

/**
 * Send game state to a client
 */
function sendGameState(ws) {
  const clientData = clients.get(ws);
  if (!clientData) return;

  sendToClient(ws, {
    type: "gameStateUpdate",
    state: clientData.state,
  });
}

/**
 * Handle client messages
 */
function handleMessage(ws, message) {
  try {
    const data = JSON.parse(message);
    const clientId = clients.get(ws)?.id || "unknown";

    console.log(`Client ${clientId} sent:`, data.type);

    switch (data.type) {
      case "createGame":
        handleCreateGame(ws);
        break;
      case "joinGame":
        handleJoinGame(ws, data);
        break;
      case "requestGameStart":
        sendGameState(ws);
        break;
      default:
        console.log(`Unknown message type: ${data.type}`);
    }
  } catch (error) {
    console.error("Error processing message:", error);
  }
}

// WebSocket connection handler
wss.on("connection", (ws) => {
  // Initialize client
  const clientState = initClientState();
  const clientId = clientState.id;

  clients.set(ws, {
    id: clientId,
    state: clientState,
  });

  console.log(`Client connected. Assigned ID: ${clientId}`);

  // Send welcome and initial state
  sendToClient(ws, {
    type: "welcome",
    id: clientId,
    message: `Welcome, Player ${clientId}!`,
  });

  sendGameState(ws);

  // Handle messages
  ws.on("message", (message) => {
    handleMessage(ws, message);
  });

  // Handle disconnect
  ws.on("close", () => {
    console.log(`Client ${clientId} disconnected`);

    // Clean up game rooms
    const gameCode = clientToRoom.get(ws);
    if (gameCode) {
      const room = gameRooms.get(gameCode);
      if (room) {
        if (room.host === ws && room.guest) {
          sendToClient(room.guest, {
            type: "opponentDisconnected",
            reason: "Host disconnected",
          });
        } else if (room.guest === ws && room.host) {
          sendToClient(room.host, {
            type: "opponentDisconnected",
            reason: "Guest disconnected",
          });
        }
        gameRooms.delete(gameCode);
      }
      clientToRoom.delete(ws);
    }

    clients.delete(ws);
  });
});

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
