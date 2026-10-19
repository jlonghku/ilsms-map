import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  createIcons,
  Network,
  Search,
  X,
  Plus,
  Minus,
  Scan,
  Navigation,
  Download,
  PanelLeft,
  Play,
  Pause,
  MousePointer2,
  ArrowUpRight,
  ArrowDownRight,
  LoaderCircle,
  Layers,
} from "lucide";
import "./style.css";
import {
  levels,
  kinds,
  roles,
  number,
  timeLabel,
  escapeHtml as h,
  networkFilter,
  featureBounds,
  traceStatus,
} from "./state.js";
import { basemaps, basemapSource, labelSource, initialStyle } from "./basemaps.js";
import { FlowAnimation, flowDash } from "./flow.js";
import { staticMode, staticRequest, installStaticProtocol, networkTileUrl, eventTileUrl, staticTerrain } from "./data-client.js";

maplibregl.setWorkerUrl(mapWorkerUrl);
maplibregl.setWorkerCount(2);
maplibregl.setMaxParallelImageRequests(6);
installStaticProtocol(maplibregl);

const $ = (id) => document.getElementById(id);
const icons = {
  Network,
  Search,
  X,
  Plus,
  Minus,
  Scan,
  Navigation,
  Download,
  PanelLeft,
  Play,
  Pause,
  MousePointer2,
  ArrowUpRight,
  ArrowDownRight,
  LoaderCircle,
  Layers,
};
const redrawIcons = () =>
  createIcons({ icons, attrs: { "stroke-width": 1.7, width: 19, height: 19 } });
const empty = { type: "FeatureCollection", features: [] };
const regions = {
  hk: {
    name: "香港",
    bounds: [
      [113.83, 22.15],
      [114.43, 22.56],
    ],
  },
  kowloon: {
    name: "九龙",
    bounds: [
      [114.118, 22.279],
      [114.256, 22.37],
    ],
  },
  island: {
    name: "港岛",
    bounds: [
      [114.1, 22.2],
      [114.28, 22.3],
    ],
  },
  nt: {
    name: "新界",
    bounds: [
      [113.96, 22.35],
      [114.36, 22.55],
    ],
  },
};
const state = {
  system: "stormwater",
  level: "full",
  region: "kowloon",
  tab: "network",
  selected: null,
  event: null,
  frame: 0,
  metric: "depth",
  playing: false,
  basemap: "street",
  trace: null,
};
let map,
  flow,
  catalog,
  selectionVersion = 0,
  traceVersion = 0,
  selectionController,
  traceController,
  searchController,
  searchTimer,
  playbackTimer,
  noticeTimer;
