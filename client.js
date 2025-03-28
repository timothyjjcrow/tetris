// Tetris Client-Side JavaScript
// This file will contain the game logic, rendering, and WebSocket client communication
//
// DEPLOYMENT STRATEGY:
// - Frontend (index.html, style.css, client.js) is deployed as static assets (e.g., on Vercel).
// - Backend (server.js + package.json) is deployed to a Node.js hosting service like Glitch.
// - Remember to update WEBSOCKET_URL below to the deployed Glitch server's wss:// address.

// WebSocket configuration
// Automatically determine if we're in a production environment (like Vercel)
// If window.location.protocol is 'https:', use a secure WebSocket connection
// Otherwise, use the localhost development server
const isProduction = window.location.protocol === "https:";
const WEBSOCKET_URL = isProduction
  ? "wss://repeated-fair-calendula.glitch.me" // Using the confirmed working Glitch server
  : "ws://localhost:8080";

console.log(`Using WebSocket URL: ${WEBSOCKET_URL}`);
// IMPORTANT: Before final deployment, change the wss:// URL above to your deployed Glitch server address.
// Find your Glitch project URL (e.g., https://your-project-name.glitch.me)

// Game Constants
const ROWS = 20;
const COLS = 10;
const BLOCK_SIZE = 30;
const DROP_INTERVAL = 1000; // Time in ms between automatic drops

// Scoring constants
const SCORE_VALUES = {
  1: 100, // 1 line: 100 points
  2: 300, // 2 lines: 300 points
  3: 500, // 3 lines: 500 points
  4: 800, // 4 lines: 800 points (Tetris)
};

// Game State Variables
let currentPiece = null;
let currentX = 0;
let currentY = 0;
let board = [];
let lastDropTime = 0;
let gameStarted = false;
let score = 0;
let linesCleared = 0;
let playerId = null;

// Opponent state
let opponentBoard = [];
let opponentScore = 0;
let opponentLines = 0;
let opponentId = null;
let opponentGameOver = false;

// Multiplayer state
let isHost = false;
let gameCode = null;
let isWaitingForOpponent = false;

// UI Elements
const menuScreen = document.getElementById("menu-screen");
const waitingScreen = document.getElementById("waiting-screen");
const gameScreen = document.getElementById("game-screen");
const createGameBtn = document.getElementById("createGameBtn");
const joinGameBtn = document.getElementById("joinGameBtn");
const singlePlayerBtn = document.getElementById("singlePlayerBtn");
const gameCodeInput = document.getElementById("gameCodeInput");
const gameCodeDisplay = document.getElementById("gameCodeDisplay");
const gameCodeSmall = document.getElementById("gameCode");
const cancelGameBtn = document.getElementById("cancelGameBtn");
const playerStatus = document.getElementById("playerStatus");

// WebSocket Setup
const socket = new WebSocket(WEBSOCKET_URL);

// Connection opened
socket.onopen = (event) => {
  console.log("Connected to the game server");

  // Enable the menu buttons once connection is established
  if (createGameBtn) createGameBtn.disabled = false;
  if (joinGameBtn) joinGameBtn.disabled = false;
  if (singlePlayerBtn) singlePlayerBtn.disabled = false;
};

// Connection closed
socket.onclose = (event) => {
  console.log("Disconnected from the game server");
  if (!event.wasClean) {
    console.warn("Connection closed unexpectedly");
    window.singlePlayerMode = true; // Immediately set single-player mode
    enableSinglePlayerMode();
  }
};

// Connection error
socket.onerror = (error) => {
  console.error("WebSocket error:", error);
  window.singlePlayerMode = true; // Immediately set single-player mode
  enableSinglePlayerMode();
};

