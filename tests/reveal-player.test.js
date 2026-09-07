const test = require('node:test');
const assert = require('node:assert/strict');
const RevealPlayer = require('../reveal-player');
const track = { uri: 'spotify:track:one', duration_ms: 180000 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture({ ignorePause = false, hangPause = false, noState = false, noEvents = false, request, pause } = {}) {
  const calls = [], errors = [], listeners = new Map();
  const state = { paused: true, position: 30000, track_window: { current_track: track } };
  const sdk = {
    addListener: (name, callback) => listeners.set(name, callback),
    emit: (name, value) => listeners.get(name)?.(value),
    connect: async () => { sdk.emit('ready', { device_id: 'test-device' }); return true; },
    activateElement: async () => calls.push('activate'),
    setVolume: async value => calls.push(['volume', value]),
    pause: async () => { calls.push('local-pause'); if (hangPause) return new Promise(() => {}); if (!ignorePause) state.paused = true; },
    seek: async () => { throw new Error('Unexpected seek'); },
    resume: async () => { throw new Error('Unexpected resume'); },
    disconnect: () => { calls.push('disconnect'); },
    getCurrentState: async () => noState ? new Promise(() => {}) : { ...state }
  };
  const api = {
    token: async () => 'test-only',
    request: async (url, options) => {
      calls.push({ url, ...options });
      if (request) return request(url, options, state, sdk);
      state.paused = !url.startsWith('/me/player/play?');
      if (!state.paused && !noEvents) sdk.emit('player_state_changed', { ...state });
    },
    pause: async (device, signal) => { calls.push(['remote-pause', device]); if (pause) return pause(device, signal, state); state.paused = true; }
  };
  globalThis.Spotify = { Player: function () { return sdk; } };
  const player = new RevealPlayer(api, { sdk: async () => {}, onError: message => errors.push(message), timeouts: { startup: 150, command: 40, stop: 40, remote: 60 } });
  await player.prepare();
  return { player, sdk, api, calls, errors, state };
}

// Regression: the previous implementation only trusted SDK.pause(), so this
// realistic error left state.paused=false and never sent a server-side stop.
test('playback_error stops the exact device when SDK pause silently does nothing', async () => {
  const { player, sdk, state, calls, errors } = await fixture({ ignorePause: true });
  await player.play(track, 1);
  assert.equal(state.paused, false);
  sdk.emit('playback_error', { message: 'Device error' });
  await player.stop();
  assert.equal(state.paused, true);
  assert.deepEqual(calls.filter(call => Array.isArray(call) && call[0] === 'remote-pause'), [['remote-pause', 'test-device']]);
  assert.match(errors[0], /Device error/);
  assert.equal(player.phase, 'idle');
});

test('one positioned start stops a 30ms clip without a pause-seek-resume sequence', async () => {
  const { player, calls, state, errors } = await fixture();
  await player.play(track, .03);
  assert.equal(player.phase, 'playing');
  const commands = calls.filter(call => call?.url);
  assert.deepEqual(commands.map(call => call.body), [{ device_ids: ['test-device'], play: false }, { uris: [track.uri], position_ms: 30000 }]);
  assert.equal(calls.includes('local-pause'), false);
  await delay(70);
  assert.equal(state.paused, true);
  assert.equal(player.phase, 'idle');
  assert.deepEqual(errors, []);
});

test('the clip timer runs before a delayed play response, and late acceptance is stopped again', async () => {
  let release;
  const { player, sdk, state, calls } = await fixture({ request: async (url, options, state, sdk) => {
    if (!url.startsWith('/me/player/play?')) return;
    state.paused = false;
    sdk.emit('player_state_changed', { ...state });
    return new Promise(resolve => { release = () => { state.paused = false; resolve(); }; });
  } });
  const playing = player.play(track, .03);
  await delay(70);
  assert.equal(state.paused, true);
  assert.equal(player.phase, 'idle');
  assert.ok(calls.includes('disconnect'));
  release(); await playing; await delay(5);
  assert.equal(state.paused, true);
  assert.equal(calls.filter(call => Array.isArray(call) && call[0] === 'remote-pause').length, 2);
});

test('missing SDK state and events cannot leave a started song playing indefinitely', async () => {
  const { player, state, errors, calls } = await fixture({ noState: true, noEvents: true });
  await player.play(track, 1);
  assert.equal(state.paused, false);
  await delay(240);
  assert.equal(state.paused, true);
  assert.equal(player.phase, 'idle');
  assert.ok(calls.includes('disconnect'));
  assert.match(errors[0], /Audiostart nicht bestätigt/);
});

test('a hung SDK pause cannot block the independent API stop or lock the UI', async () => {
  const { player, sdk, state, calls } = await fixture({ hangPause: true });
  await player.play(track, 1);
  sdk.emit('playback_error', { message: 'Connection lost' });
  await delay(5);
  assert.equal(state.paused, true);
  await delay(70);
  assert.equal(player.phase, 'idle');
  assert.ok(calls.includes('disconnect'));
});

test('failed stop paths disconnect and report that stopping was not confirmed', async () => {
  const { player, state, errors, calls } = await fixture({ ignorePause: true, pause: async () => { throw new Error('Network offline'); } });
  await player.play(track, 1);
  await player.stop();
  assert.equal(state.paused, false);
  assert.equal(player.device, null);
  assert.ok(calls.includes('disconnect'));
  assert.match(errors.at(-1), /Stopp nicht bestätigen/);
  assert.equal(player.phase, 'idle');
});

test('cancellation during device transfer never sends the subsequent play command', async () => {
  let release;
  const { player, calls } = await fixture({ request: () => new Promise(resolve => { release = resolve; }) });
  const playing = player.play(track, 1);
  while (!release) await delay(1);
  await player.stop();
  release(); await playing;
  assert.equal(calls.filter(call => call?.url?.startsWith('/me/player/play?')).length, 0);
  assert.equal(player.phase, 'idle');
});

test('duplicate clicks and a click during stop cannot start competing clips', async () => {
  let releaseStop;
  const { player, calls } = await fixture({ pause: async (device, signal, state) => new Promise(resolve => { releaseStop = () => { state.paused = true; resolve(); }; }) });
  await Promise.all([player.play(track, 1), player.play(track, 1)]);
  const stopping = player.stop();
  await player.play(track, 1);
  assert.equal(calls.filter(call => call?.url?.startsWith('/me/player/play?')).length, 1);
  releaseStop(); await stopping;
  assert.equal(player.phase, 'idle');
});

test('already elapsed audio is subtracted from the snippet duration', async () => {
  const { player, state } = await fixture({ request: async (url, options, state, sdk) => {
    if (!url.startsWith('/me/player/play?')) return;
    state.paused = false; state.position = 30400;
    sdk.emit('player_state_changed', { ...state });
  } });
  await player.play(track, .1);
  await delay(15);
  assert.equal(state.paused, true);
  assert.equal(player.phase, 'idle');
});

test('a request error stops cleanly and permits retry', async () => {
  const { player, errors } = await fixture({ request: async () => { throw new Error('Rate limited'); } });
  await player.play(track, 1);
  assert.equal(player.phase, 'idle');
  assert.deepEqual(errors, ['Rate limited']);
});
