import {readJSON, prepareGraph, walkGraph, traceResult} from './static-data.js';

const graphs = new Map(), indexes = new Map(), chunks = new Map();
let catalogPromise;
function cached(cache, key, limit, load) {
  if (cache.has(key)) {
    const item = cache.get(key); cache.delete(key); cache.set(key, item); return item;
  }
  const item = load().catch(error => { cache.delete(key); throw error; });
  cache.set(key, item);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
  return item;
}
const graphAt = base => cached(graphs, base, 4, async () => prepareGraph(await readJSON(`${base}/graph.json.gz`)));
const indexAt = base => cached(indexes, base, 2, async () => {
  const index = await readJSON(`${base}/index.json.gz`);
  index.positions = new Map(index.fids.map((fid, i) => [fid, i]));
  return index;
});
const chunkAt = (base, chunk) => cached(chunks, `${base}/${chunk}`, 32, () => readJSON(`${base}/features/${chunk}.json.gz`));
async function featureAt(base, graph, fid) {
  if (!graph.positions.has(fid)) throw new Error('Unknown pipe');
  const features = await chunkAt(base, graph.feature_chunks?.[graph.positions.get(fid)] ?? Math.floor(fid / graph.chunk_size));
  if (!features[fid]) throw new Error('Incomplete static feature export');
  return features[fid];
}
export async function request(root, path) {
  catalogPromise ||= readJSON(new URL('catalog.json', root));
  const catalog = await catalogPromise;
  const url = new URL(path, root);
  const match = url.pathname.match(/^\/api\/network\/(stormwater|sewage)\/(full|engineering|screening)\/(search|feature\/\d+|trace\/\d+)$/);
  if (!match) throw new Error('Unknown static operation');
  const [, system, level, operation] = match;
  const dataset = catalog.networks.find(n => n.system === system && n.level === level);
  if (!dataset || (url.searchParams.has('v') && url.searchParams.get('v') !== dataset.revision)) throw new Error('Reload the map to use the current data version');
  const base = new URL(dataset.base, root).href;
  const model = await indexAt(base);
  if (operation === 'search') {
    const q = (url.searchParams.get('q') || '').trim().toUpperCase().slice(0, 120);
    const found = [];
    if (q) for (let i = 0; i < model.fids.length && found.length < 20; i++)
      if (model.names[i].toUpperCase().includes(q)) found.push({fid: model.fids[i], name: model.names[i], kind: model.kinds[i]});
    return found;
  }
  const fid = Number(operation.split('/')[1]);
  const feature = await featureAt(base, model, fid);
  if (operation.startsWith('feature/')) return feature;
  const direction = url.searchParams.get('direction') || 'downstream';
  const trace = catalog.traces[system], traceBase = new URL(trace.base, root).href;
  const full = await graphAt(traceBase);
  const lineage = feature.properties.SOURCE_LINK_IDS;
  const names = new Set(lineage && lineage !== 'nan' ? lineage.split('|') : [feature.properties.FEAT_NUM]);
  const matched = [...names].filter(name => full.byName.has(name));
  const seeds = [...new Set(matched.flatMap(name => full.byName.get(name)))];
  const graph = seeds.length ? full : await graphAt(base), source = seeds.length ? traceBase : base;
  const walk = walkGraph(graph, seeds.length ? seeds : [model.positions.get(fid)], direction);
  const groups = new Map(), selected = new Map();
  for (const i of walk.indices) {
    const chunk = graph.feature_chunks?.[i] ?? Math.floor(graph.fids[i] / graph.chunk_size);
    if (!groups.has(chunk)) groups.set(chunk, []);
    groups.get(chunk).push(i);
  }
  const queue = [...groups];
  let next = 0;
  // Bound concurrency, and fetch nearby path segments together instead of serial HTTP round trips.
  await Promise.all(Array.from({length: Math.min(6, queue.length)}, async () => {
    while (next < queue.length) {
      const [chunk, indices] = queue[next++], records = await chunkAt(source, chunk);
      for (const i of indices) {
        const f = records[graph.fids[i]];
        if (!f) throw new Error('Incomplete static trace export');
        selected.set(i, seeds.length ? {...f} : {...f, properties: {name: graph.names[i], from: graph.nodes[graph.from[i]],
          to: graph.nodes[graph.to[i]], inferred: graph.inferred[i], rule: 'recorded'}});
      }
    }
  }));
  const features = walk.indices.map(i => selected.get(i));
  return {...traceResult(graph, walk, features, direction), trace_scope: seeds.length ? 'full_assets' : 'calculation_network',
    selected_level: level, unmapped_source_count: names.size - matched.length, topology_fingerprint: trace.fingerprint};
}
if (typeof self !== 'undefined') self.onmessage = async ({data: {id, root, path}}) => {
  try { self.postMessage({id, value: await request(root, path)}); }
  catch (error) { self.postMessage({id, error: error.message}); }
};
