// WebSocket Test Script
const WebSocket = require("ws");

// Connect to server
const ws = new WebSocket("wss://repeated-fair-calendula.glitch.me");

ws.on("open", () => {
  console.log("Connected to server");

  // Send a createGame message
  const message = { type: "createGame" };
  ws.send(JSON.stringify(message));
  console.log("Sent message:", message);
});

ws.on("message", (data) => {
  try {
    const message = JSON.parse(data);
    console.log("Received response:", message);
  } catch (error) {
    console.error("Error parsing message:", error);
    console.log("Raw message:", data.toString());
  }
});

ws.on("error", (error) => {
  console.error("WebSocket error:", error);
});

ws.on("close", (code, reason) => {
  console.log(`Connection closed: ${code} - ${reason || "No reason"}`);
});

// Keep the script running for a while
setTimeout(() => {
  console.log("Test complete, closing connection");
  ws.close();
  process.exit(0);
}, 5000);
