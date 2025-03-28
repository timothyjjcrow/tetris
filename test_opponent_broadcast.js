const WebSocket = require("ws");

// Create two client connections to simulate two players
const player1 = new WebSocket("ws://localhost:8080");
const player2 = new WebSocket("ws://localhost:8080");

let player1Id = null;
let player2Id = null;

// Player 1 connection
player1.on("open", function open() {
  console.log("Player 1 connected");

  setTimeout(() => {
    // Send a move action
    const moveAction = {
      type: "playerAction",
      action: "moveLeft",
    };
    console.log("Player 1 sending move action");
    player1.send(JSON.stringify(moveAction));
  }, 1000);

  // After some time, lock a piece to trigger opponent state broadcast
  setTimeout(() => {
    const lockAction = {
      type: "playerAction",
      action: "lock",
    };
    console.log(
      "Player 1 sending lock action (should trigger opponent broadcast)"
    );
    player1.send(JSON.stringify(lockAction));
  }, 2000);
});

player1.on("message", function incoming(data) {
  const message = JSON.parse(data);
  console.log("Player 1 received:", message.type);

  if (message.type === "gameStateUpdate") {
    player1Id = message.state.id;
    console.log("Player 1 ID:", player1Id);
  }
});

// Player 2 connection
player2.on("open", function open() {
  console.log("Player 2 connected");
});

player2.on("message", function incoming(data) {
  const message = JSON.parse(data);
  console.log("Player 2 received:", message.type);

  if (message.type === "gameStateUpdate") {
    player2Id = message.state.id;
    console.log("Player 2 ID:", player2Id);
  }

  if (message.type === "opponentUpdate") {
    console.log(
      "✓ Opponent broadcasting works! Player 2 received opponent state from Player 1"
    );
    console.log("  Opponent board state and score received");
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