// Listen for messages from the server
socket.onmessage = (event) => {
  try {
    const message = JSON.parse(event.data);
    console.log("Received from server:", message);

    // Handle different message types
    switch (message.type) {
      case "welcome":
        // Store player ID
        playerId = message.id;
        break;

      case "gameCreated":
        // Handle new game created
        gameCode = message.gameCode;
        isHost = message.isHost;
        isWaitingForOpponent = true;
        showWaitingScreen(gameCode);
        break;

      case "gameJoined":
        // Handle joining an existing game
        gameCode = message.gameCode;
        isHost = message.isHost;
        opponentId = message.opponentId;
        showGameScreen(gameCode);
        break;

      case "playerJoined":
        // Host is notified when a player joins
        opponentId = message.opponentId;
        isWaitingForOpponent = false;
        showGameScreen(gameCode);
        break;

      case "error":
        // Display error message
        showNotification(message.message, "error");
        break;

      case "opponentDisconnected":
        // Handle opponent disconnection
        showNotification(message.reason, "warning");
        opponentGameOver = true;
        updateOpponentDisplay();
        break;

      case "gameStateUpdate":
        // Update local game state with server state
        updateGameState(message.state);
        break;

      case "opponentUpdate":
        // Update opponent's board and stats
        updateOpponentState(message);
        break;

      case "addGarbage":
        // Handle garbage lines received from opponent
        console.log(
          `Received ${message.lines} garbage lines from Player ${message.fromPlayer}`
        );

        // Display a warning or visual effect to indicate incoming garbage
        showGarbageWarning(message.lines);
        break;
    }
  } catch (error) {
    console.error("Error parsing message from server:", error);
    console.error("Raw message:", event.data);
  }
};

/**
 * Shows a notification message to the user
 * @param {string} message - The message to display
 * @param {string} type - The type of notification (info, error, warning)
 */
function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.innerHTML = `<p>${message}</p>`;

  // Set styles based on notification type
  let bgColor = "rgba(0, 0, 255, 0.7)"; // info
  if (type === "error") bgColor = "rgba(255, 0, 0, 0.7)";
  if (type === "warning") bgColor = "rgba(255, 165, 0, 0.7)";

  notification.style.cssText = `
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background-color: ${bgColor};
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    z-index: 1000;
    text-align: center;
  `;

  document.body.appendChild(notification);

  // Remove the notification after 5 seconds
  setTimeout(() => {
    notification.style.opacity = "0";
    setTimeout(() => notification.remove(), 1000);
  }, 5000);
}

/**
 * Shows the waiting screen with the game code
 * @param {string} code - The game code to display
 */
function showWaitingScreen(code) {
  if (menuScreen) menuScreen.classList.add("hidden");
  if (waitingScreen) {
    waitingScreen.classList.remove("hidden");
    if (gameCodeDisplay) gameCodeDisplay.textContent = code;
  }
  if (gameScreen) gameScreen.classList.add("hidden");
}

/**
 * Shows the game screen and initializes the game
 * @param {string} code - The game code to display
 */
function showGameScreen(code) {
  if (menuScreen) menuScreen.classList.add("hidden");
  if (waitingScreen) waitingScreen.classList.add("hidden");
  if (gameScreen) {
    gameScreen.classList.remove("hidden");
    if (gameCodeSmall) gameCodeSmall.textContent = `Game: ${code}`;
    if (playerStatus) playerStatus.textContent = `You: Player ${playerId}`;
  }

  // Initialize or restart the game
  initializeBoard();
  currentPiece = getRandomPiece();
  currentX =
    Math.floor(COLS / 2) - Math.floor(currentPiece.shape[0].length / 2);
  currentY = 0;
  score = 0;
  linesCleared = 0;
  lastDropTime = 0;
  gameStarted = true;

  // Start the game loop
  requestAnimationFrame(gameLoop);
}

/**
 * Enables single-player mode when WebSocket connection fails
 */
function enableSinglePlayerMode() {
  // Display a notification to the user
  showNotification(
    "Unable to connect to multiplayer server. You can continue playing in single-player mode.",
    "warning"
  );

  // Set a flag indicating we're in single-player mode
  window.singlePlayerMode = true;

  // Go directly to the game screen if we're not already there
  if (gameScreen && gameScreen.classList.contains("hidden")) {
    if (menuScreen) menuScreen.classList.add("hidden");
    if (waitingScreen) waitingScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");

    // Update UI to show single player mode
    if (playerStatus) playerStatus.textContent = "Single Player Mode";
    if (gameCodeSmall) gameCodeSmall.textContent = "";

    // Initialize the game
    initializeGame();
  }
}

/**
 * Initialize the game for single player mode
 */
