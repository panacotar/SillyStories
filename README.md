## SillyStories

Collectively creative writing game where one person writes a sentence and others will continue the story, but only seeing the last sentence. 

Once there are 10 sentences, the app automatically creates a story, publishes it on the complete-stories page and deletes the sentences.
The next user is being shown the new-story page and can choose whether to see all the complete story, or to start a new one.

Users are able to decide if they wanted to receive the complete story via email.

## Requirements

- Node.js 24
- Docker with Docker Compose (or access to an external MongoDB database)

## Local setup

1. Create the local environment file:

```sh
cp .env.example .env
```

2. Start Docker Desktop (or your Docker daemon), then start MongoDB:

```sh
docker compose up -d --wait
```

The Compose service stores its data in a named volume and exposes MongoDB only
on `127.0.0.1:27018`, avoiding conflicts with a host-installed `mongod` daemon.
The default `.env.example` is already configured to use it:

```env
MONGODB_URI=mongodb://127.0.0.1:27018/sillyStories
PORT=3000
```

To use MongoDB Atlas instead, replace `MONGODB_URI` in `.env` with your Atlas
connection string:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER_HOST/sillyStories?retryWrites=true&w=majority
```

When using Atlas, add your current IP address to the project's Network
Access list. URL-encode passwords containing characters such as `@`, `:`,
or `/` before placing them in the connection string.

3. Install the dependencies:

```sh
npm ci
```

4. Start the development server:

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. On later
runs, make sure Docker is running and start MongoDB with
`docker compose up -d --wait` before starting the app. You can check the database
status with `docker compose ps` and follow its logs with
`docker compose logs -f mongodb`.

If startup reports `MongooseServerSelectionError`, the app cannot reach MongoDB.
The development command exits with an error instead of waiting for file changes.
For the local database, start Docker and run `docker compose up -d --wait`, then
rerun `npm run dev`.

### Seed the local database

With MongoDB running and `MONGODB_URI` configured in `.env`, run this command
from the project root:

```sh
npm run seed
```

This adds three sample stories with 10 sentences each. The development server
does not need to be running. You can run the command again safely: it updates
the sample stories without deleting stories created by users.

Use `npm start` to run the app without automatic restarts. To check the
JavaScript and run the HTTP security regression tests, run `npm test`.

To stop MongoDB, run `docker compose down`. The database is preserved between
restarts; use `docker compose down --volumes` only when you also want to delete
all local database data.

## Production deployment (VPS)

See the [VPS deployment guide](deploy/README.md) for production setup,
migration, backups, and operations.

## Notes

- The email opt-in interface and stored email field are retained from the original app, but email delivery is not implemented.
- Set local secrets only in `.env`. Never commit a real Atlas connection string.

______________

### Built with:
- Node.js
- Express
- EJS
- mongoose ODM
- **Database**
- - MongoDb
