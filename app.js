/* TrackTally: browser-only Spotify playlist quiz using OAuth 2.0 Authorization Code + PKCE. */
(function () {
  'use strict';








  // spotify.config.js may be blocked by privacy extensions or restrictive
  // browser policies. Keep the public PKCE client ID as a reliable fallback.
  // A Spotify client ID is intentionally public; never place a client secret here.
  const DEFAULT_CONFIG = {
    clientId: '4f5e3a37204446b683eecf6ccc47dff5',
    redirectUri: appRootUrl()
  };
  const CONFIG = {
    clientId: window.TRACKTALLY_CONFIG?.clientId || DEFAULT_CONFIG.clientId,
    // Always return to the page currently running the quiz. This avoids an old
    // cached config file sending users to a no-longer-registered redirect URI.
    redirectUri: DEFAULT_CONFIG.redirectUri
  };
  const PLACEHOLDER_ID = 'PASTE_YOUR_SPOTIFY_CLIENT_ID_HERE';
  const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-read-private', 'user-read-email', 'user-library-read', 'user-top-read', 'user-follow-read', 'streaming', 'user-modify-playback-state'];
  const GAME_SCOPES = ['streaming', 'user-modify-playback-state', 'user-library-read', 'user-top-read', 'user-follow-read'];
  const QUIZ_CLIP_MS = 10_000;
  const SPOTIFY_LOGIN_COOLDOWN_MS = 30_000;
  const SPOTIFY_LOGIN_COOLDOWN_KEY = 'tracktally_spotify_login_cooldown_until';
  const ROUND_TIME_MS = 10_000;
  const ROUND_TIMER_START_DELAY_MS = 1_000;
  const PLAYBACK_START_CHECK_INTERVAL_MS = 200;
  const PLAYBACK_START_CHECK_MAX_ATTEMPTS = 30;
  const LIKED_SONGS_VALUE = '__liked_songs__';
  const DEMO_TRACKS = [
    { name: 'Electric Summer', artists: [{ name: 'Neon Coast' }], album: { name: 'Poolside FM', images: [] }, preview_url: null, clue: 'Synthpop · 2024' },
    { name: 'Paper Moons', artists: [{ name: 'Mara Belle' }], album: { name: 'Late Checkout', images: [] }, preview_url: null, clue: 'Indie Pop · 2023' },
    { name: 'After the Rain', artists: [{ name: 'Sunday Arcade' }], album: { name: 'Warm Signals', images: [] }, preview_url: null, clue: 'Alternative · 2022' },
    { name: 'Disco Memory', artists: [{ name: 'Velvet City' }], album: { name: 'Twilight Drive', images: [] }, preview_url: null, clue: 'Nu Disco · 2024' },
    { name: 'Slow Motion', artists: [{ name: 'Atlas Bloom' }], album: { name: 'Golden Hour', images: [] }, preview_url: null, clue: 'Dream Pop · 2021' },
    { name: 'Blue Hour', artists: [{ name: 'The Glass Comet' }], album: { name: 'Night Tapes', images: [] }, preview_url: null, clue: 'Electronic · 2025' },
    { name: 'Last Train Home', artists: [{ name: 'Cedar Lane' }], album: { name: 'Westbound', images: [] }, preview_url: null, clue: 'Folk Rock · 2020' },
    { name: 'Tiny Revolutions', artists: [{ name: 'Cassette Club' }], album: { name: 'Small Rooms', images: [] }, preview_url: null, clue: 'Garage Pop · 2023' }
  ];








  const $ = (selector) => document.querySelector(selector);
  const elements = {
    setup: $('#setupPanel'), setupTitle: $('#setupTitle'), setupDescription: $('#setupDescription'), authState: $('#authState'), artistBrowser: $('#artistBrowser'), artistSearch: $('#artistSearch'), artistSearchResults: $('#artistSearchResults'), artistRecommendations: $('#artistRecommendations'), artistPickerStatus: $('#artistPickerStatus'), artistConnect: $('#artistConnectButton'), playlistControl: $('#playlistControl'), playlistSelect: $('#playlistSelect'), playlistPicker: $('#playlistPicker'), playlistPickerTrigger: $('#playlistPickerTrigger'), playlistPickerCover: $('#playlistPickerCover'), playlistPickerName: $('#playlistPickerName'), playlistPickerMeta: $('#playlistPickerMeta'), playlistPickerMenu: $('#playlistPickerMenu'), connectionNotice: $('#connectionNotice'), connect: $('#connectButton'), headerConnect: $('#headerConnect'), heroConnect: $('#heroConnect'), legacyHeroConnect: $('#legacyHeroConnect'), demo: $('#demoStart'), startPlaylist: $('#startPlaylistGame'), game: $('#gameShell'), results: $('#resultCard'), audio: $('#previewAudio'), play: $('#playPreview'), volume: $('#volumeRange'), waveform: $('#waveform'), time: $('#previewTime'), answers: $('#answerGrid'), feedback: $('#answerFeedback'), next: $('#nextQuestion'), round: $('#roundCounter'), score: $('#score'), streak: $('#streak'), correct: $('#correctCount'), bestStreak: $('#bestStreak'), clue: $('#trackClue'), vinyl: $('#trackVisual')?.querySelector('.vinyl'), leave: $('#leaveGame'), share: $('#shareGame'), playAgain: $('#playAgain'), backToSetup: $('#backToSetup'), modal: $('#configModal'), closeModal: $('#closeModal'), redirect: $('#redirectUri'), copyRedirect: $('#copyRedirect'), resultTitle: $('#resultTitle'), resultCopy: $('#resultCopy'), finalScore: $('#finalScore'), roundSummary: $('#roundSummary')
  };
  const timerElements = { value: $('#roundTimer'), meter: $('#roundTimerMeter') };
  let game = { mode: 'demo', allTracks: [], questions: [], index: 0, score: 0, correct: 0, streak: 0, bestStreak: 0, answered: false, rounds: 10 };
  let audioContext;
  let webPlayer;
  let webPlayerDeviceId;
  let webPlayerReady;
  let webPlaybackActivated = false;
  let spotifyPlaying = false;
  let roundTimerId;
  let roundTimerStartId;
  let playbackStartCheckId;
  let pendingRoundTimerTrack;
  let playbackVolume = Math.max(0, Math.min(1, Number(localStorage.getItem('tracktally_volume') ?? 65) / 100));
  const artistGenreCache = new Map();
  let artistQuizStarting = false;
  let playlistQuizStarting = false;
  let playlistSources = [];
  let artistPickerPlayerReady = false;
  let artistSearchDebounceId;
  let artistSearchRequestId = 0;








  function appRootUrl() {
    const path = window.location.pathname;
    const rootPath = /\/[^/]+\.[^/]+$/.test(path) ? path.slice(0, path.lastIndexOf('/') + 1) : path;
    return window.location.origin + rootPath;
  }
  function playPageUrl(artistId = '', playlistId = '', quizType = '') {
    const url = new URL('play.html', appRootUrl());
    if (artistId) url.searchParams.set('artist', artistId);
    if (playlistId) url.searchParams.set('playlist', playlistId);
    if (quizType) url.searchParams.set('type', quizType);
    return url.href;
  }
  function gameModePageUrl() { return new URL('mode.html', appRootUrl()).href; }
  function artistIdFromUrl() { return new URLSearchParams(window.location.search).get('artist') || ''; }
  function playlistIdFromUrl() { return new URLSearchParams(window.location.search).get('playlist') || ''; }
  function quizTypeFromUrl() {
    const type = new URLSearchParams(window.location.search).get('type');
    return ['artist', 'playlist', 'liked'].includes(type) ? type : 'playlist';
  }
  function redirectUri() { return CONFIG.redirectUri || appRootUrl(); }
  function openGameModePage() { window.location.assign(gameModePageUrl()); }
  function openArtistQuiz(artistId) { window.location.assign(playPageUrl(artistId)); }
  function openPlaylistQuiz(playlistId) { window.location.assign(playPageUrl('', playlistId)); }
  function configured() { return CONFIG.clientId && CONFIG.clientId !== PLACEHOLDER_ID; }
  function tokenData() { try { return JSON.parse(sessionStorage.getItem('tracktally_token') || 'null'); } catch { return null; } }
  function setToken(data) { sessionStorage.setItem('tracktally_token', JSON.stringify(data)); }
  function shuffle(items) { return [...items].sort(() => Math.random() - .5); }
  function cleanUrl() { history.replaceState({}, document.title, window.location.pathname); }
  function isDemo() { return game.mode === 'demo'; }
  function hasGameScopes() {
    const scopes = (tokenData()?.scope || '').split(' ');
    return GAME_SCOPES.every(scope => scopes.includes(scope));
  }








  function makeWave() {
    if (!elements.waveform) return;
    elements.waveform.innerHTML = Array.from({ length: 58 }, (_, i) => `<i style="height:${5 + ((i * 17 + 11) % 24)}px"></i>`).join('');
  }
  function showGameMessage(message) {
    if (!elements.game || elements.game.classList.contains('hidden') || !elements.clue) return false;
    elements.clue.textContent = message;
    elements.clue.style.color = '#f07895';
    return true;
  }
  function requirePlaybackActivation(message = 'Klicke einmal auf Wiedergabe, um Audio in diesem Browser zu aktivieren.') {
    webPlaybackActivated = false;
    spotifyPlaying = false;
    pendingRoundTimerTrack = undefined;
    clearRoundTimer();
    elements.answers?.querySelectorAll('.answer').forEach(button => { button.disabled = true; });
    if (elements.play) {
      elements.play.disabled = false;
      elements.play.classList.remove('pause');
      elements.play.setAttribute('aria-label', 'Wiedergabe im Browser aktivieren');
    }
    elements.vinyl?.classList.remove('playing');
    elements.waveform?.classList.remove('playing');
    showGameMessage(message);
  }
  function clearRoundTimer() {
    clearInterval(roundTimerId);
    clearTimeout(roundTimerStartId);
    clearTimeout(playbackStartCheckId);
    roundTimerId = undefined;
    roundTimerStartId = undefined;
    playbackStartCheckId = undefined;
  }
  function updateRoundTimer(remaining) {
    if (!timerElements.value || !timerElements.meter) return;
    const seconds = Math.max(0, remaining / 1000); const displayTime = seconds.toFixed(1); const progress = Math.max(0, Math.min(1, remaining / ROUND_TIME_MS)); timerElements.value.textContent = displayTime;
    timerElements.meter.style.setProperty("--timer-hue", String(Math.round(progress * 120)));
    timerElements.meter.setAttribute('aria-label', `Verbleibende Zeit: ${displayTime} Sekunden`);
  }
  function startRoundTimer() {
    clearRoundTimer();
    game.roundStartedAt = Date.now();
    elements.answers.querySelectorAll('.answer').forEach(button => { button.disabled = false; });
    const deadline = game.roundStartedAt + ROUND_TIME_MS;
    updateRoundTimer(ROUND_TIME_MS);
    roundTimerId = setInterval(() => {
      const remaining = Math.max(0, deadline - Date.now());
      updateRoundTimer(remaining);
      if (remaining === 0) { clearRoundTimer(); timeExpired(); }
    }, 100);
  }
  function scheduleRoundTimerStart(track) {
    clearRoundTimer();
    roundTimerStartId = window.setTimeout(() => {
      roundTimerStartId = undefined;
      if (!game.answered && game.questions[game.index] === track) startRoundTimer();
    }, ROUND_TIMER_START_DELAY_MS);
  }
  function isExpectedTrackPlaying(state, track) {
    return Boolean(state && !state.paused && track && state.track_window?.current_track?.uri === track.uri && !game.answered && game.questions[game.index] === track);
  }
  function confirmRoundPlayback(track, state) {
    if (pendingRoundTimerTrack !== track || !isExpectedTrackPlaying(state, track)) return false;
    pendingRoundTimerTrack = undefined;
    clearTimeout(playbackStartCheckId);
    playbackStartCheckId = undefined;
    scheduleRoundTimerStart(track);
    return true;
  }
  async function checkRoundPlaybackStart(track, attempt = 0) {
    if (pendingRoundTimerTrack !== track || game.answered || game.questions[game.index] !== track) return;
    try {
      const state = await webPlayer?.getCurrentState?.();
      if (confirmRoundPlayback(track, state)) return;
    } catch {
      // The listener remains the primary path; this check only covers a missed event.
    }
    if (pendingRoundTimerTrack !== track) return;
    if (attempt >= PLAYBACK_START_CHECK_MAX_ATTEMPTS) {
      requirePlaybackActivation('Der Song konnte nicht zuverlässig gestartet werden. Klicke auf Wiedergabe, um die Runde fortzusetzen.');
      return;
    }
    playbackStartCheckId = window.setTimeout(() => { void checkRoundPlaybackStart(track, attempt + 1); }, PLAYBACK_START_CHECK_INTERVAL_MS);
  }
  function setRounds(value) {
    game.rounds = Number(value);
    document.querySelectorAll('[data-rounds]').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.rounds) === game.rounds));
  }
  function setPlaybackVolume(value) {
    playbackVolume = Math.max(0, Math.min(1, Number(value) / 100));
    localStorage.setItem('tracktally_volume', String(Math.round(playbackVolume * 100)));
    if (elements.volume) elements.volume.value = String(Math.round(playbackVolume * 100));
    if (elements.audio) elements.audio.volume = playbackVolume;
    if (webPlayer) webPlayer.setVolume(playbackVolume).catch(() => {});
  }
  document.querySelectorAll('[data-rounds]').forEach(btn => btn.addEventListener('click', () => setRounds(btn.dataset.rounds)));








  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return [...bytes].map(byte => characters[byte % characters.length]).join('');
  }
  let spotifyLoginCooldownTimer;
  function spotifyLoginCooldownRemaining() {
    const cooldownUntil = Number(localStorage.getItem(SPOTIFY_LOGIN_COOLDOWN_KEY));
    return Number.isFinite(cooldownUntil) ? Math.max(0, cooldownUntil - Date.now()) : 0;
  }
  function syncSpotifyLoginCooldownButton() {
    const remainingMs = spotifyLoginCooldownRemaining();
    if (!elements.headerConnect) return remainingMs > 0;
    window.clearTimeout(spotifyLoginCooldownTimer);
    if (!remainingMs) {
      localStorage.removeItem(SPOTIFY_LOGIN_COOLDOWN_KEY);
      elements.headerConnect.disabled = false;
      elements.headerConnect.removeAttribute('aria-label');
      if (elements.headerConnect.dataset.spotifyCooldownLabel) {
        elements.headerConnect.textContent = elements.headerConnect.dataset.spotifyCooldownLabel;
        delete elements.headerConnect.dataset.spotifyCooldownLabel;
      }
      return false;
    }
    if (!elements.headerConnect.dataset.spotifyCooldownLabel) {
      elements.headerConnect.dataset.spotifyCooldownLabel = elements.headerConnect.textContent;
    }
    const seconds = Math.ceil(remainingMs / 1000);
    elements.headerConnect.disabled = true;
    elements.headerConnect.textContent = `Bitte warten (${seconds} s)`;
    elements.headerConnect.setAttribute('aria-label', `Bitte noch ${seconds} Sekunden warten`);
    spotifyLoginCooldownTimer = window.setTimeout(syncSpotifyLoginCooldownButton, Math.min(1000, remainingMs));
    return true;
  }
  function startSpotifyLoginCooldown() {
    localStorage.setItem(SPOTIFY_LOGIN_COOLDOWN_KEY, String(Date.now() + SPOTIFY_LOGIN_COOLDOWN_MS));
    syncSpotifyLoginCooldownButton();
  }
  function clearSpotifyLoginCooldown() {
    localStorage.removeItem(SPOTIFY_LOGIN_COOLDOWN_KEY);
    window.clearTimeout(spotifyLoginCooldownTimer);
  }
  async function beginSpotifyLogin({ useCooldown = false } = {}) {
    if (!configured()) return showConfigModal();
    if (useCooldown && syncSpotifyLoginCooldownButton()) return;
    if (useCooldown) startSpotifyLoginCooldown();
    if (window.location.pathname.endsWith('/play.html')) {
      sessionStorage.setItem('tracktally_return_to_play', 'true');
      const artistId = artistIdFromUrl();
      if (artistId) sessionStorage.setItem('tracktally_artist_quiz', artistId);
      else sessionStorage.removeItem('tracktally_artist_quiz');
      const playlistId = playlistIdFromUrl();
      if (playlistId) sessionStorage.setItem('tracktally_playlist_quiz', playlistId);
      else sessionStorage.removeItem('tracktally_playlist_quiz');
      sessionStorage.setItem('tracktally_quiz_type', quizTypeFromUrl());
    } else {
      sessionStorage.removeItem('tracktally_return_to_play');
      sessionStorage.removeItem('tracktally_artist_quiz');
      sessionStorage.removeItem('tracktally_playlist_quiz');
      sessionStorage.removeItem('tracktally_quiz_type');
    }
    const verifier = randomString(96), state = randomString(22), challenge = await sha256(verifier);
    sessionStorage.setItem('tracktally_verifier', verifier);
    sessionStorage.setItem('tracktally_state', state);
    const params = new URLSearchParams({ client_id: CONFIG.clientId, response_type: 'code', redirect_uri: redirectUri(), code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPES.join(' ') });
    window.location.assign(`https://accounts.spotify.com/authorize?${params}`);
  }
  async function handleAuthorizationReturn() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code'), state = params.get('state'), error = params.get('error');
    if (!code && !error) return false;
    if (error) { sessionStorage.removeItem('tracktally_return_to_play'); sessionStorage.removeItem('tracktally_artist_quiz'); sessionStorage.removeItem('tracktally_playlist_quiz'); sessionStorage.removeItem('tracktally_quiz_type'); showMessage(`Spotify-Login abgebrochen: ${error}.`); cleanUrl(); return true; }
    if (state !== sessionStorage.getItem('tracktally_state')) { showMessage('Der Spotify-Login konnte aus Sicherheitsgründen nicht bestätigt werden. Bitte erneut versuchen.'); cleanUrl(); return true; }
    try {
      const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CONFIG.clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: sessionStorage.getItem('tracktally_verifier') || '' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || data.error || 'Token konnte nicht geladen werden');
      clearSpotifySessionCache();
      setToken({ ...data, expires_at: Date.now() + data.expires_in * 1000 });
      clearSpotifyLoginCooldown();
      const returnToPlay = sessionStorage.getItem('tracktally_return_to_play') === 'true';
      const artistQuizId = sessionStorage.getItem('tracktally_artist_quiz') || '';
      const playlistQuizId = sessionStorage.getItem('tracktally_playlist_quiz') || '';
      const quizType = sessionStorage.getItem('tracktally_quiz_type') || '';
      sessionStorage.removeItem('tracktally_return_to_play');
      sessionStorage.removeItem('tracktally_artist_quiz');
      sessionStorage.removeItem('tracktally_playlist_quiz');
      sessionStorage.removeItem('tracktally_quiz_type');
      cleanUrl();
      if (returnToPlay && !window.location.pathname.endsWith('/play.html')) { window.location.replace(playPageUrl(artistQuizId, playlistQuizId, quizType)); return true; }
      await loadSpotifyProfile();
    } catch (error) { showMessage(`Spotify-Verbindung fehlgeschlagen: ${error.message}`); cleanUrl(); }
    return true;
  }
  let spotifyTokenRefreshInFlight;


  async function freshToken() {
    const data = tokenData();
    if (!data) return null;
    if (data.expires_at > Date.now() + 30_000) return data.access_token;
    if (!data.refresh_token || !configured()) return null;
    if (spotifyTokenRefreshInFlight) return spotifyTokenRefreshInFlight;


    spotifyTokenRefreshInFlight = (async () => {
      const latest = tokenData();
      if (!latest || !latest.refresh_token || !configured()) return null;
      if (latest.expires_at > Date.now() + 30_000) return latest.access_token;


      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CONFIG.clientId,
          grant_type: 'refresh_token',
          refresh_token: latest.refresh_token
        })
      });
      const next = await response.json();
      if (!response.ok) {
        sessionStorage.removeItem('tracktally_token');
        return null;
      }
      const refreshed = { ...latest, ...next, expires_at: Date.now() + next.expires_in * 1000 };
      setToken(refreshed);
      return refreshed.access_token;
    })();


    try {
      return await spotifyTokenRefreshInFlight;
    } finally {
      spotifyTokenRefreshInFlight = undefined;
    }
  }


  const SPOTIFY_REQUEST_GAP_MS = 400;
  const SPOTIFY_RATE_LIMIT_KEY = 'tracktally_spotify_api_retry_until';
  const SPOTIFY_SESSION_CACHE_PREFIX = 'tracktally_spotify_api_cache:';
  const SPOTIFY_CACHE_TTL = Object.freeze({
    profile: 30 * 60_000,
    playlists: 10 * 60_000,
    userArtists: 60 * 60_000,
    savedTracks: 5 * 60_000,
    playlistTracks: 5 * 60_000,
    artist: 24 * 60 * 60_000,
    artistAlbums: 6 * 60 * 60_000,
    albumTracks: 24 * 60 * 60_000
  });


  const spotifyResponseCache = new Map();
  const spotifyInFlightRequests = new Map();
  let spotifyRequestQueue = Promise.resolve();
  let spotifyNextRequestAt = 0;
  let spotifyRateLimitUntil = Number(sessionStorage.getItem(SPOTIFY_RATE_LIMIT_KEY)) || 0;


  function waitForSpotify(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }


  function spotifyRequestMethod(options = {}) {
    return (options.method || 'GET').toUpperCase();
  }


  function spotifyRequestKey(path, options = {}) {
    const body = options.body ? JSON.stringify(options.body) : '';
    return [spotifyRequestMethod(options), path, body].join(' ');
  }


  function spotifyCacheTtl(path, options = {}) {
    if (spotifyRequestMethod(options) !== 'GET') return 0;
    const resource = path.split('?')[0];
    if (resource === '/me') return SPOTIFY_CACHE_TTL.profile;
    if (resource === '/me/playlists') return SPOTIFY_CACHE_TTL.playlists;
    if (resource === '/me/top/artists' || resource === '/me/following') return SPOTIFY_CACHE_TTL.userArtists;
    if (resource === '/me/tracks') return SPOTIFY_CACHE_TTL.savedTracks;
    if (/^\/playlists\/[^/]+\/(items|tracks)$/.test(resource)) return SPOTIFY_CACHE_TTL.playlistTracks;
    if (resource === '/artists') return SPOTIFY_CACHE_TTL.artist;
    if (/^\/artists\/[^/]+$/.test(resource)) return SPOTIFY_CACHE_TTL.artist;
    if (/^\/artists\/[^/]+\/albums$/.test(resource)) return SPOTIFY_CACHE_TTL.artistAlbums;
    if (/^\/albums\/[^/]+\/tracks$/.test(resource)) return SPOTIFY_CACHE_TTL.albumTracks;
    return 0;
  }


  function spotifyPersistentCacheKey(path, options = {}) {
    if (spotifyRequestMethod(options) !== 'GET') return '';
    const resource = path.split('?')[0];
    const isSmallHomeResponse = resource === '/me' || resource === '/me/playlists' || resource === '/me/top/artists' || resource === '/me/following';
    return isSmallHomeResponse ? SPOTIFY_SESSION_CACHE_PREFIX + spotifyRequestKey(path, options) : '';
  }


  function clearSpotifySessionCache() {
    spotifyResponseCache.clear();
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(SPOTIFY_SESSION_CACHE_PREFIX)) sessionStorage.removeItem(key);
      }
    } catch { /* Session-Speicher ist optional. */ }
  }


  function readSpotifyCache(key, persistentKey = '') {
    const memoryEntry = spotifyResponseCache.get(key);
    if (memoryEntry) {
      if (memoryEntry.expiresAt > Date.now()) return memoryEntry.value;
      spotifyResponseCache.delete(key);
    }
    if (!persistentKey) return undefined;
    try {
      const storedEntry = JSON.parse(sessionStorage.getItem(persistentKey) || 'null');
      if (!storedEntry || typeof storedEntry.expiresAt !== 'number' || storedEntry.expiresAt <= Date.now()) {
        sessionStorage.removeItem(persistentKey);
        return undefined;
      }
      spotifyResponseCache.set(key, storedEntry);
      return storedEntry.value;
    } catch {
      sessionStorage.removeItem(persistentKey);
      return undefined;
    }
  }


  function writeSpotifyCache(key, value, ttl, persistentKey = '') {
    if (ttl <= 0) return;
    const entry = { value, expiresAt: Date.now() + ttl };
    spotifyResponseCache.set(key, entry);
    if (!persistentKey) return;
    try { sessionStorage.setItem(persistentKey, JSON.stringify(entry)); } catch { /* Speichern ist optional. */ }
  }


  function activeSpotifyRateLimitUntil() {
    const stored = Number(sessionStorage.getItem(SPOTIFY_RATE_LIMIT_KEY)) || 0;
    spotifyRateLimitUntil = Math.max(spotifyRateLimitUntil, stored);
    if (spotifyRateLimitUntil <= Date.now()) {
      spotifyRateLimitUntil = 0;
      sessionStorage.removeItem(SPOTIFY_RATE_LIMIT_KEY);
    }
    return spotifyRateLimitUntil;
  }


  function setSpotifyRateLimit(retryAfterMs) {
    spotifyRateLimitUntil = Date.now() + retryAfterMs;
    spotifyNextRequestAt = Math.max(spotifyNextRequestAt, spotifyRateLimitUntil);
    sessionStorage.setItem(SPOTIFY_RATE_LIMIT_KEY, String(spotifyRateLimitUntil));
  }


  function spotifyRateLimitError(until, reason = '') {
    const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    const error = new Error('Spotify begrenzt die Anfragen gerade. Bitte versuche es in ' + seconds + ' Sekunden erneut.');
    error.name = 'SpotifyRateLimitError';
    error.status = 429;
    error.retryAfterMs = Math.max(0, until - Date.now());
    error.reason = reason;
    return error;
  }


  function queueSpotifyRequest(request) {
    const run = async () => {
      const waitMs = Math.max(0, spotifyNextRequestAt - Date.now());
      if (waitMs) await waitForSpotify(waitMs);
      try {
        return await request();
      } finally {
        spotifyNextRequestAt = Math.max(spotifyNextRequestAt, Date.now() + SPOTIFY_REQUEST_GAP_MS);
      }
    };
    const queued = spotifyRequestQueue.then(run, run);
    spotifyRequestQueue = queued.catch(() => {});
    return queued;
  }


  async function executeSpotifyRequest(path, options = {}) {
    const blockedUntil = activeSpotifyRateLimitUntil();
    if (blockedUntil > Date.now()) throw spotifyRateLimitError(blockedUntil);


    const response = await queueSpotifyRequest(async () => {
      const token = await freshToken();
      if (!token) throw new Error('Deine Spotify-Sitzung ist abgelaufen. Bitte erneut verbinden.');
      const headers = { Authorization: 'Bearer ' + token, ...(options.headers || {}) };
      if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      return fetch('https://api.spotify.com/v1' + path, {
        ...options,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    });


    if (response.status === 429) {
      const data = await response.json().catch(() => ({}));
      const retryAfterSeconds = Number(response.headers.get('Retry-After'));
      const retryAfterMs = Math.max(1000, Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 2000);
      setSpotifyRateLimit(retryAfterMs);
      const reason = data.error?.reason || data.reason || '';
      throw spotifyRateLimitError(spotifyRateLimitUntil, reason);
    }


    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error?.message || 'Spotify hat die Anfrage abgelehnt.');
      error.status = response.status;
      throw error;
    }


    return response.status === 204 ? null : response.json();
  }


  async function spotifyFetch(path) {
    return spotifyRequest(path);
  }


  async function spotifyRequest(path, options = {}) {
    const key = spotifyRequestKey(path, options);
    const ttl = spotifyCacheTtl(path, options);
    const persistentKey = spotifyPersistentCacheKey(path, options);
    const cached = readSpotifyCache(key, persistentKey);
    if (cached !== undefined) return cached;


    const running = spotifyInFlightRequests.get(key);
    if (running) return running;


    const request = executeSpotifyRequest(path, options).then(value => {
      writeSpotifyCache(key, value, ttl, persistentKey);
      return value;
    });
    spotifyInFlightRequests.set(key, request);


    try {
      return await request;
    } finally {
      spotifyInFlightRequests.delete(key);
    }
  }


  let spotifyProfileLoadInFlight;


  async function loadSpotifyProfile() {
    if (spotifyProfileLoadInFlight) return spotifyProfileLoadInFlight;


    spotifyProfileLoadInFlight = (async () => {
      try {
        if (isArtistPickerPage()) setArtistPickerStatus('Deine Spotify-Daten werden geladen …');
        else if (elements.setupDescription) showMessage('Deine Spotify-Startseite wird geladen …');
        else showHomeNotice('Deine Spotify-Startseite wird geladen …');
        const profile = await spotifyFetch('/me');
        let playlistError;
        const playlists = await spotifyFetch('/me/playlists?limit=50').catch(error => { playlistError = error; return { items: [] }; });
        let topArtists = { items: [] };
        let followedArtists = { artists: { items: [] } };
        const isQuizPage = window.location.pathname.endsWith('/play.html');
        const needsArtists = !isQuizPage || (quizTypeFromUrl() === 'artist' && !artistIdFromUrl());


        if (needsArtists) {
          [topArtists, followedArtists] = await Promise.all([
            spotifyFetch('/me/top/artists?limit=10&time_range=medium_term').catch(() => ({ items: [] })),
            spotifyFetch('/me/following?type=artist&limit=10').catch(() => ({ artists: { items: [] } }))
          ]);
        }


        const items = playlists.items || [];
        const artists = [...(topArtists.items || []), ...(followedArtists.artists?.items || [])];
        const uniqueArtists = [...new Map(artists.map(artist => [artist.id, artist])).values()];
        renderConnected(profile, items, uniqueArtists, topArtists.items || []);
        if (playlistError) showHomeNotice(`Spotify ist verbunden, aber deine Playlists konnten nicht geladen werden: ${playlistError.message}`, 'error');
        const artistId = artistIdFromUrl();
        const playlistId = playlistIdFromUrl();
        if (artistId && isQuizPage) void startArtistQuiz(artistId);
        else if (playlistId && isQuizPage) void startPlaylistQuiz(playlistId);
      } catch (error) { showMessage(error.message); }
    })();


    try {
      return await spotifyProfileLoadInFlight;
    } finally {
      spotifyProfileLoadInFlight = undefined;
    }
  }
  function renderConnected(profile, playlists, artists = [], recommendedArtists = artists) {
    if (elements.authState) elements.authState.innerHTML = `<span class="spotify-pulse" aria-hidden="true">✓</span><div><strong>Verbunden als ${escapeHtml(profile.display_name || 'Spotify-Hörer:in')}</strong><small>${playlists.length} Playlist${playlists.length === 1 ? '' : 's'} verfügbar</small></div>`;
    if (elements.headerConnect) { elements.headerConnect.textContent = '✓ Verbunden'; elements.headerConnect.classList.remove('connection-error'); elements.headerConnect.classList.add('connected'); elements.headerConnect.disabled = true; elements.headerConnect.setAttribute('aria-label', 'Spotify ist verbunden'); }
    hideHomeNotice();
    const quizType = quizTypeFromUrl();
    if (elements.setupDescription) {
      elements.setupDescription.textContent = quizType === 'artist' ? 'Wähle einen Artist für deine nächste Runde.' : quizType === 'liked' ? 'Deine gespeicherten Songs sind für die nächste Runde bereit.' : 'Wähle eine Playlist für die nächste Runde.';
    }
    elements.playlistControl?.classList.remove('disabled'); if (elements.playlistSelect) elements.playlistSelect.disabled = false; if (elements.playlistPickerTrigger) elements.playlistPickerTrigger.disabled = false;
    // Spotify now exposes the count through `items` and retains `tracks` only
    // for older API responses. Support both so valid playlists are not shown
    // as empty in the selector.
    playlistSources = [
      { id: LIKED_SONGS_VALUE, name: 'Meine Lieblingssongs', meta: 'Deine gespeicherten Titel', imageUrl: '', liked: true },
      ...playlists.map(item => {
        const trackTotal = item.items?.total ?? item.tracks?.total ?? 0;
        return { id: item.id, name: item.name, meta: `${item.owner?.display_name || 'Spotify'} · ${trackTotal} Songs`, imageUrl: item.images?.[0]?.url || '', liked: false };
      })
    ];
    if (elements.playlistSelect) elements.playlistSelect.innerHTML = playlistSources.map(source => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.name)} · ${escapeHtml(source.meta)}</option>`).join('');
    renderPlaylistPicker();
    if (quizType === 'liked') selectPlaylistSource(LIKED_SONGS_VALUE);
    if (quizType === 'artist') {
      artistPickerPlayerReady = Boolean(webPlayerDeviceId) || !hasGameScopes();
      renderArtistRecommendations(recommendedArtists.length ? recommendedArtists : artists);
      if (artistPickerPlayerReady) setArtistPickerControlsDisabled(false);
    }
    renderHomeCollections(playlists, artists);
    elements.connect?.classList.add('hidden'); elements.artistConnect?.classList.add('hidden');
    if (quizType === 'artist') elements.startPlaylist?.classList.add('hidden');
    else elements.startPlaylist?.classList.remove('hidden');
    if (window.location.pathname.endsWith('/play.html') && hasGameScopes()) void warmUpWebPlaybackForPlaylistStart();
  }
  function coverMarkup(imageUrl, fallback) {
    return imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" />` : `<span>${escapeHtml(fallback)}</span>`;
  }
  function playlistPickerCoverMarkup(source) {
    return source.imageUrl ? `<img src="${escapeHtml(source.imageUrl)}" alt="" loading="lazy" />` : `<span class="${source.liked ? 'liked-playlist-icon' : ''}">${source.liked ? '♥' : '♪'}</span>`;
  }
  function closePlaylistPicker() {
    if (!elements.playlistPickerMenu || !elements.playlistPickerTrigger) return;
    elements.playlistPickerMenu.hidden = true;
    elements.playlistPickerTrigger.setAttribute('aria-expanded', 'false');
  }
  function selectPlaylistSource(id) {
    const source = playlistSources.find(item => item.id === id) || playlistSources[0];
    if (!source) return;
    if (elements.playlistSelect) elements.playlistSelect.value = source.id;
    if (elements.playlistPickerCover) elements.playlistPickerCover.innerHTML = playlistPickerCoverMarkup(source);
    if (elements.playlistPickerName) elements.playlistPickerName.textContent = source.name;
    if (elements.playlistPickerMeta) elements.playlistPickerMeta.textContent = source.meta;
    elements.playlistPickerMenu?.querySelectorAll('[data-playlist-source]').forEach(option => {
      const selected = option.dataset.playlistSource === source.id;
      option.classList.toggle('selected', selected);
      option.setAttribute('aria-selected', String(selected));
    });
  }
  function renderPlaylistPicker() {
    if (!elements.playlistPickerMenu) return;
    elements.playlistPickerMenu.innerHTML = playlistSources.map(source => `<button class="playlist-picker-option" type="button" role="option" data-playlist-source="${escapeHtml(source.id)}"><span class="playlist-option-cover" aria-hidden="true">${playlistPickerCoverMarkup(source)}</span><span class="playlist-option-copy"><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.meta)}</small></span><span class="playlist-option-check" aria-hidden="true">✓</span></button>`).join('');
    selectPlaylistSource(elements.playlistSelect?.value || playlistSources[0]?.id);
  }
  function renderHomeCollections(playlists, artists) {
    const artistsRail = $('#artistsRail'); const playlistsRail = $('#playlistsRail');
    if (artistsRail) {
      artistsRail.innerHTML = artists.length ? artists.slice(0, 10).map(artist => `<button class="media-card user-media-card artist-launch" type="button" data-artist-id="${escapeHtml(artist.id)}" aria-label="Quiz mit Songs von ${escapeHtml(artist.name)} starten"><div class="tile-art user-cover">${coverMarkup(artist.images?.[0]?.url, '♪')}</div><div class="tile-copy"><strong>${escapeHtml(artist.name)}</strong><small>${escapeHtml((artist.genres || []).slice(0, 2).join(' · ') || 'Artist-Quiz starten')}</small></div><span class="artist-launch-hint" aria-hidden="true">Quiz starten →</span></button>`).join('') : '<article class="media-card empty-media-card"><div class="tile-art user-cover"><span>♫</span></div><div class="tile-copy"><strong>Noch keine Artists</strong><small>Nach dem erneuten Verbinden erscheinen sie hier.</small></div></article>';
      artistsRail.querySelectorAll('[data-artist-id]').forEach(card => card.addEventListener('click', () => openArtistQuiz(card.dataset.artistId)));
    }
    if (playlistsRail) {
      playlistsRail.innerHTML = playlists.length ? playlists.slice(0, 10).map(playlist => `<button class="media-card user-media-card playlist-launch" type="button" data-playlist-id="${escapeHtml(playlist.id)}" aria-label="Quiz mit der Playlist ${escapeHtml(playlist.name)} starten"><div class="tile-art user-cover">${coverMarkup(playlist.images?.[0]?.url, '♪')}</div><div class="tile-copy"><strong>${escapeHtml(playlist.name)}</strong><small>${escapeHtml(playlist.owner?.display_name || 'Spotify')} · ${playlist.items?.total ?? playlist.tracks?.total ?? 0} Songs</small></div><span class="playlist-launch-hint" aria-hidden="true">Quiz starten →</span></button>`).join('') : '<article class="media-card empty-media-card"><div class="tile-art user-cover"><span>♪</span></div><div class="tile-copy"><strong>Noch keine Playlists</strong><small>Gespeicherte Playlists erscheinen hier.</small></div></article>';
      playlistsRail.querySelectorAll('[data-playlist-id]').forEach(card => card.addEventListener('click', () => openPlaylistQuiz(card.dataset.playlistId)));
    }
    requestAnimationFrame(refreshHomeRailNavigation);
  }
  function setupRailNavigation(railId, previousId, nextId) {
    const rail = $(`#${railId}`); const previous = $(`#${previousId}`); const next = $(`#${nextId}`);
    if (!rail || !previous || !next) return;
    const updateBounds = () => {
      const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
      previous.hidden = max === 0 || rail.scrollLeft <= 2;
      next.hidden = max === 0 || rail.scrollLeft >= max - 2;
    };
    if (!rail.dataset.navigationBound) {
      const scrollByPage = direction => rail.scrollBy({ left: direction * Math.max(260, Math.round(rail.clientWidth * .82)), behavior: 'smooth' });
      previous.addEventListener('click', () => scrollByPage(-1));
      next.addEventListener('click', () => scrollByPage(1));
      rail.addEventListener('scroll', updateBounds, { passive: true });
      window.addEventListener('resize', updateBounds, { passive: true });
      rail.dataset.navigationBound = 'true';
    }
    updateBounds();
  }
  function refreshHomeRailNavigation() {
    setupRailNavigation('artistsRail', 'artistsRailPrevious', 'artistsRailNext');
    setupRailNavigation('playlistsRail', 'playlistsRailPrevious', 'playlistsRailNext');
  }
  function escapeHtml(value) { const temp = document.createElement('span'); temp.textContent = value; return temp.innerHTML; }
  function isArtistPickerPage() { return quizTypeFromUrl() === 'artist' && Boolean(elements.artistBrowser); }
  function setArtistPickerStatus(message, type = 'info') {
    if (!elements.artistPickerStatus) return;
    elements.artistPickerStatus.textContent = message;
    elements.artistPickerStatus.classList.toggle('error', type === 'error');
  }
  function setArtistQuizStatus(message) {
    if (isArtistPickerPage()) setArtistPickerStatus(message);
    else if (elements.setupDescription) elements.setupDescription.textContent = message;
  }
  function formatFollowers(followers) {
    return followers?.total ? `${new Intl.NumberFormat('de-DE').format(followers.total)} Follower` : 'Artist auf Spotify';
  }
  function artistPickerCardMarkup(artist) {
    const imageUrl = artist.images?.[0]?.url || '';
    const fallback = escapeHtml((artist.name || '♪').trim().charAt(0).toUpperCase());
    const cover = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" />` : fallback;
    return `<button class="artist-picker-card" type="button" role="listitem" data-artist-picker-id="${escapeHtml(artist.id)}" ${artistPickerPlayerReady ? '' : 'disabled'}><span class="artist-picker-card-cover">${cover}</span><span class="artist-picker-card-copy"><strong>${escapeHtml(artist.name)}</strong><small>${escapeHtml(formatFollowers(artist.followers))}</small></span></button>`;
  }
  function bindArtistPickerCards(container) {
    container?.querySelectorAll('[data-artist-picker-id]').forEach(card => card.addEventListener('click', () => startArtistFromPicker(card.dataset.artistPickerId)));
  }
  function renderArtistRecommendations(artists) {
    if (!elements.artistRecommendations) return;
    const recommendations = artists.slice(0, 4);
    elements.artistRecommendations.innerHTML = recommendations.length ? recommendations.map(artistPickerCardMarkup).join('') : '<p class="artist-picker-empty">Noch keine persönlichen Empfehlungen verfügbar.</p>';
    bindArtistPickerCards(elements.artistRecommendations);
  }
  function renderArtistSearchResults(artists) {
    if (!elements.artistSearchResults) return;
    elements.artistSearchResults.classList.remove('hidden');
    elements.artistSearchResults.innerHTML = artists.length ? `<div class="artist-card-grid" role="list">${artists.map(artistPickerCardMarkup).join('')}</div>` : '<p class="artist-picker-empty">Kein passender Artist gefunden.</p>';
    bindArtistPickerCards(elements.artistSearchResults);
  }
  function setArtistPickerControlsDisabled(disabled) {
    if (elements.artistSearch) elements.artistSearch.disabled = disabled;
    document.querySelectorAll('[data-artist-picker-id]').forEach(card => { card.disabled = disabled; });
  }
  async function searchSpotifyArtists(query) {
    const searchId = ++artistSearchRequestId;
    if (query.length < 2) {
      elements.artistSearchResults?.classList.add('hidden');
      return;
    }
    try {
      const data = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=artist&limit=8`);
      if (searchId !== artistSearchRequestId) return;
      renderArtistSearchResults(data.artists?.items || []);
    } catch (error) {
      if (searchId !== artistSearchRequestId) return;
      elements.artistSearchResults?.classList.remove('hidden');
      if (elements.artistSearchResults) elements.artistSearchResults.innerHTML = '<p class="artist-picker-empty">Die Suche ist gerade nicht verfügbar. Bitte versuche es erneut.</p>';
      setArtistPickerStatus(error.message, 'error');
    }
  }
  function startArtistFromPicker(artistId) {
    if (!artistId || !artistPickerPlayerReady || artistQuizStarting) return;
    if (!hasGameScopes()) {
      window.location.assign(playPageUrl(artistId, '', 'artist'));
      return;
    }
    activateWebPlaybackFromUserGesture();
    setArtistPickerControlsDisabled(true);
    void startArtistQuiz(artistId).finally(() => {
      if (!elements.setup?.parentElement?.classList.contains('hidden')) setArtistPickerControlsDisabled(false);
    });
  }
  function loadWebPlaybackSdk() {
    if (window.Spotify?.Player) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const loaded = document.querySelector('script[data-tracktally-player]');
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      if (loaded) return;
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.dataset.tracktallyPlayer = 'true';
      script.onerror = () => reject(new Error('Der Spotify Web Player konnte nicht geladen werden.'));
      document.head.appendChild(script);
    });
  }
  async function prepareWebPlayer() {
    if (webPlayerDeviceId) return true;
    if (webPlayerReady) return webPlayerReady;
    webPlayerReady = new Promise(async (resolve) => {
      try {
        await loadWebPlaybackSdk();
        webPlayer = new window.Spotify.Player({
          name: 'TrackTally Quiz Player',
          getOAuthToken: async callback => callback(await freshToken()),
          volume: playbackVolume
        });
        webPlayer.addListener('ready', ({ device_id }) => {
          webPlayerDeviceId = device_id;
          if (isArtistPickerPage()) setArtistPickerStatus('Spotify Player bereit – wähle einen Artist.');
          else if (elements.setupDescription) {
            elements.setupDescription.textContent = 'Spotify Premium Player bereit – wähle eine Playlist.';
            elements.setupDescription.style.color = '';
          }
          resolve(true);
        });
        webPlayer.addListener('not_ready', () => {
          webPlayerDeviceId = undefined;
          webPlaybackActivated = false;
          if (elements.game && !elements.game.classList.contains('hidden') && !game.answered) {
            requirePlaybackActivation('Die Spotify-Wiedergabe ist kurz nicht verfügbar. Klicke auf Wiedergabe, sobald sie wieder bereit ist.');
          }
        });
        webPlayer.addListener('autoplay_failed', () => {
          requirePlaybackActivation('Dein Browser blockiert den automatischen Start. Aktiviere die Wiedergabe einmal, dann starten die folgenden Runden automatisch.');
        });
        webPlayer.addListener('player_state_changed', state => {
          if (!state) return;
          spotifyPlaying = !state.paused;
          if (spotifyPlaying) {
            elements.play?.classList.add('pause');
            elements.vinyl?.classList.add('playing');
            elements.waveform?.classList.add('playing');
            const expectedTrack = pendingRoundTimerTrack;
            if (expectedTrack) confirmRoundPlayback(expectedTrack, state);
          } else {
            elements.play?.classList.remove('pause');
            elements.vinyl?.classList.remove('playing');
            elements.waveform?.classList.remove('playing');
          }
        });
        webPlayer.addListener('account_error', () => {
          showMessage('Für die vollständige Wiedergabe brauchst du Spotify Premium.');
          resolve(false);
        });
        webPlayer.addListener('authentication_error', () => {
          showMessage('Die Spotify-Wiedergabe konnte nicht autorisiert werden. Bitte erneut verbinden.');
          resolve(false);
        });
        webPlayer.addListener('initialization_error', () => {
          showMessage('Dieser Browser unterstützt die geschützte Spotify-Wiedergabe nicht.');
          resolve(false);
        });
        webPlayer.addListener('playback_error', () => requirePlaybackActivation('Dieser Titel kann auf deinem Spotify-Konto nicht wiedergegeben werden. Klicke auf Wiedergabe, um es mit der Runde erneut zu versuchen.'));
        const connected = await webPlayer.connect();
        if (!connected) resolve(false);
        setTimeout(() => {
          if (!webPlayerDeviceId) {
            showMessage('Der Spotify Premium Player wurde nicht rechtzeitig bereit. Bitte versuche es noch einmal.');
            resolve(false);
          }
        }, 10_000);
      } catch (error) { showMessage(error.message); resolve(false); }
    });
    return webPlayerReady;
  }
  async function warmUpWebPlaybackForPlaylistStart() {
    const artistPicker = isArtistPickerPage();
    if (webPlayerDeviceId) {
      if (artistPicker) {
        artistPickerPlayerReady = true;
        setArtistPickerControlsDisabled(false);
      }
      return;
    }
    if (artistPicker) {
      setArtistPickerControlsDisabled(true);
      setArtistPickerStatus('Spotify Player wird vorbereitet …');
    } else if (elements.startPlaylist) {
      elements.startPlaylist.disabled = true;
      elements.startPlaylist.textContent = 'Spotify Player wird vorbereitet …';
    } else return;
    const ready = await prepareWebPlayer();
    if (!ready) return;
    if (artistPicker) {
      artistPickerPlayerReady = true;
      setArtistPickerControlsDisabled(false);
      setArtistPickerStatus('Wähle einen Artist für deine nächste Runde.');
    } else if (elements.startPlaylist) {
      elements.startPlaylist.disabled = false;
      elements.startPlaylist.innerHTML = 'Quiz mit Playlist starten <span aria-hidden="true">→</span>';
    }
    if (!artistPicker && elements.setupDescription) {
      elements.setupDescription.textContent = 'Wähle eine Playlist und starte deine Runde.';
      elements.setupDescription.style.color = '';
    }
  }
  function activateWebPlaybackFromUserGesture() {
    if (webPlaybackActivated || !webPlayer) return;
    try {
      const activation = webPlayer.activateElement?.();
      webPlaybackActivated = true;
      Promise.resolve(activation).catch(() => { webPlaybackActivated = false; });
    } catch {
      webPlaybackActivated = false;
    }
  }
  async function addArtistGenres(tracks) {
    const artistIds = [...new Set(tracks.flatMap(track => (track.artists || []).map(artist => artist.id).filter(Boolean)))];
    const missingIds = artistIds.filter(id => !artistGenreCache.has(id));
    try {
      for (let index = 0; index < missingIds.length; index += 50) {
        const ids = missingIds.slice(index, index + 50);
        const data = await spotifyFetch(`/artists?ids=${ids.map(encodeURIComponent).join(',')}`);
        (data.artists || []).forEach(artist => artistGenreCache.set(artist.id, artist.genres || []));
        ids.forEach(id => { if (!artistGenreCache.has(id)) artistGenreCache.set(id, []); });
      }
    } catch {
      return tracks;
    }
    return tracks.map(track => ({ ...track, quizGenres: [...new Set((track.artists || []).flatMap(artist => artistGenreCache.get(artist.id) || []))] }));
  }
  function sharesArtist(first, second) {
    const artistKeys = new Set((first.artists || []).map(artist => artist.id || artist.name).filter(Boolean));
    return (second.artists || []).some(artist => artistKeys.has(artist.id || artist.name));
  }
  function sharesGenre(first, second) {
    const genres = new Set(first.quizGenres || []);
    return (second.quizGenres || []).some(genre => genres.has(genre));
  }
  function relatedDistractors(track) {
    const others = game.allTracks.filter(item => item !== track);
    const sameArtist = shuffle(others.filter(item => sharesArtist(track, item)));
    const sameGenre = shuffle(others.filter(item => !sharesArtist(track, item) && sharesGenre(track, item)));
    const selected = [...sameArtist, ...sameGenre];
    const selectedItems = new Set(selected);
    return [...selected, ...shuffle(others.filter(item => !selectedItems.has(item)))].slice(0, 3);
  }
  async function getPlaylistTracks(id) {
    try {
      const tracks = [];
      let offset = 0;
      do {
        const data = await spotifyFetch(`/playlists/${encodeURIComponent(id)}/items?limit=50&offset=${offset}&additional_types=track`);
        const items = data.items || [];
        tracks.push(...items.map(item => item.item || item.track).filter(track => track && track.type === 'track'));
        offset += items.length;
        if (!data.next || items.length === 0) return tracks;
      } while (true);
    } catch (firstError) {
      if (![404, 405, 501].includes(firstError.status)) throw firstError;
      const tracks = [];
      let offset = 0;
      do {
        const data = await spotifyFetch(`/playlists/${encodeURIComponent(id)}/tracks?limit=100&offset=${offset}`);
        const items = data.items || [];
        tracks.push(...items.map(item => item.track).filter(Boolean));
        offset += items.length;
        if (!data.next || items.length === 0) return tracks;
      } while (true);
    }
  }
  async function getLikedTracks() {
    const tracks = [];
    let offset = 0;
    do {
      const data = await spotifyFetch(`/me/tracks?limit=50&offset=${offset}`);
      const items = data.items || [];
      tracks.push(...items.map(item => item.item || item.track).filter(track => track && track.type === 'track'));
      offset += items.length;
      if (!data.next || items.length === 0) return tracks;
    } while (true);
  }
  async function getArtistAlbums(artistId) {
    const albums = [];
    let offset = 0;
    do {
      const data = await spotifyFetch(`/artists/${encodeURIComponent(artistId)}/albums?include_groups=album,single,compilation,appears_on&limit=50&offset=${offset}`);
      const items = data.items || [];
      albums.push(...items);
      offset += items.length;
      if (!data.next || items.length === 0) break;
    } while (true);
    return [...new Map(albums.map(album => [album.id, album])).values()];
  }
  async function getArtistAlbumTracks(album) {
    const tracks = [];
    let offset = 0;
    do {
      const data = await spotifyFetch(`/albums/${encodeURIComponent(album.id)}/tracks?limit=50&offset=${offset}`);
      const items = data.items || [];
      tracks.push(...items.map(track => ({ ...track, album: { name: album.name, images: album.images || [] } })));
      offset += items.length;
      if (!data.next || items.length === 0) return tracks;
    } while (true);
  }
  async function getArtistDiscography(artistId) {
    const [artist, albums] = await Promise.all([
      spotifyFetch(`/artists/${encodeURIComponent(artistId)}`),
      getArtistAlbums(artistId)
    ]);
    const tracks = [];
    const batchSize = 4;
    for (let index = 0; index < albums.length; index += batchSize) {
      const batch = albums.slice(index, index + batchSize);
      const albumTracks = await Promise.all(batch.map(getArtistAlbumTracks));
      tracks.push(...albumTracks.flat());
      setArtistQuizStatus(`„${artist.name}“ wird geladen … Album ${Math.min(index + batch.length, albums.length)} von ${albums.length}`);
    }
    return {
      artist,
      tracks: [...new Map(tracks.filter(track => track.id).map(track => [track.id, track])).values()]
    };
  }
  async function startArtistQuiz(artistId) {
    if (artistQuizStarting) return;
    artistQuizStarting = true;
    try {
      if (!hasGameScopes()) {
        showMessage('Für ein Artist-Quiz braucht TrackTally einmalig die Spotify-Wiedergabe-Berechtigung.');
        await beginSpotifyLogin();
        return;
      }
      setArtistQuizStatus('Artist-Quiz wird vorbereitet …');
      const [playerReady, discography] = await Promise.all([prepareWebPlayer(), getArtistDiscography(artistId)]);
      if (!playerReady) throw new Error('Der Spotify Premium Player ist nicht verfügbar.');
      const playable = discography.tracks.filter(track => track.uri && track.artists?.some(artist => artist.id === artistId));
      if (playable.length < 4) throw new Error(`Für „${discography.artist.name}“ sind auf deinem Spotify-Konto zu wenige abspielbare Songs verfügbar.`);
      setArtistQuizStatus(`„${discography.artist.name}“: ${playable.length} Songs bereit. Quiz startet …`);
      startGame('spotify', await addArtistGenres(playable));
    } catch (error) { showMessage(error.message); }
    finally { artistQuizStarting = false; }
  }
  async function startPlaylistQuiz(id) {
    if (playlistQuizStarting) return;
    playlistQuizStarting = true;
    try {
      if (!hasGameScopes()) {
        showMessage('Für die Playlist-Wiedergabe braucht TrackTally einmalig zusätzliche Spotify-Berechtigungen.');
        await beginSpotifyLogin();
        return;
      }
      if (elements.playlistSelect) selectPlaylistSource(id);
      const selectedName = playlistSources.find(source => source.id === id)?.name || elements.playlistSelect?.selectedOptions?.[0]?.textContent?.split(' · ')[0] || 'Deine Playlist';
      if (elements.setupDescription) elements.setupDescription.textContent = `„${selectedName}“ wird vorbereitet …`;
      const [playerReady, tracks] = await Promise.all([
        prepareWebPlayer(),
        id === LIKED_SONGS_VALUE ? getLikedTracks() : getPlaylistTracks(id)
      ]);
      if (!playerReady) throw new Error('Der Spotify Premium Player ist nicht verfügbar.');
      const playable = tracks.filter(track => track.uri && track.artists?.[0]?.name);
      if (playable.length < 4) throw new Error('In dieser Playlist sind zu wenige auf deinem Konto abspielbare Songs.');
      if (elements.setupDescription) elements.setupDescription.textContent = `„${selectedName}“: ${playable.length} Songs bereit. Quiz startet …`;
      startGame('spotify', await addArtistGenres(playable));
    } catch (error) { showMessage(error.message); }
    finally { playlistQuizStarting = false; }
  }
  function startButtonLabel() {
    const type = quizTypeFromUrl();
    return type === 'artist' ? 'Artist-Quiz starten' : type === 'liked' ? 'Lieblingssong-Quiz starten' : 'Quiz mit Playlist starten';
  }
  async function startPlaylistGame() {
    const quizType = quizTypeFromUrl();
    if (quizType === 'artist') return showMessage('Bitte wähle einen Artist über die Suche oder deine Empfehlungen.');
    const id = quizType === 'liked' ? LIKED_SONGS_VALUE : elements.playlistSelect?.value;
    if (!id) return showMessage('Bitte wähle zuerst eine Musikquelle mit genügend Songs.');
    activateWebPlaybackFromUserGesture();
    elements.startPlaylist.disabled = true; elements.startPlaylist.textContent = 'Quiz wird vorbereitet …';
    try {
      if (quizType === 'artist') await startArtistQuiz(id);
      else await startPlaylistQuiz(id);
    } catch (error) { showMessage(error.message); }
    finally { elements.startPlaylist.disabled = false; elements.startPlaylist.innerHTML = `${startButtonLabel()} <span aria-hidden="true">→</span>`; }
  }
  function startDemo() { startGame('demo', DEMO_TRACKS); }
  function startGame(mode, tracks) {
    const count = Math.min(game.rounds, tracks.length);
    game = { mode, allTracks: tracks, questions: shuffle(tracks).slice(0, count), clipStarts: {}, roundResults: [], index: 0, score: 0, correct: 0, streak: 0, bestStreak: 0, answered: false, rounds: count };
    elements.results.classList.add('hidden'); elements.setup.parentElement.classList.add('hidden'); elements.game.classList.remove('hidden');
    renderQuestion(); window.scrollTo({ top: elements.game.offsetTop - 20, behavior: 'smooth' });
  }
  function renderQuestion() {
    const track = game.questions[game.index]; game.answered = false;
    pendingRoundTimerTrack = undefined;
    clearRoundTimer();
    if (isDemo()) stopAudio();
    else {
      elements.audio?.pause();
      if (elements.audio) elements.audio.currentTime = 0;
      elements.play?.classList.remove('pause'); elements.vinyl?.classList.remove('playing'); elements.waveform?.classList.remove('playing');
      if (elements.time) elements.time.textContent = '0:00';
    }
    elements.answers.innerHTML = ''; elements.feedback.classList.add('hidden'); elements.next.classList.add('hidden');
    elements.round.textContent = `RUNDE ${game.index + 1} / ${game.rounds}`; elements.score.textContent = game.score; elements.streak.textContent = `${game.streak}er-Streak`; elements.correct.textContent = game.correct; elements.bestStreak.textContent = game.bestStreak;
    elements.clue.textContent = isDemo() ? track.clue : 'Zufälliger Song-Ausschnitt · du hast einen Versuch.';
    elements.clue.style.color = '';
    const distractors = relatedDistractors(track);
    const options = shuffle([track, ...distractors]);
    options.forEach((option, index) => { const button = document.createElement('button'); button.className = 'answer'; button.disabled = true; button.dataset.correct = String(option === track); button.innerHTML = `<span class="answer-letter">${'ABCD'[index]}</span>${escapeHtml(option.name)}`; button.addEventListener('click', () => answerQuestion(button, track)); elements.answers.appendChild(button); });
    if (!isDemo()) { elements.audio.removeAttribute('src'); elements.audio.load(); }
    makeWave();
    updateRoundTimer(ROUND_TIME_MS);
    
    void startRoundPlayback(track);
  }
  function answerQuestion(button, track) { resolveQuestion(track, button, button.dataset.correct === 'true', false); }
  async function timeExpired() {
    clearRoundTimer();
    pendingRoundTimerTrack = undefined;
    if (!game.answered) resolveQuestion(game.questions[game.index], null, false, true);
    if (!isDemo() && spotifyPlaying) await stopSpotifyPlayback();
    else stopAudio();
    nextQuestion();
  }
  function resolveQuestion(track, button, right, timedOut) {
    if (game.answered) return; game.answered = true; const points = right ? Math.max(0, 100 - Math.floor((Date.now() - game.roundStartedAt) / 100)) : 0; game.roundResults[game.index] = { track, right, points, timedOut };
    elements.answers.querySelectorAll('.answer').forEach(item => { item.disabled = true; if (item.dataset.correct === 'true') item.classList.add('correct'); });
    if (right) { game.correct++; game.streak++; game.bestStreak = Math.max(game.bestStreak, game.streak); game.score += points; elements.feedback.innerHTML = `<strong>Treffer! +${points} Punkte</strong> &nbsp; „${escapeHtml(track.name)}“` ; }
    else { if (button) button.classList.add('wrong'); game.streak = 0; elements.feedback.innerHTML = timedOut ? `Zeit abgelaufen! Die richtige Antwort: <strong>„${escapeHtml(track.name)}“</strong> von ${escapeHtml(track.artists[0].name)}` : `Die richtige Antwort: <strong>„${escapeHtml(track.name)}“</strong> von ${escapeHtml(track.artists[0].name)}`; }
    elements.score.textContent = game.score; elements.streak.textContent = `${game.streak}er-Streak`; elements.correct.textContent = game.correct; elements.bestStreak.textContent = game.bestStreak; elements.feedback.classList.remove('hidden'); elements.next.classList.add('hidden');
  }
  function nextQuestion() { if (game.index + 1 >= game.rounds) return finishGame(); game.index++; renderQuestion(); } function renderRoundSummary() { if (!elements.roundSummary) return; elements.roundSummary.innerHTML = game.roundResults.map((result, index) => { const track = result.track; const artist = track.artists?.map(item => item.name).filter(Boolean).join(', ') || 'Unbekannter Artist'; const imageUrl = track.album?.images?.[2]?.url || track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || ''; const cover = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" />` : '<span aria-hidden="true">♫</span>'; const outcome = result.right ? 'Richtig' : result.timedOut ? 'Zeit abgelaufen' : 'Nicht erraten'; return `<article class="round-summary-item ${result.right ? 'is-correct' : 'is-missed'}" role="listitem"><span class="round-summary-number">${String(index + 1).padStart(2, '0')}</span><span class="round-summary-cover">${cover}</span><span class="round-summary-copy"><strong>${escapeHtml(track.name)}</strong><small>${escapeHtml(artist)}</small></span><span class="round-summary-result"><b>${result.right ? '✓' : '–'}</b><small>${outcome}</small></span><strong class="round-summary-points">${result.points} Pkt.</strong></article>`; }).join(''); }
  function finishGame() {
    clearRoundTimer();
    pendingRoundTimerTrack = undefined;
    stopAudio(); renderRoundSummary(); elements.game.classList.add('hidden'); elements.results.classList.remove('hidden');
    const ratio = game.correct / game.rounds; elements.resultTitle.textContent = ratio >= .8 ? 'Musiklexikon!' : ratio >= .5 ? 'Starke Runde!' : 'Nächste Runde gehört euch!'; elements.resultCopy.textContent = `Du hast ${game.correct} von ${game.rounds} Songs erraten.`; elements.finalScore.textContent = game.score; window.scrollTo({ top: elements.results.offsetTop - 40, behavior: 'smooth' });
  }
  async function stopSpotifyPlayback() {
    spotifyPlaying = false;
    if (webPlayerDeviceId) await spotifyRequest(`/me/player/pause?device_id=${encodeURIComponent(webPlayerDeviceId)}`, { method: 'PUT' }).catch(() => {});
    elements.play.classList.remove('pause'); elements.vinyl.classList.remove('playing'); elements.waveform.classList.remove('playing'); elements.time.textContent = '0:00';
  }
  function stopAudio() {
    if (!isDemo()) {
      elements.audio.pause(); elements.audio.currentTime = 0;
      if (spotifyPlaying) void stopSpotifyPlayback();
    }
    elements.play.classList.remove('pause'); elements.vinyl.classList.remove('playing'); elements.waveform.classList.remove('playing'); elements.time.textContent = '0:00';
  }
  function playDemoTone() {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioContext.currentTime; const notes = [220, 277.18, 329.63, 440, 329.63, 277.18];
    notes.forEach((frequency, index) => { const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.type = index % 2 ? 'triangle' : 'sine'; osc.frequency.value = frequency; gain.gain.setValueAtTime(.0001, now + index * .23); gain.gain.exponentialRampToValueAtTime(Math.max(.0001, .07 * playbackVolume), now + index * .23 + .02); gain.gain.exponentialRampToValueAtTime(.0001, now + index * .23 + .22); osc.connect(gain).connect(audioContext.destination); osc.start(now + index * .23); osc.stop(now + index * .23 + .23); });
  }
  function startDemoPlayback() {
    playDemoTone(); elements.play.classList.add('pause'); elements.vinyl.classList.add('playing'); elements.waveform.classList.add('playing');
    setTimeout(() => { elements.play.classList.remove('pause'); elements.vinyl.classList.remove('playing'); elements.waveform.classList.remove('playing'); }, 1400);
  }
  async function playSpotifyTrack(track) {
    try {
      const questionKey = track.id || String(game.index);
      if (game.clipStarts[questionKey] === undefined) {
        const latestStart = Math.max(0, (track.duration_ms || 0) - QUIZ_CLIP_MS - 2_000);
        const earliestStart = latestStart > 10_000 ? 5_000 : 0;
        game.clipStarts[questionKey] = earliestStart + Math.floor(Math.random() * (latestStart - earliestStart + 1));
      }
      await spotifyRequest('/me/player', { method: 'PUT', body: { device_ids: [webPlayerDeviceId], play: false } });
      await new Promise(resolve => setTimeout(resolve, 350));
      await spotifyRequest(`/me/player/play?device_id=${encodeURIComponent(webPlayerDeviceId)}`, { method: 'PUT', body: { uris: [track.uri], position_ms: game.clipStarts[questionKey] } });
      return true;
    } catch (error) { showMessage(`Wiedergabe fehlgeschlagen: ${error.message}`); return false; }
  }
  async function startRoundPlayback(track) {
    if (isDemo()) { startDemoPlayback(); scheduleRoundTimerStart(track); return; }
    if (!webPlayerDeviceId) return requirePlaybackActivation('Der Spotify Premium Player wird noch vorbereitet. Klicke auf Wiedergabe, sobald er bereit ist.');
    if (spotifyPlaying) await stopSpotifyPlayback();
    pendingRoundTimerTrack = track;
    const requested = await playSpotifyTrack(track);
    if (!requested) {
      if (pendingRoundTimerTrack === track && !game.answered && game.questions[game.index] === track) {
        requirePlaybackActivation('Die Wiedergabe konnte nicht gestartet werden. Klicke auf Wiedergabe, um die Runde erneut zu starten.');
      }
      return;
    }
    void checkRoundPlaybackStart(track);
  }
  async function togglePreview() {
    if (isDemo()) return startDemoPlayback();
    if (!webPlayerDeviceId || !webPlayer) return showMessage('Der Spotify Premium Player wird noch vorbereitet. Bitte einen Moment warten.');
    if (!webPlaybackActivated) {
      try {
        const activation = webPlayer.activateElement?.();
        if (activation) await activation;
        webPlaybackActivated = true;
        elements.play.disabled = true;
        elements.play.setAttribute('aria-label', 'Wiedergabe ist während der Runde aktiviert');
        elements.clue.style.color = '';
        await startRoundPlayback(game.questions[game.index]);
      } catch (error) {
        requirePlaybackActivation('Die Browser-Wiedergabe konnte nicht aktiviert werden. Klicke erneut auf Wiedergabe.');
      }
      return;
    }
    if (spotifyPlaying) return;
    await startRoundPlayback(game.questions[game.index]);
  }
  elements.audio?.addEventListener('play', () => { elements.play?.classList.add('pause'); elements.vinyl?.classList.add('playing'); elements.waveform?.classList.add('playing'); });
  elements.audio?.addEventListener('pause', () => { elements.play?.classList.remove('pause'); elements.vinyl?.classList.remove('playing'); elements.waveform?.classList.remove('playing'); });
  elements.audio?.addEventListener('timeupdate', () => { if (elements.time) elements.time.textContent = `0:${String(Math.floor(elements.audio.currentTime)).padStart(2, '0')}`; });
  elements.audio?.addEventListener('ended', stopAudio);
  function showConfigModal() { if (!elements.modal || !elements.redirect) return; elements.redirect.textContent = redirectUri(); elements.modal.classList.remove('hidden'); }
  function showHomeNotice(message, type = 'info') { if (!elements.connectionNotice) return; elements.connectionNotice.textContent = message; elements.connectionNotice.classList.remove('hidden'); elements.connectionNotice.classList.toggle('error', type === 'error'); }
  function hideHomeNotice() { if (!elements.connectionNotice) return; elements.connectionNotice.classList.add('hidden'); elements.connectionNotice.classList.remove('error'); }
  function showMessage(message) {
    if (showGameMessage(message)) return;
    if (isArtistPickerPage()) { setArtistPickerStatus(message, 'error'); return; }
    if (elements.setupDescription) { elements.setupDescription.textContent = message; elements.setupDescription.style.color = '#9c3350'; return; }
    if (elements.headerConnect) {
      elements.headerConnect.textContent = 'Erneut verbinden';
      elements.headerConnect.classList.remove('connected');
      elements.headerConnect.classList.add('connection-error');
      if (!syncSpotifyLoginCooldownButton()) elements.headerConnect.disabled = false;
    }
    showHomeNotice(message, 'error');
  }
  async function copy(value, successElement) { try { await navigator.clipboard.writeText(value); const previous = successElement.textContent; successElement.textContent = 'Kopiert ✓'; setTimeout(() => successElement.textContent = previous, 1800); } catch { window.prompt('Kopiere diesen Text:', value); } }








  elements.connect?.addEventListener('click', beginSpotifyLogin);
  elements.artistConnect?.addEventListener('click', beginSpotifyLogin);
  elements.headerConnect?.addEventListener('click', () => beginSpotifyLogin({ useCooldown: true }));
  elements.heroConnect?.addEventListener('click', openGameModePage);
  elements.legacyHeroConnect?.addEventListener('click', openGameModePage);
  elements.demo?.addEventListener('click', startDemo);
  elements.startPlaylist?.addEventListener('click', startPlaylistGame);
  elements.playlistPickerTrigger?.addEventListener('click', () => {
    if (!elements.playlistPickerMenu) return;
    const open = elements.playlistPickerMenu.hidden;
    elements.playlistPickerMenu.hidden = !open;
    elements.playlistPickerTrigger.setAttribute('aria-expanded', String(open));
  });
  elements.playlistPickerMenu?.addEventListener('click', event => {
    const option = event.target.closest('[data-playlist-source]');
    if (!option) return;
    selectPlaylistSource(option.dataset.playlistSource);
    closePlaylistPicker();
  });
  document.addEventListener('click', event => {
    if (elements.playlistPicker && !elements.playlistPicker.contains(event.target)) closePlaylistPicker();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePlaylistPicker(); });
  elements.artistSearch?.addEventListener('input', event => {
    window.clearTimeout(artistSearchDebounceId);
    const query = event.target.value.trim();
    artistSearchDebounceId = window.setTimeout(() => { void searchSpotifyArtists(query); }, 250);
  });
  elements.play?.addEventListener('click', togglePreview);
  elements.next?.addEventListener('click', nextQuestion);
  elements.leave?.addEventListener('click', () => { stopAudio(); elements.game?.classList.add('hidden'); elements.setup?.parentElement.classList.remove('hidden'); });
  elements.playAgain?.addEventListener('click', () => startGame(game.mode, game.allTracks));
  elements.backToSetup?.addEventListener('click', () => { elements.results?.classList.add('hidden'); elements.setup?.parentElement.classList.remove('hidden'); if (elements.setup) window.scrollTo({ top: elements.setup.offsetTop - 50, behavior: 'smooth' }); });
  elements.share?.addEventListener('click', () => copy(window.location.href, elements.share));
  elements.closeModal?.addEventListener('click', () => elements.modal.classList.add('hidden'));
  elements.modal?.addEventListener('click', event => { if (event.target === elements.modal) elements.modal.classList.add('hidden'); });
  elements.copyRedirect?.addEventListener('click', () => copy(redirectUri(), elements.copyRedirect));
  elements.volume?.addEventListener('input', event => setPlaybackVolume(event.target.value));
  setPlaybackVolume(Math.round(playbackVolume * 100));
  function configureQuizSetup() {
    if (!elements.setup) return;
    const quizType = quizTypeFromUrl();
    const artistPicker = quizType === 'artist';
    const pageCopy = {
      artist: { title: 'Welcher <em>Artist</em> soll es sein?', description: 'Verbinde Spotify und wähle anschließend einen deiner Artists.' },
      playlist: { title: 'Bereit für<br />den <em>nächsten</em> Song?', description: 'Verbinde Spotify, wähle eine Playlist und starte eure Runde.' },
      liked: { title: 'Deine <em>Lieblingssongs</em> warten.', description: 'Verbinde Spotify und starte ein Quiz mit deinen gespeicherten Songs.' }
    }[quizType];
    if (elements.setupTitle) elements.setupTitle.innerHTML = pageCopy.title;
    if (elements.setupDescription) elements.setupDescription.textContent = pageCopy.description;
    document.body.classList.toggle('artist-picker-page', artistPicker);
    elements.setup.parentElement?.classList.toggle('artist-setup', artistPicker);
    elements.artistBrowser?.classList.toggle('hidden', !artistPicker);
    [$('.panel-kicker'), elements.setupTitle, elements.setupDescription, elements.authState, $('.rounds-row'), elements.connect, elements.startPlaylist, $('.helper')].forEach(element => element?.classList.toggle('hidden', artistPicker));
    elements.playlistControl?.classList.toggle('hidden', quizType !== 'playlist');
    if (elements.artistConnect) elements.artistConnect.classList.toggle('hidden', !artistPicker || Boolean(tokenData()));
    if (!artistPicker && elements.startPlaylist) elements.startPlaylist.innerHTML = `${startButtonLabel()} <span aria-hidden="true">→</span>`;
  }
  configureQuizSetup();
  elements.leave?.addEventListener('click', () => { pendingRoundTimerTrack = undefined; clearRoundTimer(); });
  elements.backToSetup?.addEventListener('click', () => { pendingRoundTimerTrack = undefined; clearRoundTimer(); });
  handleAuthorizationReturn().then(returned => { syncSpotifyLoginCooldownButton(); if (!returned && tokenData()) loadSpotifyProfile(); });
  refreshHomeRailNavigation();
  makeWave();
})();
