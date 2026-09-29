const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  id: Number,
  text: String,
  name: String,
  email: String,
});

const fullStoriesSchema = new mongoose.Schema({
  id: Number,
  name: String,
  seedKey: {
    type: String,
    sparse: true,
    unique: true,
  },
  parts: {
    type: [messageSchema],
    required: true,
  },
});

const Sentence = mongoose.model("Sentence", messageSchema);
const Story = mongoose.model("Story", fullStoriesSchema);

module.exports = { Sentence, Story };
