// Tetris Server-Side JavaScript
// This file will contain the WebSocket server implementation and game state management
//
// DEPLOYMENT STRATEGY:
// - Frontend (index.html, style.css, client.js) is deployed as static assets (e.g., on Vercel).
// - Backend (server.js + package.json) is deployed to a Node.js hosting service like Glitch.
// - Remember to update WEBSOCKET_URL in client.js to the deployed Glitch server's wss:// address.

console.log("Server script starting...");

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// Define port to listen on (compatible with Glitch)
const PORT = process.env.PORT || 8080;

// Create an Express app
const app = express();

// Create an HTTP server with the Express app
const server = http.createServer(app);

// Create WebSocket server attached to the HTTP server
const wss = new WebSocket.Server({
  server: server,
  // This perMessageDeflate option is important for Glitch
  perMessageDeflate: false,
});

// Add a simple route for a status page
app.get("/", (req, res) => {
  res.send("Tetris WebSocket Server is running!");
});

// Game constants
const ROWS = 20;
const COLS = 10;

// Tetromino Definitions (must match client-side)
const TETROMINOES = {
  I: {
    shape: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    color: "#00FFFF", // Cyan
  },
  O: {
    shape: [
      [1, 1],
      [1, 1],
    ],
    color: "#FFFF00", // Yellow
  },
  T: {
    shape: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    color: "#800080", // Purple
  },
  S: {
    shape: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    color: "#00FF00", // Green
  },
  Z: {
    shape: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
    color: "#FF0000", // Red
  },
  J: {
    shape: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    color: "#0000FF", // Blue
  },
  L: {
    shape: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
    color: "#FF7F00", // Orange
  },
};

// Client state management
const clients = new Map();
let nextClientId = 1;

// Game rooms management
const gameRooms = new Map();
const clientToRoom = new Map();

/**
 * Generate a random 6-character game code
 * @returns {string} A random 6-character game code
 */
function generateGameCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Omitting confusable characters like I, 1, O, 0
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

/**
 * Create an empty board array
 * @returns {Array} 2D array filled with zeros
 */
function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

/**
 * Returns a random Tetromino piece
 * @returns {Object} A random piece definition containing shape and color
 */
function getRandomPiece() {
  const pieces = Object.keys(TETROMINOES);
  const randomPiece = pieces[Math.floor(Math.random() * pieces.length)];
  return {
    shape: TETROMINOES[randomPiece].shape,
    color: TETROMINOES[randomPiece].color,
  };
}

/**
 * Initialize client state
 * @param {number} clientId - The unique client ID
 * @returns {Object} The initial game state
 */
function createInitialState(clientId) {
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
 * Check if a move is valid (within bounds and not colliding)
 * @param {Object} state - The client state
 * @param {Number} newX - The new X position
 * @param {Number} newY - The new Y position
 * @param {Array} piece - The piece matrix
 * @returns {Boolean} Whether the move is valid
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
 * Rotates a piece clockwise
 * @param {Object} piece - The piece to rotate
 * @returns {Object} A new rotated piece
 */
function rotatePiece(piece) {
  // Make a deep copy of the original piece
  const newPiece = {
    shape: piece.shape.map((row) => [...row]),
    color: piece.color,
  };

  // Get the dimensions of the piece
  const rows = piece.shape.length;
  const cols = piece.shape[0].length;

  // Create a new rotated shape matrix
  const rotatedShape = Array.from({ length: cols }, () => Array(rows).fill(0));

  // Perform the rotation (90 degrees clockwise)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      rotatedShape[col][rows - 1 - row] = piece.shape[row][col];
    }
  }

  newPiece.shape = rotatedShape;
  return newPiece;
}

/**
 * Send updated game state to the client
 * @param {WebSocket} ws - The client's WebSocket connection
 */
function sendGameState(ws) {
  const clientData = clients.get(ws);
  if (!clientData) return;

  const message = {
    type: "gameStateUpdate",
    state: clientData.state,
  };

  ws.send(JSON.stringify(message));
}

