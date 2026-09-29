require("dotenv").config();
const mongoose = require("mongoose");

const { Story } = require("../src/models.js");

const SENTENCES_PER_STORY = 10;
const MONGODB_CONNECTION_TIMEOUT_MS = 10_000;

const seedStories = [
  {
    seedKey: "moonlight-bakery",
    name: "The Moonlight Bakery",
    sentences: [
      "At midnight, the bakery's brass bell rang even though the door was locked.",
      "Mara looked up from the dough and saw a fox in a velvet waistcoat waiting outside.",
      "The fox slid a silver coin under the door and politely requested a loaf of moonlight.",
      "Mara had never baked moonlight, but she disliked disappointing well-dressed customers.",
      "She climbed to the roof and caught a pale beam in her largest mixing bowl.",
      "The light fizzed when she added flour, yeast, and a cautious pinch of cinnamon.",
      "Soon the dough floated above the counter like a sleepy balloon.",
      "Mara tied it down with apron strings and pushed it into the hottest oven.",
      "When the timer chimed, a shining loaf sailed out and the fox caught it neatly.",
      "He carried its glow into the dark forest, waking the moon and every delighted nocturnal creature.",
    ],
  },
  {
    seedKey: "umbrella-submarine",
    name: "The Umbrella Submarine",
    sentences: [
      "Leo discovered that his grandfather's umbrella opened downward instead of up.",
      "When he pressed the handle twice, the hallway filled with the smell of the sea.",
      "A round porthole appeared in the fabric, and a tiny captain waved from inside.",
      "The captain shouted that the umbrella submarine urgently needed a navigator.",
      "Leo stepped beneath the canopy and tumbled into a cabin lined with maps.",
      "Outside the porthole, coat hooks had become coral and shoes swam like fish.",
      "They cruised through the flooded hallway and dove beneath the living-room rug.",
      "There they found an ocean deeper than the house had any right to contain.",
      "A school of teacups pointed them toward the missing bathroom plug, spinning inside a drain-shaped whirlpool.",
      "Together they rescued it, sealed the indoor ocean, and sailed home with a compass that pointed toward adventure.",
    ],
  },
  {
    seedKey: "dragon-library-card",
    name: "The Dragon's Library Card",
    sentences: [
      "On Tuesday morning, a dragon squeezed through the library's automatic doors.",
      "Everyone hid behind the shelves except Nia, who was busy stamping return dates.",
      "The dragon placed one enormous claw on the desk and whispered that he needed a library card.",
      "Nia handed him a form and asked for proof of his current address.",
      "He produced a slightly singed map with an X over the mountain next door.",
      "His name was Bernard, and he wanted books about making friends without frightening them.",
      "Nia recommended a guide to good manners and a cookbook for fireproof biscuits.",
      "Bernard tried to whisper thank you, but a puff of smoke set off the alarm.",
      "Mortified, Bernard swallowed every falling drop and practiced gentle introductions in the courtyard.",
      "Before long, he became the library's tallest volunteer and never again needed help finding a friend.",
    ],
  },
];

function buildParts(sentences) {
  if (sentences.length !== SENTENCES_PER_STORY) {
    throw new Error(`Every seed story must contain ${SENTENCES_PER_STORY} sentences.`);
  }

  return sentences.map((text, index) => ({
    id: index + 1,
    text,
    name: "Silly Stories Seed",
    email: "",
  }));
}

async function seed() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required. Copy .env.example to .env first.");
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: MONGODB_CONNECTION_TIMEOUT_MS,
  });

  try {
    const lastStory = await Story.findOne().sort({ id: -1 }).select({ id: 1 }).lean();
    const nextStoryId = (lastStory?.id || 0) + 1;
    const operations = seedStories.map((story, index) => ({
      updateOne: {
        filter: { seedKey: story.seedKey },
        update: {
          $set: {
            name: story.name,
            parts: buildParts(story.sentences),
          },
          $setOnInsert: {
            id: nextStoryId + index,
            seedKey: story.seedKey,
          },
        },
        upsert: true,
      },
    }));

    const result = await Story.bulkWrite(operations);
    console.log(
      `Seeded ${seedStories.length} stories (${result.upsertedCount} added, ${result.modifiedCount} updated).`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  seed().catch((error) => {
    console.error("Failed to seed stories:", error);
    process.exitCode = 1;
  });
}

module.exports = { buildParts, seedStories };

// Prod seed
/**
 * 
On Tuesday morning, a dragon somehow squeezed through the library's automatic doors.

People scattered immediately.

Someone knocked over a chair

It struck a backpack.

It rolled across the floor and stopped beside a dusty red backpack.

a hand reached down..

It grabbed a folded map covered in tiny handwritten notes.

...one sentence was circled twice:

“Leave before the bells.”

Nobody knew why. Why?
  *
*/
