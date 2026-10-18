const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../_src/ui/assets/js/clients.js');

test('only recorded positive-query sources appear; saved ROS aliases do not become devices', () => {
  const clients = [{key:'192.0.2.102',count:5500},{key:'192.0.2.1',count:120}];
  const aliases = {'10.0.0.250':'RouterOS_China-Telecom','10.0.0.251':'RouterOS_China-Mobile','192.0.2.1':'Router'};
  const before = JSON.stringify({clients,aliases});
  const rows = C.topology(clients, aliases, 5620);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].name, 'Router');
  assert(!JSON.stringify(rows).includes('RouterOS'));
  assert.equal(JSON.stringify({clients,aliases}), before);
  assert.equal(C.topology([{key:'10.0.0.250',count:0}], aliases, 0)[0].ip, '');
  assert.equal(C.topology([], aliases, 0)[0].name, '暂无客户端请求');
});

test('remaining source count and requests contain only actual records', () => {
  const clients = Array.from({length:7}, (_,i) => ({key:'192.0.2.'+(i+1),count:10}));
  const rows = C.topology(clients, {}, 70);
  assert.equal(rows.length, 5);
  assert.equal(rows[4].name, '其余 3 个来源');
  assert.match(rows[4].sub, /30 次/);
});

test('IPv4 and IPv6 additions validate and equivalent IPv6 addresses normalize', () => {
  assert.equal(C.normalizeIP(' 192.0.2.1 '), '192.0.2.1');
  assert.equal(C.normalizeIP('2001:0DB8:0:0:0:0:0:1'), '2001:db8::1');
  for (const ip of ['999.0.0.1','01.2.3.4','host.example','http://192.0.2.1','::1/path','<script>','__proto__']) assert.throws(() => C.normalizeIP(ip));
});

test('saving edits preserves unrelated concurrent aliases and removes only selected names', () => {
  const base = {'192.0.2.1':'Router','10.0.0.250':'Old ROS'};
  const latest = {...base,'2001:db8::5':'New from another device'};
  const next = C.mergeEdits(base, latest, new Map([['10.0.0.250',null],['192.0.2.1','Main router'],['192.0.2.20','Desk']]));
  assert.equal(next['2001:db8::5'], latest['2001:db8::5']);
  assert.equal(next['192.0.2.20'], 'Desk');
  assert(!Object.hasOwn(next, '10.0.0.250'));
  assert.equal(base['10.0.0.250'], 'Old ROS');
  assert.equal(latest['192.0.2.1'], 'Router');
});

test('conflicting edited names and malformed reads prevent overwrite', () => {
  const base = {'192.0.2.1':'Router'};
  assert.throws(() => C.mergeEdits(base, {'192.0.2.1':'New name'}, new Map([['192.0.2.1',null]])), /其他设备修改/);
  assert.throws(() => C.mergeEdits(base, {}, new Map([['192.0.2.1','My name']])), /其他设备修改/);
  for (const invalid of [null, [], '<html>', {'192.0.2.1':false}]) assert.throws(() => C.aliases(invalid));
});