/**
 * Broadcast a player's board state to their opponent in the same game room
 * @param {WebSocket} activeWs - The active player's WebSocket connection
 */
function broadcastOpponentState(activeWs) {
  const activeClient = clients.get(activeWs);
  if (!activeClient) return;

  // Find the game room and opponent
  const gameCode = clientToRoom.get(activeWs);
  if (!gameCode) return;

  const room = gameRooms.get(gameCode);
  if (!room || room.status !== "playing") return;

  // Determine the opponent's WebSocket
  let opponentWs;
  if (room.host === activeWs) {
    opponentWs = room.guest;
  } else if (room.guest === activeWs) {
    opponentWs = room.host;
  } else {
    return; // Not in this room
  }

  if (!opponentWs) return;

  // Send the active player's state to the opponent
  const message = {
    type: "opponentUpdate",
    playerId: activeClient.id,
    board: activeClient.state.board,
    score: activeClient.state.score,
    linesCleared: activeClient.state.linesCleared,
    gameOver: activeClient.state.gameOver,
  };

  try {
    opponentWs.send(JSON.stringify(message));
  } catch (error) {
    console.error(`Error sending opponent update to client:`, error);
  }
}

/**
 * Handle a create game request from a client
 * @param {WebSocket} ws - The WebSocket of the host
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
  const message = {
    type: "gameCreated",
    gameCode: gameCode,
    playerId: clientData.id,
    isHost: true,
  };

  ws.send(JSON.stringify(message));

  return room;
}

/**
 * Handle a join game request from a client
 * @param {WebSocket} ws - The WebSocket of the guest
 * @param {Object} data - The message data containing the game code
 */
function handleJoinGame(ws, data) {
  const guestClient = clients.get(ws);
  if (!guestClient) return;

  const gameCode = data.gameCode;

  // Check if room exists and is waiting
  const room = gameRooms.get(gameCode);
  if (!room || room.status !== "waiting" || room.guest !== null) {
    const errorMessage = {
      type: "error",
      message: room
        ? "Game is already full or not in waiting state"
        : "Game not found",
    };
    ws.send(JSON.stringify(errorMessage));
    return false;
  }

  // Add guest to room
  room.guest = ws;
  room.guestId = guestClient.id;
  room.status = "playing";
  clientToRoom.set(ws, gameCode);

  console.log(`Player ${guestClient.id} joined game room ${gameCode}`);

  // Notify both players
  // Notify guest
  const guestMessage = {
    type: "gameJoined",
    gameCode: gameCode,
    playerId: guestClient.id,
    opponentId: room.hostId,
    isHost: false,
  };
  ws.send(JSON.stringify(guestMessage));

  // Notify host
  const hostMessage = {
    type: "playerJoined",
    gameCode: gameCode,
    opponentId: guestClient.id,
  };
  room.host.send(JSON.stringify(hostMessage));

  // Initialize both clients' game states
  sendGameState(room.host);
  sendGameState(room.guest);

  return true;
}

/**
 * Handle a cancel game request from a client
 * @param {WebSocket} ws - The WebSocket of the client
 */
function handleCancelGame(ws) {
  const gameCode = clientToRoom.get(ws);
  if (!gameCode) return;

  const room = gameRooms.get(gameCode);
  if (!room) {
    clientToRoom.delete(ws);
    return;
  }

  // Only the host can cancel the game if it's in waiting state
  if (room.host !== ws || room.status !== "waiting") {
    return;
  }

  // Clean up room
  gameRooms.delete(gameCode);
  clientToRoom.delete(ws);
  console.log(`Game room ${gameCode} canceled by host`);

  // Notify the host
  const message = {
    type: "gameCanceled",
    gameCode: gameCode,
  };
  ws.send(JSON.stringify(message));
}

/**
 * Send updated game state to the client
 * @param {WebSocket} ws - The client's WebSocket connection
 * @param {Object} state - The game state to send (optional)
 */
