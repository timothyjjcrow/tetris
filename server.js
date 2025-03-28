// Tetris Server-Side JavaScript
// This file will contain the WebSocket server implementation and game state management
//
// DEPLOYMENT STRATEGY:
// - Frontend (index.html, style.css, client.js) is deployed as static assets (e.g., on Vercel).
// - Backend (server.js + package.json) is deployed to a Node.js hosting service like Glitch.
// - Remember to update WEBSOCKET_URL in client.js to the deployed Glitch server's wss:// address.

console.log("Server script starting...");

const WebSocket = require("ws");

// Define port to listen on (compatible with Glitch)
const PORT = process.env.PORT || 8080;

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

// Create WebSocket server
const wss = new WebSocket.Server({
  port: PORT,
  host: "0.0.0.0",
});

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
 * Create a new game room
 * @param {WebSocket} hostWs - The WebSocket of the host
 * @returns {Object} The newly created game room
 */
function createGameRoom(hostWs) {
  const hostClient = clients.get(hostWs);
  if (!hostClient) return null;

  // Generate a unique game code
  let gameCode;
  do {
    gameCode = generateGameCode();
  } while (gameRooms.has(gameCode));

  // Create the room
  const room = {
    code: gameCode,
    host: hostWs,
    hostId: hostClient.id,
    guest: null,
    guestId: null,
    status: "waiting", // waiting, playing, ended
    created: Date.now(),
  };

  // Store the room
  gameRooms.set(gameCode, room);
  clientToRoom.set(hostWs, gameCode);

  console.log(
    `Created game room ${gameCode} hosted by Player ${hostClient.id}`
  );

  // Send confirmation to host
  const message = {
    type: "gameCreated",
    gameCode: gameCode,
    playerId: hostClient.id,
    isHost: true,
  };

  hostWs.send(JSON.stringify(message));

  return room;
}

/**
 * Join an existing game room
 * @param {WebSocket} guestWs - The WebSocket of the guest
 * @param {string} gameCode - The game code to join
 * @returns {boolean} Whether the join was successful
 */
function joinGameRoom(guestWs, gameCode) {
  const guestClient = clients.get(guestWs);
  if (!guestClient) return false;

  // Check if room exists and is waiting
  const room = gameRooms.get(gameCode);
  if (!room || room.status !== "waiting" || room.guest !== null) {
    const errorMessage = {
      type: "error",
      message: room
        ? "Game is already full or not in waiting state"
        : "Game not found",
    };
    guestWs.send(JSON.stringify(errorMessage));
    return false;
  }

  // Add guest to room
  room.guest = guestWs;
  room.guestId = guestClient.id;
  room.status = "playing";
  clientToRoom.set(guestWs, gameCode);

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
  guestWs.send(JSON.stringify(guestMessage));

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
 * Checks if a move is valid (within boundaries and not colliding)
 * @param {Object} state - The player's game state
 * @param {Object} piece - The piece to check
 * @param {number} newX - The new x coordinate to check
 * @param {number} newY - The new y coordinate to check
 * @returns {boolean} True if the move is valid, false otherwise
 */
function isValidMove(state, piece, newX, newY) {
  if (!piece) return false;

  // Check piece boundaries against board boundaries
  for (let row = 0; row < piece.shape.length; row++) {
    for (let col = 0; col < piece.shape[row].length; col++) {
      if (!piece.shape[row][col]) continue; // Skip empty cells

      // Calculate actual position on the board
      const boardX = newX + col;
      const boardY = newY + row;

      // Check if outside board boundaries
      if (
        boardX < 0 || // Left boundary
        boardX >= COLS || // Right boundary
        boardY >= ROWS // Bottom boundary
      ) {
        return false;
      }

      // Check if position is already occupied on the board
      // (but only if we're within the board's y range)
      if (boardY >= 0 && state.board[boardY][boardX]) {
        return false;
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

// Listen for the 'listening' event
wss.on("listening", () => {
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
      const parsedMessage = JSON.parse(message);
      console.log(`Received from Player ${clientId}:`, parsedMessage.type);

      // Handle different message types
      switch (parsedMessage.type) {
        case "createGame":
          createGameRoom(ws);
          break;

        case "joinGame":
          if (parsedMessage.gameCode) {
            joinGameRoom(ws, parsedMessage.gameCode);
          }
          break;

        case "cancelGame":
          handleRoomDisconnection(ws);
          break;

        case "requestGameStart":
          // Start the game if in a room
          const gameCode = clientToRoom.get(ws);
          if (gameCode) {
            const room = gameRooms.get(gameCode);
            if (room && room.status === "playing") {
              sendGameState(ws);
            }
          } else {
            // Single player mode is handled client-side
            sendGameState(ws);
          }
          break;

        // Handle gameplay messages (moveLeft, moveRight, etc.)
        default:
          processAction(ws, parsedMessage);
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  // Handle client disconnection
  ws.on("close", () => {
    console.log(`Client ${clientId} disconnected`);
    handleRoomDisconnection(ws);
    clients.delete(ws);
  });
});

/**
 * Process a move action from a client
 * @param {WebSocket} ws - The client's WebSocket connection
 * @param {Object} state - The client's current game state
 * @param {string} direction - The direction to move ('left', 'right', 'down')
 */
function processMove(ws, state, direction) {
  let newX = state.currentX;
  let newY = state.currentY;

  // Calculate new position based on direction
  switch (direction) {
    case "left":
      newX--;
      break;
    case "right":
      newX++;
      break;
    case "down":
      newY++;
      break;
    default:
      return;
  }

  // Validate the move
  if (isValidMove(state, state.currentPiece, newX, newY)) {
    // Update position if valid
    state.currentX = newX;
    state.currentY = newY;

    // Send updated state to client
    sendGameState(ws);

    // No need to broadcast opponent state for simple moves
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
  if (isValidMove(state, rotatedPiece, state.currentX, state.currentY)) {
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
  if (!isValidMove(state, state.currentPiece, state.currentX, state.currentY)) {
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
  if (!isValidMove(state, state.currentPiece, state.currentX, state.currentY)) {
    // If not valid, try moving the piece up
    let newY = state.currentY;
    while (
      newY > 0 &&
      !isValidMove(state, state.currentPiece, state.currentX, newY)
    ) {
      newY--;
    }

    // If we found a valid position, update Y
    if (isValidMove(state, state.currentPiece, state.currentX, newY)) {
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

// Server error handler
wss.on("error", (error) => {
  console.error("Server error:", error);
});

function processAction(ws, message) {
  const clientId = getClientId(ws);
  if (!clientId) {
    console.error(`No client ID found for WebSocket`);
    return;
  }

  const clientData = clients.get(ws);
  if (!clientData) {
    console.error(`No state found for client ${clientId}`);
    return;
  }

  const state = clientData.state;
  const { action } = message;

  // Special test action for simulating line clears
  if (action === "simulateClearLines") {
    const numLines = message.lines || 0;
    if (numLines > 1) {
      const garbageLines = Math.min(numLines - 1, 4); // Send n-1 garbage lines, max 4
      console.log(
        `Test: Client ${clientId} is simulating clearing ${numLines} lines, sending ${garbageLines} garbage lines to opponents`
      );
      sendGarbageToOpponents(ws, garbageLines);
    }
    return;
  }

  // Regular action handling
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
    case "lock":
      processLock(ws, state);
      break;
    default:
      console.log(`Unknown action: ${action}`);
  }
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
