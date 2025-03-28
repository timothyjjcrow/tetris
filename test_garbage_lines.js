const WebSocket = require("ws");

// Create two client connections to simulate two players
const player1 = new WebSocket("ws://localhost:8080");
const player2 = new WebSocket("ws://localhost:8080");

let player1Id = null;
let player2Id = null;

// Helper function to simulate a player clearing multiple lines
// This sends a custom action to the server to trigger the garbage line mechanism
const simulateLinesClear = (ws, numLines) => {
  const message = {
    type: "playerAction",
    action: "simulateClearLines",
    lines: numLines,
  };
  ws.send(JSON.stringify(message));
};

// Player 1 connection
player1.on("open", function open() {
  console.log("Player 1 connected");

  // Allow both players to connect and get their IDs
  setTimeout(() => {
    // Simulate Player 1 clearing 3 lines, which should send garbage to Player 2
    console.log(
      "Player 1 simulating clearing 3 lines (should send garbage to Player 2)"
    );
    simulateLinesClear(player1, 3);
  }, 2000);
});

player1.on("message", function incoming(data) {
  const message = JSON.parse(data);

  if (message.type === "gameStateUpdate") {
    player1Id = message.state.id;
    console.log("Player 1 ID:", player1Id);
  }

  // Log any addGarbage messages (should not receive any from Player 2)
  if (message.type === "addGarbage") {
    console.log("Player 1 received garbage lines:", message.lines);
  }
});

// Player 2 connection
player2.on("open", function open() {
  console.log("Player 2 connected");
});

player2.on("message", function incoming(data) {
  const message = JSON.parse(data);

  if (message.type === "gameStateUpdate") {
    player2Id = message.state.id;
    console.log("Player 2 ID:", player2Id);
  }

  // Check for garbage lines from Player 1
  if (message.type === "addGarbage") {
    console.log(
      "✓ Garbage line mechanic works! Player 2 received",
      message.lines,
      "garbage lines from Player 1"
    );
  }
});

// Error handling
player1.on("error", console.error);
player2.on("error", console.error);

// Close connections after test
setTimeout(() => {
  console.log("Test completed, closing connections");
  player1.close();
  player2.close();
}, 5000);
