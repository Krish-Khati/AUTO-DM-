require('dotenv').config({ quiet: true });
const express = require('express');

const { PAGE_ACCESS_TOKEN, VERIFY_TOKEN, IG_ACCOUNT_ID, PORT = 3000 } = process.env;
const GRAPH_URL = `https://graph.facebook.com/v21.0/${IG_ACCOUNT_ID}/messages`;

if (!PAGE_ACCESS_TOKEN || !VERIFY_TOKEN || !IG_ACCOUNT_ID) {
  console.error('Missing PAGE_ACCESS_TOKEN, VERIFY_TOKEN or IG_ACCOUNT_ID in .env');
  process.exit(1);
}

// Add or edit groups here; matching is case-insensitive on whole words.
const KEYWORD_REPLIES = [
  { keywords: ['info', 'information'], reply: 'Here is the info you asked for!' },
  { keywords: ['price', 'pricing', 'cost'], reply: 'Our pricing starts at ₹999. DM us for details!' },
  { keywords: ['contact', 'number', 'email'], reply: 'You can reach us at: your@email.com' },
  { keywords: ['hi', 'hello', 'hey'], reply: 'Hey! How can we help you today?' },
];

const DEFAULT_REPLY = 'Thanks for your message! We will get back to you soon.';

function pickReply(text) {
  const match = KEYWORD_REPLIES.find(({ keywords }) =>
    keywords.some((keyword) => {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    })
  );
  return match ? match.reply : DEFAULT_REPLY;
}

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('AUTO-DM is alive');
});

// Meta webhook verification handshake
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified by Meta');
    return res.status(200).send(challenge);
  }

  console.warn('Webhook verification failed: bad mode or token');
  res.sendStatus(403);
});

// Send a DM through the Instagram Graph API
async function reply(recipientId, text) {
  try {
    console.log(`Sending reply to ${recipientId} via ${GRAPH_URL}: ${text}`);

    const response = await fetch(
      `${GRAPH_URL}?access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text },
        }),
      }
    );
    const data = await response.json();

    if (!response.ok) {
      console.error(`Reply to ${recipientId} failed (${response.status}):`, data);
      return;
    }

    console.log(`Replied to ${recipientId}: ${text}`);
  } catch (err) {
    console.error(`Reply to ${recipientId} error:`, err);
  }
}

app.post('/webhook', (req, res) => {
  const body = req.body ?? {};
  console.log('Webhook event:', JSON.stringify(body));

  res.sendStatus(200); // ack immediately so Meta does not retry

  if (body.object !== 'instagram') return;

  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id;
      const text = event.message?.text;

      // Skip echoes of our own messages, read receipts, reactions, attachments
      if (!senderId || !text || event.message.is_echo) continue;

      console.log(`Message from ${senderId}: ${text}`);
      reply(senderId, pickReply(text));
    }
  }
});

app.listen(PORT, () => {
  console.log(`Instagram webhook listening on port ${PORT}`);
});
