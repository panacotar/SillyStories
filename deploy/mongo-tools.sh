#!/bin/sh
set -eu
umask 077

if [ "${1:-}" = health ]; then
  exec mongosh --quiet --host 127.0.0.1 --eval '
    const fs = require("fs");
    const target = db.getSiblingDB("sillyStories");
    target.auth("sillystories", fs.readFileSync("/run/secrets/mongo_app_password", "utf8").trim());
    if (target.runCommand({ ping: 1 }).ok !== 1) quit(1);
  '
fi

# Database Tools accepts a password config file, keeping credentials out of
# process arguments, the host environment, and backup archives. Generated
# passwords are hexadecimal; JSON quoting also handles manually rotated values.
config=$(mktemp)
trap 'rm -f "$config"' EXIT HUP INT TERM
mongosh --quiet --nodb --eval '
  const fs = require("fs");
  print("password: " + JSON.stringify(fs.readFileSync("/run/secrets/mongo_root_password", "utf8").trim()));
' > "$config"

case "${1:-}" in
  dump)
    mongodump --config="$config" --host=127.0.0.1 --username=root \
      --authenticationDatabase=admin --db=sillyStories --archive --gzip
    ;;
  restore)
    # No --drop: the host restore script requires an entirely empty app DB.
    mongorestore --config="$config" --host=127.0.0.1 --username=root \
      --authenticationDatabase=admin --archive --gzip --stopOnError \
      --nsInclude='sillyStories.*'
    ;;
  empty)
    mongosh --quiet --host 127.0.0.1 --eval '
      const fs = require("fs");
      db.getSiblingDB("admin").auth("root", fs.readFileSync("/run/secrets/mongo_root_password", "utf8").trim());
      if (db.getSiblingDB("sillyStories").getCollectionNames().length !== 0) quit(1);
    '
    ;;
  *) echo "Expected health, dump, restore, or empty." >&2; exit 2 ;;
esac
