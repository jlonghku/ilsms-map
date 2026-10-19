import {readPacked, readJSON} from './static-data.js';

export const staticMode = import.meta.env.VITE_STATIC === '1';
const root = new URL(import.meta.env.BASE_URL, location.origin).href;
const absolute = path => new URL(path, root).href;
let worker, serial = 0;
const pending = new Map(), tileIndexes = new Map();

export async function staticRequest(path, signal) {
  if (path === '/api/catalog') return readJSON(absolute('catalog.json'), 'no-cache');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!worker) {
    worker = new Worker(new URL('./static-worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = ({data}) => {
      const job = pending.get(data.id);
      if (!job) return;
      job.clean();
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data.value);
    };
    worker.onerror = () => {
      for (const job of [...pending.values()]) { job.clean(); job.reject(new Error('Map worker failed; reload the page')); }
      worker.terminate(); worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const abort = () => { clean(); reject(new DOMException('Aborted', 'AbortError')); };
    const clean = () => { pending.delete(id); signal?.removeEventListener('abort', abort); };
    pending.set(id, {resolve, reject, clean});
    signal?.addEventListener('abort', abort, {once: true});
    worker.postMessage({id, root, path});
  });
}

export function installStaticProtocol(maplibre) {
  if (!staticMode) return;
  maplibre.addProtocol('packed', async ({url}, controller) => {
    const target = url.slice('packed://'.length), split = target.lastIndexOf('/tiles/');
    const base = target.slice(0, split), key = target.slice(split + 7).replace(/\.pbf\.gz$/, '');
    if (!tileIndexes.has(base)) tileIndexes.set(base, readJSON(`${base}/tiles.json.gz`).then(keys => new Set(keys))
      .catch(error => {tileIndexes.delete(base); throw error;}));
    const index = await tileIndexes.get(base);
    return {data: index.has(key) ? await readPacked(target, controller.signal) : new ArrayBuffer(0)};
  });
}

export const networkTileUrl = dataset => `packed://${absolute(dataset.base)}/tiles/{z}/{x}/{y}.pbf.gz`;
export const eventTileUrl = (event, metric, frame) => `${absolute(event.base)}/${metric}/${frame}/{z}/{x}/{y}.png`;
export function staticTerrain(style, terrain) {
  style.sources.terrain = {...style.sources.terrain, minzoom: terrain.minzoom, maxzoom: terrain.maxzoom,
    bounds: terrain.bounds, tiles: [`${absolute(terrain.base)}/{z}/{x}/{y}.png`], attribution: 'CSDI · DSD / HyD · DEM'};
  return style;
}
