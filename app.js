/* TrackTally: browser-only Spotify playlist quiz using OAuth 2.0 Authorization Code + PKCE. */
(function () {
  'use strict';

  // spotify.config.js may be blocked by privacy extensions or restrictive
  // browser policies. Keep the public PKCE client ID as a reliable fallback.
  // A Spotify client ID is intentionally public; never place a client secret here.
  const DEFAULT_CONFIG = {
    clientId: '4f5e3a37204446b683eecf6ccc47dff5',
    redirectUri: window.location.origin + window.location.pathname
  };
  const CONFIG = { ...DEFAULT_CONFIG, ...(window.TRACKTALLY_CONFIG || {}) };
  const PLACEHOLDER_ID = 'PASTE_YOUR_SPOTIFY_CLIENT_ID_HERE';
  const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-read-private'];
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
    setup: $('#setupPanel'), setupDescription: $('#setupDescription'), authState: $('#authState'), playlistControl: $('#playlistControl'), playlistSelect: $('#playlistSelect'), connect: $('#connectButton'), headerConnect: $('#headerConnect'), heroConnect: $('#heroConnect'), demo: $('#demoStart'), startPlaylist: $('#startPlaylistGame'), game: $('#gameShell'), results: $('#resultCard'), audio: $('#previewAudio'), play: $('#playPreview'), waveform: $('#waveform'), time: $('#previewTime'), answers: $('#answerGrid'), feedback: $('#answerFeedback'), next: $('#nextQuestion'), round: $('#roundCounter'), score: $('#score'), streak: $('#streak'), correct: $('#correctCount'), bestStreak: $('#bestStreak'), clue: $('#trackClue'), vinyl: $('#trackVisual').querySelector('.vinyl'), leave: $('#leaveGame'), share: $('#shareGame'), playAgain: $('#playAgain'), backToSetup: $('#backToSetup'), modal: $('#configModal'), closeModal: $('#closeModal'), redirect: $('#redirectUri'), copyRedirect: $('#copyRedirect'), resultTitle: $('#resultTitle'), resultCopy: $('#resultCopy'), finalScore: $('#finalScore')
  };
  let game = { mode: 'demo', allTracks: [], questions: [], index: 0, score: 0, correct: 0, streak: 0, bestStreak: 0, answered: false, rounds: 10 };
  let audioContext;

  function redirectUri() { return CONFIG.redirectUri || window.location.origin + window.location.pathname; }
  function configured() { return CONFIG.clientId && CONFIG.clientId !== PLACEHOLDER_ID; }
  function tokenData() { try { return JSON.parse(sessionStorage.getItem('tracktally_token') || 'null'); } catch { return null; } }
  function setToken(data) { sessionStorage.setItem('tracktally_token', JSON.stringify(data)); }
  function shuffle(items) { return [...items].sort(() => Math.random() - .5); }
  function cleanUrl() { history.replaceState({}, document.title, window.location.pathname); }
  function isDemo() { return game.mode === 'demo'; }

  function makeWave() {
    elements.waveform.innerHTML = Array.from({ length: 58 }, (_, i) => `<i style="height:${5 + ((i * 17 + 11) % 24)}px"></i>`).join('');
  }
  function setRounds(value) {
    game.rounds = Number(value);
    document.querySelectorAll('[data-rounds]').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.rounds) === game.rounds));
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
    if (error) { showMessage(`Spotify-Login abgebrochen: ${error}.`); cleanUrl(); return true; }
    if (state !== sessionStorage.getItem('tracktally_state')) { showMessage('Der Spotify-Login konnte aus Sicherheitsgründen nicht bestätigt werden. Bitte erneut versuchen.'); cleanUrl(); return true; }
    try {
      const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CONFIG.clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: sessionStorage.getItem('tracktally_verifier') || '' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || data.error || 'Token konnte nicht geladen werden');
      setToken({ ...data, expires_at: Date.now() + data.expires_in * 1000 });
      cleanUrl();
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
    const token = await freshToken(); if (!token) throw new Error('Deine Spotify-Sitzung ist abgelaufen. Bitte erneut verbinden.');
    const response = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error?.message || 'Spotify hat die Anfrage abgelehnt.'); }
    return response.json();
  }
  async function loadSpotifyProfile() {
    try {
      showMessage('Deine Spotify-Playlists werden geladen …');
      const [profile, playlists] = await Promise.all([spotifyFetch('/me'), spotifyFetch('/me/playlists?limit=50')]);
      const items = playlists.items || [];
      renderConnected(profile, items);
    } catch (error) { showMessage(error.message); }
  }
  function renderConnected(profile, playlists) {
    elements.authState.innerHTML = `<span class="spotify-pulse" aria-hidden="true">✓</span><div><strong>Verbunden als ${escapeHtml(profile.display_name || 'Spotify-Hörer:in')}</strong><small>${playlists.length} Playlist${playlists.length === 1 ? '' : 's'} verfügbar</small></div>`;
    elements.setupDescription.textContent = 'Wähle eine Playlist für die nächste Runde.';
    elements.playlistControl.classList.remove('disabled'); elements.playlistSelect.disabled = false;
    elements.playlistSelect.innerHTML = playlists.length ? playlists.map(item => `<option value="${item.id}">${escapeHtml(item.name)} · ${item.tracks?.total ?? 0} Songs</option>`).join('') : '<option value="">Keine Playlist gefunden</option>';
    elements.connect.classList.add('hidden'); elements.startPlaylist.classList.remove('hidden');
  }
  function escapeHtml(value) { const temp = document.createElement('span'); temp.textContent = value; return temp.innerHTML; }
  async function getPlaylistTracks(id) {
    try {
      const data = await spotifyFetch(`/playlists/${encodeURIComponent(id)}/items?limit=100&additional_types=track`);
      return (data.items || []).map(item => item.item || item.track).filter(track => track && track.type === 'track');
    } catch (firstError) {
      const data = await spotifyFetch(`/playlists/${encodeURIComponent(id)}/tracks?limit=100`);
      return (data.items || []).map(item => item.track).filter(Boolean);
    }
  }
  async function startPlaylistGame() {
    const id = elements.playlistSelect.value; if (!id) return showMessage('Bitte wähle zuerst eine Playlist mit genügend Songs.');
    elements.startPlaylist.disabled = true; elements.startPlaylist.textContent = 'Playlist wird vorbereitet …';
    try {
      const tracks = await getPlaylistTracks(id);
      const playable = tracks.filter(track => track.preview_url && track.artists?.[0]?.name);
      if (playable.length < 4) throw new Error('In dieser Playlist sind zu wenige Songs mit einer verfügbaren Hörprobe. Wähle bitte eine andere Playlist.');
      startGame('spotify', playable);
    } catch (error) { showMessage(error.message); }
    finally { elements.startPlaylist.disabled = false; elements.startPlaylist.innerHTML = 'Quiz mit Playlist starten <span aria-hidden="true">→</span>'; }
  }
  function startDemo() { startGame('demo', DEMO_TRACKS); }
  function startGame(mode, tracks) {
    const count = Math.min(game.rounds, tracks.length);
    game = { mode, allTracks: tracks, questions: shuffle(tracks).slice(0, count), index: 0, score: 0, correct: 0, streak: 0, bestStreak: 0, answered: false, rounds: count };
    elements.results.classList.add('hidden'); elements.setup.parentElement.classList.add('hidden'); elements.game.classList.remove('hidden');
    renderQuestion(); window.scrollTo({ top: elements.game.offsetTop - 20, behavior: 'smooth' });
  }
  function renderQuestion() {
    const track = game.questions[game.index]; game.answered = false;
    stopAudio(); elements.answers.innerHTML = ''; elements.feedback.classList.add('hidden'); elements.next.classList.add('hidden');
    elements.round.textContent = `RUNDE ${game.index + 1} / ${game.rounds}`; elements.score.textContent = game.score; elements.streak.textContent = `${game.streak}er-Streak`; elements.correct.textContent = game.correct; elements.bestStreak.textContent = game.bestStreak;
    elements.clue.textContent = isDemo() ? track.clue : 'Hör genau hin – du hast einen Versuch.';
    const distractors = shuffle(game.allTracks.filter(item => item !== track && item.artists?.[0]?.name !== track.artists?.[0]?.name)).slice(0, 3);
    const options = shuffle([track, ...distractors]);
    options.forEach((option, index) => { const button = document.createElement('button'); button.className = 'answer'; button.dataset.correct = String(option === track); button.innerHTML = `<span class="answer-letter">${'ABCD'[index]}</span>${escapeHtml(option.artists[0].name)}`; button.addEventListener('click', () => answerQuestion(button, track)); elements.answers.appendChild(button); });
    if (!isDemo()) elements.audio.src = track.preview_url;
    makeWave();
  }
  function answerQuestion(button, track) {
    if (game.answered) return; game.answered = true; stopAudio();
    const right = button.dataset.correct === 'true';
    elements.answers.querySelectorAll('.answer').forEach(item => { item.disabled = true; if (item.dataset.correct === 'true') item.classList.add('correct'); });
    if (right) { game.correct++; game.streak++; game.bestStreak = Math.max(game.bestStreak, game.streak); const points = 100 + Math.min(game.streak - 1, 5) * 25; game.score += points; elements.feedback.innerHTML = `<strong>Treffer! +${points} Punkte</strong> &nbsp; ${escapeHtml(track.name)}`; }
    else { button.classList.add('wrong'); game.streak = 0; elements.feedback.innerHTML = `Das war <strong>${escapeHtml(track.artists[0].name)}</strong> – „${escapeHtml(track.name)}“`; }
    elements.score.textContent = game.score; elements.streak.textContent = `${game.streak}er-Streak`; elements.correct.textContent = game.correct; elements.bestStreak.textContent = game.bestStreak; elements.feedback.classList.remove('hidden'); elements.next.textContent = game.index + 1 === game.rounds ? 'Ergebnis ansehen →' : 'Nächste Runde →'; elements.next.classList.remove('hidden');
  }
  function nextQuestion() { if (game.index + 1 >= game.rounds) return finishGame(); game.index++; renderQuestion(); }
  function finishGame() {
    stopAudio(); elements.game.classList.add('hidden'); elements.results.classList.remove('hidden');
    const ratio = game.correct / game.rounds; elements.resultTitle.textContent = ratio >= .8 ? 'Musiklexikon!' : ratio >= .5 ? 'Starke Runde!' : 'Nächste Runde gehört euch!'; elements.resultCopy.textContent = `Du hast ${game.correct} von ${game.rounds} Songs erraten.`; elements.finalScore.textContent = game.score; window.scrollTo({ top: elements.results.offsetTop - 40, behavior: 'smooth' });
  }
  function stopAudio() { if (!isDemo()) { elements.audio.pause(); elements.audio.currentTime = 0; } elements.play.classList.remove('pause'); elements.vinyl.classList.remove('playing'); elements.waveform.classList.remove('playing'); elements.time.textContent = '0:00'; }
  function playDemoTone() {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioContext.currentTime; const notes = [220, 277.18, 329.63, 440, 329.63, 277.18];
    notes.forEach((frequency, index) => { const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.type = index % 2 ? 'triangle' : 'sine'; osc.frequency.value = frequency; gain.gain.setValueAtTime(.0001, now + index * .23); gain.gain.exponentialRampToValueAtTime(.07, now + index * .23 + .02); gain.gain.exponentialRampToValueAtTime(.0001, now + index * .23 + .22); osc.connect(gain).connect(audioContext.destination); osc.start(now + index * .23); osc.stop(now + index * .23 + .23); });
  }
  function togglePreview() {
    if (isDemo()) { playDemoTone(); elements.play.classList.add('pause'); elements.vinyl.classList.add('playing'); elements.waveform.classList.add('playing'); setTimeout(() => { elements.play.classList.remove('pause'); elements.vinyl.classList.remove('playing'); elements.waveform.classList.remove('playing'); }, 1400); return; }
    if (!elements.audio.src) return; if (elements.audio.paused) elements.audio.play().catch(() => showMessage('Die Hörprobe konnte nicht gestartet werden.')); else elements.audio.pause();
  }
  elements.audio.addEventListener('play', () => { elements.play.classList.add('pause'); elements.vinyl.classList.add('playing'); elements.waveform.classList.add('playing'); });
  elements.audio.addEventListener('pause', () => { elements.play.classList.remove('pause'); elements.vinyl.classList.remove('playing'); elements.waveform.classList.remove('playing'); });
  elements.audio.addEventListener('timeupdate', () => { elements.time.textContent = `0:${String(Math.floor(elements.audio.currentTime)).padStart(2, '0')}`; });
  elements.audio.addEventListener('ended', stopAudio);
  function showConfigModal() { elements.redirect.textContent = redirectUri(); elements.modal.classList.remove('hidden'); }
  function showMessage(message) { elements.setupDescription.textContent = message; elements.setupDescription.style.color = '#9c3350'; }
  async function copy(value, successElement) { try { await navigator.clipboard.writeText(value); const previous = successElement.textContent; successElement.textContent = 'Kopiert ✓'; setTimeout(() => successElement.textContent = previous, 1800); } catch { window.prompt('Kopiere diesen Text:', value); } }

  elements.connect.addEventListener('click', beginSpotifyLogin); elements.headerConnect.addEventListener('click', beginSpotifyLogin); elements.heroConnect.addEventListener('click', beginSpotifyLogin); elements.demo.addEventListener('click', startDemo); elements.startPlaylist.addEventListener('click', startPlaylistGame); elements.play.addEventListener('click', togglePreview); elements.next.addEventListener('click', nextQuestion); elements.leave.addEventListener('click', () => { stopAudio(); elements.game.classList.add('hidden'); elements.setup.parentElement.classList.remove('hidden'); }); elements.playAgain.addEventListener('click', () => startGame(game.mode, game.allTracks)); elements.backToSetup.addEventListener('click', () => { elements.results.classList.add('hidden'); elements.setup.parentElement.classList.remove('hidden'); window.scrollTo({ top: elements.setup.offsetTop - 50, behavior: 'smooth' }); }); elements.share.addEventListener('click', () => copy(window.location.href, elements.share)); elements.closeModal.addEventListener('click', () => elements.modal.classList.add('hidden')); elements.modal.addEventListener('click', event => { if (event.target === elements.modal) elements.modal.classList.add('hidden'); }); elements.copyRedirect.addEventListener('click', () => copy(redirectUri(), elements.copyRedirect));
  handleAuthorizationReturn().then(returned => { if (!returned && tokenData()) loadSpotifyProfile(); });
  makeWave();
})();
