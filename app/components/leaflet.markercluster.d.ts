/**
 * What `import ... from "leaflet.markercluster"` actually hands back.
 *
 * `@types/leaflet.markercluster` describes the plugin thoroughly but only as an
 * augmentation of the `leaflet` module: it declares `L.MarkerClusterGroup` and
 * `L.markerClusterGroup` and says nothing at all about the plugin's own module.
 * That is a fair description of how the plugin behaves when it is loaded from a
 * script tag, and a misleading one when it is bundled — see the long comment in
 * ./project-map-cluster.ts for why the augmented names are `undefined` at
 * runtime and the named exports below are not.
 *
 * So this declares the two exports the plugin really has, with the shapes
 * @types/leaflet.markercluster has already worked out. It is a stopgap for a
 * gap in that package, not a place to describe the plugin.
 */
declare module "leaflet.markercluster" {
  export { MarkerCluster, MarkerClusterGroup } from "leaflet";
}
