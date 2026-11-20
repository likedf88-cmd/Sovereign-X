import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Heart,
  MessageCircle,
  Send,
  Plus,
  ChevronUp,
  ChevronDown,
  Bookmark,
  Sparkles,
  X,
  Camera,
  Flag,
  Trash2,
  Upload,
  Repeat2,
  Share2,
  PlusCircle,
  Play,
  Link2,
  RefreshCw,
  ExternalLink,
  Video,
  CheckCircle2,
  Search,
  Loader2,
} from 'lucide-react';
import { uploadImageFile } from '../utils/uploadImage';
import { useGlobalAudio } from '../utils/audioEngine';
import {
  buildYouTubeIframeSrc,
  getPlatformLabel,
  isYouTubeEmbedUrl,
  resolveShortVideoFromServer,
} from '../utils/shortVideoResolver';
import type { User } from 'firebase/auth';
import type {
  AvatarEmote,
  PostComment,
  PostKind,
  ReportReason,
  ReportTargetType,
  SocialPost,
  UserProfile,
  VideoPlatform,
} from '../types';
import {
  COVER_BACKDROP_IMAGE,
  FEED_ARENA_IMAGE,
  FEED_ROOFTOP_IMAGE,
  SHOP_KNIGHT_IMAGE,
} from '../data/catalog';

interface MediaPulseViewProps {
  firebaseUser: User | null;
  profile: UserProfile;
  isAdmin?: boolean;
  posts: SocialPost[];
  likedPostIds: string[];
  repostedPostIds?: string[];
  initialPostId?: string | null;
  onClearInitialPostId?: () => void;
  onToggleLike: (post: SocialPost) => Promise<void>;
  onRepostPost: (post: SocialPost) => Promise<void>;
  onSharePost: (post: SocialPost) => Promise<void>;
  onAddToStory: (post: SocialPost) => Promise<void>;
  onCreatePost: (input: {
    kind: PostKind;
    caption: string;
    mediaUrl?: string;
    videoPlatform?: VideoPlatform;
    sourceUrl?: string;
    embedUrl?: string;
    avatarId?: string;
    emote?: AvatarEmote;
  }) => Promise<void>;
  onDeletePost?: (postId: string) => Promise<void>;
  onCreateReport?: (input: {
    targetType: ReportTargetType;
    targetId: string;
    targetAuthorId?: string;
    targetAuthorName: string;
    targetExcerpt: string;
    reason: ReportReason;
    details?: string;
  }) => Promise<void>;
  onLoadComments: (postId: string) => Promise<PostComment[]>;
  onAddComment: (postId: string, text: string) => Promise<PostComment | null>;
  onEquipFromPost: (avatarId?: string, emote?: AvatarEmote) => void;
  onOpenAuth: () => void;
  prefilledSnapshotUrl?: string | null;
  onClearPrefilledSnapshot?: () => void;
}

const PRESET_MEDIA = [
  { label: 'Sanctuary Lounge', url: COVER_BACKDROP_IMAGE },
  { label: 'Tokyo Rooftop', url: FEED_ROOFTOP_IMAGE },
  { label: 'Arena Stage', url: FEED_ARENA_IMAGE },
  { label: 'Sovereign Knight', url: SHOP_KNIGHT_IMAGE },
];

const TOPIC_TABS: Array<{ id: string; label: string; query: string }> = [
  { id: 'for-you', label: 'For You', query: '' },
  { id: 'freeforms', label: 'Freeforms', query: 'freeform locs hair' },
  { id: 'basketball', label: 'Basketball', query: 'nba basketball highlights' },
  { id: 'historyyt', label: 'HistoryYT', query: 'history facts historyyt' },
  { id: 'gaming', label: 'Gaming & 3D', query: 'gaming unreal engine 3d' },
  { id: 'science', label: 'Science', query: 'science experiments' },
  { id: 'food', label: 'Food', query: 'street food cooking' },
  { id: 'music', label: 'Music', query: 'music beats freestyle' },
];

function extractYouTubeIdFromPost(post: SocialPost): string | null {
  const src = post.sourceUrl || post.embedUrl || '';
  const m = src.match(/(?:\/shorts\/|\/embed\/|[?&]v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] || null;
}

function getPlatformBadgeClass(platform?: VideoPlatform): string {
  switch (platform) {
    case 'youtube':
      return 'bg-red-600/90 border-red-400/50 text-white';
    case 'direct':
      return 'bg-emerald-600/90 border-emerald-400/50 text-white';
    default:
      return 'bg-[#1D4ED8]/90 border-blue-400/50 text-white';
  }
}

const ShortVideoPlayer: React.FC<{
  post: SocialPost;
  isMuted: boolean;
  compact?: boolean;
}> = ({ post, isMuted, compact = false }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const platform = post.videoPlatform || (post.embedUrl ? 'youtube' : 'native');
  const isYouTubeTransport = isYouTubeEmbedUrl(post.embedUrl);

  // Synchronize mute state dynamically with YouTube Player & HTML5 <video>
  useEffect(() => {
    if (isYouTubeTransport && iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: isMuted ? 'mute' : 'unMute',
            args: [],
          }),
          '*',
        );
      } catch {
        // ignore cross-origin timing
      }
    }
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted, isYouTubeTransport, post.id]);

  // Play YouTube Shorts stream cleanly for YouTube Shorts, Instagram Reels, and TikTok feeds
  if (isYouTubeTransport && post.embedUrl) {
    const src = buildYouTubeIframeSrc(post.embedUrl, isMuted);
    return (
      <div className="relative w-full h-full bg-black">
        <iframe
          ref={iframeRef}
          key={`${post.id}-yt`}
          src={src}
          title={post.caption}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="w-full h-full border-0"
        />
      </div>
    );
  }

  if (platform === 'direct' && (post.embedUrl || post.sourceUrl)) {
    return (
      <video
        ref={videoRef}
        key={`${post.id}-vid`}
        src={post.embedUrl || post.sourceUrl}
        poster={post.mediaUrl}
        autoPlay
        loop
        playsInline
        controls={!compact}
        muted={isMuted}
        className="w-full h-full object-cover bg-black"
      />
    );
  }

  return (
    <img
      src={post.mediaUrl || FEED_ROOFTOP_IMAGE}
      alt={post.caption}
      referrerPolicy="no-referrer"
      className="w-full h-full object-cover"
    />
  );
};

