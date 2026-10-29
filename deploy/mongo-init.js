// Runs only when /data/db is empty. Never grant the app admin privileges.
const fs = require("fs");
db.getSiblingDB("sillyStories").createUser({
  user: "sillystories",
  pwd: fs.readFileSync("/run/secrets/mongo_app_password", "utf8").trim(),
  roles: [{ role: "readWrite", db: "sillyStories" }],
});
