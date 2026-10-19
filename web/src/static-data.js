// Static files are gzip payloads, independent of the host's Content-Encoding headers.
export async function readPacked(url, signal, cache = 'default') {
  const response = await fetch(url, { signal, cache });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${new URL(url).pathname}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 31 || bytes[1] !== 139) return bytes.buffer;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export async function readJSON(url, cache = 'default') {
  return JSON.parse(new TextDecoder().decode(await readPacked(url, undefined, cache)));
}

export function prepareGraph(graph) {
  if (![1, 2].includes(graph.format)) throw new Error('Unsupported static data version; reload the map');
  graph.positions = new Map(graph.fids.map((fid, i) => [fid, i]));
  graph.byName = new Map();
  graph.downstream = new Map();
  graph.upstream = new Map();
  for (let i = 0; i < graph.fids.length; i++) {
    for (const [map, key] of [[graph.byName, graph.names[i]], [graph.downstream, graph.from[i]], [graph.upstream, graph.to[i]]]) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    }
  }
  return graph;
}

export function walkGraph(graph, seeds, direction) {
  if (!['upstream', 'downstream'].includes(direction)) throw new Error('Unknown direction');
  if (!seeds.length || seeds.some(i => !Number.isInteger(i) || i < 0 || i >= graph.fids.length))
    throw new Error('Unknown pipe');
  const forward = direction === 'downstream';
  const origin = forward ? graph.from : graph.to;
  const target = forward ? graph.to : graph.from;
  const outgoing = graph[direction], incoming = graph[forward ? 'upstream' : 'downstream'];
  const queue = [...new Set(seeds)], selected = new Set(queue), expanded = new Set(), stops = new Set();
  for (let head = 0; head < queue.length; head++) {
    const node = target[queue[head]], next = outgoing.get(node);
    if (!next?.length) stops.add(node);
    else if (!expanded.has(node)) {
      expanded.add(node);
      for (const i of next) if (!selected.has(i)) { selected.add(i); queue.push(i); }
    }
  }
  // Reverse coverage detects closed branches even when another branch reaches an outlet.
  const pending = [...stops], covered = new Set(), seen = new Set(pending);
  for (let head = 0; head < pending.length; head++) {
    for (const i of incoming.get(pending[head]) || []) if (selected.has(i)) {
      covered.add(i);
      if (!seen.has(origin[i])) { seen.add(origin[i]); pending.push(origin[i]); }
    }
  }
  return {indices: [...selected].sort((a, b) => a - b), stops: [...stops].sort((a, b) => graph.nodes[a].localeCompare(graph.nodes[b])),
    unterminated_count: selected.size - covered.size};
}

export function traceResult(graph, walk, features, direction) {
  const endpoints = new Map();
  for (const feature of features) {
    const parts = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    if (parts.length) {
      endpoints.set(feature.properties.from, parts[0][0]);
      endpoints.set(feature.properties.to, parts.at(-1).at(-1));
    }
  }
  const selected = new Set(walk.indices);
  const aliases = (graph.aliases || []).filter(a => selected.has(a.position));
  for (const a of aliases) if (a.inferred) features.push({type: 'Feature', id: `alias-${graph.fids[a.position]}-${a.side}`,
    geometry: a.geometry, properties: {name: `${a.from_id} / ${a.to_id}`, inferred: 1, trace_only: true, evidence: a.evidence}});
  return {type: 'FeatureCollection', features, count: walk.indices.length,
    length_m: walk.indices.reduce((sum, i) => sum + graph.lengths[i], 0) + aliases.reduce((sum, a) => sum + a.distance_m, 0),
    inferred_count: walk.indices.reduce((sum, i) => sum + Number(!!graph.inferred[i]), 0) + aliases.filter(a => a.inferred).length,
    alias_count: aliases.length, truncated: false, unterminated_count: walk.unterminated_count,
    direction, direction_basis: 'recorded_topology', terminals: walk.stops.map(i => {
      const terminal = graph.terminals[i] || {role: 'unconfirmed', published: false};
      return {id: graph.nodes[i], role: direction === 'downstream' ? terminal.role : 'upstream', published: terminal.published,
        receiver: direction === 'downstream' && terminal.published ? 'outfall' : null, coordinates: endpoints.get(graph.nodes[i])};
    })};
}
