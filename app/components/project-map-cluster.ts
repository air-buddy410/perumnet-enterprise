/**
 * Marker clustering for the project map, kept behind its own module for two
 * reasons that are both about load order.
 *
 * 1. `leaflet.markercluster` is not a module in the modern sense. Its UMD
 *    bundle takes no dependency injection and reaches for a bare global `L`
 *    the moment it is evaluated, hanging `MarkerClusterGroup` off it. Leaflet's
 *    own bundle assigns `window.L` on evaluation ("Always export us to window
 *    global", leaflet#2364), so the plugin works — as long as Leaflet has
 *    already run. The static import below is what guarantees that: ES modules
 *    evaluate in import order, so `leaflet` is finished before the plugin
 *    starts. Reversing these two lines is a `ReferenceError: L is not defined`.
 *
 * 2. Every example on the internet then writes `L.markerClusterGroup(...)`,
 *    which does not work here and fails in a way that looks like the plugin
 *    never loaded. The plugin adds its classes to Leaflet's exports *after*
 *    Leaflet has finished evaluating, and a bundler's namespace object fixes
 *    its keys when it is built — so `Leaflet.markerClusterGroup` is `undefined`
 *    however late it is read. Measured under Turbopack: the named export below
 *    is a function, `Leaflet.markerClusterGroup` is not. The plugin does export
 *    its classes properly (`exports.MarkerClusterGroup`, `__esModule: true`),
 *    so the named import is both the binding that exists at runtime and the
 *    one that does not depend on a global. `app/components/leaflet.markercluster.d.ts`
 *    is what tells TypeScript it is there, because `@types/leaflet.markercluster`
 *    only describes the augmented `leaflet` module and not this one.
 *
 * The factory is exported rather than the module simply being imported for its
 * side effect so that both of those decisions live in one place, with this
 * comment, instead of being re-derived at the call site.
 *
 * The stylesheet rides along in the same chunk. It is the plugin's animation
 * rules only (~0.9 kB raw): the transitions that make markers slide in and out
 * of a cluster, and the spiderfy legs. `MarkerCluster.Default.css` — the green,
 * yellow and orange badges the plugin ships with — is deliberately NOT imported.
 * Those colours would read as state on a map whose entire language is that a
 * colour means a state, and the badge is styled from `app/globals.css` instead.
 *
 * Nothing here is reachable except through the dynamic `import()` in
 * project-map.tsx, so the plugin stays out of the initial JavaScript exactly
 * like Leaflet itself.
 */

import * as Leaflet from "leaflet";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { MarkerClusterGroup } from "leaflet.markercluster";

export function createClusterGroup(
  options: Leaflet.MarkerClusterGroupOptions,
): Leaflet.MarkerClusterGroup {
  return new MarkerClusterGroup(options);
}