function initializeGame() {
  initializeBoard();
  currentPiece = getRandomPiece();
  currentX =
    Math.floor(COLS / 2) - Math.floor(currentPiece.shape[0].length / 2);
  currentY = 0;
  score = 0;
  linesCleared = 0;
  lastDropTime = 0;
  gameStarted = true;

  // Start the game loop
  requestAnimationFrame(gameLoop);
}

// Helper function to send messages to the server
function sendMessage(message) {
  // Don't attempt to send messages in single-player mode
  if (window.singlePlayerMode) {
    return;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  } else {
    console.warn("Cannot send message, WebSocket is not connected");
    // If we get here and single-player mode isn't set, enable it
    if (!window.singlePlayerMode) {
      console.log("Switching to single-player mode due to connection issues");
      enableSinglePlayerMode();
    }
  }
}

// Initialize UI Event Listeners
function initializeUIListeners() {
  // Create Game button
  if (createGameBtn) {
    createGameBtn.addEventListener("click", () => {
      sendMessage({ type: "createGame" });
    });
  }

  // Join Game button
  if (joinGameBtn) {
    joinGameBtn.addEventListener("click", () => {
      const code = gameCodeInput.value.trim().toUpperCase();
      if (code.length === 6) {
        sendMessage({ type: "joinGame", gameCode: code });
      } else {
        showNotification("Please enter a valid 6-character game code", "error");
      }
    });
  }

  // Single Player button
  if (singlePlayerBtn) {
    singlePlayerBtn.addEventListener("click", () => {
      window.singlePlayerMode = true;
      showGameScreen("SINGLE");
    });
  }

  // Cancel Game button
  if (cancelGameBtn) {
    cancelGameBtn.addEventListener("click", () => {
      sendMessage({ type: "cancelGame" });
      // Go back to menu
      if (menuScreen) menuScreen.classList.remove("hidden");
      if (waitingScreen) waitingScreen.classList.add("hidden");
      if (gameScreen) gameScreen.classList.add("hidden");
    });
  }

  // Init the game code input for easier entry
  if (gameCodeInput) {
    gameCodeInput.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
  }
}

/**
 * Connects to the WebSocket server
 * Sets up the game in either multiplayer or single-player mode
 */
function connectToServer() {
  // Check if WebSocket is actually open before trying to use it
  if (socket.readyState === WebSocket.OPEN) {
    console.log("WebSocket connection initialized");
    // In multiplayer mode, we wait for the server to send us game state
    sendMessage({ type: "requestGameStart" });
    gameStarted = true;
  } else if (socket.readyState === WebSocket.CONNECTING) {
    console.log("WebSocket is connecting, waiting...");

    // Set a timeout to check connection status after 2 seconds
    setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        console.log(
          "WebSocket connection timed out, starting in single-player mode"
        );
        window.singlePlayerMode = true;
        gameStarted = true;
      }
    }, 2000);
  } else {
    // WebSocket is closed or closing
    console.log("No WebSocket connection, starting in single-player mode");
    window.singlePlayerMode = true;
    gameStarted = true;
  }
}

// Canvas Setup
const canvas = document.getElementById("tetrisCanvas");
const ctx = canvas.getContext("2d");

// Set canvas dimensions based on game grid
canvas.width = COLS * BLOCK_SIZE;
canvas.height = ROWS * BLOCK_SIZE;

// Initialize UI event listeners
initializeUIListeners();

// Tetromino Definitions
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