function sendGameStateUpdate(ws, state) {
  const clientData = clients.get(ws);
  if (!clientData) return;

  const message = {
    type: "gameStateUpdate",
    state: state || clientData.state,
  };

  ws.send(JSON.stringify(message));
}

/**
 * Handle client disconnection from a game room
 * @param {WebSocket} ws - The WebSocket of the disconnected client
 */
function handleRoomDisconnection(ws) {
  const gameCode = clientToRoom.get(ws);
  if (!gameCode) return;

  const room = gameRooms.get(gameCode);
  if (!room) {
    clientToRoom.delete(ws);
    return;
  }

  // Notify the other player if there is one
  if (room.host === ws && room.guest) {
    const message = {
      type: "opponentDisconnected",
      reason: "Host left the game",
    };
    room.guest.send(JSON.stringify(message));
    clientToRoom.delete(room.guest);
  } else if (room.guest === ws && room.host) {
    const message = {
      type: "opponentDisconnected",
      reason: "Guest left the game",
    };
    room.host.send(JSON.stringify(message));
    clientToRoom.delete(room.host);
  }

  // Clean up room
  gameRooms.delete(gameCode);
  clientToRoom.delete(ws);
  console.log(`Game room ${gameCode} closed due to player disconnection`);
}

/**
 * Process a move action from a client
 * @param {WebSocket} ws - The WebSocket connection
 * @param {Object} state - The client state
 * @param {String} direction - The move direction
 */
function processMove(ws, state, direction) {
  console.log(`Processing move ${direction} for player ${getClientId(ws)}`);
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

    // Only lock piece if it's a downward move and can't move further down
    if (direction === "down" && !isValidMove(state, newX, newY + 1)) {
      // Don't automatically lock the piece - let the client handle this
      // processLock(ws, state);
    }

    sendGameState(ws);
  } else if (direction === "down" && !isValidMove(state, newX, newY + 1)) {
    // We tried to move down but couldn't, this is a landing
    processLock(ws, state);
  }
}

/**
 * Process an action from a client
 * @param {WebSocket} ws - The WebSocket connection
 * @param {String} action - The action type
 */
function processAction(ws, action) {
  const clientData = clients.get(ws);
  if (!clientData) return;

  const state = clientData.state;
  console.log(`Processing action ${action} for player ${clientData.id}`);

  switch (action) {
    case "moveLeft":
      processMove(ws, state, "left");
      break;
    case "moveRight":
      processMove(ws, state, "right");
      break;
    case "moveDown":
      processMove(ws, state, "down");
      break;
    case "rotate":
      processRotate(ws, state);
      break;
    case "dropPiece":
      processDropPiece(ws, state);
      break;
    case "lock":
      // Explicit lock requested by client
      processLock(ws, state);
      break;
    default:
      console.log(`Unknown action: ${action}`);
  }
}

/**
 * Process a rotation action from a client
 * @param {WebSocket} ws - The client's WebSocket connection
 * @param {Object} state - The client's current game state
 */
function processRotate(ws, state) {
  if (!state.currentPiece) return;

  // Get rotated piece
  const rotatedPiece = rotatePiece(state.currentPiece);

  // Check if rotation is valid
  if (isValidMove(state, state.currentX, state.currentY, rotatedPiece.shape)) {
    // Update piece to rotated version
    state.currentPiece = rotatedPiece;

    // Send updated state to client
    sendGameState(ws);

    // No need to broadcast opponent state for rotations
  }
}

/**
 * Process a lock action from a client
 * @param {WebSocket} ws - The client's WebSocket connection
 * @param {Object} state - The client's current game state
 */
