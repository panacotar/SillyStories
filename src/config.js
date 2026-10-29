const { readFileSync } = require("node:fs");

function mongodbUri() {
  if (process.env.MONGODB_URI && process.env.MONGODB_PASSWORD_FILE) {
    throw new Error("Set either MONGODB_URI or MONGODB_PASSWORD_FILE, not both.");
  }
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  if (process.env.MONGODB_PASSWORD_FILE) {
    const password = readFileSync(process.env.MONGODB_PASSWORD_FILE, "utf8").trim();
    if (!password) throw new Error("MongoDB password file is empty.");
    return `mongodb://sillystories:${encodeURIComponent(password)}@mongodb:27017/sillyStories?authSource=sillyStories`;
  }
  throw new Error("MONGODB_URI or MONGODB_PASSWORD_FILE is required.");
}

module.exports = { mongodbUri };
