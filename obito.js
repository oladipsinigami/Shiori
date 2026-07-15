#!/usr/bin/env node
const { runObito } = require('./obito-core');

const [, , userId, ...msgParts] = process.argv;
const userMessage = msgParts.join(' ');

if (!userId || !userMessage) {
  console.error('Usage: node obito.js <user_id> "<user message>"');
  process.exit(1);
}

runObito(userId, userMessage)
  .then(({ text }) => {
    console.log(text);
    console.log(`[dev note: if this turn included feedback, manually update ./data/profiles/${userId}.json feedback_log before the next turn]`);
  })
  .catch(err => {
    console.error('Error calling Gemini API:', err.message);
    process.exit(1);
  });
