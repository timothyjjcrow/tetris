const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// Create Express app
const app = express();
const port = process.env.PORT || 8080;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Simple status page
app.get("/", (req, res) => {
  res.send("Tetris WebSocket Server is running!");
});

// Game constants
const ROWS = 20;
const COLS = 10;

// Client management
const clients = new Map();
let nextClientId = 1;

// Game rooms management
const gameRooms = new Map();
const clientToRoom = new Map();

/**
 * Generate a random 6-character game code
 */
function generateGameCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Omitting confusable characters
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

/**
 * Create an empty board array
 */
function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

/**
 * Returns a random Tetromino piece
 */
function getRandomPiece() {
  const TETROMINOES = {
    I: {
      shape: [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      color: "#00FFFF",
    },
    O: {
      shape: [
        [1, 1],
        [1, 1],
      ],
      color: "#FFFF00",
    },
    T: {
      shape: [
        [0, 1, 0],
        [1, 1, 1],
        [0, 0, 0],
      ],
      color: "#800080",
    },
    S: {
      shape: [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0],
      ],
      color: "#00FF00",
    },
    Z: {
      shape: [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0],
      ],
      color: "#FF0000",
    },
    J: {
      shape: [
        [1, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
      ],
      color: "#0000FF",
    },
    L: {
      shape: [
        [0, 0, 1],
        [1, 1, 1],
        [0, 0, 0],
      ],
      color: "#FF7F00",
    },
  };

  const pieces = Object.keys(TETROMINOES);
  const randomPiece = pieces[Math.floor(Math.random() * pieces.length)];
  return {
    shape: TETROMINOES[randomPiece].shape,
    color: TETROMINOES[randomPiece].color,
  };
}

/**
 * Initialize client state
 */
function initClientState(clientId) {
  const piece = getRandomPiece();
  return {
    id: clientId,
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
 * Send data to a client
 */
function sendToClient(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (error) {
      console.error("Error sending to client:", error);
    }
  }
}

/**
 * Handle create game request
 */
function handleCreateGame(ws) {
  const clientData = clients.get(ws);
  if (!clientData) return;

  // Generate a unique game code
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
    status: "waiting", // waiting, playing, ended
    created: Date.now(),
  };

  // Store the room
  gameRooms.set(gameCode, room);
  clientToRoom.set(ws, gameCode);

  console.log(
    `Created game room ${gameCode} hosted by Player ${clientData.id}`
  );

  // Send confirmation to host
  sendToClient(ws, {
    type: "gameCreated",
    gameCode: gameCode,
    playerId: clientData.id,
    isHost: true,
  });

  return room;
}

/**
 * Handle join game request
 */
function handleJoinGame(ws, data) {
  const guestClient = clients.get(ws);
  if (!guestClient) return;

  const gameCode = data.gameCode;

  // Check if room exists and is waiting
  const room = gameRooms.get(gameCode);
  if (!room || room.status !== "waiting" || room.guest !== null) {
    sendToClient(ws, {
      type: "error",
      message: room
        ? "Game is already full or not in waiting state"
        : "Game not found",
    });
    return false;
  }

  // Add guest to room
  room.guest = ws;
  room.guestId = guestClient.id;
  room.status = "playing";
  clientToRoom.set(ws, gameCode);

  console.log(`Player ${guestClient.id} joined game room ${gameCode}`);

  // Notify guest
  sendToClient(ws, {
    type: "gameJoined",
    gameCode: gameCode,
    playerId: guestClient.id,
    opponentId: room.hostId,
    isHost: false,
  });

  // Notify host
  sendToClient(room.host, {
    type: "playerJoined",
    gameCode: gameCode,
    opponentId: guestClient.id,
  });

  return true;
}

/**
 * Check if a move is valid
 */
function isValidMove(state, newX, newY, pieceShape = null) {
  const shape = pieceShape || state.currentPiece.shape;

  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x]) {
        const boardX = newX + x;
        const boardY = newY + y;

        // Check bounds
        if (boardX < 0 || boardX >= COLS || boardY >= ROWS) {
          return false;
        }

        // Check collision with existing blocks (but only if y is valid)
        if (boardY >= 0 && state.board[boardY][boardX]) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Process a move
 */
function processMove(ws, state, direction) {
  let newX = state.currentX;
  let newY = state.currentY;

  switch (direction) {
    case "left":
      newX -= 1;
      break;
    case "right":
      newX += 1;
      break;
    case "down":
      newY += 1;
      break;
  }

  if (isValidMove(state, newX, newY)) {
    state.currentX = newX;
    state.currentY = newY;
    sendToClient(ws, {
      type: "gameStateUpdate",
      state: state,
    });
  }
}

// WebSocket connection handler
wss.on("connection", (ws) => {
  console.log("Client connected");

  // Assign client ID and initialize state
  const clientId = nextClientId++;
  clients.set(ws, {
    id: clientId,
    state: initClientState(clientId),
  });

  // Send welcome message
  sendToClient(ws, {
    type: "welcome",
    id: clientId,
    message: `Welcome, Player ${clientId}!`,
  });

  // Handle messages
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log(
        `Received message type: ${data.type} from player ${clientId}`
      );

      switch (data.type) {
        case "createGame":
          handleCreateGame(ws);
          break;

        case "joinGame":
          handleJoinGame(ws, data);
          break;

        case "moveLeft":
        case "moveRight":
        case "moveDown":
          const state = clients.get(ws).state;
          processMove(ws, state, data.type.replace("move", "").toLowerCase());
          break;

        case "requestGameState":
          const clientData = clients.get(ws);
          if (clientData) {
            sendToClient(ws, {
              type: "gameStateUpdate",
              state: clientData.state,
            });
          }
          break;

        default:
          console.log(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error("Error processing message:", error);
      console.error("Raw message:", message.toString());
    }
  });

  // Handle disconnection
  ws.on("close", () => {
    console.log(`Client ${clientId} disconnected`);

    // Remove from game room if in one
    const gameCode = clientToRoom.get(ws);
    if (gameCode) {
      const room = gameRooms.get(gameCode);
      if (room) {
        // Notify other player if exists
        if (room.host === ws && room.guest) {
          sendToClient(room.guest, {
            type: "opponentDisconnected",
            message: "Host left the game",
          });
        } else if (room.guest === ws && room.host) {
          sendToClient(room.host, {
            type: "opponentDisconnected",
            message: "Guest left the game",
          });
        }

        // Remove the room
        gameRooms.delete(gameCode);
      }

      clientToRoom.delete(ws);
    }

    // Remove client
    clients.delete(ws);
  });
});

// Start the server
server.listen(port, () => {
  console.log(`Tetris WebSocket server is running on port ${port}`);
});
