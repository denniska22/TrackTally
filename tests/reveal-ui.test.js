// Exercise the actual event handlers with a small DOM fixture and a fake Spotify
// boundary. No account credentials, network calls or browser installs required.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const rules = require('../reveal-game');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function storage(values = {}) {
  const map = new Map(Object.entries(values));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
}
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.style = { setProperty() {} }; this.hidden = false; this.value = ''; this.textContent = '';
    const classes = new Set();
    this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle: (value, force) => { const on = force ?? !classes.has(value); if (on) classes.add(value); else classes.delete(value); } };
  }
  append(...elements) { this.children.push(...elements); elements.forEach(element => { element.parentElement = this; }); }
  replaceChildren(...elements) { this.children = []; this.append(...elements); }
  get firstElementChild() { return this.children[0]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tagName === selector ? [child] : []), ...child.querySelectorAll(selector)]); }
  addEventListener(event, callback) { (this.listeners[event] ||= []).push(callback); }
  emit(event, props = {}) { for (const callback of this.listeners[event] || []) callback({ target: this, preventDefault() {}, ...props }); }
  focus() { this.focused = true; }
  select() { this.selectedText = true; }
  scrollIntoView() {}
  closest(selector) { return selector === '[data-index]' && this.dataset.index !== undefined ? this : this.parentElement?.closest(selector) || null; }
  remove() {}
}
function documentFixture() {
  const html = fs.readFileSync(path.join(root, 'progressive-audio-reveal.html'), 'utf8');
  const ids = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  ids.revealClipMeter.append(new Element());
  const document = new Element('document');
  document.body = new Element('body'); document.body.classList.add('audio-reveal-page');
  document.head = new Element('head'); document.documentElement = new Element('html');
  document.getElementById = id => ids[id] || null;
  document.querySelector = selector => selector.startsWith('#') ? ids[selector.slice(1)] || null : null;
  document.createElement = tag => new Element(tag);
  return { document, ids };
}
const tracks = Array.from({ length: 12 }, (_, index) => ({ id: `track${index}`, uri: `spotify:track:track${index}`, name: `Tune ${index}`, artists: [{ name: `Artist ${index}` }], duration_ms: 180000 }));
function setup({ connected = true, failSearch = false, saved, request } = {}) {
  const { document, ids } = documentFixture();
  const sessionStorage = storage(saved ? { tracktally_reveal_round_v1: JSON.stringify(saved) } : {});
  const api = { hasSession: () => connected, hasScopes: () => connected, request: request || (async url => {
    if (url.startsWith('/search')) { if (failSearch) throw new Error('Search unavailable'); return { tracks: { items: tracks } }; }
    return { items: url.startsWith('/me/tracks') ? [] : tracks };
  }) };
  class Player {
    constructor(api, options) { this.phase = 'idle'; this.options = options; }
    async setVolume() {} async prepare() {} async stop() { this.phase = 'idle'; this.options.onState('idle', 0); }
    async play(track, seconds) { this.lastClip = { track, seconds }; this.options.onState('playing', 0); }
    dispose() {}
  }
  const context = { document, sessionStorage, localStorage: storage(), location: { href: 'https://example.com/TrackTally/progressive-audio-reveal.html' }, TrackTallyReveal: rules, TrackTallySpotify: api, TrackTallyRevealPlayer: Player, URL, URLSearchParams, setTimeout, clearTimeout, console, navigator: { clipboard: { writeText: async () => { throw new Error('Unavailable'); } } }, addEventListener() {} };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'progressive-audio-reveal.js'), 'utf8'), context);
  return { ids, context, sessionStorage };
}

test('disconnected page has no playable controls and explains the Spotify requirement', async () => {
  const { ids } = setup({ connected: false }); await tick();
  assert.equal(ids.revealPlay.disabled, true);
  assert.equal(ids.audioRevealSearch.disabled, true);
  assert.equal(ids.revealConnect.hidden, false);
  assert.match(ids.revealStatus.textContent, /Spotify Premium/);
});

test('actual UI supports a full five-song game, restore and clipboard fallback', async () => {
  const { ids, sessionStorage } = setup(); await tick();
  assert.equal(ids.revealPlay.disabled, false);
  assert.equal(ids.revealGenres.children.length, 9);
  for (let round = 0; round < 5; round++) {
    for (let attempt = 0; attempt < 6; attempt++) { ids.revealSkip.emit('click'); await tick(); }
    if (round < 4) { assert.equal(ids.revealAnswer.hidden, false); ids.revealNext.emit('click'); }
  }
  assert.equal(ids.revealResults.hidden, false);
  assert.equal(ids.revealResultRows.children.length, 5);
  assert.equal(ids.revealTotal.textContent, '0 Punkte');
  ids.revealCopy.emit('click'); await tick();
  assert.equal(ids.revealShareFallback.hidden, false);
  assert.match(ids.revealShareFallback.value, /0 Punkte · 0\/5 Songs/);
  const saved = JSON.parse(sessionStorage.getItem('tracktally_reveal_round_v1'));
  const restored = setup({ saved }); await tick();
  assert.equal(restored.ids.revealResults.hidden, false);
  ids.revealRestart.emit('click'); await tick();
  assert.equal(ids.revealGame.hidden, false);
  assert.equal(ids.revealResults.hidden, true);
});