// Initialize empty board
function initializeBoard() {
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
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
 * Checks if a move is valid (within boundaries and not colliding)
 * @param {Object} piece - The piece to check
 * @param {number} newX - The new x coordinate to check
 * @param {number} newY - The new y coordinate to check
 * @returns {boolean} True if the move is valid, false otherwise
 */
function isValidMove(piece, newX, newY) {
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
      if (boardY >= 0 && board[boardY][boardX]) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Checks for and clears completed lines
 * @returns {number} The number of lines cleared
 */
function checkLines() {
  let linesCleared = 0;

  // Check each row from bottom to top
  for (let row = ROWS - 1; row >= 0; row--) {
    // Check if this row is complete (all blocks filled)
    const isRowComplete = board[row].every((cell) => cell !== 0);

    if (isRowComplete) {
      linesCleared++;

      // Move all rows above this one down
      for (let r = row; r > 0; r--) {
        board[r] = [...board[r - 1]];
      }

      // Create an empty row at the top
      board[0] = Array(COLS).fill(0);

      // Since we've moved all rows down, we need to check this row again
      row++;
    }
  }

  return linesCleared;
}

/**
 * Locks the current piece into the board
 */
function lockPiece() {
  for (let row = 0; row < currentPiece.shape.length; row++) {
    for (let col = 0; col < currentPiece.shape[row].length; col++) {
      if (!currentPiece.shape[row][col]) continue;

      // Calculate position on the board
      const boardY = currentY + row;

      // Don't add blocks above the board
      if (boardY < 0) continue;

      // Add block to the board (store the color)
      board[boardY][currentX + col] = currentPiece.color;
    }
  }

  // Check for completed lines
  const clearedLines = checkLines();
  if (clearedLines > 0) {
    // Update total lines cleared
    linesCleared += clearedLines;

    // Update score based on number of lines cleared
    const pointsEarned = SCORE_VALUES[clearedLines] || clearedLines * 100;
    score += pointsEarned;

    console.log(`Cleared ${clearedLines} lines! +${pointsEarned} points`);
  }

  // Generate new piece
  currentPiece = getRandomPiece();
  currentX =
    Math.floor(COLS / 2) - Math.floor(currentPiece.shape[0].length / 2);
  currentY = 0;

  // Game over condition (if can't place new piece)
  if (!isValidMove(currentPiece, currentX, currentY)) {
    console.log("Game Over!");
    gameStarted = false; // Stop the game
    // Display game over message or restart option
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "30px Arial";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2);
    ctx.fillText(
      `Final Score: ${score}`,
      canvas.width / 2,
      canvas.height / 2 + 40
    );

    ctx.font = "20px Arial";
    ctx.fillText(
      "Press R to restart",
      canvas.width / 2,
      canvas.height / 2 + 80
    );
  }
}

/**
 * Draws the score and lines cleared on the canvas
 */
function drawStats() {
  ctx.fillStyle = "#FFF";
  ctx.font = "20px Arial";
  ctx.textAlign = "left";
  ctx.fillText(`Score: ${score}`, 10, 30);
  ctx.fillText(`Lines: ${linesCleared}`, 10, 60);
}

/**
 * Draws the current game board state
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D rendering context
 */
function drawBoard(ctx) {
  // Clear the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw the grid
  drawGrid(ctx);

  // Draw fixed blocks on the board
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (board[row][col]) {
        // Get the block color
        let blockColor = board[row][col];
        let isGarbage = false;

        // Check if this is a garbage block
        if (typeof blockColor === "string" && blockColor.includes("-garbage")) {
          isGarbage = true;
          blockColor = blockColor.replace("-garbage", "");
        }

        // Draw filled square with the color stored in the board
        ctx.fillStyle = blockColor;
        ctx.fillRect(
          col * BLOCK_SIZE,
          row * BLOCK_SIZE,
          BLOCK_SIZE,
          BLOCK_SIZE
        );

        // Draw border
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          col * BLOCK_SIZE,
          row * BLOCK_SIZE,
          BLOCK_SIZE,
          BLOCK_SIZE
        );

        // Add visual indicator for garbage blocks
        if (isGarbage) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 0.5;

          // Draw diagonal stripes
          for (let i = 0; i < BLOCK_SIZE; i += 4) {
            ctx.beginPath();
            ctx.moveTo(col * BLOCK_SIZE, row * BLOCK_SIZE + i);
            ctx.lineTo(col * BLOCK_SIZE + i, row * BLOCK_SIZE);
            ctx.stroke();
          }
        }
      }
    }
  }

  // Draw current piece
  drawPiece(ctx, currentPiece, currentX, currentY);

  // Draw score and lines cleared
  drawStats();
}

/**
 * Draws the empty Tetris grid lines on the canvas
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D rendering context
 */
