# ILSMS Map

Public, static visualization of Hong Kong drainage networks and selected model scenarios.

Website: https://jlonghku.github.io/ilsms-map/

## Contents

- Stormwater/combined and sewage networks: Full, Engineering and Screening.
- Pipe search, attributes, upstream/downstream tracing and recorded-direction animation.
- Published final outfalls are distinguished from inferred connections and unconfirmed boundaries.
- A selected Kowloon heavy-rain / hypothetical area-spill scenario: depth, TSS and ammonium playback.
- Lands Department street/imagery basemaps and a pre-rendered DEM background.

This is a visualization snapshot, not an online SWMM or flood solver. It is not an operational warning service.
Inferred connectivity is not a verified hydraulic connection. Animated directions represent recorded topology,
not instantaneous simulated flow. Model scenarios are not observations; numerical acceptance status is retained.

## Deployment

GitHub Actions builds the frontend, tests it, and publishes `site/` to GitHub Pages on pushes to `main`.
Only derived display files and frontend source are stored here. No raw GeoPackages, DEM rasters, INP models,
NPZ results, credentials, or server-side Python environment are included.

```sh
npm --prefix web ci
VITE_STATIC=1 npm --prefix web run build -- --base=/ilsms-map/
npm --prefix web test
```

The `site/data/` snapshot is generated locally in the ILSMS modelling workspace with
`python -m drainage_workflow.web_static --output <publication-directory>/site --event <selected-event-id>`.
The exporter applies an attribute allowlist, checks source signatures and preserves stable feature IDs.
Do not enable `--emptyOutDir` against the data-bearing `site/` directory.

## Data and Attribution

Drainage source: Hong Kong CSDI, Drainage Services Department and Highways Department.
Terrain source: the project's CEDD terrain dataset, rendered as display tiles only.
Model modifications and illustrative results: ILSMS project; not official government predictions.
Online basemaps / aerial photography: Hong Kong Lands Department. Their logo and attribution remain visible.
Third-party data remain subject to their source terms; inclusion here does not grant additional rights.

- https://portal.csdi.gov.hk/
- https://www.dsd.gov.hk/
- https://www.hyd.gov.hk/
- https://www.cedd.gov.hk/
- https://www.landsd.gov.hk/

Display data in this public repository and website can be downloaded. No analytics, accounts, or user-input
collection are implemented. GitHub and online basemap providers receive normal web requests from visitors.
