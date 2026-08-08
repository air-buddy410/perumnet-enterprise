/**
 * When the project map is allowed to move itself.
 *
 * The map sits above the dashboard and is handed whatever the workspace picker
 * has narrowed the project list down to. Picking one project should frame that
 * project; going back to all projects should frame all of them. That much is
 * obvious. The part that is easy to get wrong is everything *else* that makes
 * the component re-render — a language toggle, a pin being placed, a project
 * being created, the list being refetched. Each of those produces a fresh
 * `projects` array, and a map that re-fits on every fresh array will throw away
 * a pan or a zoom the operator performed on purpose, over and over, for reasons
 * they cannot see. That is the behaviour this module exists to prevent.
 *
 * So the decision is made against a *frame key* rather than against React's
 * array identity: the set of pins the map is being asked to show. If the key is
 * the same as the one the view was last pointed at, the map does not move,
 * however many times it re-renders. If the key changed, the selection (or the
 * pins themselves) genuinely changed, and moving is the right answer.
 *
 * Nothing here touches Leaflet, the DOM or React. It is two small functions so
 * that the rule can be held against examples in a test rather than only against
 * a running browser.
 */

/** A project that has somewhere to be drawn. */
export interface MapPin {
  id: string;
  latitude: number;
  longitude: number;
}

/**
 * The identity of the frame a set of pins asks for.
 *
 * Order-independent, because the project list arrives in whatever order the
 * server sorted it and a re-sort is not a reason to move the map. Coordinates
 * are part of the key, not just ids: a pin that has been dragged to a new place
 * is a new frame even though the same project is selected. Five decimals is
 * about a metre, which is finer than anything the geocoder or a click on a
 * 340px-tall map can express, so this never differs for two values that mean
 * the same place.
 */
export function frameKey(pins: MapPin[]): string {
  return pins
    .map((pin) => `${pin.id}:${pin.latitude.toFixed(5)}:${pin.longitude.toFixed(5)}`)
    .sort()
    .join("|");
}

export type FrameDecision =
  /** Point the view at the pins. */
  | "fit"
  /** Nothing has ever been framed and there is nothing to frame: show Bali. */
  | "reset"
  /** There is nothing to frame, but something was framed before: stay put. */
  | "hold"
  /** The view is already pointed at exactly this: do not touch it. */
  | "skip";

/**
 * @param key         the frame the pins currently ask for, from `frameKey`
 * @param appliedKey  the frame the view was last pointed at, or null if the map
 *                    has not been pointed at anything yet
 */
export function decideFrame(key: string, appliedKey: string | null): FrameDecision {
  // The single most important line in the file: same pins, same frame, no move.
  // This is what stops a language toggle or a refetch from yanking the view
  // back, and what makes selecting the already-selected project a no-op.
  if (key === appliedKey) return "skip";
  if (key !== "") return "fit";
  // No pins. On a map that has never shown anything there is nothing to
  // preserve, so it opens on Bali. Once something *has* been shown — the
  // operator selects a project whose location was never recognised — flying off
  // to the whole island would be movement in response to there being nothing to
  // look at, underneath an overlay that already explains the situation in
  // words. The last useful view is the more useful thing to leave on screen.
  if (appliedKey === null) return "reset";
  return "hold";
}