const apiRoot = () => `/api/network/${state.system}/${state.level}`;
async function api(url, signal) {
  if (url.startsWith(`${apiRoot()}/`) && catalog) {
    const dataset = catalog.networks.find(n => n.system === state.system && n.level === state.level);
    const versioned = new URL(url, location.origin);
    versioned.searchParams.set("v", dataset.revision);
    url = versioned.toString();
  }
  if (staticMode) return staticRequest(url, signal);
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}
function notice(text, persistent = false) {
  clearTimeout(noticeTimer);
  $("notice").textContent = text;
  $("notice").hidden = false;
  if (!persistent)
    noticeTimer = setTimeout(() => {
      $("notice").hidden = true;
    }, 6500);
}
function setButtonGroup(id, value) {
  $(id)
    .querySelectorAll("button")
    .forEach((b) => {
      const active = b.dataset.value === value;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
}
function updateHeading() {
  if (state.tab === "events" && state.event) {
    $("map-title").textContent = `${regions[state.region].name}洪涝与水质`;
    $("map-subtitle").textContent =
      `${catalog.metrics[state.metric].name} · ${number(state.event.cell_size_m, 1)} m 网格 · 保存快照`;
    return;
  }
  $("map-title").textContent =
    `${regions[state.region].name}${state.system === "stormwater" ? "雨水" : "污水"}管网`;
  $("map-subtitle").textContent = `${levels[state.level]} · 修复拓扑`;
}
function fit(bounds, maxZoom = 16) {
  const compact = window.innerWidth <= 700;
  if (bounds)
    map.fitBounds(bounds, {
      padding: {
        top: compact && state.trace ? 180 : 105,
        right: 75,
        bottom: state.tab === "events" || state.trace ? (compact ? 190 : 155) : 70,
        left: 45,
      },
      maxZoom,
      duration: 850,
    });
}
function setRegion(region, move = true) {
  state.region = region;
  document
    .querySelectorAll("[data-region]")
    .forEach((b) => b.classList.toggle("active", b.dataset.region === region));
  if (move) fit(regions[region].bounds, 14);
  updateHeading();
}
function setBasemap(key) {
  const spec = basemaps[key] || basemaps.terrain;
  state.basemap = basemaps[key] ? key : "terrain";
  $("basemap").value = state.basemap;
  document.body.dataset.basemap = state.basemap;
  for (const id of ["basemap-labels", "basemap-tiles"]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  map.setLayoutProperty("terrain", "visibility", spec.online ? "none" : "visible");
  map.setPaintProperty("background", "background-color", spec.dark ? "#151a1c" : "#e8eff0");
  if (spec.online) {
    map.addSource("basemap-tiles", basemapSource(key));
    map.addLayer({id: "basemap-tiles", type: "raster", source: "basemap-tiles", paint: {
      "raster-fade-duration": 150, ...spec.paint,
    }}, "terrain");
    map.addSource("basemap-labels", labelSource);
    map.addLayer({id: "basemap-labels", type: "raster", source: "basemap-labels", paint: {
      "raster-fade-duration": 0, "raster-opacity": 0.8,
      ...(spec.dark ? {"raster-saturation": -1, "raster-brightness-min": 1, "raster-brightness-max": 0} : {}),
    }}, "terrain");
  }
  $("landsd-credit").hidden = !spec.online;
  $("landsd-credit-text").textContent = spec.type === "imagery" ? "Map / Aerial Photograph from Lands Department" : "Map from Lands Department";
  $("privacy-status").textContent = staticMode
    ? (spec.online ? "公开展示数据 · 底图来自地政总署" : "公开展示数据 · DEM 底图")
    : (spec.online ? "管网本地读取 · 在线底图仅请求视野瓦片" : "管网与结果仅在本机读取 · 离线底图");
  document.querySelectorAll(".place-label").forEach(label => { label.hidden = spec.online; });
  map.setPaintProperty("trace-glow", "line-color", spec.dark ? "#291e18" : "#ffffff");
  updateLayers();
}
function setFlowEnabled(enabled) {
  $("animate-flow").checked = enabled;
  flow.setEnabled(enabled);
  $("route-play").innerHTML = `<i data-lucide="${enabled ? "pause" : "play"}"></i>`;
  $("route-play").title = enabled ? "暂停流向动画" : "播放流向动画";
  $("route-play").setAttribute("aria-label", $("route-play").title);
  redrawIcons();
}
function networkColor() {
  if ($("color-mode").value === "diameter")
    return [
      "step",
      ["coalesce", ["get", "width"], 0],
      "#9eada8",
      1,
      "#68b5a1",
      450,
      "#197c77",
      900,
      "#466796",
      1800,
      "#ad605e",
    ];
  if ($("color-mode").value === "slope")
    return [
      "step",
      ["coalesce", ["get", "slope"], -1],
      "#9eada8",
      0,
      "#82b8b6",
      0.001,
      "#217e74",
      0.01,
      "#b88b39",
      0.05,
      "#b55566",
    ];
  return [
    "case",
    ["==", ["get", "inferred"], 1],
    basemaps[state.basemap].dark ? "#d5a3bd" : "#a25a79",
    [
      "match",
      ["get", "kind"],
      ["channel", "engineered_channel"],
      basemaps[state.basemap].dark ? "#edb75b" : "#c38c30",
      "culvert",
      basemaps[state.basemap].dark ? "#f0c679" : "#a76d22",
      state.system === "sewage" ? (basemaps[state.basemap].dark ? "#a6bce8" : "#5c74a1") : (basemaps[state.basemap].dark ? "#77d8d4" : "#217f7c"),
    ],
  ];
}
function updateLayers() {
  if (!map.getLayer("pipes")) return;
  const filter = networkFilter({
    pipes: $("show-pipes").checked,
    channels: $("show-channels").checked,
    inferred: $("show-inferred").checked,
  });
  for (const name of ["pipes", "inferred"])
    map.setFilter(name, [
      "all",
      filter,
      ["==", ["get", "inferred"], name === "inferred" ? 1 : 0],
    ]);
  map.setPaintProperty("pipes", "line-color", networkColor());
  map.setPaintProperty("inferred", "line-color", basemaps[state.basemap].dark ? "#d5a3bd" : "#a25a79");
  for (const name of ["pipes", "inferred"])
    map.setPaintProperty(
      name,
      "line-opacity",
      Number($("opacity").value) / 100 * (state.trace ? 0.26 : 1),
    );
  map.setLayoutProperty(
    "outfalls",
    "visibility",
    $("show-outfalls").checked ? "visible" : "none",
  );
  map.setLayoutProperty(
    "boundaries",
    "visibility",
    $("show-boundaries").checked ? "visible" : "none",
  );
  $("opacity-value").value = `${$("opacity").value}%`;
  updateLegend();
}
function updateLegend() {
  if (state.tab === "events" && state.event && $("show-results").checked) {
    const spec = catalog.metrics[state.metric];
    $("legend").innerHTML =
      `<strong>${h(spec.name)} <span>${h(spec.unit)}</span></strong>${spec.breaks.map((b, i) => `<div><b style="background:${spec.colors[i]}"></b><span>${i === spec.breaks.length - 1 ? "≥ " : ""}${b}${i < spec.breaks.length - 1 ? `–${spec.breaks[i + 1]}` : ""}</span></div>`).join("")}`;
    return;
  }
  const mode = $("color-mode").value;
  let entries = [
    [basemaps[state.basemap].dark ? "#77d8d4" : "#217f7c", "管道"],
    [basemaps[state.basemap].dark ? "#edb75b" : "#c38c30", "水渠 / 箱涵"],
    [basemaps[state.basemap].dark ? "#d5a3bd" : "#a25a79", "推测连接"],
  ];
  if (state.system === "sewage") entries[0][0] = basemaps[state.basemap].dark ? "#a6bce8" : "#5c74a1";
  if (mode === "diameter")
    entries = [
      ["#9eada8", "无记录"],
      ["#68b5a1", "< 450"],
      ["#197c77", "450–900"],
      ["#466796", "900–1800"],
      ["#ad605e", "≥ 1800"],
    ];
  if (mode === "slope")
    entries = [
      ["#9eada8", "无记录"],
      ["#82b8b6", "< 0.001"],
      ["#217e74", "0.001–0.01"],
      ["#b88b39", "0.01–0.05"],
      ["#b55566", "≥ 0.05"],
    ];
  $("legend").innerHTML =
    `<strong>${mode === "asset" ? "管网构件" : mode === "diameter" ? "宽度 / 管径 <span>mm</span>" : "坡度绝对值 <span>m/m</span>"}</strong>${entries.map(([color, text]) => `<div><b class="legend-line" style="background:${color}"></b><span>${text}</span></div>`).join("")}`;
  if (state.trace)
    $("legend").insertAdjacentHTML("beforeend", '<div class="trace-legend"><b class="legend-line" style="background:#ed7158"></b><span>完整追踪路径</span></div><div><b class="legend-line" style="background:#fff;border:1px solid #62857e"></b><span>记录方向脉冲</span></div>' +
      (state.trace.inferred_count ? '<div><b class="legend-line" style="background:transparent;border-top:2px dashed #a25a79"></b><span>推测接续</span></div>' : "") +
      (state.trace.direction === "downstream" && state.trace.terminals.some(t => t.published)
        ? '<div><b style="background:#198364;border-radius:50%"></b><span>最终排水口</span></div>' : ""));
}
function resetTrace() {
  traceVersion++;
  traceController?.abort();
  state.trace = null;
  flow?.setActive(false);
  for (const source of ["trace", "trace-terminals"])
    map.getSource(source)?.setData(empty);
  $("route-status").hidden = true;
  updateLayers();
}
function clearSelection() {
  selectionVersion++;
  selectionController?.abort();
  state.selected = null;
  map.getSource("selection")?.setData(empty);
  resetTrace();
  $("selection").innerHTML =
    '<div class="empty-selection"><i data-lucide="mouse-pointer-2"></i><span>尚未选择构件</span></div>';
  redrawIcons();
}
function changeNetwork(system, level) {
  state.system = system;
  state.level = level;
  setButtonGroup("system", system);
  document.querySelector(".line-swatch.pipe").style.background =
    system === "sewage" ? "#5c74a1" : "#217f7c";
  $("level").value = level;
  searchController?.abort();
  clearTimeout(searchTimer);
  $("search").value = "";
  $("search-results").replaceChildren();
  clearSelection();
  for (const layer of ["pipes", "inferred", "outfalls", "boundaries"])
    if (map.getLayer(layer)) map.removeLayer(layer);
  if (map.getSource("network")) map.removeSource("network");
  const dataset = catalog.networks.find(
    (n) => n.system === system && n.level === level,
  );
  if (!dataset) {
    notice("该管网尚未生成", true);
    return;
  }
  $("link-count").textContent = number(dataset.count);
  $("length").textContent = number(dataset.length_m / 1000);
  $("outfalls").textContent = number(dataset.published_outfalls);
  $("source-label").title = dataset.path || dataset.base;
  map.addSource("network", {
    type: "vector",
    tiles: [
      staticMode ? networkTileUrl(dataset) : `${location.origin}${apiRoot()}/tiles/{z}/{x}/{y}.pbf?v=${dataset.revision}`,
    ],
    minzoom: dataset.minzoom,
    maxzoom: dataset.maxzoom,
    bounds: [113.8, 22.1, 114.5, 22.6],
  });
  const width = [
    "interpolate",
    ["linear"],
    ["zoom"],
    9,
    0.55,
    12,
    1.1,
    16,
    2.5,
    19,
    4,
  ];
  map.addLayer(
    {
      id: "pipes",
      type: "line",
      source: "network",
      "source-layer": "pipes",
      paint: { "line-color": networkColor(), "line-width": width },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    "trace-glow",
  );
  map.addLayer(
    {
      id: "inferred",
      type: "line",
      source: "network",
      "source-layer": "pipes",
      paint: {
        "line-color": "#a25a79",
        "line-width": width,
        "line-dasharray": [3, 2],
      },
    },
    "trace-glow",
  );
  map.addLayer({
    id: "boundaries",
    type: "circle",
    source: "network",
    "source-layer": "boundaries",
    filter: ["==", ["get", "published"], 0],
    minzoom: 11,
    paint: {
      "circle-radius": 3.5,
      "circle-color": "#ffffff",
      "circle-stroke-color": "#6a6470",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "outfalls",
    type: "circle",
    source: "network",
    "source-layer": "boundaries",
    filter: ["==", ["get", "published"], 1],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2, 15, 4.5],
      "circle-color": "#137d5c",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.3,
    },
  });
  updateLayers();
  updateHeading();
  $("map-status").hidden = false;
}
async function selectFeature(fid, fly = false) {
  clearSelection();
  const version = selectionVersion;
  selectionController = new AbortController();
  $("selection").innerHTML =
    '<div class="empty-selection"><span class="spinner"></span>读取构件</div>';
  try {
    const feature = await api(`${apiRoot()}/feature/${fid}`, selectionController.signal);
    if (version !== selectionVersion) return;
    state.selected = feature;
    map.getSource("selection").setData(feature);
    const p = feature.properties;
    const invert = p.direction_reversed
      ? [p.DS_IL_REC, p.US_IL_REC]
      : [p.US_IL_REC, p.DS_IL_REC];
    const methods = p.direction_reversed
      ? [p.DS_METHOD, p.US_METHOD]
      : [p.US_METHOD, p.DS_METHOD];
    const rows = [
      ["追踪起点", p.model_from],
      ["追踪终点", p.model_to],
      ["长度", `${number(p.length_m, 1)} m`],
      ["宽 / 高", `${number(p.WIDTH)} / ${number(p.HEIGHT)} mm`],
      ["断面", p.SWMM_SHAPE],
      [
        "重建坡度",
        number(p.SLOPE_REC, 5),
      ],
      [
        "上 / 下游底高程",
        `${number(invert[0], 2)} / ${number(invert[1], 2)} m`,
      ],
      ["高程方法", `${methods[0] || "—"} / ${methods[1] || "—"}`],
      ["数据图层", p.SOURCE_LAYER],
      ["质控等级", p.QC_LEVEL],
    ];
    $("selection").innerHTML =
      `<h2>${h(p.FEAT_NUM)}</h2><div class="feature-badges"><span>${h(kinds[p.ASSET_CLASS] || p.ASSET_CLASS)}</span><span class="${p.IS_CITY_SYNTHETIC_CONNECTOR ? "inference" : ""}">${p.IS_CITY_SYNTHETIC_CONNECTOR ? "推测连接" : "原始构件 / 聚合"}</span></div><dl>${rows.map(([k, v]) => `<div><dt>${h(k)}</dt><dd>${h(v ?? "—")}</dd></div>`).join("")}</dl><div class="trace-actions"><button class="command" id="trace-up"><i data-lucide="arrow-up-right"></i>上游</button><button class="command primary" id="trace-down"><i data-lucide="arrow-down-right"></i>下游</button></div><div id="trace-summary" aria-live="polite"></div><div class="detail-note">方向：记录拓扑，非瞬时模拟流向。</div>`;
    $("trace-up").onclick = () => trace("upstream");
    $("trace-down").onclick = () => trace("downstream");
    if (window.matchMedia("(max-width: 700px)").matches) {
      $("sidebar").classList.add("open");
      $("menu").setAttribute("aria-expanded", "true");
    }
    redrawIcons();
    document
      .querySelector(".selection-section")
      .scrollIntoView({ block: "nearest", behavior: "smooth" });
    if ($("auto-trace").checked) await trace("downstream");
    else if (fly) fit(featureBounds(feature), 17);
  } catch (error) {
    if (version === selectionVersion && error.name !== "AbortError") {
      clearSelection();
      notice(`读取失败：${error.message}`);
    }
  }
}
async function trace(direction) {
  if (!state.selected) return;
  resetTrace();
  const version = selectionVersion,
    requestVersion = traceVersion,
    fid = state.selected.id;
  traceController = new AbortController();
  $("trace-summary").textContent = "正在追踪…";
  try {
    const result = await api(
      `${apiRoot()}/trace/${fid}?direction=${direction}`,
      traceController.signal,
    );
    if (selectionVersion !== version || traceVersion !== requestVersion) return;
    const status = traceStatus(result, direction);
    if (status.outdated) throw new Error(status.detail);
    state.trace = result;
    map.getSource("trace").setData(result);
    map.getSource("trace-terminals").setData({ type: "FeatureCollection", features: result.terminals.filter(t => t.coordinates).map(t => ({
      type: "Feature", geometry: {type: "Point", coordinates: t.coordinates}, properties: {name: t.id, role: t.role, published: t.published, final: direction === "downstream" && !!t.receiver},
    })) });
    $("trace-summary").innerHTML =
      `<strong>${direction === "downstream" ? "完整下游" : "上游"} ${number(result.count)} 条 · ${number(result.length_m / 1000, 2)} km</strong><p>${h(status.detail)}</p>${result.terminals.filter(t => t.published && direction === "downstream").map(t => `<div>${h(t.id)}</div>`).join("")}`;
    $("route-status").hidden = state.tab !== "network";
    $("route-status").dataset.tone = status.tone;
    $("route-title").textContent = status.title;
    $("route-meta").textContent = `${number(result.count)} 条 · ${number(result.length_m / 1000, 2)} km · 记录方向`;
    $("route-title").title = status.detail;
    for (const side of ["up", "down"]) $("trace-" + side).classList.toggle("primary", direction === (side === "up" ? "upstream" : "downstream"));
    flow.setActive(state.tab === "network");
    updateLayers();
    fit(featureBounds(result), Math.max(17, map.getZoom()));
  } catch (error) {
    if (selectionVersion === version && traceVersion === requestVersion && error.name !== "AbortError")
      $("trace-summary").textContent = `追踪失败：${error.message}`;
  }
}
function stopPlayback() {
  state.playing = false;
  clearTimeout(playbackTimer);
  $("play").innerHTML = '<i data-lucide="play"></i>';
  $("play").title = "播放";
  $("play").setAttribute("aria-label", "播放");
  redrawIcons();
}
function frameUrl() {
  if (staticMode) return eventTileUrl(state.event, state.metric, state.frame);
  return `${location.origin}/api/events/${state.event.id}/tiles/${state.metric}/${state.frame}/{z}/{x}/{y}.png?run=${encodeURIComponent(state.event.run_id)}`;
}
function renderFrame() {
  if (!state.event) return;
  updateHeading();
  $("time").value = state.frame;
  $("time-value").textContent = timeLabel(state.event.times[state.frame]);
  if (map.getSource("result")) map.getSource("result").setTiles([frameUrl()]);
  else {
    map.addSource("result", {
      type: "raster",
      tiles: [frameUrl()],
      tileSize: 256,
      minzoom: state.event.minzoom ?? 9,
      maxzoom: state.event.maxzoom ?? 17,
      bounds: state.event.bounds,
    });
    map.addLayer(
      {
        id: "result",
        type: "raster",
        source: "result",
        paint: {
          "raster-opacity": Number($("result-opacity").value) / 100,
          "raster-fade-duration": 0,
          "raster-resampling": "nearest",
        },
      },
      "pipes",
    );
  }
  map.setLayoutProperty(
    "result",
    "visibility",
    state.tab === "events" && $("show-results").checked ? "visible" : "none",
  );
  updateLegend();
}
function playback() {
  if (!state.playing) return;
  // Hold a frame until its visible tiles finish; never outrun disk decoding.
  if (map.isSourceLoaded("result")) {
    state.frame = (state.frame + 1) % state.event.times.length;
    renderFrame();
  }
  playbackTimer = setTimeout(playback, Number($("speed").value));
}
function chooseEvent() {
  stopPlayback();
  state.event = catalog.events.find((e) => e.id === $("event").value);
  if (!state.event) return;
  const event = state.event;
  setRegion(
    event.group.endsWith("-hk")
      ? "hk"
      : event.group.includes("kowloon")
        ? "kowloon"
        : state.region,
    false,
  );
  if (
    event.level &&
    (event.system !== state.system || event.level !== state.level)
  )
    changeNetwork(event.system, event.level);
  if (map.getLayer("result")) map.removeLayer("result");
  if (map.getSource("result")) map.removeSource("result");
  state.frame = event.times.length - 1;
  $("metric").innerHTML = event.metrics
    .map(
      (m) =>
        `<option value="${m}">${catalog.metrics[m].name} · ${catalog.metrics[m].unit}</option>`,
    )
    .join("");
  state.metric = event.metrics.includes(state.metric) ? state.metric : "depth";
  $("metric").value = state.metric;
  $("time").max = event.times.length - 1;
  $("time-end").textContent = timeLabel(event.times.at(-1));
  $("event-meta").innerHTML =
    `<span>${number(event.cell_size_m, 1)} m 网格</span><span>${timeLabel(event.times.at(-1))}</span><span>${event.times.length} 帧</span>`;
  const passed = event.acceptance.passed === true;
  $("acceptance").className = `acceptance ${passed ? "passed" : ""}`;
  $("acceptance").innerHTML =
    `<span class="status-dot"></span><strong>${passed ? "数值检查通过" : "诊断结果 · 数值待核验"}</strong>`;
  const failureNames = {
    flow_routing_continuity_error_pct: "水量连续性误差",
    nonconverging_steps_pct: "水力未收敛步数",
    swmm_constituent_continuity: "管网污染物质量守恒",
  };
  $("event-provenance").innerHTML =
    `<p>${event.spill ? "含假设污染面源；非真实泄漏观测。" : "模型情景结果；非实测洪涝。"}</p><p>显示管网为当前修复版 ${h(levels[state.level])}，不等同于历史案例的逐管计算清单。</p><p>运行 ID：<code>${h(event.run_id)}</code></p><p>目录：<code>${h(event.path)}</code></p><p>验收项：${passed ? "通过" : h((event.acceptance.failed_checks || ["未提供完整验收记录"]).map((c) => failureNames[c] || c).join("、"))}</p>`;
  map.getSource("spill").setData(event.spill || empty);
  map.setLayoutProperty(
    "spill-fill",
    "visibility",
    $("show-spill").checked ? "visible" : "none",
  );
  map.setLayoutProperty(
    "spill-line",
    "visibility",
    $("show-spill").checked ? "visible" : "none",
  );
  renderFrame();
  fit(
    [
      [event.bounds[0], event.bounds[1]],
      [event.bounds[2], event.bounds[3]],
    ],
    14,
  );
}
function setTab(tab) {
  state.tab = tab;
  if (tab === "events") clearSelection();
  for (const name of ["network", "events"]) {
    $(`${name}-tab`).classList.toggle("active", tab === name);
    $(`${name}-tab`).setAttribute("aria-selected", String(tab === name));
    $(`${name}-panel`).hidden = tab !== name;
  }
  $("timeline").hidden = tab !== "events" || !catalog.events.length;
  if (tab === "events" && catalog.events.length) chooseEvent();
  else {
    stopPlayback();
    for (const id of ["result", "spill-fill", "spill-line"])
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    updateLegend();
  }
  updateHeading();
}
function bindControls() {
  document
    .querySelectorAll("[data-region]")
    .forEach((b) => (b.onclick = () => setRegion(b.dataset.region)));
  $("system")
    .querySelectorAll("button")
    .forEach(
      (b) => (b.onclick = () => changeNetwork(b.dataset.value, state.level)),
    );
  $("level").onchange = (e) => changeNetwork(state.system, e.target.value);
  $("network-tab").onclick = () => setTab("network");
  $("events-tab").onclick = () => setTab("events");
  for (const id of [
    "show-pipes",
    "show-channels",
    "show-inferred",
    "show-outfalls",
    "show-boundaries",
    "color-mode",
    "opacity",
  ])
    $(id).oninput = updateLayers;
  $("clear-selection").onclick = clearSelection;
  $("close-route").onclick = clearSelection;
  $("fit-route").onclick = () => state.trace && fit(featureBounds(state.trace), 17);
  $("route-play").onclick = () => setFlowEnabled(!$("animate-flow").checked);
  $("animate-flow").onchange = (e) => setFlowEnabled(e.target.checked);
  $("auto-trace").onchange = (e) => {
    if (e.target.checked && state.selected) trace("downstream");
  };
  $("basemap").onchange = (e) => setBasemap(e.target.value);
  $("search").disabled = false;
  $("search").oninput = () => {
    clearTimeout(searchTimer);
    searchController?.abort();
    const query = $("search").value.trim();
    if (!query) {
      $("search-results").replaceChildren();
      return;
    }
    $("search-results").textContent = "搜索中…";
    searchTimer = setTimeout(async () => {
      searchController = new AbortController();
      try {
        const results = await api(
          `${apiRoot()}/search?q=${encodeURIComponent(query)}`,
          searchController.signal,
        );
        $("search-results").innerHTML = results.length
          ? results
              .map(
                (r) =>
                  `<button data-fid="${r.fid}"><strong>${h(r.name)}</strong><span>${h(kinds[r.kind] || r.kind)}</span></button>`,
              )
              .join("")
          : "<span>未找到匹配编号</span>";
        $("search-results")
          .querySelectorAll("button")
          .forEach(
            (b) =>
              (b.onclick = () => selectFeature(Number(b.dataset.fid), true)),
          );
      } catch (error) {
        if (error.name !== "AbortError")
          $("search-results").textContent = "搜索失败，请重试";
      }
    }, 250);
  };
  $("clear-search").onclick = () => {
    $("search").value = "";
    $("search").oninput();
  };
  $("zoom-in").onclick = () => map.zoomIn();
  $("zoom-out").onclick = () => map.zoomOut();
  $("home").onclick = () => setRegion("hk");
  $("north").onclick = () => map.resetNorth();
  $("menu").onclick = () => {
    $("sidebar").classList.toggle("open");
    $("menu").setAttribute(
      "aria-expanded",
      String($("sidebar").classList.contains("open")),
    );
  };
  $("export").onclick = () => {
    if (!map.areTilesLoaded()) {
      notice("瓦片仍在加载，请稍后导出");
      return;
    }
    map.once("render", () => {
      const link = document.createElement("a");
      const image = document.createElement("canvas");
      const source = map.getCanvas();
      image.width = source.width;
      image.height = source.height + 38;
      const context = image.getContext("2d");
      context.drawImage(source, 0, 0);
      context.fillStyle = "#fff";
      context.fillRect(0, source.height, image.width, 38);
      context.fillStyle = "#344c48";
      context.font = "12px sans-serif";
      context.fillText(`CSDI / DSD / HyD · ${basemaps[state.basemap].online ? $("landsd-credit-text").textContent : "Local DEM"}`, 12, source.height + 24);
      const logo = $("landsd-credit").querySelector("img");
      if (basemaps[state.basemap].online && logo.complete && logo.naturalWidth)
        context.drawImage(logo, image.width - 34, source.height + 6, 25, 25);
      link.href = image.toDataURL("image/png");
      link.download = `hk-${state.system}.png`;
      link.click();
    });
    map.triggerRepaint();
  };
  $("event").onchange = chooseEvent;
  $("metric").onchange = (e) => {
    stopPlayback();
    state.metric = e.target.value;
    renderFrame();
  };
  $("time").oninput = (e) => {
    stopPlayback();
    state.frame = Number(e.target.value);
    renderFrame();
  };
  $("fit-event").onclick = () =>
    state.event &&
    fit(
      [
        [state.event.bounds[0], state.event.bounds[1]],
        [state.event.bounds[2], state.event.bounds[3]],
      ],
      15,
    );
  $("show-results").onchange = () => {
    stopPlayback();
    renderFrame();
  };
  $("show-spill").onchange = (e) =>
    ["spill-fill", "spill-line"].forEach((id) =>
      map.setLayoutProperty(
        id,
        "visibility",
        e.target.checked ? "visible" : "none",
      ),
    );
  $("result-opacity").oninput = (e) => {
    $("result-opacity-value").value = `${e.target.value}%`;
    if (map.getLayer("result"))
      map.setPaintProperty(
        "result",
        "raster-opacity",
        Number(e.target.value) / 100,
      );
  };
  $("play").onclick = () => {
    if (state.playing) {
      stopPlayback();
      return;
    }
    if (!$("show-results").checked) {
      $("show-results").checked = true;
      renderFrame();
    }
    state.playing = true;
    $("play").innerHTML = '<i data-lucide="pause"></i>';
    $("play").title = "暂停";
    $("play").setAttribute("aria-label", "暂停");
    redrawIcons();
    playback();
  };
}
async function init() {
  redrawIcons();
  catalog = await api("/api/catalog");
  if (staticMode) {
    document.querySelector('.local-status').innerHTML = '<span></span>公开展示版';
    const option = $("basemap").querySelector('option[value="terrain"]');
    option.textContent = 'DEM · 地形';
  }
  if (!catalog.networks.length)
    throw new Error("没有可用的修复管网 GeoPackage");
  $("event").innerHTML = catalog.events
    .map((e) => `<option value="${e.id}">${h(e.group)} / ${h(e.name)}</option>`)
    .join("");
  const defaultEvent = catalog.events.find(
    (e) => e.name === "heavy-rain-dense-network-area-spill",
  );
  if (defaultEvent) $("event").value = defaultEvent.id;
  if (!catalog.events.length) {
    $("event-meta").textContent = "没有完整且运行 ID 一致的回放结果";
    $("events-tab").disabled = true;
  }
  map = new maplibregl.Map({
    container: "map",
    center: [114.18, 22.325],
    zoom: 12.3,
    minZoom: 9,
    maxZoom: 19,
    maxBounds: [
      [113.6, 21.95],
      [114.75, 22.8],
    ],
    attributionControl: false,
    maxTileCacheSize: 128,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    style: staticMode ? staticTerrain(initialStyle(location.origin), catalog.terrain) : initialStyle(location.origin),
  });
  map.addControl(
    new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }),
    "bottom-left",
  );
  map.addControl(
    new maplibregl.AttributionControl({ compact: true }),
    "bottom-right",
  );
  map.once("style.load", () => {
    for (const id of ["trace", "trace-terminals", "selection", "spill"])
      map.addSource(id, { type: "geojson", data: empty });
    map.addLayer({
      id: "trace-glow",
      type: "line",
      source: "trace",
      filter: ["!=", ["get", "inferred"], 1],
      paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.85, "line-blur": 1 },
      layout: {"line-cap": "round", "line-join": "round"},
    });
    map.addLayer({
      id: "trace",
      type: "line",
      source: "trace",
      filter: ["!=", ["get", "inferred"], 1],
      paint: { "line-color": "#ed7158", "line-width": 5 },
      layout: {"line-cap": "round", "line-join": "round"},
    });
    map.addLayer({
      id: "trace-inferred", type: "line", source: "trace",
      filter: ["==", ["get", "inferred"], 1],
      paint: {"line-color": "#a25a79", "line-width": 5, "line-dasharray": [2, 1.5]},
    });
    map.addLayer({
      id: "trace-flow", type: "line", source: "trace",
      filter: ["!=", ["get", "inferred"], 1],
      paint: {"line-color": "#fff9e5", "line-width": 2, "line-dasharray": flowDash(0),
        "line-dasharray-transition": {duration: 0, delay: 0}},
    });
    const arrow = document.createElement("canvas");
    arrow.width = arrow.height = 32;
    const pen = arrow.getContext("2d");
    pen.strokeStyle = "#a73f30"; pen.lineWidth = 4; pen.lineCap = "round";
    pen.beginPath(); pen.moveTo(11, 9); pen.lineTo(19, 16); pen.lineTo(11, 23); pen.stroke();
    map.addImage("flow-arrow", pen.getImageData(0, 0, 32, 32), {pixelRatio: 2});
    map.addLayer({
      id: "trace-arrows", type: "symbol", source: "trace",
      filter: ["!=", ["get", "inferred"], 1],
      layout: {"symbol-placement": "line", "symbol-spacing": 85, "icon-image": "flow-arrow",
        "icon-rotation-alignment": "map", "icon-keep-upright": false, "icon-allow-overlap": true},
    });
    map.addLayer({
      id: "trace-terminals", type: "circle", source: "trace-terminals",
      paint: {"circle-radius": 9, "circle-color": ["case", ["==", ["get", "published"], true], "#198364",
        ["==", ["get", "role"], "unconfirmed"], "#cf6b49", "#b18b37"],
        "circle-stroke-width": 3, "circle-stroke-color": "#fff"},
    });
    map.addLayer({
      id: "selection",
      type: "line",
      source: "selection",
      paint: { "line-color": "#a63d43", "line-width": 6 },
    });
    map.addLayer({
      id: "spill-fill",
      type: "fill",
      source: "spill",
      paint: { "fill-color": "#bd3d76", "fill-opacity": 0.1 },
    });
    map.addLayer({
      id: "spill-line",
      type: "line",
      source: "spill",
      paint: {
        "line-color": "#bd3d76",
        "line-width": 2,
        "line-dasharray": [3, 2],
      },
    });
    flow = new FlowAnimation(map);
    changeNetwork(state.system, state.level);
    bindControls();
    setRegion("kowloon");
    for (const [name, coordinates] of [
      ["九龙", [114.184, 22.335]],
      ["香港岛", [114.198, 22.253]],
      ["荃湾", [114.112, 22.376]],
      ["沙田", [114.196, 22.402]],
      ["元朗", [114.025, 22.444]],
      ["大屿山", [113.96, 22.26]],
      ["维多利亚港", [114.177, 22.292]],
    ]) {
      const element = document.createElement("span");
      element.className = "place-label";
      element.textContent = name;
      new maplibregl.Marker({ element }).setLngLat(coordinates).addTo(map);
    }
    setBasemap("street");
  });
  map.on("click", (e) => {
    const layers = ["trace-terminals", "outfalls", "boundaries", "pipes", "inferred"].filter(
      (id) => map.getLayer(id),
    );
    const features = map.queryRenderedFeatures(
      [
        [e.point.x - 5, e.point.y - 5],
        [e.point.x + 5, e.point.y + 5],
      ],
      { layers },
    );
    const point = features.find((f) => f.source === "trace-terminals") ||
      features.find((f) => f.sourceLayer === "boundaries");
    if (point) {
      let label = roles[point.properties.role] || point.properties.role;
      if (point.source === "trace-terminals" && point.properties.role !== "upstream")
        label = point.properties.final
          ? (point.properties.published ? "最终排水口（公布点）" : label)
          : "下游连接未确认";
      new maplibregl.Popup({ closeButton: true })
        .setLngLat(e.lngLat)
        .setHTML(
          `<strong>${h(point.properties.name)}</strong><p>${h(label)}</p>`,
        )
        .addTo(map);
      return;
    }
    const feature = features.find((f) => f.sourceLayer === "pipes");
    if (feature) selectFeature(feature.id);
  });
  map.on("mousemove", (e) => {
    $("coordinates").textContent =
      `${e.lngLat.lng.toFixed(4)}° E · ${e.lngLat.lat.toFixed(4)}° N`;
    const layers = ["pipes", "inferred", "outfalls", "boundaries"].filter(
      (id) => map.getLayer(id),
    );
    map.getCanvas().style.cursor =
      layers.length && map.queryRenderedFeatures(e.point, { layers }).length
        ? "pointer"
        : "";
  });
  map.on("dataloading", () => {
    $("map-status").hidden = false;
  });
  map.on("idle", () => {
    $("map-status").hidden = true;
  });
  map.on("render", () => {
    const sources = ["network", basemaps[state.basemap].online ? "basemap-tiles" : "terrain", "basemap-labels", "result"];
    $("map-status").hidden = sources.every(id => !map.getSource(id) || map.isSourceLoaded(id));
  });
  map.on("error", (e) => {
    console.error(e.error);
    if ((e.sourceId || "").startsWith("basemap-") && state.basemap !== "terrain") {
      setBasemap("terrain");
      notice("在线底图暂不可用，已切回离线 DEM。管网数据不受影响。");
      return;
    }
    notice(staticMode ? "地图数据加载失败，请刷新重试" : "地图数据加载失败，请查看本地服务日志", true);
  });
}
init().catch((error) => {
  $("map-status").hidden = true;
  notice(`启动失败：${error.message}`, true);
  console.error(error);
});
