const base = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz";
const attribution = 'Map from <a href="https://www.landsd.gov.hk/" target="_blank" rel="noopener">Lands Department</a>';

export const basemaps = {
  terrain: { name: "DEM · 离线", online: false },
  street: { name: "香港街道", online: true, type: "basemap", paint: {
    "raster-saturation": -0.9, "raster-contrast": -0.1, "raster-brightness-min": 0.34,
  } },
  dark: { name: "深色街道", online: true, type: "basemap", dark: true, paint: {
    "raster-saturation": -1, "raster-brightness-min": 0.32, "raster-brightness-max": 0.035,
  } },
  imagery: { name: "航拍影像", online: true, type: "imagery", dark: true, paint: {
    "raster-saturation": -0.3, "raster-brightness-max": 0.7,
  } },
};

export function basemapSource(key) {
  const spec = basemaps[key];
  if (!spec?.online) return null;
  return {
    type: "raster", tileSize: 256, minzoom: spec.type === "basemap" ? 10 : 9, maxzoom: 19,
    bounds: [113.8, 22.1, 114.5, 22.6],
    tiles: [`${base}/${spec.type}/WGS84/{z}/{x}/{y}.png`],
    attribution: spec.type === "imagery" ? `${attribution}; Aerial Photograph from Lands Department` : attribution,
  };
}

export const labelSource = {
  type: "raster", tileSize: 256, minzoom: 10, maxzoom: 19,
  bounds: [113.8, 22.1, 114.5, 22.6],
  tiles: [`${base}/label/hk/sc/WGS84/{z}/{x}/{y}.png`], attribution,
};

export function initialStyle(origin) {
  return {
    version: 8,
    sources: { terrain: {
      type: "raster", tiles: [`${origin}/api/terrain/{z}/{x}/{y}.png`], tileSize: 256,
      minzoom: 9, maxzoom: 16, bounds: [113.8, 22.1, 114.5, 22.6],
      attribution: "CSDI · DSD / HyD · Local DEM",
    } },
    layers: [
      {id: "background", type: "background", paint: {"background-color": "#e8eff0"}},
      {id: "terrain", type: "raster", source: "terrain", layout: {visibility: "none"},
        paint: {"raster-fade-duration": 0}},
    ],
  };
}
