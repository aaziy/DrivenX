"use client";

import { useRef } from "react";

import { BODY_PANELS, panelAt, type DamageSeverity, type VehiclePanel } from "@drivenx/core";

/**
 * The car, seen from above, drawn from the region table in `@drivenx/core` (P2-02).
 *
 * The screen and the printed report both draw this one table, so a mark placed at the
 * counter and the same mark on the A4 report six months later sit on the same panel. The
 * table is also what reads a click back, which is why nothing here knows the names of any
 * panels: adding one is a change to the table alone.
 *
 * Positions are fractions, so the picture scales to a phone at the kerbside and to a page
 * without a second set of coordinates.
 */

const WIDTH = 1000;
const HEIGHT = 1600;

export interface DiagramMark {
  id: string;
  panel: VehiclePanel;
  positionX: number | null;
  positionY: number | null;
  severity: DamageSeverity;
}

/**
 * Presentation only: the glass reads differently from the metal, which is most of what
 * makes a plan of rectangles read as a car. The panels themselves are the domain's.
 */
const GLASS: ReadonlySet<VehiclePanel> = new Set(["WINDSCREEN", "REAR_SCREEN"]);

const SEVERITY_FILL: Record<DamageSeverity, string> = {
  MINOR: "var(--warning)",
  MODERATE: "#d97706",
  SEVERE: "var(--danger)",
};

export function VehicleDiagram({
  marks,
  onPlace,
  onSelect,
  selectedId,
  label,
}: {
  marks: DiagramMark[];
  /** Given a point on the car. Omitted for a read-only picture. */
  onPlace?: (position: { x: number; y: number; panel: VehiclePanel }) => void;
  onSelect?: (markId: string) => void;
  selectedId?: string | null;
  label: string;
}) {
  const svg = useRef<SVGSVGElement>(null);

  // Marks are numbered in the order they were made, and the list beside the picture uses
  // the same numbers — a mark on a bumper is hard to talk about without one.
  const numbered = marks.map((mark, index) => ({ ...mark, number: index + 1 }));

  function place(event: React.MouseEvent<SVGSVGElement>) {
    if (!onPlace || !svg.current) return;
    const box = svg.current.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    const panel = panelAt(x, y);
    // A click off the car is a miss, not damage to the nearest panel.
    if (panel) onPlace({ x, y, panel });
  }

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
      onClick={onPlace ? place : undefined}
      style={{
        width: "100%",
        maxWidth: 260,
        height: "auto",
        cursor: onPlace ? "crosshair" : "default",
        // The picture is a picture in both languages: mirroring it would move the
        // damage to the other side of the car.
        direction: "ltr",
      }}
    >
      {/* The silhouette first, so the panels read as divisions of one car rather than as
          a stack of separate boxes. */}
      <rect
        x={0.17 * WIDTH}
        y={0.02 * HEIGHT}
        width={0.66 * WIDTH}
        height={0.96 * HEIGHT}
        rx={90}
        fill="var(--surface-2)"
        stroke="var(--border-strong)"
        strokeWidth={5}
      />
      {BODY_PANELS.map((region) => (
        <rect
          key={region.panel}
          x={region.x * WIDTH}
          y={region.y * HEIGHT}
          width={region.width * WIDTH}
          height={region.height * HEIGHT}
          rx={region.rounded ? 28 : 8}
          fill={GLASS.has(region.panel) ? "var(--brand-soft)" : "none"}
          stroke="var(--border-strong)"
          strokeWidth={2}
        />
      ))}

      {numbered
        .filter((mark) => mark.positionX !== null && mark.positionY !== null)
        .map((mark) => (
          <g
            key={mark.id}
            onClick={
              onSelect
                ? (event) => {
                    event.stopPropagation();
                    onSelect(mark.id);
                  }
                : undefined
            }
            style={{ cursor: onSelect ? "pointer" : "inherit" }}
          >
            <circle
              cx={(mark.positionX as number) * WIDTH}
              cy={(mark.positionY as number) * HEIGHT}
              r={34}
              fill={SEVERITY_FILL[mark.severity]}
              stroke={mark.id === selectedId ? "var(--text)" : "var(--surface)"}
              strokeWidth={mark.id === selectedId ? 8 : 4}
            />
            <text
              x={(mark.positionX as number) * WIDTH}
              y={(mark.positionY as number) * HEIGHT + 15}
              textAnchor="middle"
              fontSize={42}
              fontWeight={600}
              fill="#ffffff"
            >
              {mark.number}
            </text>
          </g>
        ))}
    </svg>
  );
}
