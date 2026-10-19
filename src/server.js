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
  if (error.name === "MongooseServerSelectionError") {
    console.error("Cannot connect to MongoDB. Check that the database is running and its connection settings are correct.");
    if (process.env.NODE_ENV !== "production") {
      console.error("For the local database, start Docker Desktop, then run: docker compose up -d --wait");
      console.error("Then rerun npm run dev. If using an external database, check MONGODB_URI in .env and network access.");
    }
  }
  process.exitCode = 1;
});
