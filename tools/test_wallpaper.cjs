// Uses the existing fake-indexeddb integration dependency in deployment/tools/wallpaper-test-deps.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let IDB;
try { IDB = require('fake-indexeddb'); }
catch { IDB = require(path.resolve(process.env.LOCALDNS_TEST_DEPS || 'deployment/tools/wallpaper-test-deps/node_modules', 'fake-indexeddb')); }
const source = fs.readFileSync(path.resolve(__dirname, '../_src/ui/assets/js/wallpaper.js'), 'utf8');
const image = (name = 'current.png') => ({type:'image', name, blob:new Blob(['image'], {type:'image/png'})});
const library = selected => ({version:1, revision:'old', items:[{...image('unused.png'), id:'wunused'}, {...image(), id:'wcurrent'}], selected:selected || {type:'asset', id:'wcurrent'}});
const request = r => new Promise((resolve, reject) => {r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
async function database(indexedDB, operation, write = false) {
  const opening = indexedDB.open('localdns-appearance', 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore('settings');
  const db = await request(opening);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', write ? 'readwrite' : 'readonly');
      const result = operation(tx.objectStore('settings'));
      tx.oncomplete = () => resolve(result?.result); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function storage() {
  const values = new Map();
  return {getItem:key => values.get(key) ?? null, setItem:(key, value) => values.set(key, value), removeItem:key => values.delete(key)};
}
async function ui(indexedDB, localStorage = storage()) {
  const element = () => ({dataset:{}, style:{}, value:'', textContent:'', disabled:false, classList:{toggle() {}}, setAttribute() {}, addEventListener() {}, click() {return this.onclick?.();}});
  const nodes = new Map(['wallpaper-layer','bg-url-input','bg-file-input','btn-apply-bg-url','btn-clear-custom-bg','wallpaper-save-status','btn-select-bg-file'].map(id => ['#' + id, element()]));
  const presets = ['cosmos','aurora'].map(preset => Object.assign(element(), {dataset:{bgPreset:preset}}));
  class Image {set src(value) {if (value) queueMicrotask(() => value.includes('broken') ? this.onerror?.() : this.onload?.());}}
  const window = {};
  vm.runInNewContext(source, {window, indexedDB, localStorage, Blob, URL, Image, fetch, setTimeout, clearTimeout, document:{querySelector:selector => nodes.get(selector), querySelectorAll:() => presets}});
  await window.LocalDNSWallpaper.setup();
  return {nodes, presets, localStorage, wall:nodes.get('#wallpaper-layer'), status:nodes.get('#wallpaper-save-status')};
}

test('retired gallery keeps its selected image and unrelated settings on first load', async () => {
  const db = new IDB.IDBFactory();
  await database(db, store => {store.put(library(), 'wallpaper-library-v1');store.put('keep-font', 'font-test');}, true);
  const app = await ui(db);
  assert.equal(app.wall.dataset.preset, 'custom');
  assert.match(app.status.textContent, /current.png/);
  const record = await database(db, store => store.get('wallpaper'));
  assert.equal(record.name, 'current.png'); assert.equal(record.blob.size, 5);
  assert.equal(await database(db, store => store.get('font-test')), 'keep-font');
  assert.equal((await database(db, store => store.get('wallpaper-library-v1'))).items.length, 2);
});

test('reset and replacement persist without resurrecting the retired gallery', async () => {
  const db = new IDB.IDBFactory();
  await database(db, store => store.put(library(), 'wallpaper-library-v1'), true);
  const app = await ui(db);
  await app.nodes.get('#btn-clear-custom-bg').onclick();
  assert.equal((await ui(db)).wall.dataset.preset, 'cosmos');
  app.nodes.get('#bg-url-input').value = 'https://example.test/replacement.png';
  await app.nodes.get('#btn-apply-bg-url').onclick();
  const reopened = await ui(db);
  assert.equal(reopened.nodes.get('#bg-url-input').value, 'https://example.test/replacement.png');
  assert.equal(reopened.wall.dataset.preset, 'custom');
});

test('a retired gallery preset stays selected even when it contains images', async () => {
  const db = new IDB.IDBFactory();
  await database(db, store => store.put(library({type:'preset', preset:'aurora'}), 'wallpaper-library-v1'), true);
  assert.equal((await ui(db)).wall.dataset.preset, 'aurora');
  assert.equal((await ui(db)).wall.dataset.preset, 'aurora');
});

test('invalid image and failed persistence retain the original wallpaper', async () => {
  const db = new IDB.IDBFactory(), local = storage();
  await database(db, store => store.put({version:1,type:'url',url:'https://example.test/current.png'}, 'wallpaper'), true);
  const app = await ui(db, local), oldBackground = app.wall.style.backgroundImage;
  app.nodes.get('#bg-url-input').value = 'https://example.test/broken.png';
  await app.nodes.get('#btn-apply-bg-url').onclick();
  assert.equal(app.wall.style.backgroundImage, oldBackground);
  const original = IDB.IDBDatabase.prototype.transaction;
  IDB.IDBDatabase.prototype.transaction = function(...args) {const tx = original.apply(this, args);if (args[1] === 'readwrite') queueMicrotask(() => tx.abort());return tx;};
  local.setItem = () => {throw new DOMException('quota', 'QuotaExceededError');};
  try {
    await app.nodes.get('#btn-clear-custom-bg').onclick();
    assert.equal(app.status.dataset.state, 'error');
    assert.equal(app.wall.style.backgroundImage, oldBackground);
    assert.equal((await database(db, store => store.get('wallpaper'))).url, 'https://example.test/current.png');
  } finally {IDB.IDBDatabase.prototype.transaction = original;}
});

test('single-wallpaper fallback and older single records restore after reload', async () => {
  const db = new IDB.IDBFactory(), local = storage();
  await database(db, store => store.put(library(), 'wallpaper-library-v1'), true);
  local.setItem('localdns-wallpaper-v4', JSON.stringify({version:1,type:'preset',preset:'aurora'}));
  assert.equal((await ui(db, local)).wall.dataset.preset, 'aurora');
  const older = storage();
  older.setItem('localdns-wallpaper-v3', JSON.stringify({version:1,type:'url',url:'https://example.test/old.png'}));
  const restored = await ui(new IDB.IDBFactory(), older);
  assert.equal(restored.nodes.get('#bg-url-input').value, 'https://example.test/old.png');
});