function drawGrid(ctx) {
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 0.5;

  // Draw horizontal grid lines
  for (let row = 0; row <= ROWS; row++) {
    ctx.beginPath();
    ctx.moveTo(0, row * BLOCK_SIZE);
    ctx.lineTo(COLS * BLOCK_SIZE, row * BLOCK_SIZE);
    ctx.stroke();
  }

  // Draw vertical grid lines
  for (let col = 0; col <= COLS; col++) {
    ctx.beginPath();
    ctx.moveTo(col * BLOCK_SIZE, 0);
    ctx.lineTo(col * BLOCK_SIZE, ROWS * BLOCK_SIZE);
    ctx.stroke();
  }
}

/**
 * Draws a tetromino piece at the specified coordinates
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D rendering context
 * @param {Object} piece - The piece to draw
 * @param {number} x - The x coordinate of the piece (in grid units)
 * @param {number} y - The y coordinate of the piece (in grid units)
 */
function drawPiece(ctx, piece, x, y) {
  if (!piece) return;

  ctx.fillStyle = piece.color;

  for (let row = 0; row < piece.shape.length; row++) {
    for (let col = 0; col < piece.shape[row].length; col++) {
      if (piece.shape[row][col]) {
        // Calculate position on the board
        const boardY = y + row;

        // Only draw if on the visible board
        if (boardY < 0) continue;

        // Draw filled square
        ctx.fillRect(
          (x + col) * BLOCK_SIZE,
          boardY * BLOCK_SIZE,
          BLOCK_SIZE,
          BLOCK_SIZE
        );

        // Draw border
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          (x + col) * BLOCK_SIZE,
          boardY * BLOCK_SIZE,
          BLOCK_SIZE,
          BLOCK_SIZE
        );
      }
    }
  }
}

/**
 * Move the current piece down by one row (gravity)
 */
function dropPiece() {
  // Send drop piece message to server
  sendMessage({ type: "dropPiece" });

  // In single player mode, handle the drop locally
  if (window.singlePlayerMode || true) {
    // Always handle locally for responsiveness
    moveDown();
  }
}

/**
 * Move the current piece left
 */
function moveLeft() {
  // Send move left message to server
  sendMessage({ type: "moveLeft" });

  // Single player mode or for smoother gameplay, handle the move locally as well
  if (window.singlePlayerMode || true) {
    // Always handle locally for responsiveness
    if (isValidMove(currentPiece, currentX - 1, currentY)) {
      currentX--;
    }
  }
}

/**
 * Move the current piece right
 */
function moveRight() {
  // Send move right message to server
  sendMessage({ type: "moveRight" });

  // Single player mode or for smoother gameplay, handle the move locally as well
  if (window.singlePlayerMode || true) {
    // Always handle locally for responsiveness
    if (isValidMove(currentPiece, currentX + 1, currentY)) {
      currentX++;
    }
  }
}

/**
 * Move the current piece down (fast drop)
 */
function moveDown() {
  // Send move down message to server
  sendMessage({ type: "moveDown" });

  // Single player mode or for smoother gameplay, handle the move locally as well
  if (window.singlePlayerMode || true) {
    // Always handle locally for responsiveness
    if (isValidMove(currentPiece, currentX, currentY + 1)) {
      currentY++;
    } else {
      // Lock the piece in place if it can't move down
      lockPiece();

      // Clear any completed lines
      const linesCleared = checkLines();

      // Update score
      if (linesCleared > 0) {
        score += SCORE_VALUES[linesCleared] || 0;
      }

      // Create a new piece
      currentPiece = getRandomPiece();
      currentX =
        Math.floor(COLS / 2) - Math.floor(currentPiece.shape[0].length / 2);
      currentY = 0;

      // Check for game over (if the new piece doesn't fit)
      if (!isValidMove(currentPiece, currentX, currentY)) {
        gameStarted = false;
      }
    }
  }
}

/**
 * Rotate the current piece
 */
