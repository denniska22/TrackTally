(function (root) {
  'use strict';
  let sdkPromise;
  function loadSdk() {
    if (root.Spotify?.Player) return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => fail(), 12000);
      function fail() { clearTimeout(timeout); script.remove(); sdkPromise = null; reject(new Error('Spotify Player konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.')); }
      root.onSpotifyWebPlaybackSDKReady = () => { clearTimeout(timeout); resolve(); };
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.onerror = fail;
      document.head.appendChild(script);
    });
    return sdkPromise;
  }
  class RevealPlayer {
    constructor(api, { onState = () => {}, onError = () => {}, sdk = loadSdk } = {}) {
      this.api = api;
      this.onState = onState;
      this.onError = onError;
      this.sdk = sdk;
      this.epoch = 0;
      this.volume = .65;
      this.phase = 'idle';
      this.player = null;
      this.device = null;
      this.ready = null;
    }
    state(phase, fraction = 0) { this.phase = phase; this.onState(phase, fraction); }
    async prepare() {
      if (this.device) return;
      if (this.ready) return this.ready;
      this.ready = (async () => {
        await this.sdk();
        this.player?.disconnect();
        const player = this.player = new root.Spotify.Player({
          name: 'TrackTally Audio Reveal', volume: 0, enableMediaSession: false,
          getOAuthToken: callback => { this.api.token().then(token => { if (token) callback(token); else this.fail('Deine Spotify-Sitzung ist abgelaufen. Bitte erneut verbinden.'); }).catch(() => this.fail('Spotify konnte nicht verbunden werden.')); }
        });
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Spotify Player ist nicht bereit. Bitte erneut versuchen.')), 12000);
          const fail = message => { clearTimeout(timeout); reject(new Error(message)); this.fail(message); };
          player.addListener('ready', ({ device_id }) => { if (this.player !== player) return; clearTimeout(timeout); this.device = device_id; resolve(); });
          player.addListener('not_ready', () => { this.device = null; this.ready = null; this.fail('Die Spotify-Verbindung wurde unterbrochen. Starte den Ausschnitt erneut.'); });
          player.addListener('initialization_error', () => fail('Dieser Browser unterstützt die Spotify-Wiedergabe nicht. Versuche Chrome, Edge oder Safari.'));
          player.addListener('authentication_error', () => fail('Bitte verbinde Spotify erneut, um die Wiedergabe zu erlauben.'));
          player.addListener('account_error', () => fail('Für die Wiedergabe brauchst du Spotify Premium.'));
          player.addListener('autoplay_failed', () => this.fail('Der Browser hat Audio blockiert. Klicke erneut auf Wiedergabe.'));
          player.addListener('playback_error', () => this.fail('Dieser Song konnte nicht abgespielt werden. Versuche es erneut oder wähle eine neue Kategorie.'));
          player.addListener('player_state_changed', state => {
            if (!state || this.phase !== 'playing') return;
            if (state.paused || state.track_window?.current_track?.uri !== this.expectedUri) void this.stop();
          });
          player.connect().then(connected => { if (!connected) fail('Spotify Player konnte nicht verbunden werden.'); }).catch(error => fail(error.message));
        });
      })().catch(error => { this.device = null; this.ready = null; this.player?.disconnect(); this.player = null; throw error; });
      return this.ready;
    }
    fail(message) { void this.stop(); this.onError(message); }
    async setVolume(value) {
      this.volume = Math.max(0, Math.min(1, Number(value) || 0));
      // Preparation stays silent until the correct song is paused and positioned.
      if (this.player && this.phase === 'playing') await this.player.setVolume(this.volume);
    }
    async stop() {
      const epoch = ++this.epoch;
      clearTimeout(this.stopTimer);
      clearTimeout(this.watchdog);
      clearInterval(this.meterTimer);
      const player = this.player;
      if (!player) { this.state(this.pendingEpoch ? 'stopping' : 'idle'); return; }
      this.state('stopping');
      try { await player.pause(); } catch { player.disconnect(); this.device = null; this.ready = null; }
      if (epoch === this.epoch && !this.pendingEpoch) this.state('idle');
    }
    async play(track, seconds) {
      if (this.phase !== 'idle' || this.pendingEpoch) return;
      const epoch = ++this.epoch;
      this.pendingEpoch = epoch;
      let player;
      const current = () => epoch === this.epoch;
      const check = async () => {
        if (current()) return true;
        await player?.pause().catch(() => player.disconnect());
        return false;
      };
      this.state('loading');
      try {
        // Call activateElement in the user's click stack when already prepared.
        const activation = this.player?.activateElement();
        await this.prepare();
        player = this.player;
        if (!await check()) return;
        if (activation) await activation; else await player.activateElement();
        if (!await check()) return;
        await player.setVolume(0);
        if (!await check()) return;
        const start = Math.min(30000, Math.max(0, (track.duration_ms || 180000) - 17000));
        this.expectedUri = track.uri;
        await this.api.request(`/me/player/play?device_id=${encodeURIComponent(this.device)}`, { method: 'PUT', body: { uris: [track.uri], position_ms: start } });
        if (!await check()) return;
        let started = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          const state = await player.getCurrentState();
          if (!await check()) return;
          if (state && !state.paused && state.track_window?.current_track?.uri === track.uri) { started = true; break; }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!started) throw new Error('Der Song startet nicht. Klicke erneut auf Wiedergabe; dein Versuch bleibt erhalten.');
        await player.pause();
        if (!await check()) return;
        await player.seek(start);
        if (!await check()) return;
        await player.setVolume(this.volume);
        if (!await check()) return;
        // Bound a stalled resume as well as normal playback. Pause uses the local
        // SDK, never the rate-limited Web API queue.
        this.watchdog = setTimeout(() => { if (current()) this.fail('Die Wiedergabe wurde unterbrochen. Bitte erneut starten.'); }, seconds * 1000 + 5000);
        await player.resume();
        if (!await check()) return;
        clearTimeout(this.watchdog);
        const startedAt = performance.now();
        this.state('playing');
        this.stopTimer = setTimeout(() => { if (current()) void this.stop(); }, seconds * 1000);
        this.meterTimer = setInterval(() => { if (current()) this.onState('playing', Math.min(1, (performance.now() - startedAt) / (seconds * 1000))); }, 25);
      } catch (error) {
        if (current()) { await this.stop(); this.onError(error.message || 'Wiedergabe fehlgeschlagen. Bitte erneut versuchen.'); }
      } finally {
        if (this.pendingEpoch === epoch) this.pendingEpoch = null;
        if (this.phase === 'stopping') this.state('idle');
      }
    }
    dispose() { void this.stop(); this.player?.disconnect(); this.device = null; this.ready = null; }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = RevealPlayer;
  else root.TrackTallyRevealPlayer = RevealPlayer;
})(typeof window === 'undefined' ? globalThis : window);
