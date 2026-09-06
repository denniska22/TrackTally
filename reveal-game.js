/* Pure game rules; shared by the browser and the Node test runner. */
(function (root) {
  'use strict';
  const STAGES = Object.freeze([
    { label: 'Easy', color: '#3bd4a0', clips: [1, 2, 4, 7, 11, 16], multiplier: 1 },
    { label: 'Medium', color: '#f5c518', clips: [.1, .5, 1, 2, 4, 8], multiplier: 1.15 },
    { label: 'Hard', color: '#fb923c', clips: [.08, .2, .5, 1, 2, 4], multiplier: 1.3 },
    { label: 'Expert', color: '#f87171', clips: [.05, .1, .3, .8, 2, 4], multiplier: 1.5 },
    { label: 'Impossible', color: '#b99aff', clips: [.03, .08, .15, .4, 1, 2], multiplier: 1.75 }
  ]);
  const GENRES = Object.freeze({ taste: 'Mein Geschmack', pop: 'Pop', 'hip-hop': 'Hip-Hop' });
  const POINTS = [100, 85, 70, 55, 40, 25];
  const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const title = value => normalize(String(value || '').replace(/\s*[-–(]\s*(?:\d{4}\s+)?remaster(?:ed)?[^)]*\)?$/i, ''));
  function sameTrack(a, b) {
    if (!a || !b) return false;
    const ids = [a.id, a.linked_from?.id].filter(Boolean);
    if ([b.id, b.linked_from?.id].some(id => id && ids.includes(id))) return true;
    if (a.external_ids?.isrc && a.external_ids.isrc === b.external_ids?.isrc) return true;
    return Boolean(title(a.name)) && title(a.name) === title(b.name) &&
      (a.artists || []).some(first => (b.artists || []).some(second => normalize(first.name) && normalize(first.name) === normalize(second.name)));
  }
  function uniqueTracks(tracks) {
    const result = [];
    for (const track of tracks) {
      if (!track || !track.id || !track.name || !track.artists?.length || track.is_local || track.is_playable === false || !/^spotify:track:[a-zA-Z0-9]+$/.test(track.uri || '')) continue;
      if (track.duration_ms && track.duration_ms < 17000) continue;
      if (!result.some(other => sameTrack(other, track))) result.push(track);
    }
    return result;
  }
  function sample(tracks, random = Math.random) {
    const items = uniqueTracks(tracks);
    for (let index = items.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [items[index], items[other]] = [items[other], items[index]];
    }
    return items.slice(0, 5);
  }
  class Game {
    constructor(tracks, genre = 'taste') {
      if (tracks.length !== 5 || uniqueTracks(tracks).length !== 5) throw new Error('Für eine Runde werden fünf unterschiedliche, spielbare Songs benötigt.');
      if (!GENRES[genre]) throw new Error('Unbekannte Kategorie.');
      this.tracks = tracks;
      this.genre = genre;
      this.index = 0;
      this.attempts = [];
      this.results = [];
    }
    get stage() { return STAGES[this.index]; }
    get track() { return this.tracks[this.index]; }
    get solved() { return this.results.length > this.index; }
    get complete() { return this.results.length === 5; }
    get seconds() { return this.stage.clips[Math.min(this.attempts.length, 5)]; }
    get total() { return this.results.reduce((sum, result) => sum + result.points, 0); }
    guess(track = null) {
      if (this.solved) return { ignored: true };
      if (track && this.attempts.some(attempt => attempt.track && sameTrack(attempt.track, track))) return { duplicate: true };
      const won = sameTrack(track, this.track);
      this.attempts.push({ track, won });
      if (won || this.attempts.length === 6) {
        this.results.push({ track: this.track, stage: this.index, won, attempts: [...this.attempts], points: won ? Math.round(POINTS[this.attempts.length - 1] * this.stage.multiplier) : 0 });
      }
      return { won, finished: this.solved };
    }
    next() {
      if (!this.solved || this.complete) return false;
      this.index++;
      this.attempts = [];
      return true;
    }
    snapshot() {
      return { version: 1, genre: this.genre, tracks: this.tracks, index: this.index, rounds: this.results.map(result => result.attempts), attempts: this.attempts };
    }
    static restore(data) {
      try {
        if (data?.version !== 1 || !Number.isInteger(data.index) || data.index < 0 || data.index > 4 || !Array.isArray(data.rounds) || data.rounds.length > 5) return null;
        const game = new Game(data.tracks, data.genre);
        for (let index = 0; index <= data.index; index++) {
          if (index && !game.next()) return null;
          const attempts = data.rounds[index] || data.attempts;
          if (!Array.isArray(attempts) || attempts.length > 6) return null;
          for (const attempt of attempts) {
            if (!attempt || game.solved) return null;
            const result = game.guess(attempt.track || null);
            if (result.duplicate) return null;
          }
        }
        if (game.results.length !== data.rounds.length) return null;
        return game;
      } catch { return null; }
    }
    shareText(url) {
      const rows = this.results.map(result => `${STAGES[result.stage].label}: ${result.attempts.map(attempt => attempt.won ? '🟩' : attempt.track ? '🟥' : '⬛').join('')}`);
      return `TrackTally · ${GENRES[this.genre]}\n${rows.join('\n')}\n${this.total} Punkte · ${this.results.filter(result => result.won).length}/5 Songs\n${url}`;
    }
  }
  const api = Object.freeze({ Game, STAGES, GENRES, normalize, sameTrack, uniqueTracks, sample });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrackTallyReveal = api;
})(typeof window === 'undefined' ? globalThis : window);