function rotatePiece() {
  // Send rotate message to server
  sendMessage({ type: "rotate" });

  // Single player mode or for smoother gameplay, handle rotation locally
  if (window.singlePlayerMode || true) {
    // Always handle locally for responsiveness
    // Create a copy of the current piece
    const originalPiece = { ...currentPiece };

    // Create a rotated shape (transpose then reverse rows)
    const rows = currentPiece.shape.length;
    const cols = currentPiece.shape[0].length;

    // Create a new empty shape with swapped dimensions
    const rotatedShape = Array.from({ length: cols }, () =>
      Array(rows).fill(0)
    );

    // Transpose and reverse rows (90-degree rotation)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        rotatedShape[c][rows - 1 - r] = currentPiece.shape[r][c];
      }
    }

    // Update the shape
    currentPiece.shape = rotatedShape;

    // Revert if the rotation is invalid
    if (!isValidMove(currentPiece, currentX, currentY)) {
      currentPiece = originalPiece;
    }
  }
}

/**
 * Handle keyboard input
 * @param {KeyboardEvent} event - The keyboard event
 */
function handleKeyPress(event) {
  if (!gameStarted && event.key.toLowerCase() === "r") {
    // Restart the game
    initializeBoard();
    currentPiece = getRandomPiece();
    currentX =
      Math.floor(COLS / 2) - Math.floor(currentPiece.shape[0].length / 2);
    currentY = 0;
    gameStarted = true;
    score = 0;
    linesCleared = 0;
    lastDropTime = 0;
    requestAnimationFrame(gameLoop);
    return;
  }

  switch (event.key) {
    case "ArrowLeft":
      moveLeft();
      break;
    case "ArrowRight":
      moveRight();
      break;
    case "ArrowDown":
      moveDown();
      break;
    case "ArrowUp":
      rotatePiece();
      break;
  }
}

/**
 * Main game loop
 * @param {number} timestamp - The current timestamp from requestAnimationFrame
 */
function gameLoop(timestamp) {
  // Exit if game is over
  if (!gameStarted) return;

  // Initialize lastDropTime on first run
  if (lastDropTime === 0) {
    lastDropTime = timestamp;
  }

  // Check if it's time to drop the piece
  if (timestamp - lastDropTime > DROP_INTERVAL) {
    dropPiece();
    lastDropTime = timestamp;
  }

  // Draw the current state
  drawBoard(ctx);

  // Draw opponent's board if available
  if (opponentBoard.length > 0) {
    drawOpponentBoard();
  }

  // Continue the game loop
  requestAnimationFrame(gameLoop);
}

// Add event listener for keyboard input
document.addEventListener("keydown", handleKeyPress);

/**
 * Updates the local game state from the server data
 * @param {Object} state - The game state received from the server
 */
function updateGameState(state) {
  // Update board if it exists in the state
  if (state.board) {
    board = state.board;

    // Check for garbage lines to highlight them differently
    highlightGarbageLines();
  }

  // Update current piece if it exists
  if (state.currentPiece) {
    currentPiece = state.currentPiece;
  }

  // Update position
  if (state.currentX !== undefined) {
    currentX = state.currentX;
  }

  if (state.currentY !== undefined) {
    currentY = state.currentY;
  }

  // Update score and lines
  if (state.score !== undefined) {
    score = state.score;
  }

  if (state.linesCleared !== undefined) {
    linesCleared = state.linesCleared;
  }

  // Check for game over
  if (state.gameOver) {
    gameStarted = false;
  }

  // Redraw the game with updated state
  drawBoard(ctx);
}

/**
 * Updates the opponent's state for display
 * @param {Object} message - The opponent update message
 */
function updateOpponentState(message) {
  opponentId = message.playerId;
  opponentBoard = message.board;
  opponentScore = message.score || 0;
  opponentLines = message.linesCleared || 0;
  opponentGameOver = message.gameOver || false;

  // Update the opponent info div
  updateOpponentDisplay();
}

/**
 * Updates the opponent info display in the DOM
 */
