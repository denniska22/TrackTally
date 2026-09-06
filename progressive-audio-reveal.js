(function () {
  'use strict';
  const { Game, STAGES, GENRES, normalize, sameTrack, uniqueTracks, sample } = window.TrackTallyReveal;
  const api = window.TrackTallySpotify;
  const $ = id => document.getElementById(id);
  const el = Object.fromEntries(['Connect', 'Score', 'Stages', 'Genres', 'Status', 'Retry', 'Game', 'Progress', 'Play', 'Duration', 'PlaybackLabel', 'ClipMeter', 'Volume', 'VolumeValue', 'GuessForm', 'Suggestions', 'Skip', 'Selection', 'SelectedName', 'Submit', 'Meta', 'Feedback', 'Attempts', 'Answer', 'AnswerTitle', 'RoundPoints', 'AnswerTrack', 'AnswerCopy', 'Next', 'Results', 'Total', 'Summary', 'ResultRows', 'Copy', 'Download', 'CopyLink', 'Restart', 'ShareFallback', 'ShareStatus'].map(name => [name, $(`reveal${name}`)]));
  const input = $('audioRevealSearch');
  const SAVE_KEY = 'tracktally_reveal_round_v1';
  const read = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
  const write = (storage, key, value) => { try { storage.setItem(key, value); } catch { /* Progress storage is optional. */ } };
  let game = null, genre = 'taste', catalog = [], selected = null, suggestions = [], activeSuggestion = -1;
  let loading = false, loadId = 0, searchId = 0, searchTimer;
  const catalogs = new Map();
  const player = new window.TrackTallyRevealPlayer(api, {
    onState(phase, progress) {
      el.Play.classList.toggle('playing', phase === 'playing');
      el.Play.setAttribute('aria-label', phase === 'playing' ? 'Ausschnitt stoppen' : phase === 'loading' ? 'Wiedergabe wird vorbereitet' : 'Ausschnitt abspielen');
      el.PlaybackLabel.textContent = phase === 'loading' ? 'Wird vorbereitet …' : phase === 'playing' ? 'Wird abgespielt' : 'Ausschnitt';
      el.ClipMeter.firstElementChild.style.width = `${progress * 100}%`;
      controls();
    },
    onError(message) { status(message, true); }
  });
  const savedVolume = Number(read(localStorage, 'tracktally_volume') ?? 65);
  el.Volume.value = String(Number.isFinite(savedVolume) ? Math.min(100, Math.max(0, savedVolume)) : 65);
  void player.setVolume(Number(el.Volume.value) / 100);
  el.VolumeValue.textContent = `${el.Volume.value} %`;
  function node(tag, text = '', className = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function status(message, error = false) {
    el.Status.textContent = message;
    el.Status.classList.toggle('error', error);
  }
  function persist() { if (game) write(sessionStorage, SAVE_KEY, JSON.stringify(game.snapshot())); }
  function controls() {
    const blocked = loading || ['loading', 'stopping'].includes(player.phase);
    const playable = Boolean(game && !game.solved && api.hasSession() && api.hasScopes());
    el.Play.disabled = !playable || blocked;
    el.Skip.disabled = input.disabled = !playable || blocked;
    el.Submit.disabled = !playable || blocked || !selected;
    el.Genres.querySelectorAll('button').forEach(button => { button.disabled = blocked; });
    el.Restart.disabled = blocked;
    el.Next.disabled = blocked;
    el.Game.setAttribute('aria-busy', String(loading));
  }
  function resetSearch() {
    clearTimeout(searchTimer);
    searchId++;
    selected = null;
    input.value = '';
    el.Selection.hidden = true;
    closeSuggestions();
  }
  function closeSuggestions() {
    el.Suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeSuggestion = -1;
  }
  function trackLabel(track) { return `${track.name} · ${track.artists.map(artist => artist.name).join(', ')}`; }
  function trackView(track) {
    const wrapper = node('div', '', 'reveal-track-info');
    const imageUrl = track.album?.images?.[0]?.url;
    if (imageUrl && /^https:\/\//.test(imageUrl)) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.width = image.height = 56;
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove(), { once: true });
      wrapper.append(image);
    }
    const copy = node('div');
    copy.append(node('strong', track.name), node('small', track.artists.map(artist => artist.name).join(', ')));
    wrapper.append(copy);
    return wrapper;
  }
  function trackLink(track) {
    const link = node('a', 'Auf Spotify anhören ↗', 'reveal-spotify-link');
    link.href = `https://open.spotify.com/track/${encodeURIComponent(track.id)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }
  function render() {
    const stage = game?.stage || STAGES[0];
    document.documentElement.style.setProperty('--reveal-accent', stage.color);
    el.Stages.replaceChildren(...STAGES.map((item, index) => {
      const result = game?.results[index];
      const pill = node('li', `${result ? result.won ? '✓ ' : '× ' : ''}${item.label}`, `audio-reveal-pill difficulty${game?.index === index || !game && index === 0 ? ' active' : ''}`);
      if ((game?.index || 0) === index) pill.setAttribute('aria-current', 'step');
      if (result) pill.classList.add(result.won ? 'stage-won' : 'stage-lost');
      return pill;
    }));
    el.Genres.querySelectorAll('button').forEach(button => {
      const active = button.dataset.genre === genre;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    el.Score.textContent = `${game?.complete ? '5 / 5 Songs' : `Song ${(game?.index || 0) + 1} / 5`} · ${game?.total || 0} Punkte`;
    el.Progress.setAttribute('aria-valuenow', String(game?.results.length || 0));
    el.Progress.replaceChildren(...STAGES.map((item, index) => {
      const bar = node('i');
      if (game?.results[index]) bar.style.background = game.results[index].won ? item.color : '#8e4d58';
      else if ((game?.index || 0) === index) bar.style.background = item.color;
      return bar;
    }));
    const seconds = game?.seconds || 1;
    el.Duration.textContent = `${seconds.toLocaleString('de-DE', { minimumFractionDigits: seconds >= 1 ? 1 : 0, maximumFractionDigits: 2 })} s`;
    el.Meta.textContent = `${game?.attempts.length || 0} / 6 Versuche · ${stage.label} · ${GENRES[genre]}`;
    el.Game.hidden = Boolean(game?.solved);
    el.Answer.hidden = !game?.solved || game.complete;
    el.Results.hidden = !game?.complete;
    el.Attempts.replaceChildren(...(game?.attempts || []).map((attempt, index) => node('li', `${index + 1}. ${attempt.track ? trackLabel(attempt.track) : 'Übersprungen'} ${attempt.won ? '✓' : '×'}`, attempt.won ? 'won' : 'miss')));
    if (game?.solved && !game.complete) {
      const result = game.results.at(-1);
      el.AnswerTitle.textContent = result.won ? `${stage.label} · Richtig erkannt!` : `${stage.label} · Das war der Song`;
      el.RoundPoints.textContent = `+${result.points} Punkte`;
      el.AnswerTrack.replaceChildren(trackView(result.track), trackLink(result.track));
      el.AnswerCopy.textContent = `${result.attempts.length} / 6 Versuche · Insgesamt ${game.total} Punkte`;
      el.Next.textContent = `Weiter zu ${STAGES[game.index + 1].label} →`;
    }
    if (game?.complete) {
      el.Total.textContent = `${game.total} Punkte`;
      el.Summary.textContent = `${game.results.filter(result => result.won).length} / 5 Songs erkannt · ${GENRES[genre]}`;
      el.ResultRows.replaceChildren(...game.results.map(result => {
        const row = node('li');
        const heading = node('div', '', 'reveal-result-heading');
        heading.append(node('strong', STAGES[result.stage].label), node('span', `${result.points} Punkte`));
        const marks = node('div', '', 'reveal-result-marks');
        marks.setAttribute('aria-label', `${result.won ? 'Erkannt' : 'Nicht erkannt'} nach ${result.attempts.length} Versuchen`);
        for (let index = 0; index < 6; index++) {
          const attempt = result.attempts[index];
          marks.append(node('span', attempt?.won ? '✓' : attempt ? '×' : '·', attempt ? attempt.won ? 'won' : 'miss' : 'pending'));
        }
        row.append(heading, trackView(result.track), marks, trackLink(result.track));
        return row;
      }));
    }
    controls();
  }
  async function loadCatalog(category) {
    if (catalogs.has(category)) return catalogs.get(category);
    let tracks = [];
    if (category === 'taste') {
      const results = await Promise.allSettled([
        api.request('/me/top/tracks?limit=50&time_range=medium_term'),
        api.request('/me/tracks?limit=50')
      ]);
      tracks = results.flatMap((result, index) => result.status === 'fulfilled' ? (result.value.items || []).map(item => index === 1 ? item.track : item) : []);
      if (uniqueTracks(tracks).length < 5) {
        const error = results.find(result => result.status === 'rejected');
        if (error) throw error.reason;
      }
    } else {
      for (let index = 0; index < 2; index++) {
        // Search has a maximum page size of 10. Different pages broaden the pool.
        const offset = index * 10;
        const query = new URLSearchParams({ q: `genre:"${category}"`, type: 'track', limit: '10', offset: String(offset) });
        const data = await api.request(`/search?${query}`);
        tracks.push(...(data.tracks?.items || []));
      }
    }
    tracks = uniqueTracks(tracks);
    if (tracks.length < 5) throw new Error(category === 'taste' ? 'Für „Mein Geschmack“ brauchst du mindestens fünf verfügbare Top- oder Lieblingssongs. Wähle sonst eine andere Kategorie.' : 'In dieser Kategorie wurden nicht genügend spielbare Songs gefunden. Wähle eine andere Kategorie oder lade erneut.');
    catalogs.set(category, tracks);
    return tracks;
  }
  async function start(category = genre, restore = false) {
    const request = ++loadId;
    const previous = game;
    genre = category;
    resetSearch();
    await player.stop();
    if (request !== loadId) return;
    game = restore ? previous : null;
    el.Feedback.textContent = '';
    el.ShareStatus.textContent = '';
    el.ShareFallback.hidden = true;
    el.Retry.hidden = true;
    if (!restore) { try { sessionStorage.removeItem(SAVE_KEY); } catch {} }
    if (!api.hasSession() || !api.hasScopes()) {
      status('Verbinde Spotify, um mit deinen Songs zu spielen. Für die Wiedergabe brauchst du Spotify Premium.');
      el.Connect.hidden = false;
      render();
      return;
    }
    loading = true;
    el.Connect.hidden = true;
    status('Deine Songs werden geladen …');
    render();
    try {
      const tracks = await loadCatalog(category);
      if (request !== loadId) return;
      catalog = tracks;
      if (!restore || !game) {
        const fresh = tracks.filter(track => !previous?.tracks.some(old => sameTrack(old, track)));
        game = new Game(sample(fresh.length >= 5 ? fresh : tracks), category);
      }
      persist();
      status('Höre den Ausschnitt an und suche den Song.');
      // Preparing early allows activateElement to run directly inside the click.
      void player.prepare().catch(error => { if (request === loadId) status(error.message, true); });
    } catch (error) {
      if (request !== loadId) return;
      status(error.message || 'Songs konnten nicht geladen werden.', true);
      el.Retry.hidden = false;
      el.Connect.hidden = false;
      el.Connect.textContent = 'Spotify erneut verbinden';
    } finally {
      if (request === loadId) { loading = false; render(); }
    }
  }
  function showSuggestions(tracks) {
    suggestions = tracks;
    activeSuggestion = -1;
    input.removeAttribute('aria-activedescendant');
    el.Suggestions.replaceChildren(...tracks.map((track, index) => {
      const option = node('li', '', 'reveal-suggestion');
      option.id = `reveal-option-${index}`;
      option.role = 'option';
      option.setAttribute('aria-selected', 'false');
      option.dataset.index = String(index);
      option.append(trackView(track));
      return option;
    }));
    el.Suggestions.hidden = !tracks.length;
    input.setAttribute('aria-expanded', String(Boolean(tracks.length)));
  }
  async function search(query, request) {
    const isCurrent = () => request === searchId && game && !game.solved;
    const terms = query.trim().split(/\s+/).map(normalize);
    const local = uniqueTracks([...catalog, ...(game?.tracks || [])]).filter(track => terms.every(term => normalize(trackLabel(track)).includes(term)));
    if (!isCurrent()) return;
    showSuggestions(local.slice(0, 10));
    el.Feedback.textContent = local.length ? '' : 'Songs werden gesucht …';
    try {
      const data = await api.request(`/search?${new URLSearchParams({ q: query, type: 'track', limit: '10' })}`);
      if (!isCurrent()) return;
      const tracks = uniqueTracks([...local, ...(data.tracks?.items || [])]).slice(0, 10);
      showSuggestions(tracks);
      el.Feedback.textContent = tracks.length ? '' : 'Keine Songs gefunden. Versuche einen anderen Titel oder Artist.';
    } catch (error) {
      if (isCurrent()) el.Feedback.textContent = local.length ? 'Die Spotify-Suche ist gerade nicht verfügbar. Du kannst einen Treffer aus deinen geladenen Songs wählen.' : error.message;
    }
  }
  function choose(index) {
    if (!suggestions[index]) return;
    selected = suggestions[index];
    ++searchId;
    clearTimeout(searchTimer);
    input.value = trackLabel(selected);
    el.SelectedName.textContent = trackLabel(selected);
    el.Selection.hidden = false;
    el.Feedback.textContent = '';
    closeSuggestions();
    controls();
    el.Submit.focus();
  }
  function answer(track) {
    if (!game || game.solved || loading || ['loading', 'stopping'].includes(player.phase)) return;
    const result = game.guess(track);
    if (result.duplicate) { el.Feedback.textContent = 'Diesen Song hast du bereits versucht. Wähle einen anderen; kein Versuch wurde verbraucht.'; return; }
    void player.stop();
    resetSearch();
    el.Feedback.textContent = result.finished ? '' : track ? 'Noch nicht richtig. Der nächste Ausschnitt ist länger.' : 'Übersprungen. Du kannst jetzt einen längeren Ausschnitt hören.';
    persist();
    render();
    if (game.complete) el.Restart.focus();
    else if (game.solved) el.Next.focus();
    else el.Play.focus();
  }
  const gameUrl = new URL('progressive-audio-reveal.html', location.href).href;
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); el.ShareFallback.hidden = true; el.ShareStatus.textContent = 'Kopiert!'; }
    catch { el.ShareFallback.value = text; el.ShareFallback.hidden = false; el.ShareFallback.focus(); el.ShareFallback.select(); el.ShareStatus.textContent = 'Bitte kopiere den markierten Text.'; }
  }
  function downloadCard() {
    if (!game?.complete) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1420;
    const ctx = canvas.getContext('2d');
    if (!ctx) { el.ShareStatus.textContent = 'Die Karte konnte nicht erstellt werden. Kopiere stattdessen dein Ergebnis.'; return; }
    ctx.fillStyle = '#0d0b0a'; ctx.fillRect(0, 0, 1080, 1420);
    function text(value, x, y, size, color = '#f7f3ee', bold = false) {
      ctx.font = `${bold ? 700 : 400} ${size}px system-ui, sans-serif`;
      ctx.fillStyle = color;
      let label = value;
      while (ctx.measureText(label).width > 920 && label.length > 1) label = label.slice(0, -2) + '…';
      ctx.fillText(label, x, y);
    }
    text('tracktally', 80, 115, 58, '#3bd4a0', true);
    text('PROGRESSIVE AUDIO REVEAL', 80, 167, 25, '#a9b8c8');
    text(`${game.total} Punkte`, 80, 270, 76, '#f7f3ee', true);
    text(`${game.results.filter(result => result.won).length}/5 Songs erkannt · ${GENRES[genre]}`, 80, 320, 30, '#a9b8c8');
    game.results.forEach((result, index) => {
      const y = 405 + index * 175;
      text(`${STAGES[index].label} · ${result.points} Punkte`, 80, y, 29, STAGES[index].color, true);
      text(result.track.name, 80, y + 42, 30, '#f7f3ee', true);
      text(result.track.artists.map(artist => artist.name).join(', '), 80, y + 77, 25, '#a9b8c8');
      for (let attempt = 0; attempt < 6; attempt++) {
        const entry = result.attempts[attempt];
        ctx.fillStyle = !entry ? '#292725' : entry.won ? '#3bd4a0' : '#ad5965';
        ctx.fillRect(80 + attempt * 42, y + 96, 30, 18);
      }
    });
    text('5 Songs. 6 Versuche. Wie gut kennst du deine Musik?', 80, 1345, 26, '#a9b8c8');
    canvas.toBlob(blob => {
      if (!blob) { el.ShareStatus.textContent = 'Die Karte konnte nicht gespeichert werden. Bitte erneut versuchen.'; return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'tracktally-ergebnis.png';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      el.ShareStatus.textContent = 'Deine Ergebniskarte wurde erstellt.';
    }, 'image/png');
  }
  el.Genres.replaceChildren(...Object.entries(GENRES).map(([key, label]) => {
    const button = node('button', label, 'audio-reveal-pill genre');
    button.type = 'button'; button.dataset.genre = key;
    button.addEventListener('click', () => { if (key !== genre) void start(key); });
    return button;
  }));
  el.Connect.addEventListener('click', () => { void api.connect().catch(error => status(error.message, true)); });
  el.Retry.addEventListener('click', () => { catalogs.delete(genre); void start(genre, Boolean(game)); });
  el.Play.addEventListener('click', () => {
    if (player.phase === 'playing') { void player.stop(); return; }
    if (game && !game.solved) { status('Höre den Ausschnitt an und suche den Song.'); void player.play(game.track, game.seconds); }
  });
  el.Volume.addEventListener('input', () => {
    write(localStorage, 'tracktally_volume', el.Volume.value);
    el.VolumeValue.textContent = `${el.Volume.value} %`;
    void player.setVolume(Number(el.Volume.value) / 100).catch(() => status('Lautstärke konnte nicht geändert werden.', true));
  });
  input.addEventListener('input', () => {
    const request = ++searchId;
    clearTimeout(searchTimer);
    selected = null; el.Selection.hidden = true; closeSuggestions(); controls();
    const query = input.value.trim();
    el.Feedback.textContent = query.length === 1 ? 'Gib mindestens zwei Zeichen ein.' : '';
    if (query.length >= 2) searchTimer = setTimeout(() => { void search(query, request); }, 400);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeSuggestions(); return; }
    if (el.Suggestions.hidden) return;
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      activeSuggestion = (activeSuggestion + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      [...el.Suggestions.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSuggestion)));
      const option = el.Suggestions.children[activeSuggestion];
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') { event.preventDefault(); choose(activeSuggestion < 0 ? 0 : activeSuggestion); }
  });
  el.Suggestions.addEventListener('click', event => { const option = event.target.closest('[data-index]'); if (option) choose(Number(option.dataset.index)); });
  document.addEventListener('click', event => { if (!event.target.closest('.reveal-search-wrap')) closeSuggestions(); });
  el.GuessForm.addEventListener('submit', event => { event.preventDefault(); if (selected) answer(selected); });
  el.Skip.addEventListener('click', () => answer(null));
  el.Next.addEventListener('click', () => {
    if (!game?.next()) return;
    resetSearch(); el.Feedback.textContent = ''; status('Höre den Ausschnitt an und suche den Song.'); persist(); render(); el.Play.focus();
  });
  el.Restart.addEventListener('click', () => { void start(); });
  el.Copy.addEventListener('click', () => { if (game?.complete) void copyText(game.shareText(gameUrl)); });
  el.CopyLink.addEventListener('click', () => { void copyText(gameUrl); });
  el.Download.addEventListener('click', downloadCard);
  document.addEventListener('visibilitychange', () => { if (document.hidden) void player.stop(); });
  window.addEventListener('pagehide', () => player.dispose());
  try { game = Game.restore(JSON.parse(read(sessionStorage, SAVE_KEY) || 'null')); } catch { /* Start fresh if storage is invalid. */ }
  if (game) genre = game.genre;
  render();
  void start(genre, Boolean(game));
})();
