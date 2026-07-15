const fs = require('fs');
const path = require('path');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY not set. Add it to your .env or export it in your shell.');
}

const schemaPath = path.join(__dirname, 'data', 'profile-schema.json');
if (!fs.existsSync(schemaPath)) {
  throw new Error(`profile-schema.json not found at ${schemaPath}`);
}

const promptPath = path.join(__dirname, 'obito.md');
if (!fs.existsSync(promptPath)) {
  throw new Error(`obito.md not found at ${promptPath}`);
}

// Strip the --- frontmatter fence, keep only the body as the system prompt
function loadSystemPrompt(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const fenceMatch = raw.match(/^---\n[\s\S]*?\n---\n?/);
  return fenceMatch ? raw.slice(fenceMatch[0].length).trim() : raw.trim();
}
const systemPrompt = loadSystemPrompt(promptPath);

const profilesDir = path.join(__dirname, 'data', 'profiles');
const logsDir = path.join(__dirname, 'logs');
fs.mkdirSync(profilesDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

function loadOrCreateProfile(userId) {
  const profilePath = path.join(profilesDir, `${userId}.json`);
  let profile;
  if (fs.existsSync(profilePath)) {
    profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
  } else {
    profile = {
      user_id: userId,
      profile_status: 'empty',
      schedule: {},
      taste: {
        genre_affinities: [],
        tone_preferences: {},
        anchor_favorites: [],
        known_dislikes: []
      },
      feedback_log: []
    };
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  }
  return profile;
}

function logRecommendations(userId, text) {
  const recRegex = /<!--\s*rec_id:\s*(rec-\S+?)\s*-->/g;
  const recIds = [];
  let match;
  while ((match = recRegex.exec(text)) !== null) {
    const recId = match[1];
    const beforeMatch = text.slice(0, match.index);
    const lineStart = beforeMatch.lastIndexOf('\n') + 1;
    const lineEnd = text.indexOf('\n', match.index);
    const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const rawText = lineText.replace(/<!--[\s\S]*?-->/g, '').trim();

    const logPath = path.join(logsDir, `${userId}-recs.json`);
    const logs = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf-8')) : [];
    logs.push({
      rec_id: recId,
      raw_text_of_that_recommendation: rawText,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
    recIds.push(recId);
  }
  return recIds;
}

// Removes the internal <!-- rec_id: ... --> tracking comments so they
// never reach anything displaying the response to an end user.
function stripRecComments(text) {
  return text
    .replace(/<!--\s*rec_id:[^>]*-->/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Removes Markdown syntax so responses read as clean plain text
// regardless of whether the consumer (terminal, OKX.AI, etc.) renders Markdown.
function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')           // multi-line code blocks
    .replace(/\*\*\*+/g, '')                  // horizontal rules (***)
    .replace(/\*\*(.+?)\*\*/g, '$1')          // **bold**
    .replace(/\*(.+?)\*/g, '$1')              // *italic*
    .replace(/^#{1,6}\s+/gm, '')              // # headers
    .replace(/^\s*[-*]\s+/gm, '- ')           // normalize bullets
    .replace(/`([^`]+)`/g, '$1')              // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [links](url) -> link text
    .replace(/\n{3,}/g, '\n\n')               // collapse extra blank lines
    .trim();
}

// Runs one turn of the Obito agent for a given user. Returns the raw
// (Markdown-intact) response text plus any rec_ids logged this turn.
async function runObito(userId, userMessage) {
  const profile = loadOrCreateProfile(userId);
  const status = profile.profile_status || 'empty';
  const { today_context, ...profileRest } = profile;
  let context = `Context: profile_status=${status}. profile=${JSON.stringify(profileRest)}.`;
  if (today_context) {
    context += ` today_context=${JSON.stringify(today_context)}.`;
  }
  const fullMessage = `${context} ${userMessage}`;

  const model = process.env.OPENROUTER_MODEL || 'openrouter/auto';
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://obito-ai.app',
      'X-Title': 'Obito - AI Librarian'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fullMessage }
      ],
      temperature: 0.7,
      max_tokens: 800
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const rawOutput = (data.choices?.[0]?.message?.content || '').trim();

  const recIds = logRecommendations(userId, rawOutput);
  const cleanText = stripMarkdown(stripRecComments(rawOutput));

  return { text: cleanText, recIds };
}

module.exports = { runObito };
