require("dotenv").config();
const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");

const story = require("./modules/create_story.js");
const { Sentence, Story } = require("./models.js");

const STORY_SENTENCE_LIMIT = 10;
const MONGODB_CONNECTION_TIMEOUT_MS =
  process.env.NODE_ENV === "production" ? 30_000 : 3_000;

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", async function (req, res, next) {
  try {
    const newest = Sentence.findOne().sort({ _id: -1 });
    const [results, existingStory] = await Promise.all([
      Sentence.find({}),
      Story.exists({}),
    ]);
    const hasStories = existingStory !== null;

    if (results.length === 0) {
      res.render("newstory", { hasStories });
    } else if (results.length === STORY_SENTENCE_LIMIT) {
      const record = await Story.find({});
      await story.createNewStory(record, results, Story, Sentence, res);
    } else {
      const data = await newest.exec();
      const newestDoc = data.text;
      const sLeft = STORY_SENTENCE_LIMIT - data.id;
      res.render("index", {
        toRender: newestDoc,
        sencentesLeft: sLeft,
        sentenceLimit: STORY_SENTENCE_LIMIT,
        hasStories,
      });
    }
  } catch (error) {
    next(error);
  }
});

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

app.post("/", async function (req, res, next) {
  const message = req.body.message;
  const eMail = req.body.email;
  const fName = req.body.fName;

  try {
    const results = await Sentence.find({});
    const newMessage = new Sentence({
      id: results.length + 1,
      text: message,
      name: fName,
      email: eMail,
    });

    await newMessage.save();
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

app.use(function (req, res) {
  res.status(404).render("404");
});

app.use(function (error, req, res, next) {
  console.error(error);
  res.status(500).send("Something went wrong.");
});

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is required.");
    process.exitCode = 1;
    return;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: MONGODB_CONNECTION_TIMEOUT_MS,
    });

    const port = process.env.PORT || 3000;
    app.listen(port, function () {
      console.log(`Server has started, port ${port}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exitCode = 1;
  }
}

start();
