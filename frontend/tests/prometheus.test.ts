import { describe, expect, it } from 'vitest';
import { metricFind, parseProm } from '../src/shared/metrics/prometheus';

describe('parseProm legacy behavior', () => {
  it('ignores blank lines and trimmed comments, including CRLF input', () => {
    expect(parseProm('\r\n  \n # HELP x text\r\n# TYPE x counter\n x 2 \r\n'))
      .toEqual([{ name: 'x', labels: {}, value: 2 }]);
  });

  it.each([undefined, null, false, 0, '', NaN])('keeps falsy input coercion for %s', value => {
    expect(parseProm(value)).toEqual([]);
  });

  it('coerces other input with String', () => {
    expect(parseProm({ toString: () => 'value 3' })).toEqual([{ name: 'value', labels: {}, value: 3 }]);
  });

  it('parses unlabelled metrics, empty labels, and colon-prefixed names in order', () => {
    expect(parseProm('queries_total 12\n:cache_hits{}\t5\n_process:count 6')).toEqual([
      { name: 'queries_total', labels: {}, value: 12 },
      { name: ':cache_hits', labels: {}, value: 5 },
      { name: '_process:count', labels: {}, value: 6 },
    ]);
  });

  it('parses multiple labels and preserves comma/equal characters inside values', () => {
    expect(parseProm('requests{tag="cache_main",group="domestic",description="a,b=c"} 42')).toEqual([
      { name: 'requests', labels: { tag: 'cache_main', group: 'domestic', description: 'a,b=c' }, value: 42 },
    ]);
  });

  it('unescapes quotes then backslashes, but preserves literal backslash-n', () => {
    expect(parseProm(String.raw`m{quoted="say \"hi\"",path="C:\\DNS",newline="a\nb"} 1`)).toEqual([
      { name: 'm', labels: { quoted: 'say "hi"', path: 'C:\\DNS', newline: String.raw`a\nb` }, value: 1 },
    ]);
  });

  it('retains permissive label scanning and the last duplicate value', () => {
    expect(parseProm('m{broken=plain,valid="ok",valid="last"} 2')).toEqual([
      { name: 'm', labels: { valid: 'last' }, value: 2 },
    ]);
  });

  it.each([
    '9invalid 1', 'metric-name 1', 'metric', 'metric 1 123456', 'metric 1 # exemplar',
    'metric {tag="a"} 1', 'metric{tag="a" 1', 'metric{tag="a}b"} 1',
  ])('ignores lines outside the original expression: %s', line => {
    expect(parseProm(line)).toEqual([]);
  });

  it.each([
    ['12', 12], ['-3.5', -3.5], ['+4', 4], ['1.2e3', 1200], ['0x10', 16], ['-0', -0],
    ['Infinity', Infinity], ['-Infinity', -Infinity], ['1e999', Infinity],
    ['NaN', NaN], ['+Inf', NaN], ['-Inf', NaN], ['nonsense', NaN],
  ])('keeps Number conversion for %s', (text, value) => {
    expect(parseProm(`metric ${text}`)).toEqual([{ name: 'metric', labels: {}, value }]);
  });
});

describe('metricFind legacy behavior', () => {
  const metrics = parseProm('m{tag="one",group="domestic"} 7\nm{tag="two",group="foreign"} 9\nm{tag="one",group="foreign"} 11\nm 13');

  it('returns the first matching name when labels are omitted or empty', () => {
    expect(metricFind(metrics, 'm')).toBe(7);
    expect(metricFind(metrics, 'm', {})).toBe(7);
  });

  it('requires all requested labels and allows additional metric labels', () => {
    expect(metricFind(metrics, 'm', { tag: 'one', group: 'foreign' })).toBe(11);
    expect(metricFind(metrics, 'm', { tag: 'two' })).toBe(9);
    expect(metricFind(metrics, 'm', { tag: 'two', group: 'domestic' })).toBe(0);
  });

  it('returns zero for missing names, missing labels, mismatched labels, or no metrics', () => {
    expect(metricFind(metrics, 'missing')).toBe(0);
    expect(metricFind(metrics, 'm', { absent: 'value' })).toBe(0);
    expect(metricFind(metrics, 'm', { tag: 'ONE' })).toBe(0);
    expect(metricFind([], 'm')).toBe(0);
  });

  it.each([['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['-0', -0], ['0', 0]])(
    'returns the matched %s value without normalizing it', (text, expected) => {
      expect(metricFind(parseProm(`m ${text}`), 'm')).toBe(expected);
    },
  );
});
