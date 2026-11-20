import type { VideoPlatform } from '../types';

export interface ResolvedShortVideo {
  platform: VideoPlatform;
  videoId: string;
  sourceUrl: string;
  embedUrl: string;
  thumbnailUrl?: string;
  title?: string;
  authorName?: string;
}

export function isYouTubeEmbedUrl(embedUrl?: string): boolean {
  if (!embedUrl) return false;
  return /https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\//i.test(embedUrl);
}

/**
 * Parses YouTube Shorts / YouTube, Instagram Reels, TikTok, or direct MP4/WebM URLs
 * into normalized metadata. Instagram Reels and TikTok links intentionally leave embedUrl
 * blank until resolved through /api/social-embed/resolve onto a non-blocked YouTube Shorts stream.
 */
export function parseShortVideoUrl(rawInput: string): ResolvedShortVideo | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    if (trimmed.startsWith('/api/videos/')) {
      return {
        platform: 'direct',
        videoId: trimmed.split('/').pop() || 'clip',
        sourceUrl: trimmed,
        embedUrl: trimmed,
      };
    }
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname;

  // 1. YouTube Shorts / YouTube watch / youtu.be
  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'youtu.be'
  ) {
    let videoId = '';
    if (host === 'youtu.be') {
      videoId = path.replace(/^\/+/, '').split('/')[0] || '';
    } else if (path.startsWith('/shorts/')) {
      videoId = path.replace('/shorts/', '').split('/')[0] || '';
    } else if (path.startsWith('/embed/')) {
      videoId = path.replace('/embed/', '').split('/')[0] || '';
    } else {
      videoId = url.searchParams.get('v') || '';
    }
    videoId = videoId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (videoId.length >= 6) {
      return {
        platform: 'youtube',
        videoId,
        sourceUrl: `https://www.youtube.com/shorts/${videoId}`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&loop=1&playlist=${videoId}&playsinline=1&rel=0&enablejsapi=1`,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    }
  }

  // 2. Instagram Reels / Posts (always routed via backend YouTube Shorts resolver to avoid X-Frame-Options blocks)
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    const match = path.match(/^\/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/);
    const shortcode = match?.[1];
    if (shortcode) {
      return {
        platform: 'instagram',
        videoId: shortcode,
        sourceUrl: `https://www.instagram.com/reel/${shortcode}/`,
        embedUrl: '',
      };
    }
  }

  // 3. TikTok videos (always routed via backend YouTube Shorts resolver to avoid iframe blocking)
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const vidMatch =
      path.match(/\/video\/(\d+)/) || path.match(/\/player\/v1\/(\d+)/) || path.match(/\/v\/(\d+)/);
    const videoId = vidMatch?.[1] || path.replace(/[^a-zA-Z0-9_-]/g, '') || 'tiktok';
    return {
      platform: 'tiktok',
      videoId,
      sourceUrl: trimmed,
      embedUrl: '',
    };
  }

  // 4. Direct video streams (.mp4, .webm, .mov, /api/videos/...)
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(path) || path.startsWith('/api/videos/')) {
    return {
      platform: 'direct',
      videoId: path.split('/').pop() || 'video',
      sourceUrl: trimmed,
      embedUrl: trimmed,
    };
  }

  return null;
}

/**
 * Resolves YouTube Shorts, Instagram Reels, TikTok, or direct video URLs
 * through the server into unblocked playable streams.
 */
export async function resolveShortVideoFromServer(rawUrl: string): Promise<ResolvedShortVideo> {
  const localParsed = parseShortVideoUrl(rawUrl);
  const resp = await fetch(`/api/social-embed/resolve?url=${encodeURIComponent(rawUrl.trim())}`);
  if (resp.ok) {
    const data = (await resp.json()) as {
      ok?: boolean;
      videoPlatform?: VideoPlatform;
      videoId?: string;
      sourceUrl?: string;
      embedUrl?: string;
      thumbnailUrl?: string;
      title?: string;
      authorName?: string;
    };
    if (data.ok && data.videoPlatform && data.embedUrl) {
      return {
        platform: data.videoPlatform,
        videoId: data.videoId || localParsed?.videoId || 'clip',
        sourceUrl: data.sourceUrl || rawUrl.trim(),
        embedUrl: data.embedUrl,
        thumbnailUrl: data.thumbnailUrl || localParsed?.thumbnailUrl,
        title: data.title,
        authorName: data.authorName,
      };
    }
  }

  if (localParsed && localParsed.embedUrl) {
    return localParsed;
  }
  throw new Error(
    'Paste a valid YouTube Shorts, Instagram Reel, TikTok, or direct .mp4/.webm video URL.',
  );
}

export function buildYouTubeIframeSrc(embedUrl: string, muted: boolean): string {
  try {
    const u = new URL(embedUrl);
    u.searchParams.set('autoplay', '1');
    u.searchParams.set('mute', muted ? '1' : '0');
    u.searchParams.set('enablejsapi', '1');
    u.searchParams.set('playsinline', '1');
    return u.toString();
  } catch {
    return embedUrl;
  }
}

export function buildTikTokIframeSrc(embedUrl: string, muted: boolean): string {
  try {
    const u = new URL(embedUrl);
    u.searchParams.set('autoplay', '1');
    u.searchParams.set('muted', muted ? '1' : '0');
    u.searchParams.set('controls', '1');
    return u.toString();
  } catch {
    return embedUrl;
  }
}

export function getPlatformLabel(platform?: VideoPlatform): string {
  switch (platform) {
    case 'youtube':
      return 'YouTube Shorts';
    case 'instagram':
      return 'Instagram Reels';
    case 'tiktok':
      return 'TikTok';
    case 'direct':
      return 'Video Clip';
    default:
      return '3D Pulse';
  }
}
