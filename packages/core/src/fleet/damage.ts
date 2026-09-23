/**
 * Where the damage is (P2-02, SOW §12).
 *
 * A handover form is worth nothing in an argument six months later unless it says
 * exactly which panel was marked. Free text does not survive that argument — "scratch on
 * the side" is a scratch on one of eight panels — so a mark is a point on a diagram, and
 * the panel it falls in is derived from the point rather than typed.
 *
 * The regions below are the single source of that diagram: the screen draws the car from
 * this table and reads a click back through `panelAt`, and the PDF draws the same table
 * again. They cannot drift apart, because there is only one of them.
 *
 * Coordinates are fractions of the diagram box, nose at the top, so they survive being
 * drawn at any size — a 320px form, an A4 page — without being rescaled anywhere.
 * Left and right are the driver's, which in a view from above with the nose pointing up
 * are also the viewer's.
 */

export type VehiclePanel =
  | "FRONT_BUMPER"
  | "BONNET"
  | "WINDSCREEN"
  | "ROOF"
  | "REAR_SCREEN"
  | "BOOT"
  | "REAR_BUMPER"
  | "FRONT_LEFT_WING"
  | "FRONT_LEFT_DOOR"
  | "REAR_LEFT_DOOR"
  | "REAR_LEFT_WING"
  | "FRONT_RIGHT_WING"
  | "FRONT_RIGHT_DOOR"
  | "REAR_RIGHT_DOOR"
  | "REAR_RIGHT_WING"
  | "WHEELS"
  | "INTERIOR"
  | "MECHANICAL"
  | "OTHER";

export interface PanelRegion {
  panel: VehiclePanel;
  /** Left edge, as a fraction of the diagram's width. */
  x: number;
  /** Top edge, as a fraction of the diagram's height. */
  y: number;
  width: number;
  height: number;
  /** Drawn with rounded ends, as bumpers are. */
  rounded?: boolean;
}

const LEFT = 0.18;
const RIGHT = 0.7;
const STRIP = 0.12;
const MIDDLE = 0.3;
const MIDDLE_WIDTH = 0.4;
const FULL_WIDTH = 0.64;

/**
 * The body, tiled without gaps so every point inside the outline belongs to exactly one
 * panel. Ordered front to back, which is also the order they are listed to staff.
 */
export const BODY_PANELS: readonly PanelRegion[] = [
  { panel: "FRONT_BUMPER", x: LEFT, y: 0.03, width: FULL_WIDTH, height: 0.09, rounded: true },

  { panel: "FRONT_LEFT_WING", x: LEFT, y: 0.12, width: STRIP, height: 0.18 },
  { panel: "BONNET", x: MIDDLE, y: 0.12, width: MIDDLE_WIDTH, height: 0.16 },
  { panel: "FRONT_RIGHT_WING", x: RIGHT, y: 0.12, width: STRIP, height: 0.18 },

  { panel: "WINDSCREEN", x: MIDDLE, y: 0.28, width: MIDDLE_WIDTH, height: 0.1 },

  { panel: "FRONT_LEFT_DOOR", x: LEFT, y: 0.3, width: STRIP, height: 0.2 },
  { panel: "ROOF", x: MIDDLE, y: 0.38, width: MIDDLE_WIDTH, height: 0.22 },
  { panel: "FRONT_RIGHT_DOOR", x: RIGHT, y: 0.3, width: STRIP, height: 0.2 },

  { panel: "REAR_LEFT_DOOR", x: LEFT, y: 0.5, width: STRIP, height: 0.18 },
  { panel: "REAR_SCREEN", x: MIDDLE, y: 0.6, width: MIDDLE_WIDTH, height: 0.1 },
  { panel: "REAR_RIGHT_DOOR", x: RIGHT, y: 0.5, width: STRIP, height: 0.18 },

  { panel: "REAR_LEFT_WING", x: LEFT, y: 0.68, width: STRIP, height: 0.2 },
  { panel: "BOOT", x: MIDDLE, y: 0.7, width: MIDDLE_WIDTH, height: 0.18 },
  { panel: "REAR_RIGHT_WING", x: RIGHT, y: 0.68, width: STRIP, height: 0.2 },

  { panel: "REAR_BUMPER", x: LEFT, y: 0.88, width: FULL_WIDTH, height: 0.09, rounded: true },
] as const;

/**
 * Damage that a view from above cannot show. A cigarette burn in a seat is real and
 * chargeable, and pretending it sits on the roof would make the diagram lie, so these are
 * chosen from a list instead and carry no position.
 */
export const OFF_DIAGRAM_PANELS: readonly VehiclePanel[] = [
  "WHEELS",
  "INTERIOR",
  "MECHANICAL",
  "OTHER",
] as const;

export function isBodyPanel(panel: VehiclePanel): boolean {
  return BODY_PANELS.some((region) => region.panel === panel);
}

/**
 * The panel a mark falls in, or null when the mark is off the car.
 *
 * A click outside the outline is a miss, not damage to the nearest panel: silently
 * snapping it somewhere would put a mark on a panel nobody chose.
 */
export function panelAt(x: number, y: number): VehiclePanel | null {
  for (const region of BODY_PANELS) {
    if (
      x >= region.x &&
      x < region.x + region.width &&
      y >= region.y &&
      y < region.y + region.height
    ) {
      return region.panel;
    }
  }
  return null;
}

export type DamageSeverity = "MINOR" | "MODERATE" | "SEVERE";

/** Worst first, which is the order a return report should read in. */
export function severityRank(severity: DamageSeverity): number {
  return severity === "SEVERE" ? 0 : severity === "MODERATE" ? 1 : 2;
}