export const MediaPulseView: React.FC<MediaPulseViewProps> = ({
  firebaseUser,
  profile,
  isAdmin = false,
  posts,
  likedPostIds,
  repostedPostIds = [],
  initialPostId,
  onClearInitialPostId,
  onToggleLike,
  onRepostPost,
  onSharePost,
  onAddToStory,
  onCreatePost,
  onDeletePost,
  onCreateReport,
  onLoadComments,
  onAddComment,
  onEquipFromPost,
  onOpenAuth,
  prefilledSnapshotUrl,
  onClearPrefilledSnapshot,
}) => {
  const { isMuted, playUiSfx } = useGlobalAudio();

  const [feedMode, setFeedMode] = useState<'reels' | 'grid'>('reels');
  const [activeTopicId, setActiveTopicId] = useState<string>('for-you');
  const [activeSearchQuery, setActiveSearchQuery] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [reelIndex, setReelIndex] = useState(0);
  const [activeStory, setActiveStory] = useState<SocialPost | null>(null);
  const [theaterPost, setTheaterPost] = useState<SocialPost | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [forYouShorts, setForYouShorts] = useState<SocialPost[]>([]);
  const [topicShorts, setTopicShorts] = useState<SocialPost[]>([]);
  const [feedPage, setFeedPage] = useState(1);
  const [topicPage, setTopicPage] = useState(1);
  const [loadingShorts, setLoadingShorts] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const lastScrollAtRef = useRef<number>(0);
  const touchStartYRef = useRef<number | null>(null);
  const gridSentinelRef = useRef<HTMLDivElement | null>(null);
  const initialFetchedRef = useRef(false);

  // Comments Drawer + Inline Reels Comments
  const [localCommentsByPostId, setLocalCommentsByPostId] = useState<
    Record<string, PostComment[]>
  >({});
  const [activeComments, setActiveComments] = useState<PostComment[]>([]);
  const [loadingActiveComments, setLoadingActiveComments] = useState(false);
  const [inlineCommentText, setInlineCommentText] = useState('');
  const [commentPost, setCommentPost] = useState<SocialPost | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);

  // Report Modal
  const [reportingPost, setReportingPost] = useState<SocialPost | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>('inappropriate');
  const [reportDetails, setReportDetails] = useState('');
  const [pulseNotice, setPulseNotice] = useState<string | null>(null);

  // Composer Modal
  const [composerOpen, setComposerOpen] = useState(Boolean(prefilledSnapshotUrl));
  const [newKind, setNewKind] = useState<PostKind>('reel');
  const [newCaption, setNewCaption] = useState('');
  const [newMediaUrl, setNewMediaUrl] = useState(prefilledSnapshotUrl || FEED_ROOFTOP_IMAGE);
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [newVideoPlatform, setNewVideoPlatform] = useState<VideoPlatform>('native');
  const [newEmbedUrl, setNewEmbedUrl] = useState('');
  const [resolvingVideo, setResolvingVideo] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const showNotice = (msg: string) => {
    setPulseNotice(msg);
    window.setTimeout(() => {
      setPulseNotice((cur) => (cur === msg ? null : cur));
    }, 3600);
  };

  const isFilteredView = activeTopicId !== 'for-you' || activeSearchQuery.trim().length > 0;

  // Build active stream: either user search/topic Shorts or endless For You feed
  const mergedPosts = useMemo(() => {
    const map = new Map<string, SocialPost>();
    if (isFilteredView) {
      topicShorts.forEach((p) => map.set(p.id, p));
      // Also include any matching user/seeded posts (e.g. Reposts or Story items)
      const q = activeSearchQuery.trim().toLowerCase();
      posts.forEach((p) => {
        if (p.kind === 'story') {
          map.set(p.id, p);
          return;
        }
        if (q && `${p.caption} ${p.authorName} ${p.authorHandle}`.toLowerCase().includes(q)) {
          if (!map.has(p.id)) map.set(p.id, p);
        }
      });
    } else {
      posts.forEach((p) => map.set(p.id, p));
      forYouShorts.forEach((p) => {
        if (!map.has(p.id)) map.set(p.id, p);
      });
    }
    return Array.from(map.values());
  }, [posts, forYouShorts, topicShorts, isFilteredView, activeSearchQuery]);

  const stories = mergedPosts.filter((p) => p.kind === 'story');
  const reels = mergedPosts.filter((p) => p.kind === 'reel');
  const photos = mergedPosts.filter((p) => p.kind === 'photo' || p.kind === 'reel');

  const safeReelIdx = Math.min(reelIndex, Math.max(0, reels.length - 1));
  const activeReel = reels[safeReelIdx] || reels[0] || mergedPosts[0];

  const fetchShortsBatch = async (opts: {
    query?: string;
    page: number;
    replace?: boolean;
    limit?: number;
  }) => {
    const existingList = opts.replace ? [] : isFilteredView ? topicShorts : [...posts, ...forYouShorts];
    const exclude = existingList
      .map(extractYouTubeIdFromPost)
      .filter((id): id is string => Boolean(id))
      .slice(-80)
      .join(',');

    const params = new URLSearchParams({
      page: String(opts.page),
      limit: String(opts.limit || 12),
    });
    if (opts.query?.trim()) params.set('q', opts.query.trim());
    if (exclude) params.set('exclude', exclude);

    const resp = await fetch(`/api/social-embed/shorts-feed?${params.toString()}`);
    if (!resp.ok) throw new Error('Unable to fetch YouTube Shorts.');
    const data = (await resp.json()) as {
      items?: Array<{
        id: string;
        videoId: string;
        title: string;
        authorName: string;
        authorHandle: string;
        sourceUrl: string;
        embedUrl: string;
        thumbnailUrl: string;
      }>;
    };

    const items: SocialPost[] = (data.items || []).map((item, i) => ({
      id: item.id,
      authorId: `yt_creator_${item.authorHandle}`,
      authorName: item.authorName,
      authorHandle: item.authorHandle,
      kind: 'reel',
      caption: item.title,
      mediaUrl: item.thumbnailUrl,
      videoPlatform: 'youtube',
      sourceUrl: item.sourceUrl,
      embedUrl: item.embedUrl,
      likesCount: 420 + ((item.videoId.charCodeAt(0) * 37 + i * 91) % 8500),
      commentsCount: 18 + ((item.videoId.charCodeAt(1) * 13 + i * 17) % 340),
      repostsCount: 24 + ((item.videoId.charCodeAt(2) * 19 + i * 29) % 480),
      sharesCount: 14 + ((item.videoId.charCodeAt(3) * 11 + i * 23) % 290),
    }));
    return items;
  };

  // Auto-load initial fresh batch of YouTube Shorts on mount so feed starts deep & ready to scroll
  useEffect(() => {
    if (initialFetchedRef.current) return;
    initialFetchedRef.current = true;
    setLoadingMore(true);
    void fetchShortsBatch({ page: 1, limit: 12 })
      .then((items) => {
        if (items.length > 0) {
          setForYouShorts((prev) => {
            const map = new Map<string, SocialPost>();
            prev.forEach((p) => map.set(p.id, p));
            items.forEach((p) => {
              if (!map.has(p.id)) map.set(p.id, p);
            });
            return Array.from(map.values());
          });
          setFeedPage(2);
        }
      })
      .catch(() => {
        // Seeded posts still remain playable offline
      })
      .finally(() => {
        setLoadingMore(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadMoreShorts = async () => {
    if (loadingMore || loadingShorts) return;
    setLoadingMore(true);
    try {
      const currentQuery =
        activeSearchQuery.trim() ||
        TOPIC_TABS.find((t) => t.id === activeTopicId)?.query ||
        '';
      const nextPage = isFilteredView ? topicPage + 1 : feedPage + 1;
      const items = await fetchShortsBatch({
        query: currentQuery || undefined,
        page: nextPage,
        limit: 12,
      });
      if (items.length > 0) {
        if (isFilteredView) {
          setTopicShorts((prev) => {
            const map = new Map<string, SocialPost>();
            prev.forEach((p) => map.set(p.id, p));
            items.forEach((p) => {
              if (!map.has(p.id)) map.set(p.id, p);
            });
            return Array.from(map.values());
          });
          setTopicPage(nextPage);
        } else {
          setForYouShorts((prev) => {
            const map = new Map<string, SocialPost>();
            prev.forEach((p) => map.set(p.id, p));
            items.forEach((p) => {
              if (!map.has(p.id)) map.set(p.id, p);
            });
            return Array.from(map.values());
          });
          setFeedPage(nextPage);
        }
      }
    } catch {
      // Ignore transient pagination error
    } finally {
      setLoadingMore(false);
    }
  };

  // Automatically load next batch when user scrolls within 3 clips of the end
  useEffect(() => {
    if (feedMode !== 'reels' || reels.length === 0) return;
    if (safeReelIdx >= reels.length - 3 && !loadingMore && !loadingShorts) {
      void handleLoadMoreShorts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeReelIdx, reels.length, feedMode]);

  // Also auto-load in Visual Feed grid when scrolling to bottom sentinel
  useEffect(() => {
    if (feedMode !== 'grid' || !gridSentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void handleLoadMoreShorts();
        }
      },
      { rootMargin: '220px' },
    );
    observer.observe(gridSentinelRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedMode, isFilteredView, topicPage, feedPage, loadingMore, loadingShorts]);

  // Jump cleanly to shared deep-link post (?pulse=postId)
  useEffect(() => {
    if (!initialPostId) return;
    const idx = reels.findIndex((r) => r.id === initialPostId);
    if (idx >= 0) {
      setFeedMode('reels');
      setReelIndex(idx);
      onClearInitialPostId?.();
      return;
    }
    const found = mergedPosts.find((p) => p.id === initialPostId);
    if (found) {
      if (found.kind === 'story') setActiveStory(found);
      else setTheaterPost(found);
      onClearInitialPostId?.();
    }
  }, [initialPostId, reels, mergedPosts, onClearInitialPostId]);

  const onLoadCommentsRef = useRef(onLoadComments);
  onLoadCommentsRef.current = onLoadComments;

  // Load comments for the currently active Vertical Reel cleanly
  useEffect(() => {
    const activeId = activeReel?.id;
    if (feedMode !== 'reels' || !activeId) {
      setActiveComments([]);
      return;
    }
    let cancelled = false;
    setLoadingActiveComments(true);
    void onLoadCommentsRef
      .current(activeId)
      .then((cloudList) => {
        if (cancelled) return;
        const locals = localCommentsByPostId[activeId] || [];
        const seen = new Set(cloudList.map((c) => c.id));
        setActiveComments([...cloudList, ...locals.filter((c) => !seen.has(c.id))]);
      })
      .catch(() => {
        if (!cancelled) setActiveComments(localCommentsByPostId[activeId] || []);
      })
      .finally(() => {
        if (!cancelled) setLoadingActiveComments(false);
      });
    return () => {
      cancelled = true;
    };
  }, [feedMode, activeReel?.id, localCommentsByPostId]);

  // Keyboard Up/Down navigation for Vertical Reels
  useEffect(() => {
    if (feedMode !== 'reels' || composerOpen || commentPost || theaterPost || activeStory) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setReelIndex((i) => Math.min(Math.max(0, reels.length - 1), i + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setReelIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feedMode, reels.length, composerOpen, commentPost, theaterPost, activeStory]);

  const stepReel = (dir: 1 | -1) => {
    const now = Date.now();
    if (now - lastScrollAtRef.current < 380) return;
    lastScrollAtRef.current = now;
    setReelIndex((i) => Math.max(0, Math.min(Math.max(0, reels.length - 1), i + dir)));
  };

  const handleStageWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) < 22) return;
    stepReel(e.deltaY > 0 ? 1 : -1);
  };

  const handleStageTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handleStageTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartYRef.current === null) return;
    const endY = e.changedTouches[0]?.clientY ?? touchStartYRef.current;
    const diff = touchStartYRef.current - endY;
    touchStartYRef.current = null;
    if (Math.abs(diff) > 42) {
      stepReel(diff > 0 ? 1 : -1);
    }
  };

  const handleSelectTopic = async (topicId: string) => {
    const tab = TOPIC_TABS.find((t) => t.id === topicId);
    if (!tab) return;
    setActiveTopicId(topicId);
    setActiveSearchQuery('');
    setSearchInput('');
    setReelIndex(0);

    if (topicId === 'for-you') {
      return;
    }

    setLoadingShorts(true);
    try {
      const items = await fetchShortsBatch({ query: tab.query, page: 1, limit: 12, replace: true });
      setTopicShorts(items);
      setTopicPage(1);
      playUiSfx('nav');
    } catch {
      showNotice(`Could not load ${tab.label} Shorts right now.`);
    } finally {
      setLoadingShorts(false);
    }
  };

  const handleSyncLiveShorts = async () => {
    if (loadingShorts || loadingMore) return;
    setLoadingShorts(true);
    try {
      const currentQuery =
        activeSearchQuery.trim() ||
        TOPIC_TABS.find((t) => t.id === activeTopicId)?.query ||
        '';
      const nextPage = isFilteredView ? topicPage + 1 : feedPage + 1;
      const items = await fetchShortsBatch({
        query: currentQuery || undefined,
        page: nextPage,
        limit: 12,
      });
      if (items.length > 0) {
        if (isFilteredView) {
          setTopicShorts((prev) => [...items, ...prev.filter((p) => !items.some((n) => n.id === p.id))]);
          setTopicPage(nextPage);
        } else {
          setForYouShorts((prev) => [...items, ...prev.filter((p) => !items.some((n) => n.id === p.id))]);
          setFeedPage(nextPage);
        }
        setReelIndex(0);
        playUiSfx('post');
        showNotice(`Loaded ${items.length} fresh YouTube Shorts into your feed!`);
      } else {
        showNotice('Feed is already up to date.');
      }
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Live Shorts sync unavailable.');
    } finally {
      setLoadingShorts(false);
    }
  };

  const handleResolveVideoInComposer = async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    setResolvingVideo(true);
    setMediaUploadError(null);
    try {
      const resolved = await resolveShortVideoFromServer(trimmed);
      setNewVideoUrl(resolved.sourceUrl);
      setNewVideoPlatform(resolved.platform);
      setNewEmbedUrl(resolved.embedUrl);
      if (resolved.thumbnailUrl) setNewMediaUrl(resolved.thumbnailUrl);
      if (!newCaption.trim() && resolved.title) {
        setNewCaption(
          resolved.authorName ? `${resolved.title} — via ${resolved.authorName}` : resolved.title,
        );
      }
      playUiSfx('nav');
    } catch (err) {
      setMediaUploadError(
        err instanceof Error ? err.message : 'Could not resolve short video link.',
      );
    } finally {
      setResolvingVideo(false);
    }
  };

  const handleSearchOrConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = searchInput.trim();
    if (!raw) {
      await handleSelectTopic('for-you');
      return;
    }

    // If user pasted a direct video / YouTube Shorts URL, connect & stream it
    const looksLikeUrl =
      /^https?:\/\//i.test(raw) ||
      /(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|\.mp4|\.webm)/i.test(raw);
    if (looksLikeUrl) {
      setLoadingShorts(true);
      try {
        const resolved = await resolveShortVideoFromServer(raw);
        if (firebaseUser) {
          await onCreatePost({
            kind: 'reel',
            caption: resolved.title || 'Shared YouTube Short to Sovereign Media Pulse',
            mediaUrl: resolved.thumbnailUrl || FEED_ROOFTOP_IMAGE,
            videoPlatform: resolved.platform,
            sourceUrl: resolved.sourceUrl,
            embedUrl: resolved.embedUrl,
            avatarId: profile.equippedAvatarId,
            emote: profile.equippedEmote,
          });
          setSearchInput('');
          setActiveTopicId('for-you');
          setActiveSearchQuery('');
          setReelIndex(0);
          playUiSfx('post');
          showNotice('Added your YouTube Short to Media Pulse!');
        } else {
          const tempPost: SocialPost = {
            id: `yt_${resolved.videoId}`,
            authorId: 'yt_direct',
            authorName: resolved.authorName || 'YouTube Shorts',
            authorHandle: 'youtubeshorts',
            kind: 'reel',
            caption: resolved.title || 'YouTube Short',
            mediaUrl: resolved.thumbnailUrl || FEED_ROOFTOP_IMAGE,
            videoPlatform: resolved.platform,
            sourceUrl: resolved.sourceUrl,
            embedUrl: resolved.embedUrl,
            likesCount: 120,
            commentsCount: 8,
            repostsCount: 14,
            sharesCount: 9,
          };
          setForYouShorts((prev) => [tempPost, ...prev.filter((p) => p.id !== tempPost.id)]);
          setActiveTopicId('for-you');
          setActiveSearchQuery('');
          setReelIndex(0);
          setSearchInput('');
          playUiSfx('post');
          showNotice('Playing YouTube Short in Media Pulse!');
        }
      } catch (err) {
        showNotice(err instanceof Error ? err.message : 'Unsupported video link.');
      } finally {
        setLoadingShorts(false);
      }
      return;
    }

    // Otherwise run a live YouTube Shorts search across Media Pulse!
    setLoadingShorts(true);
    setActiveSearchQuery(raw);
    setActiveTopicId('search');
    setReelIndex(0);
    try {
      const items = await fetchShortsBatch({ query: raw, page: 1, limit: 12, replace: true });
      setTopicShorts(items);
      setTopicPage(1);
      playUiSfx('nav');
      if (items.length === 0) {
        showNotice(`No Shorts found for "${raw}" — try another keyword!`);
      } else {
        showNotice(`Found ${items.length} YouTube Shorts for "${raw}" — scroll to watch more!`);
      }
    } catch {
      showNotice('Search temporarily unavailable — please try again.');
    } finally {
      setLoadingShorts(false);
    }
  };

  const openComments = async (post: SocialPost) => {
    setCommentPost(post);
    setLoadingComments(true);
    try {
      const list = await onLoadComments(post.id);
      const locals = localCommentsByPostId[post.id] || [];
      const seen = new Set(list.map((c) => c.id));
      setComments([...list, ...locals.filter((c) => !seen.has(c.id))]);
    } finally {
      setLoadingComments(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentPost || !commentText.trim()) return;
    if (!firebaseUser) {
      onOpenAuth();
      return;
    }
    const created = await onAddComment(commentPost.id, commentText.trim());
    if (created) {
      setComments((prev) => [...prev, created]);
      setLocalCommentsByPostId((prev) => ({
        ...prev,
        [commentPost.id]: [...(prev[commentPost.id] || []), created],
      }));
      setCommentText('');
      playUiSfx('post');
    }
  };

  const handlePostInlineComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReel || !inlineCommentText.trim()) return;
    if (!firebaseUser) {
      onOpenAuth();
      return;
    }
    const created = await onAddComment(activeReel.id, inlineCommentText.trim());
    if (created) {
      setActiveComments((prev) => [...prev, created]);
      setLocalCommentsByPostId((prev) => ({
        ...prev,
        [activeReel.id]: [...(prev[activeReel.id] || []), created],
      }));
      setInlineCommentText('');
      playUiSfx('post');
    }
  };

  const handleActionLike = async (post: SocialPost) => {
    if (!firebaseUser) {
      onOpenAuth();
      return;
    }
    playUiSfx('like');
    await onToggleLike(post);
  };

  const handleActionRepost = async (post: SocialPost) => {
    if (!firebaseUser) {
      onOpenAuth();
      return;
    }
    playUiSfx('repost');
    await onRepostPost(post);
    showNotice(`Reposted ${post.authorName}'s clip to Media Pulse!`);
  };

  const handleActionShare = async (post: SocialPost) => {
    playUiSfx('share');
    await onSharePost(post);
    showNotice('Share link copied & share count updated!');
  };

  const handleActionAddToStory = async (post: SocialPost) => {
    if (!firebaseUser) {
      onOpenAuth();
      return;
    }
    playUiSfx('story');
    await onAddToStory(post);
    showNotice(`Added "${post.authorName}" video to your 24h Story strip!`);
  };

  const handlePublishPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      onOpenAuth();
      return;
    }
    if (!newCaption.trim()) return;
    setPublishing(true);
    try {
      let resolvedPlatform = newVideoPlatform;
      let resolvedSource = newVideoUrl.trim() || undefined;
      let resolvedEmbed = newEmbedUrl.trim() || undefined;
      let resolvedMedia = newMediaUrl.trim() || COVER_BACKDROP_IMAGE;

      if (resolvedSource && !resolvedEmbed) {
        const res = await resolveShortVideoFromServer(resolvedSource);
        resolvedPlatform = res.platform;
        resolvedSource = res.sourceUrl;
        resolvedEmbed = res.embedUrl;
        if (res.thumbnailUrl && resolvedMedia === FEED_ROOFTOP_IMAGE) {
          resolvedMedia = res.thumbnailUrl;
        }
      }

      await onCreatePost({
        kind: newKind,
        caption: newCaption.trim(),
        mediaUrl: resolvedMedia,
        videoPlatform: resolvedEmbed ? resolvedPlatform : 'native',
        ...(resolvedSource ? { sourceUrl: resolvedSource } : {}),
        ...(resolvedEmbed ? { embedUrl: resolvedEmbed } : {}),
        avatarId: profile.equippedAvatarId,
        emote: profile.equippedEmote,
      });

      playUiSfx('post');
      setNewCaption('');
      setNewVideoUrl('');
      setNewEmbedUrl('');
      setNewVideoPlatform('native');
      setComposerOpen(false);
      onClearPrefilledSnapshot?.();
      showNotice(
        newKind === 'story'
          ? 'Published to 24h Stories!'
          : resolvedEmbed
            ? `Published ${getPlatformLabel(resolvedPlatform)} video to Media Pulse!`
            : 'Published post to Media Pulse!',
      );
    } catch (err) {
      setMediaUploadError(err instanceof Error ? err.message : 'Failed to publish post.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section className="max-w-[1240px] mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Header & Mode Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-white">Media Pulse</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Scroll &amp; search live YouTube Shorts across every topic — like, repost, comment,
            share, or add directly to Stories.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={loadingShorts}
            onClick={() => void handleSyncLiveShorts()}
            className="px-3.5 py-2 rounded-lg bg-[#111829] hover:bg-[#19243E] border border-white/12 text-xs font-semibold text-slate-200 flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#60A5FA] ${loadingShorts ? 'animate-spin' : ''}`} />
            <span>{loadingShorts ? 'Loading Shorts...' : 'Refresh Feed'}</span>
          </button>

          <div className="flex items-center gap-1 p-1 bg-[#0F1627] border border-white/10 rounded-lg">
            <button
              type="button"
              onClick={() => setFeedMode('reels')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                feedMode === 'reels' ? 'bg-[#2563EB] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Scroll Shorts
            </button>
            <button
              type="button"
              onClick={() => setFeedMode('grid')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                feedMode === 'grid' ? 'bg-[#2563EB] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Explore Grid
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (!firebaseUser) {
                onOpenAuth();
              } else {
                setComposerOpen(true);
              }
            }}
            className="px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Post Short</span>
          </button>
        </div>
      </div>

      {/* Search Bar & Trending Topic Tabs */}
      <div className="bg-[#0B101D] border border-white/10 rounded-2xl p-3.5 space-y-3">
        <form onSubmit={handleSearchOrConnect} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search YouTube Shorts (freeforms, basketball, historyyt, cooking, gaming...) or paste a Shorts URL..."
              className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[#12192B] border border-white/12 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#3B82F6]"
            />
          </div>
          <button
            type="submit"
            disabled={loadingShorts}
            className="px-4 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap flex items-center gap-1.5"
          >
            {loadingShorts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>{loadingShorts ? 'Searching...' : 'Search'}</span>
          </button>
          {isFilteredView && (
            <button
              type="button"
              onClick={() => void handleSelectTopic('for-you')}
              className="px-3 py-2.5 rounded-lg bg-[#12192B] hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 whitespace-nowrap"
            >
              Reset
            </button>
          )}
        </form>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {TOPIC_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => void handleSelectTopic(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                activeTopicId === tab.id
                  ? 'bg-[#D4AF37] text-slate-950'
                  : 'bg-[#12192B] text-slate-300 hover:text-white border border-white/8'
              }`}
            >
              {tab.label}
            </button>
          ))}
          {activeSearchQuery && (
            <span className="px-3 py-1.5 rounded-lg bg-[#15223D] border border-[#3B82F6]/40 text-xs font-semibold text-[#93C5FD] whitespace-nowrap shrink-0">
              Results: “{activeSearchQuery}”
            </span>
          )}
        </div>
      </div>

      {pulseNotice && (
        <div className="px-4 py-2.5 rounded-xl bg-[#161209] border border-[#D4AF37]/45 text-xs text-[#FDE68A] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0" />
          <span>{pulseNotice}</span>
        </div>
      )}

      {/* Stories Strip (Playable YouTube Shorts & 3D Moments) */}
      <div className="bg-[#0B101D] border border-white/10 rounded-2xl p-4">
        <div className="flex items-center gap-4 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => {
              if (!firebaseUser) onOpenAuth();
              else {
                setNewKind('story');
                setComposerOpen(true);
              }
            }}
            className="flex flex-col items-center gap-1.5 shrink-0 group"
          >
            <div className="w-16 h-16 rounded-full bg-[#131B2E] border-2 border-dashed border-[#3B82F6]/60 group-hover:border-[#60A5FA] flex items-center justify-center text-[#60A5FA] transition-colors">
              <Camera className="w-6 h-6" />
            </div>
            <span className="text-xs text-slate-300 font-medium">Your Story</span>
          </button>

          {stories.map((story) => (
            <button
              key={story.id}
              type="button"
              onClick={() => setActiveStory(story)}
              className="flex flex-col items-center gap-1.5 shrink-0 group"
            >
              <div className="relative w-16 h-16 rounded-full p-0.5 bg-gradient-to-tr from-[#2563EB] via-[#60A5FA] to-[#D4AF37]">
                <div className="w-full h-full rounded-full overflow-hidden bg-[#0B101D] p-0.5">
                  <img
                    src={story.mediaUrl || COVER_BACKDROP_IMAGE}
                    alt={story.authorName}
                    referrerPolicy="no-referrer"
                    className="w-full h-full rounded-full object-cover group-hover:scale-105 transition-transform"
                  />
                </div>
                {story.embedUrl && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#2563EB] border border-[#0B101D] flex items-center justify-center">
                    <Play className="w-2.5 h-2.5 text-white fill-white" />
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-200 font-medium max-w-[76px] truncate">
                {story.authorName}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Empty Search Fallback */}
      {feedMode === 'reels' && !activeReel && (
        <div className="bg-[#0B101D] border border-white/10 rounded-2xl p-10 text-center space-y-3">
          <p className="text-sm text-slate-300">
            {loadingShorts
              ? 'Searching live YouTube Shorts...'
              : 'No Shorts matched that search yet. Try another keyword or switch back to For You.'}
          </p>
          {!loadingShorts && (
            <button
              type="button"
              onClick={() => void handleSelectTopic('for-you')}
              className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
            >
              Back to For You Feed
            </button>
          )}
        </div>
      )}

      {/* Vertical Scrollable Shorts Player + Comment/Like/Repost System */}
      {feedMode === 'reels' && activeReel && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div
            onWheel={handleStageWheel}
            onTouchStart={handleStageTouchStart}
            onTouchEnd={handleStageTouchEnd}
            className="lg:col-span-7 flex flex-col items-center gap-3"
          >
            <div className="relative w-full max-w-[420px] aspect-[9/16] rounded-2xl overflow-hidden bg-black border border-white/15 shadow-2xl">
              <ShortVideoPlayer post={activeReel} isMuted={isMuted} />

              {/* Top Overlay: Platform Badge + Repost Attribution + External Source */}
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
                <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
                  <span
                    className={`px-2.5 py-1 rounded-md border text-[11px] font-bold ${getPlatformBadgeClass(
                      activeReel.videoPlatform,
                    )}`}
                  >
                    {getPlatformLabel(activeReel.videoPlatform)}
                  </span>
                  {activeReel.repostedFromAuthor && (
                    <span className="px-2 py-1 rounded-md bg-black/75 border border-white/15 text-[11px] text-emerald-300 flex items-center gap-1">
                      <Repeat2 className="w-3 h-3" />
                      <span>Reposted from {activeReel.repostedFromAuthor}</span>
                    </span>
                  )}
                </div>

                {activeReel.sourceUrl && (
                  <a
                    href={activeReel.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pointer-events-auto px-2 py-1 rounded-md bg-black/75 border border-white/15 text-[11px] text-slate-200 hover:text-white flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Source</span>
                  </a>
                )}
              </div>

              {/* Vertical Queue Up / Down Arrows */}
              <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-10">
                <button
                  type="button"
                  aria-label="Previous short"
                  disabled={safeReelIdx === 0}
                  onClick={() => stepReel(-1)}
                  className="p-2.5 rounded-full bg-black/70 border border-white/15 text-white hover:bg-[#2563EB] disabled:opacity-35 transition-colors"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next short"
                  disabled={safeReelIdx >= reels.length - 1 && !loadingMore}
                  onClick={() => stepReel(1)}
                  className="p-2.5 rounded-full bg-black/70 border border-white/15 text-white hover:bg-[#2563EB] disabled:opacity-35 transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Scroll / Next Bar right beneath the player for effortless mouse scrolling */}
            <div className="w-full max-w-[420px] flex items-center justify-between gap-2 px-1">
              <button
                type="button"
                disabled={safeReelIdx === 0}
                onClick={() => stepReel(-1)}
                className="px-3 py-1.5 rounded-lg bg-[#0B101D] border border-white/10 text-xs font-semibold text-slate-300 hover:text-white disabled:opacity-40 flex items-center gap-1"
              >
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
              <span className="text-[11px] font-mono text-slate-400">
                {loadingMore
                  ? `Loading more Shorts... (${safeReelIdx + 1} / ${reels.length})`
                  : `Short ${safeReelIdx + 1} / ${reels.length} · Scroll for more`}
              </span>
              <button
                type="button"
                disabled={safeReelIdx >= reels.length - 1 && !loadingMore}
                onClick={() => stepReel(1)}
                className="px-3 py-1.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-1"
              >
                <span>Next Short</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Action & Info Deck cleanly positioned below/beside player so YouTube/TikTok/IG controls stay clickable */}
            <div className="w-full max-w-[420px] bg-[#0B101D] border border-white/12 rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">
                    {activeReel.authorName}{' '}
                    <span className="text-xs font-normal text-slate-400">
                      @{activeReel.authorHandle}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-200 leading-relaxed mt-1">
                    {activeReel.caption}
                  </p>
                </div>
                {activeReel.avatarId && (
                  <button
                    type="button"
                    onClick={() => onEquipFromPost(activeReel.avatarId, activeReel.emote)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[11px] font-semibold transition-colors inline-flex items-center gap-1 shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Equip 3D</span>
                  </button>
                )}
              </div>

              {/* Interactive Action Bar: Like, Repost, Comment, Share, Add to Story, Bookmark, Report */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => void handleActionLike(activeReel)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    likedPostIds.includes(activeReel.id)
                      ? 'bg-red-600/20 text-red-400 border border-red-500/40'
                      : 'bg-[#12192B] text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <Heart className="w-4 h-4" />
                  <span className="font-mono tabular-nums">{activeReel.likesCount}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleActionRepost(activeReel)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    repostedPostIds.includes(activeReel.id)
                      ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-[#12192B] text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <Repeat2 className="w-4 h-4" />
                  <span className="font-mono tabular-nums">{activeReel.repostsCount ?? 0}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void openComments(activeReel)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#12192B] hover:bg-white/10 text-slate-200 text-xs font-medium flex items-center gap-1.5"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="font-mono tabular-nums">{activeReel.commentsCount}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleActionShare(activeReel)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#12192B] hover:bg-white/10 text-slate-200 text-xs font-medium flex items-center gap-1.5"
                >
                  <Share2 className="w-4 h-4" />
                  <span className="font-mono tabular-nums">{activeReel.sharesCount ?? 0}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleActionAddToStory(activeReel)}
                  title="Add video to 24h Story"
                  className="px-2.5 py-1.5 rounded-lg bg-[#1A1508] hover:bg-[#2A220D] border border-[#D4AF37]/40 text-[#FDE68A] text-xs font-semibold flex items-center gap-1"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Story</span>
                </button>

                <button
                  type="button"
                  aria-label="Bookmark post"
                  onClick={() =>
                    setSavedIds((prev) =>
                      prev.includes(activeReel.id)
                        ? prev.filter((id) => id !== activeReel.id)
                        : [...prev, activeReel.id],
                    )
                  }
                  className={`p-1.5 rounded-lg ${
                    savedIds.includes(activeReel.id)
                      ? 'bg-[#D4AF37] text-slate-950'
                      : 'bg-[#12192B] text-slate-300 hover:text-white'
                  }`}
                >
                  <Bookmark className="w-4 h-4" />
                </button>

                {onCreateReport && (
                  <button
                    type="button"
                    aria-label="Report post"
                    onClick={() => {
                      if (!firebaseUser) onOpenAuth();
                      else setReportingPost(activeReel);
                    }}
                    className="p-1.5 rounded-lg bg-[#12192B] text-slate-300 hover:text-amber-300"
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                )}

                {isAdmin && onDeletePost && (
                  <button
                    type="button"
                    aria-label="Admin remove post"
                    onClick={() => void onDeletePost(activeReel.id)}
                    className="p-1.5 rounded-lg bg-red-950/80 text-red-200 hover:bg-red-800"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Live Comments, Likes & Repost System (Replaces Up Next) */}
          <div className="lg:col-span-5 bg-[#0B101D] border border-white/10 rounded-2xl p-5 flex flex-col gap-4 max-h-[760px]">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold font-display text-white">
                  Comments &amp; Pulse ({activeReel.commentsCount})
                </h2>
                <p className="text-xs text-slate-400">
                  Clip {safeReelIdx + 1} of {Math.max(1, reels.length)} · Use arrows to switch clips
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleActionLike(activeReel)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 border transition-colors ${
                    likedPostIds.includes(activeReel.id)
                      ? 'bg-red-600/20 border-red-500/40 text-red-400'
                      : 'bg-[#111829] border-white/10 text-slate-200 hover:border-white/25'
                  }`}
                >
                  <Heart className="w-3.5 h-3.5" />
                  <span className="font-mono tabular-nums">{activeReel.likesCount}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleActionRepost(activeReel)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 border transition-colors ${
                    repostedPostIds.includes(activeReel.id)
                      ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-[#111829] border-white/10 text-slate-200 hover:border-white/25'
                  }`}
                >
                  <Repeat2 className="w-3.5 h-3.5" />
                  <span className="font-mono tabular-nums">{activeReel.repostsCount ?? 0}</span>
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-[260px] max-h-[480px] overflow-y-auto space-y-2.5 pr-1">
              {loadingActiveComments ? (
                <p className="text-xs text-slate-400 py-4">Loading comments...</p>
              ) : activeComments.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#101727] border border-white/8 text-xs text-slate-400">
                  No replies on this clip yet — drop a comment, hit Like, or Repost it to your feed.
                </div>
              ) : (
                activeComments.map((c) => (
                  <div key={c.id} className="p-3 rounded-xl bg-[#111829] border border-white/8">
                    <div className="text-xs font-semibold text-white">{c.authorName}</div>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">{c.text}</p>
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={handlePostInlineComment}
              className="pt-3 border-t border-white/10 flex items-center gap-2"
            >
              <input
                type="text"
                value={inlineCommentText}
                onChange={(e) => setInlineCommentText(e.target.value)}
                maxLength={300}
                placeholder={
                  firebaseUser
                    ? 'Write a comment on this video...'
                    : 'Sign in to comment, like, or repost...'
                }
                className="flex-1 px-3 py-2.5 rounded-lg bg-[#12192B] border border-white/12 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#3B82F6]"
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Comment</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Visual Feed Grid (Click any card to Watch inside Theater Modal) */}
      {feedMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {photos.map((post) => {
            const liked = likedPostIds.includes(post.id);
            const reposted = repostedPostIds.includes(post.id);
            const hasPlayableVideo = Boolean(post.embedUrl || post.videoPlatform === 'direct');
            return (
              <article
                key={post.id}
                className="bg-[#0B101D] border border-white/10 rounded-2xl overflow-hidden flex flex-col"
              >
                <div className="px-4 py-3 flex items-center justify-between border-b border-white/8 gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {post.authorName}
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      @{post.authorHandle} · {getPlatformLabel(post.videoPlatform)}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${getPlatformBadgeClass(
                      post.videoPlatform,
                    )}`}
                  >
                    {getPlatformLabel(post.videoPlatform)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setTheaterPost(post)}
                  className="relative aspect-[4/3] bg-[#111829] overflow-hidden group text-left"
                >
                  <img
                    src={post.mediaUrl || FEED_ARENA_IMAGE}
                    alt={post.caption}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  {hasPlayableVideo && (
                    <span className="absolute inset-0 bg-black/35 flex items-center justify-center">
                      <span className="w-12 h-12 rounded-full bg-black/75 border border-white/25 flex items-center justify-center text-white group-hover:bg-[#2563EB] transition-colors">
                        <Play className="w-5 h-5 fill-white ml-0.5" />
                      </span>
                    </span>
                  )}
                </button>

                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5">
                    {post.repostedFromAuthor && (
                      <div className="text-[11px] text-emerald-300 flex items-center gap-1">
                        <Repeat2 className="w-3 h-3" />
                        <span>Reposted from {post.repostedFromAuthor}</span>
                      </div>
                    )}
                    <p className="text-sm text-slate-200 leading-relaxed line-clamp-3">
                      {post.caption}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/8">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleActionLike(post)}
                        className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                          liked ? 'text-red-400' : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        <Heart className="w-4 h-4" />
                        <span className="font-mono tabular-nums">{post.likesCount}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleActionRepost(post)}
                        className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                          reposted ? 'text-emerald-300' : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        <Repeat2 className="w-4 h-4" />
                        <span className="font-mono tabular-nums">{post.repostsCount ?? 0}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void openComments(post)}
                        className="flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white transition-colors"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span className="font-mono tabular-nums">{post.commentsCount}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleActionShare(post)}
                        aria-label="Share post"
                        className="flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white transition-colors"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span className="font-mono tabular-nums">{post.sharesCount ?? 0}</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleActionAddToStory(post)}
                        title="Add to Story"
                        aria-label="Add to Story"
                        className="p-1.5 rounded-md text-[#FDE68A] hover:bg-white/10 transition-colors"
                      >
                        <PlusCircle className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSavedIds((prev) =>
                            prev.includes(post.id)
                              ? prev.filter((id) => id !== post.id)
                              : [...prev, post.id],
                          )
                        }
                        aria-label="Bookmark post"
                        className={`p-1.5 rounded-md transition-colors ${
                          savedIds.includes(post.id)
                            ? 'text-[#D4AF37]'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Bookmark className="w-4 h-4" />
                      </button>
                      {isAdmin && onDeletePost && (
                        <button
                          type="button"
                          onClick={() => void onDeletePost(post.id)}
                          aria-label="Admin remove post"
                          className="p-1.5 rounded-md text-red-400 hover:text-red-200 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Theater Video Watch Modal (for Grid cards & Shared Links) */}
      {theaterPost && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl bg-[#0B101D] border border-white/15 rounded-2xl overflow-hidden grid grid-cols-1 md:grid-cols-12 max-h-[90vh]">
            <div className="md:col-span-7 aspect-[9/16] md:aspect-auto md:h-[560px] bg-black relative">
              <ShortVideoPlayer post={theaterPost} isMuted={isMuted} />
            </div>
            <div className="md:col-span-5 p-5 flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-white">{theaterPost.authorName}</div>
                    <div className="text-xs text-slate-400">
                      @{theaterPost.authorHandle} · {getPlatformLabel(theaterPost.videoPlatform)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTheaterPost(null)}
                    aria-label="Close video player"
                    className="p-1.5 rounded-lg bg-[#12192B] text-slate-300 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-slate-200 leading-relaxed">{theaterPost.caption}</p>
                {theaterPost.sourceUrl && (
                  <a
                    href={theaterPost.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-[#60A5FA] hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open original on {getPlatformLabel(theaterPost.videoPlatform)}</span>
                  </a>
                )}
              </div>

              <div className="space-y-2.5 pt-3 border-t border-white/10">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleActionLike(theaterPost)}
                    className="py-2 px-3 rounded-lg bg-[#12192B] hover:bg-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
                  >
                    <Heart className="w-4 h-4 text-red-400" />
                    <span>Like ({theaterPost.likesCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleActionRepost(theaterPost)}
                    className="py-2 px-3 rounded-lg bg-[#12192B] hover:bg-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
                  >
                    <Repeat2 className="w-4 h-4 text-emerald-400" />
                    <span>Repost ({theaterPost.repostsCount ?? 0})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = theaterPost;
                      setTheaterPost(null);
                      void openComments(target);
                    }}
                    className="py-2 px-3 rounded-lg bg-[#12192B] hover:bg-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
                  >
                    <MessageCircle className="w-4 h-4 text-[#60A5FA]" />
                    <span>Comments ({theaterPost.commentsCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleActionShare(theaterPost)}
                    className="py-2 px-3 rounded-lg bg-[#12192B] hover:bg-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
                  >
                    <Share2 className="w-4 h-4 text-[#D4AF37]" />
                    <span>Share ({theaterPost.sharesCount ?? 0})</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void handleActionAddToStory(theaterPost)}
                  className="w-full py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Add Video to 24h Story</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ephemeral Story Viewer Modal (Plays Connected Short Videos!) */}
      {activeStory && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm flex flex-col gap-3">
            <div className="relative w-full aspect-[9/16] rounded-2xl overflow-hidden bg-black border border-white/15">
              <ShortVideoPlayer post={activeStory} isMuted={isMuted} />

              <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                <div className="px-2.5 py-1 rounded-lg bg-black/75 border border-white/15 pointer-events-auto">
                  <div className="text-xs font-semibold text-white">{activeStory.authorName}</div>
                  <div className="text-[11px] text-slate-300">
                    @{activeStory.authorHandle} · {getPlatformLabel(activeStory.videoPlatform)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveStory(null)}
                  aria-label="Close story"
                  className="pointer-events-auto p-2 rounded-full bg-black/75 text-white hover:bg-black"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="bg-[#0B101D] border border-white/12 rounded-2xl p-3.5 space-y-2.5">
              <p className="text-xs text-white leading-relaxed">{activeStory.caption}</p>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void handleActionLike(activeStory)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#12192B] text-xs text-white flex items-center gap-1"
                >
                  <Heart className="w-3.5 h-3.5 text-red-400" />
                  <span>{activeStory.likesCount}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleActionRepost(activeStory)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#12192B] text-xs text-white flex items-center gap-1"
                >
                  <Repeat2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Repost</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleActionShare(activeStory)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#12192B] text-xs text-white flex items-center gap-1"
                >
                  <Share2 className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>Share</span>
                </button>
                {activeStory.avatarId && (
                  <button
                    type="button"
                    onClick={() => {
                      onEquipFromPost(activeStory.avatarId, activeStory.emote);
                      setActiveStory(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold"
                  >
                    Wear Rig
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Comments Drawer Modal */}
      {commentPost && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-[#0B101D] border border-white/12 rounded-2xl p-5 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-bold font-display text-white">
                Comments · {commentPost.authorName}
              </h3>
              <button
                type="button"
                onClick={() => setCommentPost(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {loadingComments ? (
                <p className="text-xs text-slate-400">Loading replies...</p>
              ) : comments.length === 0 ? (
                <p className="text-xs text-slate-400">No comments yet. Start the conversation.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="p-3 rounded-xl bg-[#111829] border border-white/8">
                    <div className="text-xs font-semibold text-white">{c.authorName}</div>
                    <p className="text-xs text-slate-300 mt-1">{c.text}</p>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handlePostComment} className="pt-3 border-t border-white/10 flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                maxLength={300}
                placeholder="Write a comment..."
                className="flex-1 px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white focus:outline-none focus:border-[#3B82F6]"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold flex items-center gap-1"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Post</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Create Post / Connect YouTube Shorts, Instagram Reels, TikTok or Video Upload */}
      {composerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg bg-[#0B101D] border border-white/12 rounded-2xl p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold font-display text-white">
                Connect Video or Publish to Media Pulse
              </h3>
              <button
                type="button"
                onClick={() => {
                  setComposerOpen(false);
                  onClearPrefilledSnapshot?.();
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePublishPost} className="space-y-4">
              <div className="flex items-center gap-1 p-1 bg-[#12192B] rounded-lg">
                {(['reel', 'photo', 'story'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setNewKind(k)}
                    className={`flex-1 py-2 rounded-md text-xs font-semibold capitalize transition-colors ${
                      newKind === k ? 'bg-[#2563EB] text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {k === 'reel' ? 'Vertical Reel' : k === 'photo' ? 'Feed Post' : '24h Story'}
                  </button>
                ))}
              </div>

              {/* Connect YouTube Shorts / Instagram Reel / TikTok URL */}
              <div className="p-3.5 rounded-xl bg-[#111829] border border-white/10 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Video className="w-3.5 h-3.5 text-[#60A5FA]" />
                    <span>YouTube Shorts / Instagram Reels / TikTok Link</span>
                  </label>
                  <label className="px-2.5 py-1 rounded-md bg-[#162340] hover:bg-[#1E3159] border border-[#3B82F6]/40 text-[11px] font-semibold text-[#93C5FD] cursor-pointer flex items-center gap-1">
                    <Upload className="w-3 h-3" />
                    <span>{uploadingMedia ? 'Uploading...' : 'Upload MP4'}</span>
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime"
                      disabled={uploadingMedia}
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setMediaUploadError(null);
                        setUploadingMedia(true);
                        try {
                          const videoId = `vid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
                          const resp = await fetch(`/api/videos/${videoId}`, {
                            method: 'POST',
                            headers: { 'Content-Type': file.type || 'video/mp4' },
                            body: file,
                          });
                          if (!resp.ok) throw new Error('Video upload failed (max 25MB).');
                          const endpoint = `/api/videos/${videoId}`;
                          setNewVideoPlatform('direct');
                          setNewVideoUrl(endpoint);
                          setNewEmbedUrl(endpoint);
                        } catch (err) {
                          setMediaUploadError(
                            err instanceof Error ? err.message : 'Failed to upload video clip.',
                          );
                        } finally {
                          setUploadingMedia(false);
                        }
                      }}
                    />
                  </label>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newVideoUrl}
                    onChange={(e) => setNewVideoUrl(e.target.value)}
                    placeholder="https://youtube.com/shorts/... or instagram.com/reel/... or tiktok.com/..."
                    className="flex-1 px-3 py-2 rounded-lg bg-[#0B101D] border border-white/12 text-xs text-white focus:outline-none focus:border-[#3B82F6]"
                  />
                  <button
                    type="button"
                    disabled={resolvingVideo || !newVideoUrl.trim()}
                    onClick={() => void handleResolveVideoInComposer(newVideoUrl)}
                    className="px-3 py-2 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] disabled:opacity-50 text-slate-950 text-xs font-bold whitespace-nowrap"
                  >
                    {resolvingVideo ? 'Resolving...' : 'Connect'}
                  </button>
                </div>

                {newEmbedUrl && (
                  <div className="flex items-center justify-between text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-lg px-2.5 py-1.5">
                    <span>Connected {getPlatformLabel(newVideoPlatform)} playable stream</span>
                    <button
                      type="button"
                      onClick={() => {
                        setNewVideoUrl('');
                        setNewEmbedUrl('');
                        setNewVideoPlatform('native');
                      }}
                      className="text-slate-300 hover:text-white underline"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Thumbnail / Cover Image Upload or Preset
                  </label>
                  <label className="px-2.5 py-1 rounded-md bg-[#162340] hover:bg-[#1E3159] border border-[#3B82F6]/40 text-[11px] font-semibold text-[#93C5FD] cursor-pointer flex items-center gap-1">
                    <Upload className="w-3 h-3" />
                    <span>{uploadingMedia ? 'Uploading...' : 'Upload Image'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      disabled={uploadingMedia}
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setMediaUploadError(null);
                        setUploadingMedia(true);
                        try {
                          const endpoint = await uploadImageFile(file);
                          setNewMediaUrl(endpoint);
                        } catch (err) {
                          setMediaUploadError(
                            err instanceof Error ? err.message : 'Failed to upload image.',
                          );
                        } finally {
                          setUploadingMedia(false);
                        }
                      }}
                    />
                  </label>
                </div>
                {mediaUploadError && (
                  <p className="text-[11px] text-red-300 mb-1.5">{mediaUploadError}</p>
                )}
                {newMediaUrl && (
                  <div className="mb-2 relative h-28 rounded-xl overflow-hidden bg-[#111829] border border-white/10">
                    <img
                      src={newMediaUrl}
                      alt="Post thumbnail preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {PRESET_MEDIA.map((pm) => (
                    <button
                      key={pm.label}
                      type="button"
                      onClick={() => setNewMediaUrl(pm.url)}
                      className={`p-1 rounded-lg border text-[11px] truncate ${
                        newMediaUrl === pm.url
                          ? 'border-[#3B82F6] bg-[#162340] text-white'
                          : 'border-white/10 bg-[#111829] text-slate-400'
                      }`}
                    >
                      {pm.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={newMediaUrl}
                  onChange={(e) => setNewMediaUrl(e.target.value)}
                  maxLength={1000}
                  placeholder="Or paste thumbnail image URL..."
                  className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white focus:outline-none focus:border-[#3B82F6]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Caption</label>
                <textarea
                  required
                  rows={3}
                  maxLength={500}
                  value={newCaption}
                  onChange={(e) => setNewCaption(e.target.value)}
                  placeholder="Add your reaction, remix caption, or lounge moment..."
                  className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                />
              </div>

              <button
                type="submit"
                disabled={publishing}
                className="w-full py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {publishing ? 'Publishing...' : 'Publish Now'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Report Content Modal */}
      {reportingPost && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-[#0B101D] border border-[#D4AF37]/30 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold font-display text-white">
                Report Post by {reportingPost.authorName}
              </h3>
              <button
                type="button"
                onClick={() => setReportingPost(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <blockquote className="p-3 rounded-xl bg-[#111829] border border-white/10 text-xs text-slate-300 line-clamp-3">
              “{reportingPost.caption}”
            </blockquote>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!onCreateReport) return;
                await onCreateReport({
                  targetType: 'post',
                  targetId: reportingPost.id,
                  targetAuthorId: reportingPost.authorId,
                  targetAuthorName: reportingPost.authorName,
                  targetExcerpt: reportingPost.caption || reportingPost.id,
                  reason: reportReason,
                  details: reportDetails.trim() || undefined,
                });
                setReportingPost(null);
                setReportDetails('');
                showNotice('Report submitted to Sovereign Admin moderation queue.');
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs text-slate-300 mb-1">Reason</label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value as ReportReason)}
                  className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                >
                  <option value="inappropriate">Inappropriate Content</option>
                  <option value="harassment">Harassment or Abuse</option>
                  <option value="spam">Spam or Scam</option>
                  <option value="impersonation">Impersonation</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Additional Context</label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#12192B] border border-white/10 text-xs text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E5C158] text-slate-950 text-xs font-bold"
              >
                Submit Report
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
