const express = require("express");
const mongoose = require("mongoose");

const story = require("./modules/create_story.js");
const { Sentence, Story } = require("./models.js");

const { installSecurity, submissionLimiter, validateSubmission } = require("./security.js");

function createApp({
  production = process.env.NODE_ENV === "production",
  publicOrigin = process.env.PUBLIC_ORIGIN,
  trustProxy = process.env.TRUST_PROXY_HOPS === "1" ? 1 : false,
} = {}) {
  if (production && (!publicOrigin || new URL(publicOrigin).origin !== publicOrigin ||
      !publicOrigin.startsWith("https://"))) {
    throw new Error("Production requires PUBLIC_ORIGIN as an HTTPS origin without a trailing slash.");
  }
  const app = express();
  installSecurity(app, { production, publicOrigin, trustProxy });
  app.get("/healthz", (req, res) => {
    res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
      status: mongoose.connection.readyState === 1 ? "ok" : "unavailable",
    });
  });

  // One app process owns the story at a time. Serialize reads that finalize a
  // story and submissions so concurrent visitors cannot exceed ten sentences
  // or publish the same completed story twice.
  let pending = Promise.resolve();
  const storyRoute = (handler) => (req, res, next) => {
    const operation = pending.then(() => handler(req, res));
    pending = operation.catch(() => {});
    operation.catch(next);
  };

  const STORY_SENTENCE_LIMIT = 10;

  app.set("view engine", "ejs");

  app.get("/", storyRoute(async function (req, res) {
    const newest = Sentence.findOne().sort({ _id: -1 });
    const [results, existingStory] = await Promise.all([
      Sentence.find({}),
      Story.exists({}),
    ]);
    const hasStories = existingStory !== null;

    if (results.length === 0) {
      res.render("newstory", { hasStories });
    } else if (results.length >= STORY_SENTENCE_LIMIT) {
      const record = await Story.find({});
      await story.createNewStory(record, results, Story, Sentence, res);
    } else {
      const data = await newest.exec();
      const newestDoc = data.text;
      const sLeft = STORY_SENTENCE_LIMIT - results.length;
      res.render("index", {
        toRender: newestDoc,
        sencentesLeft: sLeft,
        sentenceLimit: STORY_SENTENCE_LIMIT,
        hasStories,
      });
    }
  }));

  app.get("/stories", async function (req, res, next) {
    try {
      const recordedStories = await Story.find().exec();
      res.render("stories", { stories: recordedStories });
    } catch (error) {
      next(error);
    }
  });

  app.get("/about", async function (req, res, next) {
    try {
      const existingStory = await Story.exists({});
      res.render("about", {
        hasStories: existingStory !== null,
        sentenceLimit: STORY_SENTENCE_LIMIT,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/", submissionLimiter(), (req, res, next) => {
    const error = validateSubmission(req.body);
    if (error) return res.status(400).send(error);
    next();
  }, storyRoute(async function (req, res) {
    let results = await Sentence.find({});
    // A visitor may post a form opened just before the preceding story finished.
    if (results.length >= STORY_SENTENCE_LIMIT) {
      await story.createNewStory(await Story.find({}), results, Story, Sentence);
      results = [];
    }
    await new Sentence({
      id: results.length + 1,
      text: req.body.message.trim(),
      name: req.body.fName,
      email: req.body.email,
    }).save();
    res.redirect(303, "/");
  }));

  app.use(function (req, res) {
    res.status(404).render("404");
  });

  app.use(function (error, req, res, next) {
    // Do not log submitted text, emails, or connection strings.
    console.error("Request failed:", error.name);
    const status = [400, 413, 415].includes(error.status) ? error.status : 500;
    res.status(status).send(status === 500 ? "Something went wrong." : "Invalid request body.");
  });

  return app;
}

module.exports = { createApp };
