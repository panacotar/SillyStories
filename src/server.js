require("dotenv").config();
const mongoose = require("mongoose");
const { createApp } = require("./app.js");
const { mongodbUri } = require("./config.js");

async function start() {
  const app = createApp();
  await mongoose.connect(mongodbUri(), {
    serverSelectionTimeoutMS: process.env.NODE_ENV === "production" ? 30_000 : 3_000,
  });
  const server = app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log(`Server has started, port ${process.env.PORT || 3000}`);
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => process.exit(1), 25_000);
    timeout.unref();
    server.close(async () => {
      await mongoose.disconnect();
      clearTimeout(timeout);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((error) => {
  console.error("Startup failed:", error.name);
  process.exitCode = 1;
});