test('song selection requires submission and stale search results cannot re-open after skip', async () => {
  let finishSearch;
  const { ids } = setup({ request: async url => url.startsWith('/search') ? new Promise(resolve => { finishSearch = resolve; }) : { items: url.startsWith('/me/tracks') ? [] : tracks } });
  await tick();
  ids.audioRevealSearch.value = 'Tune'; ids.audioRevealSearch.emit('input');
  await new Promise(resolve => setTimeout(resolve, 430));
  assert.equal(ids.revealSuggestions.hidden, false);
  ids.revealSuggestions.emit('click', { target: ids.revealSuggestions.children[0] });
  assert.equal(ids.revealSelection.hidden, false);
  assert.match(ids.revealMeta.textContent, /^0 \/ 6/);
  ids.revealSkip.emit('click'); await tick();
  finishSearch({ tracks: { items: tracks } }); await tick();
  assert.equal(ids.revealSuggestions.hidden, true);
  assert.equal(ids.revealSelection.hidden, true);
  assert.match(ids.revealMeta.textContent, /^1 \/ 6/);
});

test('empty catalog gives recovery controls without consuming attempts', async () => {
  const { ids } = setup({ request: async () => ({ items: [] }) }); await tick();
  assert.equal(ids.revealRetry.hidden, false);
  assert.equal(ids.revealPlay.disabled, true);
  assert.match(ids.revealStatus.textContent, /mindestens fünf/);
});

test('submitting a searched correct song reveals its title and adds points', async () => {
  const { ids, sessionStorage } = setup(); await tick();
  const answer = JSON.parse(sessionStorage.getItem('tracktally_reveal_round_v1')).tracks[0];
  ids.audioRevealSearch.value = answer.name; ids.audioRevealSearch.emit('input');
  await new Promise(resolve => setTimeout(resolve, 430));
  ids.revealSuggestions.emit('click', { target: ids.revealSuggestions.children[0] });
  ids.revealGuessForm.emit('submit'); await tick();
  assert.equal(ids.revealAnswer.hidden, false);
  assert.equal(ids.revealRoundPoints.textContent, '+100 Punkte');
  assert.match(ids.revealScore.textContent, /100 Punkte/);
});

test('the real app bridge reuses the token and returns reveal login to the registered root', async () => {
  const { document } = documentFixture();
  const sessionStorage = storage({ tracktally_token: JSON.stringify({ access_token: 'test-only', expires_at: Date.now() + 3600000, scope: 'streaming user-modify-playback-state user-library-read user-top-read' }) });
  let destination;
  const context = { document, sessionStorage, localStorage: storage(), location: { pathname: '/TrackTally/progressive-audio-reveal.html', search: '', origin: 'https://example.com', assign: url => { destination = url; } }, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, crypto: webcrypto, btoa: value => Buffer.from(value, 'binary').toString('base64') };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  assert.equal(await context.TrackTallySpotify.token(), 'test-only');
  assert.equal(context.TrackTallySpotify.hasScopes(), true);
  await context.TrackTallySpotify.connect();
  const url = new URL(destination);
  assert.equal(url.origin, 'https://accounts.spotify.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/TrackTally/');
  assert.equal(sessionStorage.getItem('tracktally_return_to_reveal'), 'true');
  assert.equal(sessionStorage.getItem('tracktally_return_to_play'), null);
});

test('successful OAuth callback sends the player back to Audio Reveal', async () => {
  const { document } = documentFixture();
  document.body.classList.remove('audio-reveal-page');
  const sessionStorage = storage({ tracktally_state: 'state', tracktally_verifier: 'verifier', tracktally_return_to_reveal: 'true' });
  let destination;
  const context = { document, sessionStorage, localStorage: storage(), location: { pathname: '/TrackTally/', search: '?code=test&state=state', origin: 'https://example.com', replace: url => { destination = url; } }, history: { replaceState() {} }, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, fetch: async () => ({ ok: true, json: async () => ({ access_token: 'test-only', expires_in: 3600 }) }) };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  await tick();
  assert.equal(destination, 'https://example.com/TrackTally/progressive-audio-reveal.html');
  assert.equal(sessionStorage.getItem('tracktally_return_to_reveal'), null);
});
