import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {prepareGraph, walkGraph, traceResult, readPacked, readJSON} from '../src/static-data.js';

function graph(from, to, terminals = {}) {
  return prepareGraph({format: 1, nodes: Array.from({length: Math.max(...from, ...to) + 1}, (_, i) => `N${i}`),
    fids: from.map((_, i) => i + 1), names: from.map((_, i) => `P${i}`), kinds: from.map(() => 'pipe'),
    from, to, lengths: from.map(() => 10), inferred: from.map(() => 0), terminals, aliases: []});
}
const features = (g, indices) => indices.map(i => ({type: 'Feature', id: g.fids[i],
  properties: {name: g.names[i], from: g.nodes[g.from[i]], to: g.nodes[g.to[i]], inferred: g.inferred[i]},
  geometry: {type: 'LineString', coordinates: [[g.from[i], 0], [g.to[i], 0]]}}));

test('static trace continues past intermediate boundaries to all final outfalls', () => {
  const g = graph([0, 1, 2, 2, 3, 4], [1, 2, 3, 4, 5, 6], {
    1: {role: 'pump_transfer', published: false}, 2: {role: 'outfall', published: true},
    5: {role: 'outfall', published: true}, 6: {role: 'outfall', published: true},
  });
  const w = walkGraph(g, [0], 'downstream'), result = traceResult(g, w, features(g, w.indices), 'downstream');
  assert.deepEqual(w.indices, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(result.terminals.map(t => t.id), ['N5', 'N6']);
  assert.ok(result.terminals.every(t => t.receiver === 'outfall'));
  assert.equal(result.length_m, 60);
});
test('an outlet branch never masks a separate closed-loop branch', () => {
  const g = graph([0, 1, 1, 3, 4], [1, 2, 3, 4, 3]);
  const w = walkGraph(g, [0], 'downstream');
  assert.deepEqual(w.stops, [2]);
  assert.equal(w.unterminated_count, 3);
});
test('multiple seeds and parallel pipes remain distinct, no 5000-link cutoff', () => {
  const from = Array.from({length: 6001}, (_, i) => i), to = from.map(i => i + 1);
  const g = graph([...from, 0], [...to, 1]);
  assert.equal(walkGraph(g, [0, 6001], 'downstream').indices.length, 6002);
  assert.equal(walkGraph(g, [6000], 'upstream').indices.length, 6002);
  assert.throws(() => walkGraph(g, [99999], 'downstream'));
  assert.throws(() => walkGraph(g, [0], 'invalid'));
});
test('unconfirmed receivers, upstreams and inferred aliases stay labelled', () => {
  const g = graph([0, 1], [1, 2], {2: {role: 'published_outlet', published: false}});
  g.inferred[1] = 1;
  g.aliases = [{position: 0, side: 'TO', from_id: 'x', to_id: 'N1', distance_m: 2, inferred: true,
    geometry: {type: 'LineString', coordinates: [[0, 0], [1, 0]]}, evidence: 'reviewed candidate'}];
  const w = walkGraph(g, [0], 'downstream'), r = traceResult(g, w, features(g, w.indices), 'downstream');
  assert.equal(r.terminals[0].receiver, null);
  assert.equal(r.inferred_count, 2);
  assert.equal(r.length_m, 22);
  assert.equal(r.features.at(-1).properties.trace_only, true);
  const up = walkGraph(g, [1], 'upstream');
  assert.equal(traceResult(g, up, features(g, up.indices), 'upstream').terminals[0].role, 'upstream');
});
test('gzip files work with or without server-side content decoding', async () => {
  const body = JSON.stringify({name: 'SMD4006060'});
  for (const bytes of [Buffer.from(body), gzipSync(body)]) {
    const result = await readPacked(`data:application/octet-stream;base64,${bytes.toString('base64')}`);
    assert.equal(new TextDecoder().decode(result), body);
  }
});
test('the publication catalog can revalidate while versioned data stays cached', async (t) => {
  const caches = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    caches.push(options.cache);
    return new Response(JSON.stringify({format: 2}));
  });
  assert.deepEqual(await readJSON('https://example.com/catalog.json', 'no-cache'), {format: 2});
  await readJSON('https://example.com/data/versioned/graph.json.gz');
  assert.deepEqual(caches, ['no-cache', 'default']);
});