function processLock(ws, state) {
  // Add the current piece to the board
  for (let row = 0; row < state.currentPiece.shape.length; row++) {
    for (let col = 0; col < state.currentPiece.shape[row].length; col++) {
      if (!state.currentPiece.shape[row][col]) continue;

      // Calculate position on the board
      const boardY = state.currentY + row;

      // Don't add blocks above the board
      if (boardY < 0) continue;

      // Add block to the board (store the color)
      state.board[boardY][state.currentX + col] = state.currentPiece.color;
    }
  }

  // Check for completed lines
  const clearedLines = checkForCompletedLines(state);
  if (clearedLines > 0) {
    // Update lines cleared count
    state.linesCleared += clearedLines;

    // Update score based on lines cleared
    const scoreValues = {
      1: 100,
      2: 300,
      3: 500,
      4: 800,
    };
    state.score += scoreValues[clearedLines] || clearedLines * 100;

    // Send garbage lines if more than 1 line was cleared
    if (clearedLines > 1) {
      // Calculate garbage lines (lines cleared - 1)
      const garbageLines = clearedLines - 1;

      // Send garbage to opponents
      sendGarbageToOpponents(ws, garbageLines);
    }
  }

  // Spawn a new piece
  state.currentPiece = getRandomPiece();
  state.currentX =
    Math.floor(COLS / 2) - Math.floor(state.currentPiece.shape[0].length / 2);
  state.currentY = 0;

  // Check for game over condition
  if (!isValidMove(state, state.currentX, state.currentY)) {
    state.gameOver = true;
  }

  // Send updated state to client
  sendGameState(ws);

  // Broadcast state to opponents since the board has changed
  broadcastOpponentState(ws);
}

/**
 * Send garbage lines to the opponent
 * @param {WebSocket} senderWs - The WebSocket of the sender
 * @param {number} numLines - Number of garbage lines to send
 */
function sendGarbageToOpponents(senderWs, numLines) {
  if (numLines <= 0) return;

  const senderClient = clients.get(senderWs);
  if (!senderClient) return;

  // Find opponent in the same game room
  const gameCode = clientToRoom.get(senderWs);
  if (!gameCode) return;

  const room = gameRooms.get(gameCode);
  if (!room || room.status !== "playing") return;

  // Determine the opponent
  let opponentWs;
  if (room.host === senderWs) {
    opponentWs = room.guest;
  } else if (room.guest === senderWs) {
    opponentWs = room.host;
  } else {
    return; // Not in this room
  }

  if (!opponentWs) return;

  const opponentClient = clients.get(opponentWs);
  if (!opponentClient) return;

  // Send garbage lines to the opponent
  const garbageMessage = {
    type: "addGarbage",
    lines: numLines,
    fromPlayer: senderClient.id,
  };

  try {
    opponentWs.send(JSON.stringify(garbageMessage));
    console.log(
      `Player ${senderClient.id} sent ${numLines} garbage lines to Player ${opponentClient.id}`
    );

    // Also update the opponent's game state on the server
    addGarbageLines(opponentClient.state, numLines);
    sendGameState(opponentWs);
  } catch (error) {
    console.error("Error sending garbage lines:", error);
  }
}

/**
 * Add garbage lines to a player's board
 * @param {Object} state - The player's game state
 * @param {number} numLines - The number of garbage lines to add
 */
function addGarbageLines(state, numLines) {
  // Make sure we don't add too many lines
  const linesToAdd = Math.min(numLines, ROWS - 4);
  if (linesToAdd <= 0) return;

  // First, shift the existing board up by the number of garbage lines
  for (let row = 0; row < ROWS - linesToAdd; row++) {
    state.board[row] = [...state.board[row + linesToAdd]];
  }

  // Now add the garbage lines at the bottom
  for (let i = 0; i < linesToAdd; i++) {
    const rowIndex = ROWS - i - 1;
    state.board[rowIndex] = Array(COLS).fill("#808080"); // Gray color for garbage

    // Add one random gap in each garbage line
    const gapPosition = Math.floor(Math.random() * COLS);
    state.board[rowIndex][gapPosition] = 0; // Empty cell at the gap position
  }

  // Check if current piece position is still valid after adding garbage
  if (!isValidMove(state, state.currentX, state.currentY)) {
    // If not valid, try moving the piece up
    let newY = state.currentY;
    while (newY > 0 && !isValidMove(state, state.currentX, newY)) {
      newY--;
    }

    // If we found a valid position, update Y
    if (isValidMove(state, state.currentX, newY)) {
      state.currentY = newY;
    } else {
      // If no valid position is found, it's game over
      state.gameOver = true;
    }
  }
}

