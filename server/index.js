require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const pathModule = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

let YoutubeTranscript;
try {
  YoutubeTranscript = require('youtube-transcript').YoutubeTranscript;
} catch (e) {
  console.warn('youtube-transcript not installed — transcripts will be unavailable');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Pollinations image proxy endpoint ───────────────────────────────────────
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, anchorImage } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const decoratedPrompt = anchorImage
      ? `${prompt}. Match the style/composition of the provided anchor image.`
      : prompt;
      
    const seed = Date.now() % 1000000;
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(decoratedPrompt)}?width=1024&height=1024&seed=${seed}&nologo=true`;

    console.log(`[Image Tool] Requesting image from Pollinations...`);

    // CRITICAL FIX 1: Add a User-Agent disguise so we don't get blocked!
    // We use the global native fetch that comes with Node 24.
    const response = await globalThis.fetch(imageUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Pollinations API rejected the request with status: ${response.status}`);
    }

    // CRITICAL FIX 2: Use arrayBuffer() for modern Node.js compatibility
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    res.json({
      mimeType: 'image/jpeg',
      data: base64,
      url: imageUrl,
      fileName: `lisa_generated_${seed}.jpg`,
    });
  } catch (err) {
    console.error('[Image Generation Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});
const URI = process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI;
const DB = 'chatapp';
let db;

async function connect() {
  if (!URI) throw new Error('No MongoDB URI found in .env');
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('✅ MongoDB connected successfully');
}

app.get('/', (req, res) => {
  res.send('<h1>Chat API Server Running</h1>');
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users & Sessions ─────────────────────────────────────────────────────────

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      username: username.toLowerCase(),
      password: hashed,
      email, firstName, lastName,
      createdAt: new Date().toISOString()
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.collection('users').findOne({ username: username.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ ok: true, username: user.username, firstName: user.firstName, lastName: user.lastName });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await db.collection('sessions').find({ username: req.query.username }).toArray();
    res.json(sessions.map(s => ({ id: s._id.toString(), title: s.title, createdAt: s.createdAt })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const result = await db.collection('sessions').insertOne({
      username: req.body.username,
      title: req.body.title || 'New Chat',
      messages: [],
      createdAt: new Date().toISOString()
    });
    res.json({ id: result.insertedId.toString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls } = req.body;
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: { role, content, imageData, charts, toolCalls, timestamp: new Date().toISOString() } } }
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/messages', async (req, res) => {
  try {
    const doc = await db.collection('sessions').findOne({ _id: new ObjectId(req.query.session_id) });
    res.json(doc?.messages || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── YouTube Logic ───────────────────────────────────────────────────────────

function parseDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return iso;
  const h = parseInt(match[1] || 0), m = parseInt(match[2] || 0), s = parseInt(match[3] || 0);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}


// ── YouTube Channel Data Endpoint (SSE) ─────────────────────────────
app.get('/api/youtube/channel-data', async (req, res) => {
  const { url: channelUrl, maxVideos: maxStr } = req.query;
  const maxVideos = Math.min(parseInt(maxStr) || 10, 100);
  const YOUTUBE_API_KEY = process.env.REACT_APP_YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };

  try {
    send({ type: 'progress', current: 0, total: maxVideos, message: 'Resolving channel...' });

    // ── DEMO MODE: Veritasium Data ──
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_YOUTUBE_API_KEY_HERE') {
      send({ type: 'progress', current: 5, total: 10, message: 'Using demo data (No API Key found)...' });
      const sampleData = [
        {
          title: "What Happens Inside a Black Hole?",
          description: "Black holes are fascinating...",
          transcript: "When matter falls into a black hole...",
          duration: "12:45",
          releaseDate: "2024-11-15T14:30:00Z",
          viewCount: 2500000,
          likeCount: 185000,
          commentCount: 42000,
          videoUrl: "https://www.youtube.com/watch?v=e-P5IFTqB98",
          videoId: "e-P5IFTqB98",
          thumbnailUrl: "https://i.ytimg.com/vi/e-P5IFTqB98/maxresdefault.jpg"
        },
        // ... add more demo items as needed
      ];
      const results = sampleData.slice(0, maxVideos);
      send({ type: 'complete', data: results, fileName: 'veritasium_data.json', channelTitle: 'Veritasium' });
      return res.end();
    }

    // ── REAL MODE: YouTube API ──
    const apiFetch = async (u) => {
      const r = await fetch(u);
      return await r.json();
    };

    // 1. Resolve Channel ID from @handle
    const handleMatch = channelUrl.match(/@([\w.-]+)/);
    if (!handleMatch) throw new Error("Invalid YouTube URL. Use the @handle format.");
    const searchData = await apiFetch(`https://www.googleapis.com/youtube/v3/search?q=${handleMatch[1]}&type=channel&part=snippet&key=${YOUTUBE_API_KEY}`);
    const channelId = searchData.items?.[0]?.id?.channelId;
    if (!channelId) throw new Error("Could not find channel.");

    // 2. Get Uploads Playlist
    const chanData = await apiFetch(`https://www.googleapis.com/youtube/v3/channels?id=${channelId}&part=contentDetails,snippet&key=${YOUTUBE_API_KEY}`);
    const uploadsId = chanData.items[0].contentDetails.relatedPlaylists.uploads;
    const channelTitle = chanData.items[0].snippet.title;


    // 3. Get Video IDs (with pagination)
    let videoIds = [];
    let nextPageToken = '';
    while (videoIds.length < maxVideos) {
      const remaining = maxVideos - videoIds.length;
      const maxResults = Math.min(50, remaining);
      const url = `https://www.googleapis.com/youtube/v3/playlistItems?playlistId=${uploadsId}&part=contentDetails&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}` + (nextPageToken ? `&pageToken=${nextPageToken}` : '');
      const playlistData = await apiFetch(url);
      if (playlistData.items && playlistData.items.length > 0) {
        videoIds.push(...playlistData.items.map(item => item.contentDetails.videoId));
      }
      if (!playlistData.nextPageToken || videoIds.length >= maxVideos) break;
      nextPageToken = playlistData.nextPageToken;
    }
    videoIds = videoIds.slice(0, maxVideos);

    // 4. Get Full Metadata + Transcripts
    const results = [];
    for (let i = 0; i < videoIds.length; i++) {
      send({ type: 'progress', current: i + 1, total: videoIds.length, message: `Downloading video ${i+1}...` });
      const vId = videoIds[i];
      const vMeta = await apiFetch(`https://www.googleapis.com/youtube/v3/videos?id=${vId}&part=snippet,contentDetails,statistics&key=${YOUTUBE_API_KEY}`);
      const v = vMeta.items[0];

      let transcript = null;
      if (YoutubeTranscript) {
        try { transcript = (await YoutubeTranscript.fetchTranscript(vId)).map(s => s.text).join(' '); } catch (e) {}
      }

      results.push({
        title: v.snippet.title,
        viewCount: parseInt(v.statistics.viewCount),
        likeCount: parseInt(v.statistics.likeCount),
        commentCount: parseInt(v.statistics.commentCount),
        duration: parseDuration(v.contentDetails.duration),
        releaseDate: v.snippet.publishedAt,
        videoUrl: `https://www.youtube.com/watch?v=${vId}`,
        thumbnailUrl: v.snippet.thumbnails?.high?.url,
        transcript
      });
    }

    send({ type: 'complete', data: results, fileName: `${channelTitle.replace(/\s/g, '_')}_data.json`, channelTitle });
    res.end();

  } catch (err) {
    console.error(err);
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ── STARTUP ──────────────────────────────────────────────────────────────────

const PORT = 3001;
connect().then(() => {
  app.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`✅ SERVER LIVE: http://localhost:${PORT}`);
    console.log(`=========================================\n`);
  });
}).catch(err => {
  console.error('❌ Startup failed:', err.message);
  process.exit(1);
});