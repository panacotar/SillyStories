## SillyStories

Collectively creative writing game where one person writes a sentence and others will continue the story, but only seeing the last sentence. 

Once there are 20 sentences, the app automatically creates a story, publishes it on the complete-stories page and deletes the sentences.
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

2. Start MongoDB:

```sh
docker compose up -d
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
runs, start MongoDB with `docker compose up -d` before starting the app. You can
check the database status with `docker compose ps` and follow its logs with
`docker compose logs -f mongodb`.

Use `npm start` to run the app without automatic restarts. To validate the
JavaScript entry points, run `npm test`.

To stop MongoDB, run `docker compose down`. The database is preserved between
restarts; use `docker compose down --volumes` only when you also want to delete
all local database data.

## Free deployment

The recommended deployment is a Render Free Web Service backed by a MongoDB Atlas Free cluster.

Create the Render service with these settings:

- Runtime: Node
- Region: Frankfurt (choose a nearby Atlas region)
- Build command: `npm ci`
- Start command: `npm start`
- Instance type: Free
- Environment variables:
  - `MONGODB_URI`: the complete Atlas connection string
  - `NODE_ENV`: `production`

After creating the Render service, copy its outbound CIDR ranges from the service's **Connect > Outbound** panel into the Atlas project's IP access list. This avoids opening the database to `0.0.0.0/0`.

Render Free services sleep after 15 minutes without inbound traffic, so the first request after an idle period can take about a minute. The deployed URL will be the `onrender.com` address shown in the Render dashboard.

## Notes

- The email opt-in interface and stored email field are retained from the original app, but email delivery is not implemented.
- Set secrets only in `.env` locally or in the Render dashboard. Never commit a real Atlas connection string.
- The Heroku `Procfile` is retained for compatibility, but Render uses the `start` script in `package.json`.

______________

### Built with:
- Node.js
- Express
- jQuery
- EJS
- mongoose ODM
- **Database**
- - MongoDb
