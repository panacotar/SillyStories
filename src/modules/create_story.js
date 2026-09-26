async function createNewStory(record, results, storyModel, sentenceModel, respond) {
  const story = new storyModel({
    id: record.length + 1,
    name: `Story#${record.length + 1}`,
    parts: results,
  });

  await story.save();
  await sentenceModel.deleteMany({});
  respond.render("fullstory");
}

exports.createNewStory = createNewStory;
