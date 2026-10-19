import { expect, it } from 'vitest';
import { resolveRoute } from '../src/core/router/resolve-route';

it.each([['#/logs','logs'],['#rules','rules'],['upstreams','upstreams'],['data','management'],['features','management'],['','overview'],['<script>','overview']])('resolves compatible route %s', (value, expected) => {
  expect(resolveRoute(value)).toBe(expected);
});
