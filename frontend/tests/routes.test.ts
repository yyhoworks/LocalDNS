import { expect, it } from 'vitest';
import { parseRoute, resolveRoute } from '../src/core/router/resolve-route';

it.each([['#/logs','logs'],['#rules','rules'],['upstreams','upstreams'],['data','management'],['features','management'],['','overview'],['<script>','overview']])('resolves compatible route %s', (value, expected) => {
  expect(resolveRoute(value)).toBe(expected);
});

it.each([
  ['#/rules/adguard', 'rules', 'adguard'],
  ['#/rules/auto', 'rules', 'auto'],
  ['#/management/cache', 'management', 'cache'],
  ['#/management/features', 'management', 'features'],
  ['rules/diversion?x=1', 'rules', 'diversion'],
  ['#/rules/bogus', 'rules', null],
  ['#/overview/extra', 'overview', null],
  ['#/data', 'management', null],
])('parses sub-route %s', (value, route, sub) => {
  expect(parseRoute(value)).toEqual({ route, sub });
});
