const test = require('node:test');
const assert = require('node:assert/strict');
const RevealPlayer = require('../reveal-player');
const track = { uri: 'spotify:track:one', duration_ms: 180000 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(request) {
  const calls = [];
  const sdk = {
    activateElement: async () => calls.push('activate'), setVolume: async value => calls.push(['volume', value]),
    pause: async () => calls.push('pause'), seek: async value => calls.push(['seek', value]),
    resume: async () => calls.push('resume'), disconnect: () => calls.push('disconnect'),
    getCurrentState: async () => ({ paused: false, track_window: { current_track: track } })
  };
  const errors = [];
  const player = new RevealPlayer({ request: request || (async (url, options) => calls.push({ url, ...options })) }, { onError: message => errors.push(message) });
  player.player = sdk; player.device = 'test-device';
  return { player, sdk, calls, errors };
}

test('starts the expected song silently, seeks consistently, and stops a 30ms clip locally', async () => {
  const { player, calls, errors } = fixture();
  await player.play(track, .03);
  assert.equal(player.phase, 'playing');
  assert.deepEqual(calls.find(call => call?.body)?.body, { uris: [track.uri], position_ms: 30000 });
  assert.deepEqual(calls.filter(call => Array.isArray(call)), [['volume', 0], ['seek', 30000], ['volume', .65]]);
  assert.equal(calls.filter(call => call === 'resume').length, 1);
  await delay(70);
  assert.equal(player.phase, 'idle');
  assert.equal(calls.at(-1), 'pause');
  assert.deepEqual(errors, []);
});

test('late network completion after cancellation cannot resume or unmute audio', async () => {
  let resolveRequest;
  const { player, calls } = fixture(() => new Promise(resolve => { resolveRequest = resolve; }));
  const playing = player.play(track, 1);
  while (!resolveRequest) await delay(1);
  await player.stop();
  resolveRequest();
  await playing;
  assert.equal(calls.includes('resume'), false);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'volume' && call[1] > 0), false);
  assert.equal(player.phase, 'idle');
});

test('request failure preserves retryability and reports the error', async () => {
  const { player, errors } = fixture(async () => { throw new Error('Rate limited'); });
  await player.play(track, 1);
  assert.equal(player.phase, 'idle');
  assert.deepEqual(errors, ['Rate limited']);
});

test('pause failure disconnects instead of leaving music running', async () => {
  const { player, sdk, calls } = fixture();
  sdk.pause = async () => { throw new Error('Device lost'); };
  await player.stop();
  assert.equal(calls.includes('disconnect'), true);
  assert.equal(player.device, null);
  assert.equal(player.phase, 'idle');
});

test('double play clicks do not start a second clip and stopping locks new playback', async () => {
  const { player, sdk, calls } = fixture();
  await Promise.all([player.play(track, 1), player.play(track, 1)]);
  assert.equal(calls.filter(call => call === 'resume').length, 1);
  let release;
  sdk.pause = () => new Promise(resolve => { release = resolve; });
  const stopping = player.stop();
  await player.play(track, 1);
  assert.equal(calls.filter(call => call === 'resume').length, 1);
  release(); await stopping;
});
