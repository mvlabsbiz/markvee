#!/usr/bin/env node
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 4300;
const OWNER_TOKEN = process.env.OWNER_TOKEN || '';
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const PROFILE_FILE = path.join(DATA_DIR, 'profile.jpg');
const BANNER_FILE = path.join(DATA_DIR, 'banner.jpg');

// Ensure data dir exists
fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});

// Utility: constant-time token comparison
function authed(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/, '');
  return OWNER_TOKEN && token.length === OWNER_TOKEN.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(OWNER_TOKEN));
}

// Utility: read JSON from request body
async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// Utility: read posts
async function readPosts() {
  try {
    const data = await fs.readFile(POSTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Utility: write posts
async function writePosts(posts) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(POSTS_FILE, JSON.stringify(posts, null, 2));
}

// Resize image: scale down if larger than maxWidth
async function shrinkImage(base64Data, maxWidth = 2048) {
  const sharp = require('sharp');
  const buffer = Buffer.from(base64Data, 'base64');
  try {
    const resized = await sharp(buffer)
      .resize(maxWidth, maxWidth, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return resized.toString('base64');
  } catch {
    return base64Data; // Return original if resize fails
  }
}

// HTTP server
const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // GET /
    if (p === '/' && req.method === 'GET') {
      const html = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // GET /style.css
    if (p === '/style.css' && req.method === 'GET') {
      const css = await fs.readFile(path.join(PUBLIC_DIR, 'style.css'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(css);
      return;
    }

    // GET /script.js
    if (p === '/script.js' && req.method === 'GET') {
      const js = await fs.readFile(path.join(PUBLIC_DIR, 'script.js'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(js);
      return;
    }

    // GET /profile (profile photo)
    if (p === '/profile' && req.method === 'GET') {
      try {
        const data = await fs.readFile(PROFILE_FILE);
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }

    // GET /banner (banner photo)
    if (p === '/banner' && req.method === 'GET') {
      try {
        const data = await fs.readFile(BANNER_FILE);
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }

    // GET /api/posts
    if (p === '/api/posts' && req.method === 'GET') {
      const posts = await readPosts();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        posts,
        canPost: authed(req)
      }));
      return;
    }

    // POST /api/posts (create post, owner-token required)
    if (p === '/api/posts' && req.method === 'POST') {
      if (!authed(req)) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const body = await readJson(req);
      const posts = await readPosts();

      // Save post images if present
      let imageUrls = [];
      if (body.images && Array.isArray(body.images)) {
        for (const img of body.images) {
          const shrunken = await shrinkImage(img);
          const hash = crypto.createHash('sha256').update(shrunken).digest('hex');
          const filename = `${hash}.jpg`;
          const filepath = path.join(DATA_DIR, 'media', filename);
          await fs.mkdir(path.dirname(filepath), { recursive: true });
          await fs.writeFile(filepath, shrunken, 'base64');
          imageUrls.push(`/media/${filename}`);
        }
      }

      const post = {
        id: Date.now().toString(),
        text: body.text || '',
        images: imageUrls,
        created: new Date().toISOString()
      };

      posts.unshift(post);
      await writePosts(posts);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(post));
      return;
    }

    // POST /api/profile (upload profile photo, owner-token required)
    if (p === '/api/profile' && req.method === 'POST') {
      if (!authed(req)) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const body = await readJson(req);
      if (!body.image) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'No image provided' }));
        return;
      }

      // Crop to 512x512 circle
      const sharp = require('sharp');
      const buffer = Buffer.from(body.image, 'base64');
      try {
        const resized = await sharp(buffer)
          .resize(512, 512, { fit: 'cover' })
          .jpeg({ quality: 90 })
          .toBuffer();
        await fs.writeFile(PROFILE_FILE, resized);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: '/profile' }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // POST /api/banner (upload banner photo, owner-token required)
    if (p === '/api/banner' && req.method === 'POST') {
      if (!authed(req)) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const body = await readJson(req);
      if (!body.image) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'No image provided' }));
        return;
      }

      // Fit to 1920x1080 (16:9)
      const sharp = require('sharp');
      const buffer = Buffer.from(body.image, 'base64');
      try {
        const resized = await sharp(buffer)
          .resize(1920, 1080, { fit: 'cover' })
          .jpeg({ quality: 90 })
          .toBuffer();
        await fs.writeFile(BANNER_FILE, resized);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: '/banner' }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // GET /media/* (post images)
    if (p.startsWith('/media/') && req.method === 'GET') {
      const filename = p.slice(7);
      if (!filename.match(/^[a-f0-9]{64}\.jpg$/)) {
        res.writeHead(400);
        res.end('Invalid filename');
        return;
      }
      try {
        const data = await fs.readFile(path.join(DATA_DIR, 'media', filename));
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`markvee.org running on port ${PORT}`);
});
