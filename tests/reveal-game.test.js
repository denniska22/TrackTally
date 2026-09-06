const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, STAGES, sameTrack, sample } = require('../reveal-game');
const tracks = Array.from({ length: 10 }, (_, index) => ({ id: `song${index}`, uri: `spotify:track:song${index}`, name: `Song ${index}`, artists: [{ name: `Artist ${index}` }], duration_ms: 180000 }));

test('five first-attempt wins finish at 670 points and cannot be scored twice', () => {
  const game = new Game(tracks.slice(0, 5));
  for (let index = 0; index < 5; index++) {
    assert.equal(game.index, index);
    assert.equal(game.guess(tracks[index]).won, true);
    assert.equal(game.guess(tracks[index]).ignored, true);
    assert.equal(game.next(), index < 4);
  }
  assert.equal(game.complete, true);
  assert.equal(game.total, 670);
  assert.match(game.shareText('https://example.com'), /670 Punkte · 5\/5 Songs/);
  assert.doesNotMatch(game.shareText('https://example.com'), /Artist|Song 0/);
});

test('six skips reveal each song, extend clips and complete a zero-point game', () => {
  const game = new Game(tracks.slice(0, 5), 'hip-hop');
  assert.equal(game.next(), false);
  for (let round = 0; round < 5; round++) {
    for (let attempt = 0; attempt < 6; attempt++) {
      assert.equal(game.seconds, STAGES[round].clips[attempt]);
      game.guess();
      assert.equal(game.solved, attempt === 5);
    }
    game.next();
  }
  assert.equal(game.total, 0);
  assert.equal(game.complete, true);
  assert.equal(game.results.every(result => result.attempts.length === 6), true);
});

test('duplicate answers do not consume a guess; a sixth-try win still counts', () => {
  const game = new Game(tracks.slice(0, 5));
  game.guess(tracks[7]);
  assert.equal(game.guess({ ...tracks[7], id: 'alternative' }).duplicate, true);
  assert.equal(game.attempts.length, 1);
  for (let index = 0; index < 4; index++) game.guess();
  game.guess(tracks[0]);
  assert.equal(game.total, 25);
  assert.equal(game.results[0].won, true);
});

test('recording identity accepts reissues and rejects covers, remixes and live versions', () => {
  const track = { ...tracks[0], name: 'Déjà Vu', external_ids: { isrc: 'recording' } };
  assert.equal(sameTrack(track, { ...track, id: 'reissue', name: 'Deja Vu - 2020 Remaster' }), true);
  assert.equal(sameTrack(track, { ...tracks[1], external_ids: { isrc: 'recording' } }), true);
  assert.equal(sameTrack(track, { ...tracks[1], name: 'Déjà Vu' }), false);
  assert.equal(sameTrack(track, { ...track, id: 'live', external_ids: {}, name: 'Déjà Vu - Live' }), false);
  assert.equal(sameTrack(track, { ...track, id: 'remix', external_ids: {}, name: 'Déjà Vu (Remix)' }), false);
});

test('sampling excludes duplicates and unplayable tracks without mutating the pool', () => {
  const pool = [...tracks, { ...tracks[0], id: 'duplicate' }, { ...tracks[1], id: 'local', is_local: true }, null];
  const sampled = sample(pool, () => .5);
  assert.equal(sampled.length, 5);
  assert.equal(pool.length, 13);
  assert.equal(sampled.some(item => item.is_local), false);
  assert.throws(() => new Game([tracks[0], tracks[0], ...tracks.slice(1, 4)]));
});

test('refresh restores pending, between-song and final states with recomputed scores', () => {
  let game = new Game(tracks.slice(0, 5), 'pop');
  for (let index = 0; index < 5; index++) {
    game.guess();
    game = Game.restore(JSON.parse(JSON.stringify(game.snapshot())));
    assert.ok(game);
    assert.equal(game.attempts.length, 1);
    game.guess(tracks[index]);
    game = Game.restore(game.snapshot());
    assert.ok(game.solved);
    if (index < 4) { game.next(); game = Game.restore(game.snapshot()); assert.equal(game.index, index + 1); }
  }
  assert.equal(game.complete, true);
  assert.equal(game.total, 571); // Each stage is rounded before adding its points.
});

test('invalid saved games are rejected instead of trapping the player', () => {
  assert.equal(Game.restore(null), null);
  assert.equal(Game.restore({ version: 1, tracks: [], index: 0, rounds: [], attempts: [] }), null);
  const game = new Game(tracks.slice(0, 5));
  assert.equal(Game.restore({ ...game.snapshot(), index: 99 }), null);
  assert.equal(Game.restore({ ...game.snapshot(), attempts: Array(7).fill({ track: null }) }), null);
});
