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
  const ROUND_TIME_MS = 10_000;
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
    setup: $('#setupPanel'), setupDescription: $('#setupDescription'), authState: $('#authState'), playlistControl: $('#playlistControl'), playlistSelect: $('#playlistSelect'), connect: $('#connectButton'), headerConnect: $('#headerConnect'), heroConnect: $('#heroConnect'), demo: $('#demoStart'), startPlaylist: $('#startPlaylistGame'), game: $('#gameShell'), results: $('#resultCard'), audio: $('#previewAudio'), play: $('#playPreview'), volume: $('#volumeRange'), waveform: $('#waveform'), time: $('#previewTime'), answers: $('#answerGrid'), feedback: $('#answerFeedback'), next: $('#nextQuestion'), round: $('#roundCounter'), score: $('#score'), streak: $('#streak'), correct: $('#correctCount'), bestStreak: $('#bestStreak'), clue: $('#trackClue'), vinyl: $('#trackVisual')?.querySelector('.vinyl'), leave: $('#leaveGame'), share: $('#shareGame'), playAgain: $('#playAgain'), backToSetup: $('#backToSetup'), modal: $('#configModal'), closeModal: $('#closeModal'), redirect: $('#redirectUri'), copyRedirect: $('#copyRedirect'), resultTitle: $('#resultTitle'), resultCopy: $('#resultCopy'), finalScore: $('#finalScore')
  };
  const timerElements = { value: $('#roundTimer'), bar: $('#roundTimerBar'), meter: $('#roundTimerMeter') };
  let game = { mode: 'demo', allTracks: [], questions: [], index: 0, score: 0, correct: 0, streak: 0, bestStreak: 0, answered: false, rounds: 10 };
  let audioContext;
  let webPlayer;
  let webPlayerDeviceId;
  let webPlayerReady;
  let spotifyPlaying = false;
  let roundTimerId;
  let playbackVolume = Math.max(0, Math.min(1, Number(localStorage.getItem('tracktally_volume') ?? 65) / 100));
  const artistGenreCache = new Map();
  let artistQuizStarting = false;
  let playlistQuizStarting = false;

  function appRootUrl() {
    const path = window.location.pathname;
    const rootPath = /\/[^/]+\.[^/]+$/.test(path) ? path.slice(0, path.lastIndexOf('/') + 1) : path;
    return window.location.origin + rootPath;
  }
  function playPageUrl(artistId = '', playlistId = '') {
    const url = new URL('play.html', appRootUrl());
    if (artistId) url.searchParams.set('artist', artistId);
    if (playlistId) url.searchParams.set('playlist', playlistId);
    return url.href;
  }
  function artistIdFromUrl() { return new URLSearchParams(window.location.search).get('artist') || ''; }
  function playlistIdFromUrl() { return new URLSearchParams(window.location.search).get('playlist') || ''; }
  function redirectUri() { return CONFIG.redirectUri || appRootUrl(); }
  function openPlayPage() { window.location.assign(playPageUrl()); }
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
  function clearRoundTimer() { clearInterval(roundTimerId); roundTimerId = undefined; }
  function updateRoundTimer(remaining) {
    if (!timerElements.value || !timerElements.bar || !timerElements.meter) return;
    timerElements.value.textContent = Math.ceil(remaining / 1000);
    timerElements.bar.style.width = `${Math.max(0, remaining / ROUND_TIME_MS) * 100}%`;
    timerElements.meter.classList.toggle('warning', remaining <= 3_000);
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
  async function beginSpotifyLogin() {
    if (!configured()) return showConfigModal();
    if (window.location.pathname.endsWith('/play.html')) {
      sessionStorage.setItem('tracktally_return_to_play', 'true');
      const artistId = artistIdFromUrl();
      if (artistId) sessionStorage.setItem('tracktally_artist_quiz', artistId);
      else sessionStorage.removeItem('tracktally_artist_quiz');
      const playlistId = playlistIdFromUrl();
      if (playlistId) sessionStorage.setItem('tracktally_playlist_quiz', playlistId);
      else sessionStorage.removeItem('tracktally_playlist_quiz');
    } else {
      sessionStorage.removeItem('tracktally_return_to_play');
      sessionStorage.removeItem('tracktally_artist_quiz');
      sessionStorage.removeItem('tracktally_playlist_quiz');
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
    if (error) { sessionStorage.removeItem('tracktally_return_to_play'); sessionStorage.removeItem('tracktally_artist_quiz'); sessionStorage.removeItem('tracktally_playlist_quiz'); showMessage(`Spotify-Login abgebrochen: ${error}.`); cleanUrl(); return true; }
    if (state !== sessionStorage.getItem('tracktally_state')) { showMessage('Der Spotify-Login konnte aus Sicherheitsgründen nicht bestätigt werden. Bitte erneut versuchen.'); cleanUrl(); return true; }
    try {
      const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CONFIG.clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: sessionStorage.getItem('tracktally_verifier') || '' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || data.error || 'Token konnte nicht geladen werden');
      setToken({ ...data, expires_at: Date.now() + data.expires_in * 1000 });
      const returnToPlay = sessionStorage.getItem('tracktally_return_to_play') === 'true';
      const artistQuizId = sessionStorage.getItem('tracktally_artist_quiz') || '';
      const playlistQuizId = sessionStorage.getItem('tracktally_playlist_quiz') || '';
      sessionStorage.removeItem('tracktally_return_to_play');
      sessionStorage.removeItem('tracktally_artist_quiz');
      sessionStorage.removeItem('tracktally_playlist_quiz');
      cleanUrl();
      if (returnToPlay && !window.location.pathname.endsWith('/play.html')) { window.location.replace(playPageUrl(artistQuizId, playlistQuizId)); return true; }
      await loadSpotifyProfile();
    } catch (error) { showMessage(`Spotify-Verbindung fehlgeschlagen: ${error.message}`); cleanUrl(); }
    return true;
  }
  async function freshToken() {
    let data = tokenData();
    if (!data) return null;
    if (data.expires_at > Date.now() + 30_000) return data.access_token;
    if (!data.refresh_token || !configured()) return null;
    const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CONFIG.clientId, grant_type: 'refresh_token', refresh_token: data.refresh_token }) });
    const next = await response.json();
    if (!response.ok) { sessionStorage.removeItem('tracktally_token'); return null; }
    data = { ...data, ...next, expires_at: Date.now() + next.expires_in * 1000 };
    setToken(data); return data.access_token;
  }
  async function spotifyFetch(path) {
    return spotifyRequest(path);
  }
  async function spotifyRequest(path, options = {}) {
    const token = await freshToken(); if (!token) throw new Error('Deine Spotify-Sitzung ist abgelaufen. Bitte erneut verbinden.');
    const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(`https://api.spotify.com/v1${path}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error?.message || 'Spotify hat die Anfrage abgelehnt.'); }
    return response.status === 204 ? null : response.json();
  }
  async function loadSpotifyProfile() {
    try {
      showMessage('Deine Spotify-Startseite wird geladen …');
      const [profile, playlists, topArtists, followedArtists] = await Promise.all([
        spotifyFetch('/me'),
        spotifyFetch('/me/playlists?limit=50'),
        spotifyFetch('/me/top/artists?limit=10&time_range=medium_term').catch(() => ({ items: [] })),
        spotifyFetch('/me/following?type=artist&limit=10').catch(() => ({ artists: { items: [] } }))
      ]);
      const items = playlists.items || [];
      const artists = [...(topArtists.items || []), ...(followedArtists.artists?.items || [])];
      const uniqueArtists = [...new Map(artists.map(artist => [artist.id, artist])).values()];
      renderConnected(profile, items, uniqueArtists);
      const artistId = artistIdFromUrl();
      const playlistId = playlistIdFromUrl();
      if (artistId && window.location.pathname.endsWith('/play.html')) void startArtistQuiz(artistId);
      else if (playlistId && window.location.pathname.endsWith('/play.html')) void startPlaylistQuiz(playlistId);
    } catch (error) { showMessage(error.message); }
  }
  function renderConnected(profile, playlists, artists = []) {
    if (elements.authState) elements.authState.innerHTML = `<span class="spotify-pulse" aria-hidden="true">✓</span><div><strong>Verbunden als ${escapeHtml(profile.display_name || 'Spotify-Hörer:in')}</strong><small>${playlists.length} Playlist${playlists.length === 1 ? '' : 's'} verfügbar</small></div>`;
    if (elements.setupDescription) elements.setupDescription.textContent = 'Wähle eine Playlist für die nächste Runde.';
    elements.playlistControl?.classList.remove('disabled'); if (elements.playlistSelect) elements.playlistSelect.disabled = false;
    // Spotify now exposes the count through `items` and retains `tracks` only
    // for older API responses. Support both so valid playlists are not shown
    // as empty in the selector.
    const likedSongsOption = `<option value="${LIKED_SONGS_VALUE}">♥ Meine Lieblingssongs</option>`;
    const playlistOptions = playlists.map(item => {
      const trackTotal = item.items?.total ?? item.tracks?.total ?? 0;
      return `<option value="${item.id}">${escapeHtml(item.name)} · ${trackTotal} Songs</option>`;
    }).join('');
    if (elements.playlistSelect) elements.playlistSelect.innerHTML = likedSongsOption + playlistOptions;
    renderHomeCollections(playlists, artists);
    elements.connect?.classList.add('hidden'); elements.startPlaylist?.classList.remove('hidden');
  }
  function coverMarkup(imageUrl, fallback) {
    return imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" />` : `<span>${escapeHtml(fallback)}</span>`;
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
          elements.setupDescription.textContent = 'Spotify Premium Player bereit – wähle eine Playlist.';
          elements.setupDescription.style.color = '';
          resolve(true);
        });
        webPlayer.addListener('not_ready', () => { webPlayerDeviceId = undefined; });
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
        webPlayer.addListener('playback_error', () => showMessage('Dieser Titel kann auf diesem Spotify-Konto nicht wiedergegeben werden.'));
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
      if (elements.setupDescription) elements.setupDescription.textContent = `„${artist.name}“ wird geladen … Album ${Math.min(index + batch.length, albums.length)} von ${albums.length}`;
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
      if (elements.setupDescription) elements.setupDescription.textContent = 'Artist-Quiz wird vorbereitet …';
      const [playerReady, discography] = await Promise.all([prepareWebPlayer(), getArtistDiscography(artistId)]);
      if (!playerReady) throw new Error('Der Spotify Premium Player ist nicht verfügbar.');
      const playable = discography.tracks.filter(track => track.uri && track.artists?.some(artist => artist.id === artistId));
      if (playable.length < 4) throw new Error(`Für „${discography.artist.name}“ sind auf deinem Spotify-Konto zu wenige abspielbare Songs verfügbar.`);
      if (elements.setupDescription) elements.setupDescription.textContent = `„${discography.artist.name}“: ${playable.length} Songs bereit. Quiz startet …`;
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
      if (elements.playlistSelect && id !== LIKED_SONGS_VALUE) elements.playlistSelect.value = id;
      const selectedName = elements.playlistSelect?.selectedOptions?.[0]?.textContent?.split(' · ')[0] || 'Deine Playlist';
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
  async function startPlaylistGame() {
    const id = elements.playlistSelect.value; if (!id) return showMessage('Bitte wähle zuerst eine Musikquelle mit genügend Songs.');
    elements.startPlaylist.disabled = true; elements.startPlaylist.textContent = 'Playlist wird vorbereitet …';
    try {
      await startPlaylistQuiz(id);
    } catch (error) { showMessage(error.message); }
    finally { elements.startPlaylist.disabled = false; elements.startPlaylist.innerHTML = 'Quiz mit Playlist starten <span aria-hidden="true">→</span>'; }
  }
  function startDemo() { startGame('demo', DEMO_TRACKS); }
  function startGame(mode, tracks) {
    const count = Math.min(game.rounds, tracks.length);
    game = { mode, allTracks: tracks, questions: shuffle(tracks).slice(0, count), clipStarts: {}, index: 0, score: 0, correct: 0, streak: 0, bestStreak: 0, answered: false, rounds: count };
    elements.results.classList.add('hidden'); elements.setup.parentElement.classList.add('hidden'); elements.game.classList.remove('hidden');
    renderQuestion(); window.scrollTo({ top: elements.game.offsetTop - 20, behavior: 'smooth' });
  }
  function renderQuestion() {
    const track = game.questions[game.index]; game.answered = false;
    stopAudio(); elements.answers.innerHTML = ''; elements.feedback.classList.add('hidden'); elements.next.classList.add('hidden');
    elements.round.textContent = `RUNDE ${game.index + 1} / ${game.rounds}`; elements.score.textContent = game.score; elements.streak.textContent = `${game.streak}er-Streak`; elements.correct.textContent = game.correct; elements.bestStreak.textContent = game.bestStreak;
    elements.clue.textContent = isDemo() ? track.clue : 'Zufälliger Song-Ausschnitt · du hast einen Versuch.';
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
    if (!game.answered) resolveQuestion(game.questions[game.index], null, false, true);
    if (!isDemo() && spotifyPlaying) await stopSpotifyPlayback();
    else stopAudio();
    nextQuestion();
  }
  function resolveQuestion(track, button, right, timedOut) {
    if (game.answered) return; game.answered = true;
    elements.answers.querySelectorAll('.answer').forEach(item => { item.disabled = true; if (item.dataset.correct === 'true') item.classList.add('correct'); });
    if (right) { game.correct++; game.streak++; game.bestStreak = Math.max(game.bestStreak, game.streak); const elapsedTenths = Math.floor((Date.now() - game.roundStartedAt) / 100); const points = Math.max(0, 100 - elapsedTenths); game.score += points; elements.feedback.innerHTML = `<strong>Treffer! +${points} Punkte</strong> &nbsp; „${escapeHtml(track.name)}“` ; }
    else { if (button) button.classList.add('wrong'); game.streak = 0; elements.feedback.innerHTML = timedOut ? `Zeit abgelaufen! Die richtige Antwort: <strong>„${escapeHtml(track.name)}“</strong> von ${escapeHtml(track.artists[0].name)}` : `Die richtige Antwort: <strong>„${escapeHtml(track.name)}“</strong> von ${escapeHtml(track.artists[0].name)}`; }
    elements.score.textContent = game.score; elements.streak.textContent = `${game.streak}er-Streak`; elements.correct.textContent = game.correct; elements.bestStreak.textContent = game.bestStreak; elements.feedback.classList.remove('hidden'); elements.next.classList.add('hidden');
  }
  function nextQuestion() { if (game.index + 1 >= game.rounds) return finishGame(); game.index++; renderQuestion(); }
  function finishGame() {
    clearRoundTimer(); stopAudio(); elements.game.classList.add('hidden'); elements.results.classList.remove('hidden');
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
      await webPlayer.activateElement?.();
      await spotifyRequest('/me/player', { method: 'PUT', body: { device_ids: [webPlayerDeviceId], play: false } });
      await new Promise(resolve => setTimeout(resolve, 350));
      await spotifyRequest(`/me/player/play?device_id=${encodeURIComponent(webPlayerDeviceId)}`, { method: 'PUT', body: { uris: [track.uri], position_ms: game.clipStarts[questionKey] } });
      elements.play.classList.add('pause'); elements.vinyl.classList.add('playing'); elements.waveform.classList.add('playing');
      spotifyPlaying = true;
      return true;
    } catch (error) { showMessage(`Wiedergabe fehlgeschlagen: ${error.message}`); return false; }
  }
  async function startRoundPlayback(track) {
    if (isDemo()) { startDemoPlayback(); startRoundTimer(); return; }
    if (!webPlayerDeviceId) return showMessage('Der Spotify Premium Player wird noch vorbereitet. Bitte einen Moment warten.');
    const started = await playSpotifyTrack(track);
    if (started && !game.answered && game.questions[game.index] === track) startRoundTimer();
  }
  async function togglePreview() {
    if (isDemo()) return startDemoPlayback();
    if (!webPlayerDeviceId) return showMessage('Der Spotify Premium Player wird noch vorbereitet. Bitte einen Moment warten.');
    if (spotifyPlaying) return stopSpotifyPlayback();
    await playSpotifyTrack(game.questions[game.index]);
  }
  elements.audio?.addEventListener('play', () => { elements.play?.classList.add('pause'); elements.vinyl?.classList.add('playing'); elements.waveform?.classList.add('playing'); });
  elements.audio?.addEventListener('pause', () => { elements.play?.classList.remove('pause'); elements.vinyl?.classList.remove('playing'); elements.waveform?.classList.remove('playing'); });
  elements.audio?.addEventListener('timeupdate', () => { if (elements.time) elements.time.textContent = `0:${String(Math.floor(elements.audio.currentTime)).padStart(2, '0')}`; });
  elements.audio?.addEventListener('ended', stopAudio);
  function showConfigModal() { if (!elements.modal || !elements.redirect) return; elements.redirect.textContent = redirectUri(); elements.modal.classList.remove('hidden'); }
  function showMessage(message) { if (!elements.setupDescription) return; elements.setupDescription.textContent = message; elements.setupDescription.style.color = '#9c3350'; }
  async function copy(value, successElement) { try { await navigator.clipboard.writeText(value); const previous = successElement.textContent; successElement.textContent = 'Kopiert ✓'; setTimeout(() => successElement.textContent = previous, 1800); } catch { window.prompt('Kopiere diesen Text:', value); } }

  elements.connect?.addEventListener('click', beginSpotifyLogin);
  elements.headerConnect?.addEventListener('click', beginSpotifyLogin);
  elements.heroConnect?.addEventListener('click', openPlayPage);
  elements.demo?.addEventListener('click', startDemo);
  elements.startPlaylist?.addEventListener('click', startPlaylistGame);
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
  elements.leave?.addEventListener('click', clearRoundTimer);
  elements.backToSetup?.addEventListener('click', clearRoundTimer);
  handleAuthorizationReturn().then(returned => { if (!returned && tokenData()) loadSpotifyProfile(); });
  refreshHomeRailNavigation();
  makeWave();
})();
