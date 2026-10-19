import {readJSON, prepareGraph, walkGraph, traceResult} from './static-data.js';

const graphs = new Map(), chunks = new Map();
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
const chunkAt = (base, chunk) => cached(chunks, `${base}/${chunk}`, 32, () => readJSON(`${base}/features/${chunk}.json.gz`));
async function featureAt(base, graph, fid) {
  if (!graph.positions.has(fid)) throw new Error('Unknown pipe');
  const features = await chunkAt(base, Math.floor(fid / graph.chunk_size));
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
  const model = await graphAt(base);
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
  const graph = seeds.length ? full : model, source = seeds.length ? traceBase : base;
  const walk = walkGraph(graph, seeds.length ? seeds : [model.positions.get(fid)], direction);
  const features = [];
  // Sequential chunks bound requests and memory for long upstream trees.
  for (const i of walk.indices) {
    const f = await featureAt(source, graph, graph.fids[i]);
    features.push(seeds.length ? {...f} : {...f, properties: {name: graph.names[i], from: graph.nodes[graph.from[i]],
      to: graph.nodes[graph.to[i]], inferred: graph.inferred[i], rule: 'recorded'}});
  }
  return {...traceResult(graph, walk, features, direction), trace_scope: seeds.length ? 'full_assets' : 'calculation_network',
    selected_level: level, unmapped_source_count: names.size - matched.length, topology_fingerprint: trace.fingerprint};
}
if (typeof self !== 'undefined') self.onmessage = async ({data: {id, root, path}}) => {
  try { self.postMessage({id, value: await request(root, path)}); }
  catch (error) { self.postMessage({id, error: error.message}); }
};
