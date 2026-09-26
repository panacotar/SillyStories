## SillyStories

Collectively creative writing game where one person writes a sentence and others will continue the story, but only seeing the last sentence. 

Once there are 20 sentences, the app automatically creates a story, publishes it on the complete-stories page and deletes the sentences.
The next user is being shown the new-story page and can choose whether to see all the complete story, or to start a new one.

Users are able to decide if they wanted to receive the complete story via email.

## Requirements

- Node.js 24
- A MongoDB database (MongoDB Atlas Free is suitable)

## Local setup

1. Create a free MongoDB Atlas cluster and a database user with `readWrite` access to the `sillyStories` database.
2. Copy `.env.example` to `.env` and replace the placeholder in `MONGODB_URI` with the Atlas connection string.
3. Install dependencies and start the development server:

   ```sh
   npm ci
   npm run dev
   ```

The app is available at `http://localhost:3000` by default.

For a production-style local start, run `npm start`. To validate the JavaScript entry points, run `npm test`.

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
