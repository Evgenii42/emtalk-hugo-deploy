import { createAudioMeasurement } from './analytics-events.js';
// Lifetime contract: Hugo serves static player markup with full document
// navigation. Repeated initPlayers() calls enhance the same markup idempotently.
// The registries below belong to that document, including bfcache restoration.
// Dynamic DOM removal or page swapping requires an explicit disposal contract
// before it can be supported; the current site keeps each player's markup intact.
const players = new Set();
const actions = new Map();
const bufferedSources = new WeakMap();
const pendingSources = new WeakMap();
const nativeSources = new WeakSet();
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

function localMediaUrl(audio) {
  if (!document.baseURI || typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') return null;
  let url;
  try {
    url = new URL(audio.getAttribute('src') || '', document.baseURI);
  } catch { return null; }
  const page = new URL(document.baseURI);
  // Only the prepared local article media filenames use complete-file playback.
  // External and standalone player sources retain native streaming behavior.
  return url.origin === page.origin && !url.search && !url.hash
    && /\/media\/(?:mp3-[a-f0-9]{20}-|[a-f0-9]{20}-)[^/]+\.(?:opus|mp3)$/i.test(url.pathname) ? url : null;
}

function assignAudioSource(audio, source) {
  const cached = bufferedSources.get(audio);
  if (cached?.source === source && audio.getAttribute('src') === cached.objectUrl) return false;
  const pending = pendingSources.get(audio);
  if (pending && pending.source !== source) pending.cancel();
  if (cached) {
    URL.revokeObjectURL(cached.objectUrl);
    bufferedSources.delete(audio);
  }
  if (audio.getAttribute('src') === source) return false;
  nativeSources.delete(audio);
  audio.src = source;
  return true;
}

function bufferLocalAudio(audio, signal) {
  if (nativeSources.has(audio)) return null;
  if (bufferedSources.get(audio)?.objectUrl === audio.getAttribute('src')) return null;
  const url = localMediaUrl(audio);
  if (!url) return null;
  const source = audio.getAttribute('src');
  return (async () => {
    // Static hosts may return 200 for Range requests. A real local Blob provides
    // finite duration and seeking without an audio backend. Download on Play only.
    const response = await fetch(url.href, { signal, credentials: 'omit', redirect: 'error', mode: 'same-origin' });
    if (response.status !== 200 || !response.body || Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES) {
      await response.body?.cancel();
      throw new Error('Audio download failed');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_AUDIO_BYTES) {
          await reader.cancel();
          throw new Error('Audio download too large');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (!size || signal.aborted || audio.getAttribute('src') !== source) {
      throw new DOMException('Audio load superseded', 'AbortError');
    }
    const blob = new Blob(chunks, { type: /\.mp3$/i.test(url.pathname) ? 'audio/mpeg' : 'audio/ogg; codecs="opus"' });
    const objectUrl = URL.createObjectURL(blob);
    bufferedSources.set(audio, { source, objectUrl });
    audio.src = objectUrl;
  })();
}

let activePlayer;
const playerActivity = new Map();
let lastActivity = 0;
let ownsMediaSession = false;
const markActive = audio => {
  activePlayer = audio;
  playerActivity.set(audio, ++lastActivity);
};

function formatTime(time) {
  if (!Number.isFinite(time) || time < 0) return '0:00';
  return `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
}

function initPlayer(root, legacy = false) {
  if (root.dataset.playerReady === 'true') return;
  const audio = root.querySelector(legacy ? '#audio-player' : '.emtalk-audio-player__control');
  const button = root.querySelector(legacy ? '#play-btn' : '.emtalk-player-ui__play');
  const icon = legacy ? button : root.querySelector('.emtalk-player-ui__play-icon');
  const current = root.querySelector(legacy ? '#current-time' : '.emtalk-player-ui__current');
  const duration = root.querySelector(legacy ? '#duration' : '.emtalk-player-ui__duration');
  const progress = root.querySelector(legacy ? '.progress-bar' : '.emtalk-player-ui__progress');
  const fill = root.querySelector(legacy ? '.progress-fill' : '.emtalk-player-ui__progress-fill');
  if (!audio || !button || !icon || !current || !duration || !progress || !fill) return;
  let starting = false;
  const seekBlocked = () => starting || root.dataset.playbackState === 'loading';
  const updateSeekAvailability = () => progress.setAttribute('aria-disabled', String(seekBlocked()));
  const setPlaybackState = state => {
    root.dataset.playbackState = state;
    updateSeekAvailability();
  };
  const measurement = createAudioMeasurement();
  root.dataset.playerReady = 'true';
  setPlaybackState('idle');
  button.setAttribute('role', 'button');
  button.setAttribute('aria-label', 'Play audio');
  if (button.tagName !== 'BUTTON') button.tabIndex = 0;
  progress.setAttribute('role', 'slider');
  progress.tabIndex = 0;
  progress.setAttribute('aria-label', 'Audio progress');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  let status = root.querySelector('.emtalk-player-status');
  if (!status) {
    status = document.createElement('p');
    status.className = 'emtalk-player-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    root.append(status);
  }
  const showStatus = text => {
    status.textContent = text;
    status.hidden = !text;
  };
  const setAction = action => {
    button.dataset.playerAction = action;
    button.setAttribute('aria-label', { play: 'Play audio', pause: 'Pause audio', cancel: 'Cancel audio loading' }[action]);
  };
  const showIcon = paused => {
    setAction(paused ? 'play' : 'pause');
    if (legacy) {
      icon.textContent = paused ? '\u25b6' : '\u275a\u275a';
    } else {
      // Action tokens keep decorative icons independent of translated accessible names.
      icon.textContent = '';
    }
  };
  const update = () => {
    const total = Number.isFinite(audio.duration) ? audio.duration : 0;
    const percent = total ? Math.max(0, Math.min(100, audio.currentTime / total * 100)) : 0;
    current.textContent = formatTime(audio.currentTime);
    duration.textContent = formatTime(total);
    fill.style.width = `${percent}%`;
    progress.setAttribute('aria-valuenow', String(Math.round(percent)));
    progress.setAttribute('aria-valuetext', `${formatTime(audio.currentTime)} of ${formatTime(total)}`);
  };
  // Ignore errors from an inactive cancelled load until the next explicit attempt.
  let cancelledStart = false;
  let cancelStart;
  window.addEventListener?.('pagehide', event => {
    cancelStart?.(true);
    audio.pause();
    if (!event.persisted) {
      const cached = bufferedSources.get(audio);
      if (cached) {
        URL.revokeObjectURL(cached.objectUrl);
        bufferedSources.delete(audio);
      }
    }
  });
  const toggle = async event => {
    event?.preventDefault();
    markActive(audio);
    if (starting) { cancelStart?.(); return; }
    if (!audio.paused) {
      measurement.pauseByUser();
      audio.pause();
      return;
    }
    starting = true;
    measurement.attempt();
    cancelledStart = false;
    setPlaybackState('loading');
    button.setAttribute('aria-busy', 'true');
    setAction('cancel');
    showStatus('Loading audio...');
    let rejectLoad;
    let cancelled = false;
    let decodingBlob = false;
    const download = new AbortController();
    const failed = new Promise((_, reject) => { rejectLoad = reject; });
    cancelStart = (preserveCycle = false) => {
      cancelled = true;
      cancelledStart = true;
      // Page lifecycle interruption preserves an existing factual audio cycle.
      // Explicit cancel/source replacement still end the attempt for a new Play.
      if (preserveCycle === true) measurement.suspend();
      else measurement.cancel();
      download.abort();
      audio.pause();
      rejectLoad(new DOMException('Playback cancelled', 'AbortError'));
    };
    const attempt = { source: audio.getAttribute('src'), cancel: cancelStart };
    pendingSources.set(audio, attempt);
    const onError = () => {
      if (!decodingBlob) rejectLoad(new Error('Media load failed'));
    };
    audio.addEventListener('error', onError);
    // Local complete-file playback gets a bounded minute for download/start.
    // Native sources retain their 15-second deadline. Both can be cancelled.
    let timedOut = false;
    const loadTimeout = setTimeout(() => {
      timedOut = true;
      download.abort();
      rejectLoad(new Error('Media load timed out'));
    }, bufferedSources.has(audio) || (localMediaUrl(audio) && !nativeSources.has(audio)) ? 60000 : 15000);
    try {
      // Retry after a failed load without changing the CMS/local media URL.
      if (audio.error && (!localMediaUrl(audio) || nativeSources.has(audio))) audio.load();
      const buffered = bufferLocalAudio(audio, download.signal);
      const play = buffered ? buffered.then(async () => {
        if (download.signal.aborted) throw new DOMException('Playback cancelled', 'AbortError');
        decodingBlob = true;
        try {
          return await audio.play();
        } catch (error) {
          const cached = bufferedSources.get(audio);
          if (download.signal.aborted || !cached || error?.name === 'NotAllowedError'
              || error?.name === 'AbortError'
              || (error?.name !== 'NotSupportedError' && audio.error?.code !== 4)) throw error;
          // Some native decoders accept HTTP media but reject the same Blob.
          // Restore the approved source only for that format failure, not for
          // network, cancellation or playback-policy failures. Replays stay native.
          decodingBlob = false;
          audio.src = cached.source;
          audio.load();
          URL.revokeObjectURL(cached.objectUrl);
          bufferedSources.delete(audio);
          nativeSources.add(audio);
          return audio.play();
        } finally {
          decodingBlob = false;
        }
      }) : audio.play();
      // Observe both inputs, including a late losing download or play rejection.
      await Promise.race([play, failed]);
    } catch (error) {
      audio.pause();
      setPlaybackState(cancelled ? 'paused' : 'error');
      if (!cancelled) measurement.error(timedOut ? 'timeout' : error?.name === 'NotAllowedError' ? 'play_rejected' : 'load_failed');
      // A rejected play attempt can fail without a MediaError (for example, playback policy).
      showStatus(cancelled ? '' : 'Audio could not start. Please try again.');
      showIcon(true);
    } finally {
      download.abort();
      if (pendingSources.get(audio) === attempt) pendingSources.delete(audio);
      clearTimeout(loadTimeout);
      audio.removeEventListener('error', onError);
      starting = false;
      // A resolved play promise can win its race just before an explicit cancel.
      // Native paused state remains authoritative after pending callbacks settle.
      if (audio.paused && root.dataset.playbackState !== 'error') {
        setPlaybackState(audio.ended ? 'ended' : 'paused');
        showStatus('');
      }
      cancelStart = null;
      button.removeAttribute('aria-busy');
      updateSeekAvailability();
      showIcon(audio.paused);
    }
  };
  button.addEventListener('click', toggle);
  button.addEventListener('keydown', event => {
    if ([' ', 'Enter'].includes(event.key) && button.tagName !== 'BUTTON') {
      event.preventDefault();
      toggle();
    }
  });
  audio.addEventListener('play', () => {
    if (audio.paused || cancelledStart || root.dataset.playbackState === 'error') {
      if (!audio.paused) audio.pause();
      return;
    }
    markActive(audio);
    // Selecting this player is an explicit pause action for an active sibling.
    // Reuse its registered action so accepted playback has one matching pause.
    for (const other of players) if (other !== audio && !other.paused) actions.get(other)?.pause();
    showIcon(false);
    if (starting) setAction('cancel');
    setPlaybackState('playing');
    showStatus('');
  });
  audio.addEventListener('playing', () => {
    if (audio.paused || cancelledStart || root.dataset.playbackState === 'error') {
      if (!audio.paused) audio.pause();
      return;
    }
    setPlaybackState('playing');
    showStatus('');
    measurement.playing();
  });
  audio.addEventListener('pause', () => {
    if (starting) return;
    showIcon(true);
    if (!audio.error && root.dataset.playbackState !== 'error') setPlaybackState(audio.ended ? 'ended' : 'paused');
    if (root.dataset.playbackState !== 'error') showStatus('');
    measurement.paused();
  });
  audio.addEventListener('ended', () => {
    measurement.ended();
    setPlaybackState('ended');
    showIcon(true);
    update();
  });
  audio.addEventListener('waiting', () => {
    if (audio.paused) return;
    setPlaybackState('loading');
    if (starting) setAction('cancel');
    showStatus('Loading audio...');
  });
  audio.addEventListener('error', () => {
    // Pending failures settle through toggle; a cancelled attempt is not a load error.
    if (starting || cancelledStart) return;
    measurement.error('load_failed');
    setPlaybackState('error');
    showIcon(true);
    showStatus('Audio could not load. Please try again.');
  });
  for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked']) audio.addEventListener(event, update);
  const seek = time => {
    if (seekBlocked()) return;
    markActive(audio);
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, time));
    update();
  };
  progress.addEventListener('click', event => {
    const rect = progress.getBoundingClientRect();
    if (rect.width > 0) seek((event.clientX - rect.left) / rect.width * audio.duration);
  });
  progress.addEventListener('keydown', event => {
    const offsets = { ArrowRight: 5, ArrowLeft: -5, ArrowUp: 5, ArrowDown: -5, PageUp: 30, PageDown: -30 };
    if (Object.prototype.hasOwnProperty.call(offsets, event.key)) {
      event.preventDefault();
      seek(audio.currentTime + offsets[event.key]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      seek(event.key === 'Home' ? 0 : audio.duration);
    }
  });
  audio.controls = false;
  audio.preload = localMediaUrl(audio) ? 'none' : 'metadata';
  players.add(audio);
  actions.set(audio, { play: () => { if (audio.paused) return toggle(); }, pause: () => {
    if (starting) {
      // Native playing can precede resolution of play(). Preserve a factual
      // accepted pause before cancelling that still-pending start promise.
      if (!audio.paused) {
        measurement.pauseByUser();
        audio.pause();
        measurement.paused();
      }
      cancelStart?.();
    } else { measurement.pauseByUser(); audio.pause(); }
  } });
  showIcon(true);
  update();
}

export function initPlayers() {
  const initializedPlayers = new Set();
  const meta = document.querySelector('[tmplayer-meta="audio-url"]');
  const audioUrl = meta?.textContent.trim() || document.body.dataset.audioUrl || '';
  const mp3Url = document.documentElement.dataset.audioMp3 || '';
  const supportedUrl = audio => {
    // Prepared <source> types come from the approved audio inventory. A URL
    // without a known type is left to the native decoder, not guessed as Opus.
    const sources = [...audio.querySelectorAll('source[src]')];
    const candidates = [...new Set([audioUrl, mp3Url, audio.getAttribute('src'),
      ...sources.map(source => source.getAttribute('src'))].filter(Boolean))];
    return candidates.find(url => {
      const declared = sources.find(source => source.getAttribute('src') === url)?.getAttribute('type');
      const type = declared || (url === mp3Url || /\.mp3(?:[?#]|$)/i.test(url) ? 'audio/mpeg'
        : /\.(?:ogg|opus)(?:[?#]|$)/i.test(url) ? 'audio/ogg; codecs="opus"' : '');
      return !type || Boolean(audio.canPlayType(type));
    }) || '';
  };
  const title = document.querySelector('h1')?.textContent.trim() || '';
  const roots = [...document.querySelectorAll('.emtalk-audio-player')];
  roots.forEach(root => {
    const audio = root.querySelector('.emtalk-audio-player__control');
    const name = root.querySelector('.emtalk-player-ui__name');
    const selectedUrl = audio && supportedUrl(audio);
    if (selectedUrl && audio && assignAudioSource(audio, selectedUrl)) {
      if (localMediaUrl(audio)) audio.preload = 'none';
      else audio.load();
    }
    if (title && name) name.textContent = title;
    if (!selectedUrl) { root.hidden = true; return; }
    if (audio) audio.setAttribute('aria-label', title || 'Audio');
    initPlayer(root);
    if (players.has(audio)) initializedPlayers.add(audio);
  });
  // Retain source legacy selectors; CSS controls whether that player is visible.
  document.querySelectorAll('.sp-track-wrapper .audio-player').forEach(root => {
    const audio = root.querySelector('#audio-player');
    // The retained hidden source wrapper supplies metadata/fragment compatibility only.
    // Leave its native preload=none and controls untouched; visible legacy UIs still work.
    const retainedHidden = root.closest('.legacy-audio-player-hidden');
    if (retainedHidden && getComputedStyle(retainedHidden).display === 'none') return;
    const selectedUrl = audio && supportedUrl(audio);
    if (selectedUrl && audio) assignAudioSource(audio, selectedUrl);
    if (!selectedUrl) { root.hidden = true; return; }
    initPlayer(root, true);
    if (players.has(audio)) initializedPlayers.add(audio);
  });
  if (!initializedPlayers.size && ownsMediaSession && 'mediaSession' in navigator) {
    navigator.mediaSession.metadata = null;
    ownsMediaSession = false;
    try {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
    } catch { /* An unsupported OS action must not disable the page player. */ }
  }
  if (initializedPlayers.size && title && 'mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({ title });
    ownsMediaSession = true;
    const currentPlayer = () => {
      const visible = [...initializedPlayers].filter(audio => {
        const container = audio.closest('.emtalk-audio-player, .sp-track-wrapper .audio-player');
        if (audio.isConnected === false || !container || container.isConnected === false
            || !container.getClientRects().length) return false;
        for (let node = container; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (node.hidden || style.display === 'none' || style.visibility === 'hidden'
              || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
        }
        const box = container.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
      if (visible.includes(activePlayer)) return activePlayer;
      const recent = visible.filter(audio => playerActivity.has(audio))
        .sort((a, b) => playerActivity.get(b) - playerActivity.get(a))[0];
      // Without activity history, a single visible player is the only unambiguous fallback.
      return recent || (visible.length === 1 ? visible[0] : undefined);
    };
    try {
      navigator.mediaSession.setActionHandler('play', () => actions.get(currentPlayer())?.play());
      navigator.mediaSession.setActionHandler('pause', () => actions.get(currentPlayer())?.pause());
    } catch { /* An unsupported OS action must not disable the page player. */ }
  }
}
