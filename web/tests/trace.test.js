import test from "node:test";
import assert from "node:assert/strict";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { traceStatus } from "../src/state.js";
import { FlowAnimation, flowDash } from "../src/flow.js";
import { basemaps, basemapSource, labelSource, initialStyle } from "../src/basemaps.js";

test("published outfalls are distinct from inferred transfers and missing outlets", () => {
  const published = {published: true, role: "outfall", receiver: "outfall"};
  const transfer = {published: false, role: "pump_transfer", receiver: null};
  const unknown = {published: false, role: "unconfirmed", receiver: null};
  assert.equal(traceStatus({terminals: [published]}, "downstream").tone, "connected");
  assert.equal(traceStatus({terminals: [published]}, "downstream").title, "到达 1 个公布出水口");
  assert.equal(traceStatus({terminals: [transfer]}, "downstream").title, "未到达公布出水口或受纳水体");
  assert.equal(traceStatus({terminals: [unknown]}, "downstream").title, "未到达公布出水口或受纳水体");
  const mixed = traceStatus({terminals: [published, unknown]}, "downstream");
  assert.equal(mixed.tone, "warning");
  assert.equal(mixed.title, "部分路径尚未到达受纳端");
  assert.match(mixed.detail, /1 处下游连接未确认/);
  assert.equal(traceStatus({terminals: []}, "downstream").tone, "warning");
  for (const direction of ["upstream", "downstream"])
    assert.match(traceStatus({terminals: [published], truncated: true}, direction).detail, /未完整返回/);
  const cycle = traceStatus({terminals: [published], unterminated_count: 3}, "downstream");
  assert.equal(cycle.tone, "warning");
  assert.match(cycle.detail, /3 条构件无终端路径/);
  assert.equal(traceStatus({terminals: [published, transfer]}, "downstream").tone, "warning");
  assert.equal(traceStatus({terminals: [{published: true, role: "published_outlet", receiver: null}]}, "downstream").tone, "warning");
  const inferred = traceStatus({terminals: [published], inferred_count: 1}, "downstream");
  assert.equal(inferred.tone, "warning");
  assert.match(inferred.title, /含推测接续/);
  assert.match(inferred.detail, /非已核实排水路径/);
  const river = {role: "river", receiver: "river"};
  assert.equal(traceStatus({terminals: [river]}, "downstream").title, "到达 1 个已确认受纳端");
  assert.equal(traceStatus({terminals: [{role: "river", receiver: null}]}, "downstream").tone, "warning");
});

test("old API responses cannot be mistaken for disconnected drainage", () => {
  for (const terminal of [{published: true, role: "outfall"}, {published: false, role: "transfer_boundary"}]) {
    const status = traceStatus({terminals: [terminal]}, "downstream");
    assert.equal(status.outdated, true);
    assert.equal(status.title, "追踪服务版本未更新");
    assert.match(status.detail, /暂不能判断/);
    assert.doesNotMatch(status.title, /未到达/);
  }
  assert.equal(traceStatus({terminals: [{published: false, role: "unconfirmed", receiver: null}]}, "downstream").outdated, undefined);
});

test("full asset scope and missing lineage remain visible", () => {
  const result = {terminals: [{published: true, role: "outfall", receiver: "outfall"}], trace_scope: "full_assets"};
  assert.match(traceStatus(result, "downstream").detail, /完整资产追踪网/);
  const partial = traceStatus({...result, unmapped_source_count: 2}, "downstream");
  assert.equal(partial.tone, "warning");
  assert.match(partial.detail, /2 条源构件未映射/);
  assert.equal(partial.title, "部分路径尚未到达受纳端");
  assert.match(traceStatus({...result, trace_scope: "calculation_network"}, "downstream").detail, /未使用完整资产追踪/);
});

test("moving dash has a constant period and wraps without negative lengths", () => {
  for (let phase = -32; phase <= 32; phase += 0.25) {
    const dash = flowDash(phase);
    assert.ok(dash.every(n => n >= 0));
    assert.equal(dash.reduce((a, b) => a + b), 16);
    assert.equal(dash[0] + dash[2], 2);
    assert.deepEqual(flowDash(phase + 16), dash);
  }
  assert.deepEqual(flowDash(1), [0, 1, 2, 13]);
  assert.deepEqual(flowDash(2), [0, 2, 2, 12]);
});

test("online basemaps and animated lines satisfy the MapLibre style spec", () => {
  const initial = initialStyle("http://127.0.0.1:8765");
  assert.deepEqual(validateStyleMin(initial), []);
  assert.equal(initial.layers.find(layer => layer.id === "terrain").layout.visibility, "none");
  assert.equal(basemapSource("terrain"), null);
  for (const [key, spec] of Object.entries(basemaps).filter(([, spec]) => spec.online)) {
    const source = basemapSource(key);
    assert.ok(source.tiles.every(url => url.startsWith("https://mapapi.geodata.gov.hk/")));
    assert.deepEqual(validateStyleMin({version: 8, sources: {
      basemap: source, labels: labelSource,
      trace: {type: "geojson", data: {type: "FeatureCollection", features: []}},
    }, layers: [
      {id: "basemap", type: "raster", source: "basemap", paint: spec.paint},
      {id: "labels", type: "raster", source: "labels"},
      {id: "flow", type: "line", source: "trace", paint: {"line-dasharray": flowDash(15.5)}},
    ]}), []);
  }
});

test("animation stops when idle, paused, hidden or reduced-motion is requested", (t) => {
  const names = ["document", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame"];
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => names.forEach((name, i) => previous[i]
    ? Object.defineProperty(globalThis, name, previous[i]) : delete globalThis[name]));
  const doc = new EventTarget(), motion = new EventTarget(), frames = new Map(), paints = [];
  doc.hidden = false;
  motion.matches = false;
  let serial = 0, cleanup;
  Object.assign(globalThis, {
    document: doc, matchMedia: () => motion,
    requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const animation = new FlowAnimation({
    once: (event, fn) => { assert.equal(event, "remove"); cleanup = fn; },
    setPaintProperty: (...args) => paints.push(args),
  });
  const advance = time => {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time));
  };
  assert.equal(frames.size, 0);
  animation.setActive(true);
  assert.equal(frames.size, 1);
  advance(100); advance(150);
  assert.notDeepEqual(paints[0][2], paints[1][2]);
  for (let time = 200; time < 100000; time += 53) advance(time);
  assert.ok(new Set(paints.map(paint => JSON.stringify(paint[2]))).size <= 32,
    "Unbounded dash states exhaust MapLibre's texture atlas during long playback");
  animation.setEnabled(false);
  assert.equal(frames.size, 0);
  animation.setEnabled(true);
  doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(frames.size, 0);
  doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(frames.size, 1);
  motion.matches = true; motion.dispatchEvent(new Event("change"));
  assert.equal(frames.size, 0);
  motion.matches = false; motion.dispatchEvent(new Event("change"));
  assert.equal(frames.size, 1);
  animation.setActive(false);
  assert.equal(frames.size, 0);
  cleanup();
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(frames.size, 0);
});