/**
 * Check for and clear completed lines in a player's board
 * @param {Object} state - The player's game state
 * @returns {number} The number of lines cleared
 */
function checkForCompletedLines(state) {
  let linesCleared = 0;

  // Check each row from bottom to top
  for (let row = ROWS - 1; row >= 0; row--) {
    // Check if this row is complete (all blocks filled)
    const isRowComplete = state.board[row].every((cell) => cell !== 0);

    if (isRowComplete) {
      linesCleared++;

      // Move all rows above this one down
      for (let r = row; r > 0; r--) {
        state.board[r] = [...state.board[r - 1]];
      }

      // Create an empty row at the top
      state.board[0] = Array(COLS).fill(0);

      // Since we've moved all rows down, check this row again
      row++;
    }
  }

  return linesCleared;
}

/**
 * Get the client ID from a WebSocket connection
 * @param {WebSocket} ws - The WebSocket connection
 * @returns {Object} The client data
 */
function getClientId(ws) {
  const clientData = clients.get(ws);
  return clientData ? clientData.id : null;
}

/**
 * Process a drop piece action from a client
 * @param {WebSocket} ws - The WebSocket connection
 * @param {Object} state - The client state
 */
function processDropPiece(ws, state) {
  console.log(`Processing drop piece for player ${getClientId(ws)}`);

  // Move the piece down until it can't move anymore
  let newY = state.currentY;
  while (isValidMove(state, state.currentX, newY + 1)) {
    newY++;
  }

  if (newY > state.currentY) {
    console.log(`Dropping piece from y=${state.currentY} to y=${newY}`);
    state.currentY = newY;
    sendGameStateUpdate(ws, state);

    // After moving down, lock the piece
    processLock(ws, state);
  } else {
    console.log(`Piece already at bottom at y=${state.currentY}`);
    processLock(ws, state);
  }
}

// Listen for the 'listening' event
server.on("listening", () => {
  console.log(`Tetris server running on port ${PORT}`);
});

// Client connection handler
wss.on("connection", (ws) => {
  console.log("New client connected");

  // Assign a unique ID to the client
  const clientId = nextClientId++;

  // Initialize client state
  clients.set(ws, {
    id: clientId,
    state: createInitialState(clientId),
  });

  // Send welcome message with client ID
  ws.send(
    JSON.stringify({
      type: "welcome",
      id: clientId,
      message: `Welcome, Player ${clientId}!`,
    })
  );

  // Handle messages from clients
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Client ${clientId} sent message type:`, data.type);

      switch (data.type) {
        case "createGame":
          handleCreateGame(ws);
          break;
        case "joinGame":
          handleJoinGame(ws, data);
          break;
        case "cancelGame":
          handleCancelGame(ws);
          break;
        case "moveLeft":
        case "moveRight":
        case "moveDown":
        case "rotate":
        case "dropPiece":
        case "lock":
          // Direct action types from client
          processAction(ws, data.type);
          break;
        case "requestGameStart":
          // Send current game state
          const clientData = clients.get(ws);
          if (clientData) {
            sendGameStateUpdate(ws, clientData.state);
          }
          break;
        case "playerAction":
          // For backward compatibility with older client code
          if (data.action) {
            console.log(`Processing legacy playerAction: ${data.action}`);
            processAction(ws, data.action);
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

  // Handle client disconnection
  ws.on("close", () => {
    console.log(`Client ${clientId} disconnected`);
    handleRoomDisconnection(ws);
    clients.delete(ws);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Tetris WebSocket server is running on port ${PORT}`);
});

// Server error handler
server.on("error", (error) => {
  console.error("Server error:", error);
});