function updateOpponentDisplay() {
  const opponentInfoDiv = document.getElementById("opponentInfo");
  if (!opponentInfoDiv) return;

  // Create a mini-canvas for opponent's board
  if (!opponentInfoDiv.querySelector("canvas")) {
    const canvas = document.createElement("canvas");
    canvas.id = "opponentCanvas";
    canvas.width = COLS * 15; // Smaller block size for opponent board
    canvas.height = ROWS * 15;
    opponentInfoDiv.appendChild(canvas);
  }

  // Update text info
  const infoSection = document.createElement("div");
  infoSection.innerHTML = `
    <h3>Opponent (Player ${opponentId})</h3>
    <p>Score: ${opponentScore}</p>
    <p>Lines: ${opponentLines}</p>
    ${opponentGameOver ? '<p class="game-over">GAME OVER</p>' : ""}
  `;

  // Replace any existing info section
  const existingInfo = opponentInfoDiv.querySelector("div");
  if (existingInfo) {
    opponentInfoDiv.replaceChild(infoSection, existingInfo);
  } else {
    opponentInfoDiv.appendChild(infoSection);
  }

  // Draw the opponent's board
  drawOpponentBoard();
}

/**
 * Draws the opponent's board on the mini-canvas
 */
function drawOpponentBoard() {
  const canvas = document.getElementById("opponentCanvas");
  if (!canvas || !opponentBoard.length) return;

  const ctx = canvas.getContext("2d");
  const blockSize = 15; // Smaller blocks for opponent view

  // Clear the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw background
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw the board
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (opponentBoard[row] && opponentBoard[row][col]) {
        // Draw filled square with the color stored in the board
        ctx.fillStyle = opponentBoard[row][col];
        ctx.fillRect(col * blockSize, row * blockSize, blockSize, blockSize);

        // Draw border
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(col * blockSize, row * blockSize, blockSize, blockSize);
      }
    }
  }

  // Draw grid lines
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 0.5;

  // Horizontal lines
  for (let row = 0; row <= ROWS; row++) {
    ctx.beginPath();
    ctx.moveTo(0, row * blockSize);
    ctx.lineTo(COLS * blockSize, row * blockSize);
    ctx.stroke();
  }

  // Vertical lines
  for (let col = 0; col <= COLS; col++) {
    ctx.beginPath();
    ctx.moveTo(col * blockSize, 0);
    ctx.lineTo(col * blockSize, ROWS * blockSize);
    ctx.stroke();
  }
}

/**
 * Shows a visual warning that garbage lines are incoming
 * @param {number} numLines - Number of garbage lines
 */
function showGarbageWarning(numLines) {
  const gameContainer = document.querySelector(".game-container");
  if (!gameContainer) return;

  // Create warning element
  const warningElement = document.createElement("div");
  warningElement.className = "garbage-warning";
  warningElement.textContent = `${numLines} garbage line${
    numLines > 1 ? "s" : ""
  } incoming!`;
  warningElement.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: rgba(255, 0, 0, 0.7);
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    font-weight: bold;
    animation: fadeOut 2s forwards;
    z-index: 100;
  `;

  // Add the warning to the game container
  gameContainer.appendChild(warningElement);

  // Remove after animation completes
  setTimeout(() => {
    if (warningElement.parentNode) {
      warningElement.parentNode.removeChild(warningElement);
    }
  }, 2000);
}

/**
 * Highlights garbage lines with a special effect
 */
function highlightGarbageLines() {
  // Look for garbage lines (rows that have all cells filled with the same color
  // except for one gap)
  for (let row = 0; row < ROWS; row++) {
    if (!board[row]) continue;

    let emptyCount = 0;
    let filledCount = 0;
    let isGarbage = true;
    let garbageColor = null;

    // Check each cell in the row
    for (let col = 0; col < COLS; col++) {
      if (!board[row][col]) {
        emptyCount++;
      } else {
        filledCount++;

        // If this is the first filled cell, store its color
        if (garbageColor === null) {
          garbageColor = board[row][col];
        }
        // If this cell has a different color than other filled cells,
        // it's not a garbage line
        else if (board[row][col] !== garbageColor) {
          isGarbage = false;
          break;
        }
      }
    }

    // If this is a garbage line (one empty cell, rest filled with same color)
    // Add a visual indicator by adding a striped pattern
    if (isGarbage && emptyCount === 1 && filledCount === COLS - 1) {
      for (let col = 0; col < COLS; col++) {
        if (board[row][col]) {
          // Keep track that this is a garbage block
          if (
            typeof board[row][col] === "string" &&
            !board[row][col].includes("garbage")
          ) {
            board[row][col] = board[row][col] + "-garbage";
          }
        }
      }
    }
  }
}
