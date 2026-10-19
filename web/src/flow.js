// A moving dash in geometry order; phase is illustrative, never a flow velocity.
export function flowDash(phase, length = 2, period = 16) {
  const p = ((phase % period) + period) % period;
  return p <= period - length
    ? [0, p, length, period - p - length]
    : [p + length - period, period - length, period - p, 0];
}

// MapLibre caches each distinct dash in an atlas. Reuse a bounded set forever.
const dashFrames = Array.from({length: 32}, (_, index) => flowDash(index / 2));

export class FlowAnimation {
  constructor(map) {
    this.map = map;
    this.active = false;
    this.enabled = true;
    this.frame = 0;
    this.last = 0;
    this.phase = 0;
    this.motion = matchMedia("(prefers-reduced-motion: reduce)");
    this.sync = this.sync.bind(this);
    this.tick = this.tick.bind(this);
    document.addEventListener("visibilitychange", this.sync);
    this.motion.addEventListener("change", this.sync);
    map.once("remove", () => this.destroy());
  }
  setActive(value) { this.active = value; this.sync(); }
  setEnabled(value) { this.enabled = value; this.sync(); }
  sync() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.last = 0;
    if (this.active && this.enabled && !document.hidden && !this.motion.matches)
      this.frame = requestAnimationFrame(this.tick);
  }
  tick(now) {
    if (now - this.last >= 50) {
      this.phase = (this.phase + (this.last ? Math.min(now - this.last, 100) : 0) * 0.012) % 16;
      this.map.setPaintProperty("trace-flow", "line-dasharray", dashFrames[Math.floor(this.phase * 2)]);
      this.last = now;
    }
    this.frame = requestAnimationFrame(this.tick);
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    document.removeEventListener("visibilitychange", this.sync);
    this.motion.removeEventListener("change", this.sync);
  }
}
