require("dotenv").config();
const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");

const story = require("./modules/create_story.js");

const STORY_SENTENCE_LIMIT = 20;
const MONGODB_CONNECTION_TIMEOUT_MS =
  process.env.NODE_ENV === "production" ? 30_000 : 3_000;

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

const messageSchema = new mongoose.Schema({
  id: Number,
  text: "String",
  name: "String",
  email: "String",
});

const Sentence = mongoose.model("Sentence", messageSchema);

const fullStoriesSchema = new mongoose.Schema({
  id: Number,
  name: "String",
  parts: {
    type: [messageSchema],
    required: true,
  },
});

const Story = mongoose.model("Story", fullStoriesSchema);

app.get("/", async function (req, res, next) {
  try {
    const newest = Sentence.findOne().sort({ _id: -1 });
    const results = await Sentence.find({});

    if (results.length === 0) {
      res.render("newstory");
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
