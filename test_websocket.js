const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:8080");

ws.on("open", function open() {
  console.log("Connected to server");
  const testPlayer = {
    type: "playerAction",
    action: "moveLeft",
    playerId: "test123",
  };
  ws.send(JSON.stringify(testPlayer));
});

ws.on("message", function incoming(data) {
  console.log("Received: %s", data);
});

ws.on("error", function error(err) {
  console.error("WebSocket error: %s", err);
});

// Keep connection open for a few seconds
setTimeout(() => {
  ws.close();
  console.log("Connection closed");
}, 5000);
