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
  // Bound SDK commands too: their promises may never settle after a device error.
  function attempt(action, milliseconds) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve({ ok: false, error: new Error('Spotify reagiert nicht rechtzeitig.') }), milliseconds);
      try {
        Promise.resolve(action()).then(value => { clearTimeout(timer); resolve({ ok: true, value }); }, error => { clearTimeout(timer); resolve({ ok: false, error }); });
      } catch (error) { clearTimeout(timer); resolve({ ok: false, error }); }
    });
  }
  class RevealPlayer {
    constructor(api, { onState = () => {}, onError = () => {}, sdk = loadSdk, timeouts = {} } = {}) {
      this.api = api;
      this.onState = onState;
      this.onError = onError;
      this.sdk = sdk;
      this.timeouts = { startup: 8000, command: 1500, stop: 500, confirm: 1500, settle: 2500, remote: 2500, ...timeouts };
      this.volume = .65;
      this.phase = 'idle';
      this.player = null;
      this.device = null;
      this.ready = null;
      this.operation = null;
      this.stopping = null;
    }
    state(phase, fraction = 0) { this.phase = phase; this.onState(phase, fraction); }
    retire(player) {
      try { player?.disconnect(); } catch { /* Continue with the device-specific API stop. */ }
      if (this.player === player) { this.player = null; this.device = null; this.ready = null; }
    }
    async prepare() {
      if (this.device) return;
      if (this.ready) return this.ready;
      this.ready = (async () => {
        await this.sdk();
        // Keep the in-flight ready promise while replacing an old connection.
        try { this.player?.disconnect(); } catch { /* Already disconnected. */ }
        this.player = null;
        this.device = null;
        const player = this.player = new root.Spotify.Player({
          name: 'TrackTally Audio Reveal', volume: this.volume, enableMediaSession: false,
          getOAuthToken: callback => { this.api.token().then(token => { if (token) callback(token); else this.fail('Deine Spotify-Sitzung ist abgelaufen. Bitte erneut verbinden.'); }).catch(() => this.fail('Spotify konnte nicht verbunden werden.')); }
        });
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Spotify Player ist nicht bereit. Bitte erneut versuchen.')), 12000);
          const fail = message => {
            if (this.player !== player) return;
            clearTimeout(timeout); reject(new Error(message)); this.fail(message);
          };
          player.addListener('ready', ({ device_id }) => { if (this.player !== player) return; clearTimeout(timeout); this.device = device_id; resolve(); });
          player.addListener('not_ready', () => { if (this.player === player) this.fail('Die Spotify-Verbindung wurde unterbrochen. Starte den Ausschnitt erneut.'); });
          player.addListener('initialization_error', () => fail('Dieser Browser unterstützt die Spotify-Wiedergabe nicht.'));
          player.addListener('authentication_error', () => fail('Bitte verbinde Spotify erneut, um die Wiedergabe zu erlauben.'));
          player.addListener('account_error', () => fail('Für die Wiedergabe brauchst du Spotify Premium.'));
          player.addListener('autoplay_failed', () => { if (this.player === player) this.fail('Der Browser hat Audio blockiert. Klicke erneut auf Wiedergabe.'); });
          player.addListener('playback_error', ({ message } = {}) => {
            if (this.player !== player || this.phase === 'stopping') return;
            this.fail(message ? `Spotify-Wiedergabefehler: ${message}. Dein Versuch bleibt erhalten.` : 'Spotify konnte den Ausschnitt nicht abspielen. Dein Versuch bleibt erhalten.');
          });
          player.addListener('player_state_changed', state => { if (this.player === player) this.observe(state); });
          player.connect().then(connected => { if (!connected) fail('Spotify Player konnte nicht verbunden werden.'); }).catch(error => fail(error.message));
        });
      })().catch(error => { this.retire(this.player); throw error; });
      return this.ready;
    }
    fail(message) {
      if (this.phase === 'stopping') return;
      void this.stop();
      this.onError(message);
    }
    async setVolume(value) {
      this.volume = Math.max(0, Math.min(1, Number(value) || 0));
      if (this.player && this.phase === 'playing') {
        const result = await attempt(() => this.player.setVolume(this.volume), this.timeouts.command);
        if (!result.ok) throw result.error;
      }
    }
    async remoteStop(device) {
      if (!device) return { ok: false };
      const controller = new AbortController();
      const result = await attempt(() => this.api.pause(device, controller.signal), this.timeouts.remote);
      controller.abort();
      return result;
    }
    async confirmPaused(player) {
      if (!player) return false;
      const deadline = performance.now() + this.timeouts.confirm;
      do {
        const state = await attempt(() => player.getCurrentState(), Math.min(this.timeouts.stop, Math.max(1, deadline - performance.now())));
        if (state.ok && state.value?.paused === true) return true;
        const remaining = deadline - performance.now();
        if (remaining <= 0) return false;
        await new Promise(resolve => setTimeout(resolve, Math.min(40, remaining)));
      } while (performance.now() < deadline);
      return false;
    }
    stop() {
      if (this.stopping) return this.stopping;
      const op = this.operation;
      // Answer submission and navigation may call stop after the clip ended.
      // Sending new commands to an idle device can produce spurious 404 errors.
      if (!op && this.phase === 'idle') return Promise.resolve();
      const player = op?.player || this.player;
      // Keep the exact target even if a not_ready event disconnects the SDK.
      const device = op?.device || this.device;
      if (op) {
        op.cancelled = true;
        // A 30–100 ms clip can end before its accepted start request returns.
        // Abort queued starts, but let an already playing start settle normally.
        if (!op.started) op.controller.abort();
        clearTimeout(op.startTimer); clearTimeout(op.clipTimer); clearTimeout(op.pollTimer); clearInterval(op.meterTimer);
      }
      this.state('stopping');
      this.stopping = (async () => {
        // Stop audible playback immediately. Await the mute too, so an old mute
        // cannot race with the next song's volume setting.
        const local = player ? attempt(() => player.pause(), this.timeouts.stop) : Promise.resolve({ ok: false });
        const mute = player ? attempt(() => player.setVolume(0), this.timeouts.command) : Promise.resolve({ ok: false });
        const pendingStart = Boolean(op?.started && op.requestPending);
        if (pendingStart) {
          await attempt(() => op.startSettled, this.timeouts.settle);
          // Preserve ordering on Spotify's side before using the API fallback.
          if (op.requestPending) op.controller.abort();
        }
        let [localResult, muteResult] = await Promise.all([local, mute]);
        if (pendingStart && !op.requestPending && player) {
          localResult = await attempt(() => player.pause(), this.timeouts.stop);
        }
        // SDK state often lags a successful pause; allow it to converge before
        // treating the stop as a failure or issuing another API command.
        let confirmed = localResult.ok && await this.confirmPaused(player);
        if (!confirmed) {
          const remoteResult = await this.remoteStop(device);
          // HTTP 204 is also a valid confirmation. A stale SDK snapshot must
          // not invalidate a successful server-side stop.
          confirmed = remoteResult.ok || await this.confirmPaused(player);
        }
        if (!confirmed || !localResult.ok || !muteResult.ok || op?.requestPending) this.retire(player);
        if (!confirmed && device) this.onError('Spotify konnte den Stopp nicht bestätigen. Die Player-Verbindung wurde getrennt. Bitte stoppe gegebenenfalls die Wiedergabe in Spotify.');
      })().finally(() => {
        if (this.operation === op) this.operation = null;
        this.stopping = null;
        this.state('idle');
      });
      return this.stopping;
    }
    matches(state, op) {
      const actual = state?.track_window?.current_track;
      const uris = [op.track.uri, op.track.linked_from?.uri, op.track.linked_from?.id && `spotify:track:${op.track.linked_from.id}`];
      return actual && uris.includes(actual.uri);
    }
    observe(state) {
      const op = this.operation;
      if (!op || op.cancelled || !op.sent || !state) return;
      if (op.started) {
        // A delayed pause/track-change event from Easy can arrive after Medium
        // starts. Check the current state before stopping the new clip.
        if ((state.paused || !this.matches(state, op)) && !op.checkingState) {
          op.checkingState = true;
          void attempt(() => op.player.getCurrentState(), this.timeouts.stop).then(latest => {
            op.checkingState = false;
            if (this.operation === op && !op.cancelled && latest.ok && latest.value &&
                (latest.value.paused || !this.matches(latest.value, op))) void this.stop();
          });
        }
        return;
      }
      if (state.paused || !this.matches(state, op)) return;
      op.started = true;
      clearTimeout(op.startTimer); clearTimeout(op.pollTimer);
      // Subtract audio already played before Spotify's notification arrived.
      const elapsed = Math.max(0, (Number(state.position) || op.position) - op.position);
      const remaining = Math.max(0, op.milliseconds - elapsed);
      const startedAt = performance.now() - elapsed;
      // Arm the stop before updating UI and independently of the HTTP response.
      op.clipTimer = setTimeout(() => { if (this.operation === op) void this.stop(); }, remaining);
      op.meterTimer = setInterval(() => { if (!op.cancelled) this.onState('playing', Math.min(1, (performance.now() - startedAt) / op.milliseconds)); }, 25);
      this.state('playing');
    }
    async poll(op) {
      if (this.operation !== op || op.cancelled || op.started) return;
      const state = await attempt(() => op.player.getCurrentState(), this.timeouts.stop);
      if (this.operation !== op || op.cancelled || op.started) return;
      if (state.ok) this.observe(state.value);
      if (!op.started) op.pollTimer = setTimeout(() => { void this.poll(op); }, 40);
    }
    async play(track, seconds) {
      if (this.phase !== 'idle' || this.operation || this.stopping) return;
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 16) return;
      const op = this.operation = { track, milliseconds: seconds * 1000, controller: new AbortController(), cancelled: false, sent: false, started: false };
      const current = () => this.operation === op && !op.cancelled;
      this.state('loading');
      try {
        // Preserve the browser's user gesture before any asynchronous work.
        const activation = this.player ? attempt(() => this.player.activateElement(), this.timeouts.command) : null;
        await this.prepare();
        if (!current()) return;
        op.player = this.player; op.device = this.device;
        const activated = await (activation || attempt(() => op.player.activateElement(), this.timeouts.command));
        if (!activated.ok) throw activated.error;
        if (!current()) return;
        const volume = await attempt(() => op.player.setVolume(this.volume), this.timeouts.command);
        if (!volume.ok) throw volume.error;
        if (!current()) return;
        // Explicitly activate this browser device, matching the classic quiz.
        const options = { method: 'PUT', signal: op.controller.signal };
        const transferred = await attempt(() => this.api.request('/me/player', { ...options, body: { device_ids: [op.device], play: false } }), this.timeouts.startup);
        if (!current()) return;
        if (!transferred.ok) throw transferred.error;
        op.position = Math.min(30000, Math.max(0, (track.duration_ms || 180000) - 17000));
        // One positioned start. Do not rapidly pause/seek/resume an unready SDK.
        op.sent = true; op.requestPending = true;
        op.startTimer = setTimeout(() => { if (current()) this.fail('Spotify hat den Audiostart nicht bestätigt. Bitte erneut versuchen; dein Versuch bleibt erhalten.'); }, this.timeouts.startup);
        const request = this.api.request(`/me/player/play?device_id=${encodeURIComponent(op.device)}`, { ...options, body: { uris: [track.uri], position_ms: op.position } });
        // If the server accepted a start after cancellation, stop that old device
        // again. A missing HTTP reply never disables the independent clip timer.
        op.startSettled = Promise.resolve(request).then(() => {
          op.requestPending = false;
          if (op.cancelled && this.operation !== op) void this.remoteStop(op.device);
        }, () => { op.requestPending = false; });
        void this.poll(op);
        const result = await attempt(() => request, this.timeouts.startup);
        if (!current()) return;
        if (!result.ok) throw result.error;
      } catch (error) {
        if (current()) { this.onError(error.message || 'Wiedergabe fehlgeschlagen. Bitte erneut versuchen.'); await this.stop(); }
      }
    }
    dispose() {
      void this.stop();
      this.retire(this.player);
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = RevealPlayer;
  else root.TrackTallyRevealPlayer = RevealPlayer;
})(typeof window === 'undefined' ? globalThis : window);
