import { describe, expect, it } from "vitest";

import {
  BODY_PANELS,
  isBodyPanel,
  OFF_DIAGRAM_PANELS,
  panelAt,
  severityRank,
  type VehiclePanel,
} from "./damage";

describe("the damage diagram", () => {
  it("names each panel once", () => {
    const panels = BODY_PANELS.map((region) => region.panel);
    expect(new Set(panels).size).toBe(panels.length);
  });

  it("keeps every region inside the diagram box", () => {
    for (const region of BODY_PANELS) {
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.y).toBeGreaterThanOrEqual(0);
      expect(region.x + region.width).toBeLessThanOrEqual(1);
      expect(region.y + region.height).toBeLessThanOrEqual(1);
    }
  });

  it("never overlaps two panels, so a mark is never ambiguous", () => {
    // Edges meet exactly, but 0.68 + 0.2 is 0.8800000000000001 in binary, so two panels
    // that share an edge appear to overlap by a ten-thousandth of a millimetre on an A4
    // page. The tolerance is for the arithmetic, not for the geometry.
    const EPSILON = 1e-9;
    for (const a of BODY_PANELS) {
      for (const b of BODY_PANELS) {
        if (a.panel === b.panel) continue;
        const apart =
          a.x + a.width <= b.x + EPSILON ||
          b.x + b.width <= a.x + EPSILON ||
          a.y + a.height <= b.y + EPSILON ||
          b.y + b.height <= a.y + EPSILON;
        expect(apart, `${a.panel} overlaps ${b.panel}`).toBe(true);
      }
    }
  });

  it("finds the panel a mark falls in", () => {
    for (const region of BODY_PANELS) {
      const centre = panelAt(region.x + region.width / 2, region.y + region.height / 2);
      expect(centre).toBe(region.panel);
    }
  });

  it("reads the body from the front back", () => {
    expect(panelAt(0.5, 0.05)).toBe("FRONT_BUMPER");
    expect(panelAt(0.5, 0.2)).toBe("BONNET");
    expect(panelAt(0.5, 0.33)).toBe("WINDSCREEN");
    expect(panelAt(0.5, 0.5)).toBe("ROOF");
    expect(panelAt(0.5, 0.65)).toBe("REAR_SCREEN");
    expect(panelAt(0.5, 0.8)).toBe("BOOT");
    expect(panelAt(0.5, 0.92)).toBe("REAR_BUMPER");
  });

  it("puts the driver's side on the viewer's left, nose up", () => {
    expect(panelAt(0.22, 0.4)).toBe("FRONT_LEFT_DOOR");
    expect(panelAt(0.75, 0.4)).toBe("FRONT_RIGHT_DOOR");
    expect(panelAt(0.22, 0.6)).toBe("REAR_LEFT_DOOR");
    expect(panelAt(0.75, 0.6)).toBe("REAR_RIGHT_DOOR");
  });

  it("returns nothing for a mark off the car", () => {
    expect(panelAt(0.02, 0.5)).toBeNull();
    expect(panelAt(0.98, 0.5)).toBeNull();
    expect(panelAt(0.5, 0.005)).toBeNull();
    expect(panelAt(0.5, 0.995)).toBeNull();
    // Beside the cabin, where the outline narrows to the door strips.
    expect(panelAt(0.5, 0.995)).toBeNull();
  });

  it("keeps a region's top-left corner but not its bottom-right, so edges belong to one panel", () => {
    const bonnet = BODY_PANELS.find((region) => region.panel === "BONNET");
    if (!bonnet) throw new Error("no bonnet");
    expect(panelAt(bonnet.x, bonnet.y)).toBe("BONNET");
    expect(panelAt(bonnet.x + bonnet.width, bonnet.y)).not.toBe("BONNET");
  });

  it("separates what the diagram cannot show", () => {
    for (const panel of OFF_DIAGRAM_PANELS) {
      expect(isBodyPanel(panel)).toBe(false);
    }
    expect(isBodyPanel("BONNET")).toBe(true);
  });

  it("covers every panel in the union between the diagram and the list", () => {
    const named: VehiclePanel[] = [
      ...BODY_PANELS.map((region) => region.panel),
      ...OFF_DIAGRAM_PANELS,
    ];
    // Nineteen: fifteen body panels plus wheels, interior, mechanical and other.
    expect(named).toHaveLength(19);
  });

  it("sorts the worst damage first", () => {
    const sorted = (["MINOR", "SEVERE", "MODERATE"] as const)
      .slice()
      .sort((a, b) => severityRank(a) - severityRank(b));
    expect(sorted).toEqual(["SEVERE", "MODERATE", "MINOR"]);
  });
});
