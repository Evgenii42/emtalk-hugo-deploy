const players = new Set();
const actions = new Map();
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
  root.dataset.playerReady = 'true';
  root.dataset.playbackState = 'idle';
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
  let starting = false;
  // Ignore errors from an inactive cancelled load until the next explicit attempt.
  let cancelledStart = false;
  let cancelStart;
  const toggle = async event => {
    event?.preventDefault();
    markActive(audio);
    if (starting) { cancelStart?.(); return; }
    if (!audio.paused) {
      audio.pause();
      return;
    }
    starting = true;
    cancelledStart = false;
    root.dataset.playbackState = 'loading';
    button.setAttribute('aria-busy', 'true');
    setAction('cancel');
    showStatus('Loading audio...');
    let rejectLoad;
    let cancelled = false;
    const failed = new Promise((_, reject) => { rejectLoad = reject; });
    cancelStart = () => {
      cancelled = true;
      cancelledStart = true;
      audio.pause();
      rejectLoad(new DOMException('Playback cancelled', 'AbortError'));
    };
    const onError = () => rejectLoad(new Error('Media load failed'));
    audio.addEventListener('error', onError, { once: true });
    const loadTimeout = setTimeout(() => rejectLoad(new Error('Media load timed out')), 15000);
    try {
      // Retry after a failed load without changing the CMS/local media URL.
      if (audio.error) audio.load();
      // Promise.race observes rejections from both inputs, including a late losing play promise.
      await Promise.race([audio.play(), failed]);
    } catch {
      audio.pause();
      root.dataset.playbackState = cancelled ? 'paused' : 'error';
      // A rejected play attempt can fail without a MediaError (for example, playback policy).
      showStatus(cancelled ? '' : 'Audio could not start. Please try again.');
      showIcon(true);
    } finally {
      clearTimeout(loadTimeout);
      audio.removeEventListener('error', onError);
      starting = false;
      // A resolved play promise can win its race just before an explicit cancel.
      // Native paused state remains authoritative after pending callbacks settle.
      if (audio.paused && root.dataset.playbackState !== 'error') {
        root.dataset.playbackState = audio.ended ? 'ended' : 'paused';
        showStatus('');
      }
      cancelStart = null;
      button.removeAttribute('aria-busy');
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
    markActive(audio);
    for (const other of players) if (other !== audio && !other.paused) other.pause();
    showIcon(false);
    if (starting) setAction('cancel');
    root.dataset.playbackState = 'playing';
    showStatus('');
  });
  audio.addEventListener('playing', () => {
    root.dataset.playbackState = 'playing';
    showStatus('');
  });
  audio.addEventListener('pause', () => {
    if (starting) return;
    showIcon(true);
    if (!audio.error && root.dataset.playbackState !== 'error') root.dataset.playbackState = audio.ended ? 'ended' : 'paused';
    if (root.dataset.playbackState !== 'error') showStatus('');
  });
  audio.addEventListener('ended', () => {
    root.dataset.playbackState = 'ended';
    showIcon(true);
    update();
  });
  audio.addEventListener('waiting', () => {
    if (audio.paused) return;
    root.dataset.playbackState = 'loading';
    if (starting) setAction('cancel');
    showStatus('Loading audio...');
  });
  audio.addEventListener('error', () => {
    // Pending failures settle through toggle; a cancelled attempt is not a load error.
    if (starting || cancelledStart) return;
    root.dataset.playbackState = 'error';
    showIcon(true);
    showStatus('Audio could not load. Please try again.');
  });
  for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked']) audio.addEventListener(event, update);
  const seek = time => {
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
  audio.preload = 'metadata';
  players.add(audio);
  actions.set(audio, { play: () => { if (audio.paused) return toggle(); }, pause: () => starting ? cancelStart?.() : audio.pause() });
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
    if (selectedUrl && audio && audio.getAttribute('src') !== selectedUrl) {
      audio.src = selectedUrl;
      audio.load();
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
    if (selectedUrl && audio && audio.getAttribute('src') !== selectedUrl) audio.src = selectedUrl;
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
