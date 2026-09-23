"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A place to sign with a finger or a mouse (P2-03).
 *
 * The drawing is submitted as a PNG data URL in a hidden field, and the server treats it
 * like any other upload — sniffed, size-checked and put in object storage — rather than
 * trusting what the browser says it is.
 *
 * The canvas is sized from its own box rather than given fixed pixels, because it is
 * signed on a phone at the kerbside as often as on a desk, and a canvas whose backing
 * store does not match its display size draws the stroke away from the fingertip.
 */
export function SignaturePad({
  name,
  label,
  clearLabel,
  required,
}: {
  name: string;
  label: string;
  clearLabel: string;
  required?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [value, setValue] = useState("");

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    const box = element.getBoundingClientRect();
    element.width = box.width * ratio;
    element.height = box.height * ratio;
    const context = element.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    // Ink is drawn in a fixed colour: the signature is printed on a white page whatever
    // theme the person taking it happens to be using.
    context.strokeStyle = "#16202e";
  }, []);

  function pointIn(event: React.PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const point = pointIn(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const point = pointIn(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    setValue(canvas.current?.toDataURL("image/png") ?? "");
  }

  function clear() {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    context.clearRect(0, 0, element.width, element.height);
    setValue("");
  }

  // A canvas is not a labelable element, so the visible label cannot be tied to it with
  // `for`. It is pointed at instead, which gives the drawing surface a name in a screen
  // reader rather than announcing it as an unlabelled graphic.
  const labelId = `${name}-label`;

  return (
    <div className="field">
      <label id={labelId}>{label}</label>
      <canvas
        ref={canvas}
        aria-labelledby={labelId}
        role="img"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{
          width: "100%",
          height: 120,
          background: "#ffffff",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sm)",
          touchAction: "none",
        }}
      />
      <input type="hidden" name={name} value={value} required={required} />
      <button type="button" className="btn-secondary" onClick={clear} style={{ marginTop: 6 }}>
        {clearLabel}
      </button>
    </div>
  );
}
