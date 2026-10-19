export const levels = {
  full: "完整模型",
  engineering: "工程模型",
  screening: "筛查模型",
};
export const kinds = {
  pipe: "管道",
  combined_pipe: "合流管",
  multiple_pipe: "并联管",
  culvert: "箱涵 / 隧道",
  channel: "水渠",
  engineered_channel: "工程渠",
  synthetic_connector: "推测连接",
};
export const roles = {
  outfall: "公布出水口",
  published_outlet: "公布出口，受纳端未确认",
  river: "已确认河道受纳端",
  sea: "已确认海洋受纳端",
  conveyance_transfer: "输送转移边界",
  pump_transfer: "泵送转移边界",
  transfer_boundary: "模型转移边界",
  evidence_transfer: "设施转移边界",
  unconfirmed: "去向未确认",
  upstream: "上游起点",
};

export function traceStatus(result, direction) {
  if (direction === "downstream" && result.terminals.some(t => !Object.hasOwn(t, "receiver")))
    return {title: "追踪服务版本未更新", tone: "warning", outdated: true,
      detail: "旧版接口缺少受纳端判定，暂不能判断是否到达出口。请重启本地地图服务。"};
  const closed = result.unterminated_count || 0;
  const unmapped = result.unmapped_source_count || 0;
  const scope = result.trace_scope === "full_assets" ? "完整资产追踪网"
    : result.trace_scope === "calculation_network" ? "当前计算网，未使用完整资产追踪" : "";
  const mapping = unmapped ? `${unmapped} 条源构件未映射，路径可能不完整` : "";
  const incomplete = result.truncated ? "路径未完整返回" : "";
  const cycles = closed ? `${closed} 条构件无终端路径（闭环）` : "";
  if (direction === "upstream")
    return { title: "上游汇入路径", tone: result.truncated || closed ? "warning" : "neutral",
      detail: [scope, mapping, `${result.terminals.length} 个上游起点`, cycles, incomplete].filter(Boolean).join(" · ") };
  const receivers = result.terminals.filter((t) => ["outfall", "river", "sea"].includes(t.receiver));
  const published = receivers.filter(t => t.receiver === "outfall").length;
  const waters = receivers.length - published;
  const missing = result.terminals.length - receivers.length;
  const inferred = result.inferred_count || 0;
  const partial = missing || closed || result.truncated || unmapped;
  return {
    title: !receivers.length ? "未到达公布出水口或受纳水体" : partial ? "部分路径尚未到达受纳端"
      : waters ? `到达 ${receivers.length} 个已确认受纳端`
      : `到达 ${published} 个公布出水口${inferred ? "（含推测接续）" : ""}`,
    tone: partial || inferred || !receivers.length ? "warning" : "connected",
    detail: [scope, mapping, published ? `${published} 个公布出水口` : "", waters ? `${waters} 个已确认河道或海洋受纳端` : "",
      missing ? `${missing} 处下游连接未确认，未视为出口` : "",
      inferred ? `${inferred} 处推测连接，非已核实排水路径` : "",
      !result.terminals.length ? "未发现终端，可能含闭环" : "",
      cycles, incomplete].filter(Boolean).join(" · "),
  };
}
export const number = (value, digits = 0) =>
  value == null || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
export function timeLabel(seconds) {
  const n = Math.max(0, Math.round(seconds));
  return [Math.floor(n / 3600), Math.floor((n % 3600) / 60), n % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function networkFilter(visible) {
  const category = [
    "match",
    ["get", "kind"],
    ["channel", "culvert", "engineered_channel"],
    "channels",
    "pipes",
  ];
  return [
    "case",
    ["==", ["get", "inferred"], 1],
    visible.inferred,
    ["match", category, "channels", visible.channels, visible.pipes],
  ];
}
export function featureBounds(feature) {
  const coordinates = [];
  function visit(v) {
    if (typeof v[0] === "number") coordinates.push(v);
    else v.forEach(visit);
  }
  if (feature.type === "FeatureCollection")
    feature.features.forEach((f) => visit(f.geometry.coordinates));
  else visit(feature.geometry.coordinates);
  if (!coordinates.length) return null;
  const bounds = [
    [Infinity, Infinity],
    [-Infinity, -Infinity],
  ];
  for (const p of coordinates)
    for (let axis = 0; axis < 2; axis++) {
      bounds[0][axis] = Math.min(bounds[0][axis], p[axis]);
      bounds[1][axis] = Math.max(bounds[1][axis], p[axis]);
    }
  return bounds;
}
