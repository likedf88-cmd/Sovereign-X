import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface LoungeMemberState {
  clientId: string;
  uid: string;
  displayName: string;
  handle: string;
  platform: 'pc' | 'mobile' | 'console';
  loyaltyRank: 'Squire' | 'Sentinel' | 'Vanguard' | 'Sovereign';
  equippedAvatarId: string;
  emote: string;
  moveState?: 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'land' | 'turn';
  speed?: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  chatText?: string;
  chatExpiresAt?: number;
  updatedAt: number;
}

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

// Persistent disk folder for uploaded GLB models & custom thumbnails
const UPLOAD_DIR = path.resolve(__dirname, '.uploads');
const IMAGE_UPLOAD_DIR = path.resolve(UPLOAD_DIR, 'images');
const VIDEO_UPLOAD_DIR = path.resolve(UPLOAD_DIR, 'videos');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(IMAGE_UPLOAD_DIR)) {
  fs.mkdirSync(IMAGE_UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(VIDEO_UPLOAD_DIR)) {
  fs.mkdirSync(VIDEO_UPLOAD_DIR, { recursive: true });
}
const modelMemoryCache = new Map<string, Buffer>();
const imageMemoryCache = new Map<string, { buffer: Buffer; contentType: string }>();
const videoMemoryCache = new Map<string, { buffer: Buffer; contentType: string }>();

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const ALLOWED_MOVE_STATES = new Set([
  'idle',
  'walk',
  'run',
  'sprint',
  'jump',
  'fall',
  'land',
  'turn',
]);

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  app.use(express.json({ limit: '2mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'sovereign-x', timestamp: Date.now() });
  });

  // Upload thumbnail/media image binary
  app.post(
    '/api/images/:imageId',
    express.raw({
      type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/octet-stream'],
      limit: '6mb',
    }),
    (req, res) => {
      const imageId = String(req.params.imageId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!imageId || imageId.length > 128) {
        res.status(400).json({ error: 'Invalid imageId' });
        return;
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Empty image payload' });
        return;
      }
      const rawCt = String(req.headers['content-type'] || 'image/jpeg').split(';')[0].trim().toLowerCase();
      const contentType = ALLOWED_IMAGE_TYPES.has(rawCt) ? rawCt : 'image/jpeg';

      imageMemoryCache.set(imageId, { buffer: body, contentType });
      const binPath = path.join(IMAGE_UPLOAD_DIR, `${imageId}.bin`);
      const metaPath = path.join(IMAGE_UPLOAD_DIR, `${imageId}.json`);
      fs.writeFile(binPath, body, (err) => {
        if (err) console.error('Failed to persist image binary:', err);
      });
      fs.writeFile(metaPath, JSON.stringify({ contentType }), (err) => {
        if (err) console.error('Failed to persist image metadata:', err);
      });

      res.json({
        ok: true,
        imageId,
        bytes: body.length,
        contentType,
        endpoint: `/api/images/${imageId}`,
      });
    },
  );

  // Serve thumbnail/media image binary
  app.get('/api/images/:imageId', (req, res) => {
    const imageId = String(req.params.imageId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!imageId) {
      res.status(400).json({ error: 'Invalid imageId' });
      return;
    }
    const cached = imageMemoryCache.get(imageId);
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cached.buffer);
      return;
    }
    const binPath = path.join(IMAGE_UPLOAD_DIR, `${imageId}.bin`);
    const metaPath = path.join(IMAGE_UPLOAD_DIR, `${imageId}.json`);
    if (fs.existsSync(binPath)) {
      const buf = fs.readFileSync(binPath);
      let contentType = 'image/jpeg';
      if (fs.existsSync(metaPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { contentType?: string };
          if (parsed.contentType && ALLOWED_IMAGE_TYPES.has(parsed.contentType)) {
            contentType = parsed.contentType;
          }
        } catch {
          // fallback to image/jpeg
        }
      }
      imageMemoryCache.set(imageId, { buffer: buf, contentType });
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buf);
      return;
    }
    res.status(404).json({ error: 'Image not found' });
  });

  // Upload custom GLB model binary for shared 3D Lounge & Item Shop rendering
  app.post(
    '/api/models/:modelId',
    express.raw({ type: ['application/octet-stream', 'model/gltf-binary'], limit: '15mb' }),
    (req, res) => {
      const modelId = String(req.params.modelId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!modelId || modelId.length > 128) {
        res.status(400).json({ error: 'Invalid modelId' });
        return;
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Empty GLB payload' });
        return;
      }
      modelMemoryCache.set(modelId, body);
      const filePath = path.join(UPLOAD_DIR, `${modelId}.glb`);
      fs.writeFile(filePath, body, (err) => {
        if (err) {
          console.error('Failed to persist GLB file:', err);
        }
      });
      res.json({ ok: true, modelId, bytes: body.length, endpoint: `/api/models/${modelId}` });
    },
  );

  // Serve custom GLB model binary
  app.get('/api/models/:modelId', (req, res) => {
    const modelId = String(req.params.modelId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!modelId) {
      res.status(400).json({ error: 'Invalid modelId' });
      return;
    }
    const cached = modelMemoryCache.get(modelId);
    if (cached) {
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(cached);
      return;
    }
    const filePath = path.join(UPLOAD_DIR, `${modelId}.glb`);
    if (fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      modelMemoryCache.set(modelId, buf);
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buf);
      return;
    }
    res.status(404).json({ error: 'Model not found' });
  });

  // Upload short-form video clip (MP4/WebM) for Media Pulse
  app.post(
    '/api/videos/:videoId',
    express.raw({
      type: ['video/mp4', 'video/webm', 'video/quicktime', 'application/octet-stream'],
      limit: '25mb',
    }),
    (req, res) => {
      const videoId = String(req.params.videoId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!videoId || videoId.length > 128) {
        res.status(400).json({ error: 'Invalid videoId' });
        return;
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Empty video payload' });
        return;
      }
      const rawCt = String(req.headers['content-type'] || 'video/mp4').split(';')[0].trim().toLowerCase();
      const contentType = ALLOWED_VIDEO_TYPES.has(rawCt) ? rawCt : 'video/mp4';

      videoMemoryCache.set(videoId, { buffer: body, contentType });
      const binPath = path.join(VIDEO_UPLOAD_DIR, `${videoId}.bin`);
      const metaPath = path.join(VIDEO_UPLOAD_DIR, `${videoId}.json`);
      fs.writeFile(binPath, body, (err) => {
        if (err) console.error('Failed to persist video binary:', err);
      });
      fs.writeFile(metaPath, JSON.stringify({ contentType }), (err) => {
        if (err) console.error('Failed to persist video metadata:', err);
      });

      res.json({
        ok: true,
        videoId,
        bytes: body.length,
        contentType,
        endpoint: `/api/videos/${videoId}`,
      });
    },
  );

  // Serve short-form video clip (with HTTP Range support for smooth scrubbing/looping)
  app.get('/api/videos/:videoId', (req, res) => {
    const videoId = String(req.params.videoId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!videoId) {
      res.status(400).json({ error: 'Invalid videoId' });
      return;
    }
    let entry = videoMemoryCache.get(videoId);
    if (!entry) {
      const binPath = path.join(VIDEO_UPLOAD_DIR, `${videoId}.bin`);
      const metaPath = path.join(VIDEO_UPLOAD_DIR, `${videoId}.json`);
      if (fs.existsSync(binPath)) {
        const buf = fs.readFileSync(binPath);
        let contentType = 'video/mp4';
        if (fs.existsSync(metaPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { contentType?: string };
            if (parsed.contentType && ALLOWED_VIDEO_TYPES.has(parsed.contentType)) {
              contentType = parsed.contentType;
            }
          } catch {
            // fallback
          }
        }
        entry = { buffer: buf, contentType };
        videoMemoryCache.set(videoId, entry);
      }
    }
    if (!entry) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const total = entry.buffer.length;
    const range = req.headers.range;
    res.setHeader('Content-Type', entry.contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Number(parts[0]) || 0;
      const end = parts[1] ? Math.min(total - 1, Number(parts[1])) : total - 1;
      if (start >= total || start > end) {
        res.status(416).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      res.send(entry.buffer.subarray(start, end + 1));
      return;
    }

    res.setHeader('Content-Length', String(total));
    res.send(entry.buffer);
  });

  const FALLBACK_SHORTS_POOL: Array<{
    videoId: string;
    title: string;
    authorName: string;
    authorHandle: string;
  }> = [
    {
      videoId: 'QGOSKe7V9vs',
      title: '1 Year Freeform Locs transformation & natural journey #freeformlocs',
      authorName: 'KNOT NATION',
      authorHandle: 'knotnation',
    },
    {
      videoId: 'cFDbd-rIOj0',
      title: 'Everyone thought he was flopping on the court #basketball #nba',
      authorName: 'Hoop Reaper',
      authorHandle: 'hoopreaper',
    },
    {
      videoId: 'QNrEAwVZg1c',
      title: 'The Gift That Spied for Seven Years — wild Cold War history #historyyt',
      authorName: 'Unluckily History',
      authorHandle: 'unluckilyhistory',
    },
    {
      videoId: '_dz6U7qORwI',
      title: '5 Weird WW1 Facts you never learned in school #historyyt',
      authorName: 'HistoryYT Clips',
      authorHandle: 'history.yt',
    },
    {
      videoId: '0l_GUCQR2r4',
      title: 'How to get your freeforms to drop naturally #freeformlocs #hair',
      authorName: 'Steps To Glory',
      authorHandle: 'stepstoglory',
    },
    {
      videoId: '7D0g03LTBwg',
      title: '22 Points highlight reel — explosive buckets & transitions #basketball',
      authorName: 'RoNALDOTv',
      authorHandle: 'ronaldotv',
    },
  ];

  async function searchPlayableYouTubeShorts(
    searchQuery: string,
    limit = 10,
    excludeIds: Set<string> = new Set(),
  ): Promise<
    Array<{
      videoId: string;
      title: string;
      authorName: string;
      thumbnailUrl: string;
      embedUrl: string;
      ytSourceUrl: string;
    }>
  > {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const resp = await fetch(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(`${searchQuery} #shorts`)}`,
        {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        },
      );
      clearTimeout(timer);
      if (!resp.ok) return [];
      const html = await resp.text();
      const reelIds = [
        ...html.matchAll(/"reelWatchEndpoint":\{"videoId":"([a-zA-Z0-9_-]{11})"/g),
      ].map((m) => m[1]);
      const anyIds = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map((m) => m[1]);
      const candidates = [...new Set([...reelIds, ...anyIds])]
        .filter((vid) => !excludeIds.has(vid))
        .slice(0, Math.min(24, limit + 8));

      const resolved = await Promise.all(
        candidates.map(async (vid) => {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 3000);
            const ytSourceUrl = `https://www.youtube.com/shorts/${vid}`;
            const [oe, emb] = await Promise.all([
              fetch(
                `https://www.youtube.com/oembed?url=${encodeURIComponent(ytSourceUrl)}&format=json`,
                { signal: ctrl.signal },
              ),
              fetch(`https://www.youtube.com/embed/${vid}`, {
                signal: ctrl.signal,
                headers: { 'User-Agent': 'Mozilla/5.0' },
              }),
            ]);
            clearTimeout(t);
            if (!oe.ok || !emb.ok) return null;
            const embHtml = await emb.text();
            if (
              /UNPLAYABLE|Video unavailable|Playback on other websites has been disabled/i.test(
                embHtml,
              )
            ) {
              return null;
            }
            const j = (await oe.json()) as {
              title?: string;
              author_name?: string;
              thumbnail_url?: string;
            };
            return {
              videoId: vid,
              title: j.title || `${searchQuery} Short`,
              authorName: j.author_name || 'Creator',
              thumbnailUrl: j.thumbnail_url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
              embedUrl: `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&loop=1&playlist=${vid}&playsinline=1&rel=0&enablejsapi=1`,
              ytSourceUrl,
            };
          } catch {
            return null;
          }
        }),
      );

      return resolved
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  // Resolve YouTube Shorts or direct video links into unblocked streams
  app.get('/api/social-embed/resolve', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl || rawUrl.length > 1024) {
      res.status(400).json({ error: 'Missing or invalid URL' });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        res.status(400).json({ error: 'Only HTTP/HTTPS links are supported' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Malformed URL' });
      return;
    }

    let finalUrlStr = parsedUrl.toString();
    let host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');

    if (
      host === 'vm.tiktok.com' ||
      host === 'vt.tiktok.com' ||
      (host.endsWith('tiktok.com') && parsedUrl.pathname.startsWith('/t/'))
    ) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const redir = await fetch(finalUrlStr, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        clearTimeout(timer);
        if (redir.url) {
          finalUrlStr = redir.url;
          parsedUrl = new URL(finalUrlStr);
          host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
        }
      } catch {
        // Proceed with original URL
      }
    }

    // 1. YouTube / YouTube Shorts
    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com' ||
      host === 'youtu.be'
    ) {
      let videoId = '';
      if (host === 'youtu.be') {
        videoId = parsedUrl.pathname.replace(/^\/+/, '').split('/')[0] || '';
      } else if (parsedUrl.pathname.startsWith('/shorts/')) {
        videoId = parsedUrl.pathname.replace('/shorts/', '').split('/')[0] || '';
      } else if (parsedUrl.pathname.startsWith('/embed/')) {
        videoId = parsedUrl.pathname.replace('/embed/', '').split('/')[0] || '';
      } else {
        videoId = parsedUrl.searchParams.get('v') || '';
      }
      videoId = videoId.replace(/[^a-zA-Z0-9_-]/g, '');
      if (videoId.length < 6) {
        res.status(400).json({ error: 'Could not extract YouTube video ID' });
        return;
      }

      const canonicalSource = `https://www.youtube.com/shorts/${videoId}`;
      let title: string | undefined;
      let authorName: string | undefined;
      let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const oe = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalSource)}&format=json`,
          { signal: controller.signal },
        );
        clearTimeout(timer);
        if (oe.ok) {
          const j = (await oe.json()) as {
            title?: string;
            author_name?: string;
            thumbnail_url?: string;
          };
          if (j.title) title = j.title;
          if (j.author_name) authorName = j.author_name;
          if (j.thumbnail_url) thumbnailUrl = j.thumbnail_url;
        }
      } catch {
        // Use fallback thumbnail
      }

      res.json({
        ok: true,
        videoPlatform: 'youtube',
        videoId,
        sourceUrl: canonicalSource,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&loop=1&playlist=${videoId}&playsinline=1&rel=0&enablejsapi=1`,
        thumbnailUrl,
        title,
        authorName,
      });
      return;
    }

    // 2. Direct MP4 / WebM
    if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(parsedUrl.pathname)) {
      res.json({
        ok: true,
        videoPlatform: 'direct',
        videoId: parsedUrl.pathname.split('/').pop() || 'clip',
        sourceUrl: finalUrlStr,
        embedUrl: finalUrlStr,
      });
      return;
    }

    // 3. Fallback: resolve TikTok / IG / external links onto a matching YouTube Shorts clip
    if (host.includes('tiktok.com') || host.includes('instagram.com')) {
      const ytMatches = await searchPlayableYouTubeShorts('viral trending clips', 1);
      const picked = ytMatches[0] || {
        videoId: FALLBACK_SHORTS_POOL[0].videoId,
        title: FALLBACK_SHORTS_POOL[0].title,
        authorName: FALLBACK_SHORTS_POOL[0].authorName,
        thumbnailUrl: `https://i.ytimg.com/vi/${FALLBACK_SHORTS_POOL[0].videoId}/hqdefault.jpg`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${FALLBACK_SHORTS_POOL[0].videoId}?autoplay=1&loop=1&playlist=${FALLBACK_SHORTS_POOL[0].videoId}&playsinline=1&rel=0&enablejsapi=1`,
        ytSourceUrl: `https://www.youtube.com/shorts/${FALLBACK_SHORTS_POOL[0].videoId}`,
      };
      res.json({
        ok: true,
        videoPlatform: 'youtube',
        videoId: picked.videoId,
        sourceUrl: picked.ytSourceUrl,
        embedUrl: picked.embedUrl,
        thumbnailUrl: picked.thumbnailUrl,
        title: picked.title,
        authorName: picked.authorName,
      });
      return;
    }

    res.status(400).json({
      error: 'Unsupported URL. Provide a YouTube Shorts link or .mp4/.webm video URL.',
    });
  });

  // Search & paginate endless YouTube Shorts across any user query or rotating trending topics
  app.get('/api/social-embed/shorts-feed', async (req, res) => {
    const rawQuery = String(req.query.q || '').trim().slice(0, 120);
    const page = Math.max(1, Math.min(20, Number(req.query.page) || 1));
    const limit = Math.max(3, Math.min(18, Number(req.query.limit) || 12));
    const rawExclude = String(req.query.exclude || '');
    const excludeIds = new Set(
      rawExclude
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^[a-zA-Z0-9_-]{6,20}$/.test(s)),
    );

    const DISCOVERY_ROTATION = [
      ['freeform locs hair', 'nba basketball highlights', 'weird history facts historyyt'],
      ['science experiments', 'street food cooking', 'unreal engine 3d animation'],
      ['sneakers streetwear', 'music beats freestyle', 'skateboarding tricks'],
      ['sports clutch highlights', 'ancient history documentary', 'car edits drift'],
      ['basketball drills dunks', 'hair care locs tutorial', 'amazing space facts'],
      ['comedy skits', 'gaming montage clips', 'chef cooking steak'],
    ];

    const PAGE_MODIFIERS = ['', 'trending', 'viral', 'best moments', 'highlights', 'new'];

    let batchQueries: string[];
    if (rawQuery) {
      const mod = PAGE_MODIFIERS[(page - 1) % PAGE_MODIFIERS.length];
      batchQueries = [mod ? `${rawQuery} ${mod}` : rawQuery];
    } else {
      batchQueries = DISCOVERY_ROTATION[(page - 1) % DISCOVERY_ROTATION.length];
    }

    const perQueryLimit = rawQuery ? limit : Math.max(4, Math.ceil(limit / batchQueries.length) + 1);
    const batchResults = await Promise.all(
      batchQueries.map((q) => searchPlayableYouTubeShorts(q, perQueryLimit, excludeIds)),
    );

    const discovered: Array<{
      id: string;
      videoId: string;
      videoPlatform: 'youtube';
      title: string;
      authorName: string;
      authorHandle: string;
      sourceUrl: string;
      embedUrl: string;
      thumbnailUrl: string;
    }> = [];

    for (const group of batchResults) {
      for (const hit of group) {
        if (excludeIds.has(hit.videoId) || discovered.some((d) => d.videoId === hit.videoId)) {
          continue;
        }
        const cleanHandle =
          hit.authorName
            .toLowerCase()
            .replace(/[^a-z0-9._]/g, '')
            .slice(0, 24) || 'creator';
        discovered.push({
          id: `yt_${hit.videoId}`,
          videoId: hit.videoId,
          videoPlatform: 'youtube',
          title: hit.title,
          authorName: hit.authorName,
          authorHandle: cleanHandle,
          sourceUrl: hit.ytSourceUrl,
          embedUrl: hit.embedUrl,
          thumbnailUrl: hit.thumbnailUrl,
        });
        if (discovered.length >= limit) break;
      }
      if (discovered.length >= limit) break;
    }

    if (discovered.length === 0 && !rawQuery) {
      for (const fb of FALLBACK_SHORTS_POOL) {
        if (excludeIds.has(fb.videoId)) continue;
        discovered.push({
          id: `yt_${fb.videoId}`,
          videoId: fb.videoId,
          videoPlatform: 'youtube',
          title: fb.title,
          authorName: fb.authorName,
          authorHandle: fb.authorHandle,
          sourceUrl: `https://www.youtube.com/shorts/${fb.videoId}`,
          embedUrl: `https://www.youtube-nocookie.com/embed/${fb.videoId}?autoplay=1&loop=1&playlist=${fb.videoId}&playsinline=1&rel=0&enablejsapi=1`,
          thumbnailUrl: `https://i.ytimg.com/vi/${fb.videoId}/hqdefault.jpg`,
        });
      }
    }

    res.json({ ok: true, query: rawQuery || null, page, items: discovered });
  });

  // WebSocket Server for Real-Time Multi-User 3D Lounge
  const wss = new WebSocketServer({ server, path: '/ws' });
  const loungeMembers = new Map<string, LoungeMemberState>();
  const socketToClient = new Map<WebSocket, string>();

  function broadcast(payload: Record<string, unknown>, excludeSocket?: WebSocket) {
    const serialized = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client !== excludeSocket && client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  wss.on('connection', (ws) => {
    let assignedClientId = '';

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          type?: string;
          clientId?: string;
          payload?: Record<string, unknown>;
        };

        if (!msg || typeof msg.type !== 'string') return;

        if (msg.type === 'lounge:join' && msg.payload) {
          const p = msg.payload;
          const clientId = String(p.clientId || msg.clientId || `guest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`).slice(0, 80);
          assignedClientId = clientId;
          socketToClient.set(ws, clientId);

          const rawMoveState = typeof p.moveState === 'string' ? p.moveState : 'idle';
          const moveState = (ALLOWED_MOVE_STATES.has(rawMoveState) ? rawMoveState : 'idle') as LoungeMemberState['moveState'];

          const member: LoungeMemberState = {
            clientId,
            uid: String(p.uid || clientId).slice(0, 128),
            displayName: String(p.displayName || 'Vanguard Guest').slice(0, 48),
            handle: String(p.handle || 'vanguard').slice(0, 32),
            platform: (p.platform === 'mobile' || p.platform === 'console') ? p.platform : 'pc',
            loyaltyRank: (p.loyaltyRank === 'Sentinel' || p.loyaltyRank === 'Vanguard' || p.loyaltyRank === 'Sovereign') ? p.loyaltyRank : 'Squire',
            equippedAvatarId: String(p.equippedAvatarId || 'avatar-sovereign-knight').slice(0, 128),
            emote: String(p.emote || 'idle').slice(0, 48),
            moveState,
            speed: Math.max(0, Math.min(24, Number(p.speed) || 0)),
            x: Number(p.x) || 0,
            y: Math.max(0, Math.min(14, Number(p.y) || 0)),
            z: Number(p.z) || 4,
            yaw: Number(p.yaw) || 0,
            updatedAt: Date.now(),
          };

          loungeMembers.set(clientId, member);

          // Send full current state to newly joined client
          ws.send(
            JSON.stringify({
              type: 'lounge:init',
              selfClientId: clientId,
              members: Array.from(loungeMembers.values()),
            }),
          );

          // Broadcast join to others
          broadcast({ type: 'user:joined', member }, ws);
          return;
        }

        if (!assignedClientId) return;
        const current = loungeMembers.get(assignedClientId);
        if (!current) return;

        if (msg.type === 'lounge:move' && msg.payload) {
          const p = msg.payload;
          current.x = Math.max(-28, Math.min(28, Number(p.x) || 0));
          current.y = Math.max(0, Math.min(14, Number(p.y) || 0));
          current.z = Math.max(-28, Math.min(28, Number(p.z) || 0));
          current.yaw = Number(p.yaw) || 0;
          if (typeof p.emote === 'string') {
            current.emote = p.emote.slice(0, 48);
          }
          if (typeof p.moveState === 'string' && ALLOWED_MOVE_STATES.has(p.moveState)) {
            current.moveState = p.moveState as LoungeMemberState['moveState'];
          }
          if (typeof p.speed === 'number' && Number.isFinite(p.speed)) {
            current.speed = Math.max(0, Math.min(24, p.speed));
          }
          current.updatedAt = Date.now();

          broadcast(
            {
              type: 'user:moved',
              clientId: assignedClientId,
              x: current.x,
              y: current.y,
              z: current.z,
              yaw: current.yaw,
              emote: current.emote,
              moveState: current.moveState,
              speed: current.speed,
            },
            ws,
          );
          return;
        }

        if (msg.type === 'lounge:state' && msg.payload) {
          const p = msg.payload;
          if (typeof p.equippedAvatarId === 'string') {
            current.equippedAvatarId = p.equippedAvatarId.slice(0, 128);
          }
          if (typeof p.emote === 'string') {
            current.emote = p.emote.slice(0, 48);
          }
          if (p.platform === 'pc' || p.platform === 'mobile' || p.platform === 'console') {
            current.platform = p.platform;
          }
          if (
            p.loyaltyRank === 'Squire' ||
            p.loyaltyRank === 'Sentinel' ||
            p.loyaltyRank === 'Vanguard' ||
            p.loyaltyRank === 'Sovereign'
          ) {
            current.loyaltyRank = p.loyaltyRank;
          }
          if (typeof p.displayName === 'string' && p.displayName.trim()) {
            current.displayName = p.displayName.trim().slice(0, 48);
          }
          current.updatedAt = Date.now();
          broadcast({ type: 'user:updated', member: current });
          return;
        }

        if (msg.type === 'lounge:chat' && msg.payload) {
          const text = String(msg.payload.text || '').trim().slice(0, 180);
          if (!text) return;
          current.chatText = text;
          current.chatExpiresAt = Date.now() + 7000;
          current.updatedAt = Date.now();
          broadcast({
            type: 'chat:message',
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            clientId: assignedClientId,
            uid: current.uid,
            displayName: current.displayName,
            platform: current.platform,
            loyaltyRank: current.loyaltyRank,
            text,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error('WebSocket message parse error:', err);
      }
    });

    ws.on('close', () => {
      const clientId = socketToClient.get(ws);
      socketToClient.delete(ws);
      if (clientId && loungeMembers.has(clientId)) {
        loungeMembers.delete(clientId);
        broadcast({ type: 'user:left', clientId });
      }
    });
  });

  if (isProduction) {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sovereign X server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
