// Exercise the production count-up function with a deterministic animation clock.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../_src/ui/assets/js/app.js'), 'utf8');
const start = source.indexOf('  function animateCountUps(root){');
const end = source.indexOf('  function syncSegThumb(', start);
assert(start >= 0 && end > start, 'Production count-up function must be found');

function fixture(value, reduced = false) {
  const frames = [], motion = { matches: reduced }, number = { textContent: value, isConnected: true };
  let splits = 0;
  const element = {
    querySelector: selector => { assert.equal(selector, '.display-number'); return number; },
    classList: { add() {}, remove() {} },
    set textContent(_) { assert.fail('Count-up must never replace the number/unit container'); }
  };
  const context = vm.createContext({
    window: { LocalDNSInterface: { displayNumerals: () => splits++ } },
    reduceMotion: motion, performance: { now: () => 0 },
    requestAnimationFrame: callback => frames.push(callback), setTimeout() {}
  });
  vm.runInContext(source.slice(start, end), context);
  context.animateCountUps({ querySelectorAll: () => [element] });
  return { frames, motion, number, splits };
}

let test = fixture('1,234.50');
assert.equal(test.splits, 1);
assert.equal(test.number.textContent, '0.00');
test.frames.shift()(280);
assert.equal(test.number.textContent, '1,080.19');
test.frames.shift()(560);
assert.equal(test.number.textContent, '1,234.50');
assert.equal(test.frames.length, 0);

test = fixture('98.12');
test.frames.shift()(140);
test.motion.matches = true;
test.frames.shift()(280);
assert.equal(test.number.textContent, '98.12');
assert.equal(test.frames.length, 0);

test = fixture('42', true);
assert.equal(test.splits, 1, 'Structure must be established even without animation');
assert.equal(test.number.textContent, '42');
assert.equal(test.frames.length, 0);

test = fixture('100');
test.number.isConnected = false;
test.frames.shift()(280);
assert.equal(test.number.textContent, '0', 'Detached DOM must not be animated');
assert.equal(test.frames.length, 0);

for (const value of ['0', '-1', '−1', '—']) {
  test = fixture(value);
  assert.equal(test.number.textContent, value);
  assert.equal(test.frames.length, 0);
}
console.log('Count-up regression: formatting, units, reduced motion, detached DOM and nonpositive values passed');
