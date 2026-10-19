import test from "node:test";
import assert from "node:assert/strict";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  timeLabel,
  number,
  escapeHtml,
  featureBounds,
  networkFilter,
} from "../src/state.js";
test("time remains correct after one day", () => {
  assert.equal(timeLabel(90061), "25:01:01");
  assert.equal(timeLabel(-5), "00:00:00");
});
test("missing scientific values are not displayed as zero", () => {
  assert.equal(number(null), "—");
  assert.equal(number(NaN), "—");
  assert.equal(number(0), "0");
});
test("attribute text is escaped", () =>
  assert.equal(
    escapeHtml('<img onerror="x">'),
    "&lt;img onerror=&quot;x&quot;&gt;",
  ));
test("bounds support large traces without argument stack overflow", () => {
  const feature = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: Array.from({ length: 150000 }, (_, i) => [
        i / 1000,
        i / 2000,
      ]),
    },
  };
  assert.deepEqual(featureBounds(feature), [
    [0, 0],
    [149.999, 74.9995],
  ]);
  assert.equal(
    featureBounds({ type: "FeatureCollection", features: [] }),
    null,
  );
});
test("inferred links remain a separate filter", () => {
  const filter = networkFilter({
    pipes: true,
    channels: true,
    inferred: false,
  });
  assert.equal(filter[2], false);
});
test("layer filter satisfies MapLibre's style specification", () => {
  assert.deepEqual(
    validateStyleMin({
      version: 8,
      sources: {
        network: {
          type: "vector",
          tiles: ["http://127.0.0.1/{z}/{x}/{y}.pbf"],
        },
      },
      layers: [
        {
          id: "pipes",
          type: "line",
          source: "network",
          "source-layer": "pipes",
          filter: networkFilter({
            pipes: true,
            channels: false,
            inferred: true,
          }),
        },
      ],
    }),
    [],
  );
});
test(
  "production build includes a local map worker",
  { skip: !existsSync("dist/assets") },
  () => {
    const files = readdirSync("dist/assets");
    const worker = files.find(
      (f) => f.startsWith("maplibre-gl-worker-") && f.endsWith(".js"),
    );
    assert.ok(
      worker,
      "MapLibre cannot resolve its default worker after bundling",
    );
    const application = files
      .filter((f) => f.startsWith("index-") && f.endsWith(".js"))
      .map((f) => readFileSync(`dist/assets/${f}`, "utf8"))
      .join("");
    assert.ok(application.includes(worker));
  },
);
