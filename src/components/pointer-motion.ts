"use client";

import { useEffect, useRef, useState, type MouseEventHandler, type RefObject } from "react";
import { useMotionValue, useReducedMotion, useSpring, type MotionValue } from "framer-motion";

/**
 * Pointer-driven motion helpers (magnetic buttons, 3D card tilt). All of
 * it is transform-only and guarded twice: the device must have a fine
 * pointer with hover (no touch), and the user must not prefer reduced
 * motion. Motion values start at 0, so the resting render is identical
 * with or without these effects, and nothing here touches opacity or
 * visibility.
 */

/** True once mounted on a device with a hover-capable fine pointer. */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setFine(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return fine;
}

/** Pointer effects run only with a fine pointer and no reduced-motion preference. */
export function usePointerMotionEnabled(): boolean {
  const reduceMotion = useReducedMotion();
  const fine = useFinePointer();
  return fine && !reduceMotion;
}

/**
 * Magnetic pull: the element translates a fraction of the cursor's offset
 * from its centre (capped), springing back on leave. Attach `style` and
 * `ref` to the motion element; attach the handlers to that element or to
 * an ancestor that receives mouse events (SearchForm attaches them to the
 * search row, because a disabled button fires no mouse events in Chrome
 * and the handlers would never run). The offset is always measured
 * against the ref'd element's own rect, and a proximity gate keeps the
 * element at rest while the cursor is far from it, so hovering distant
 * parts of an ancestor leaves it unmoved. The transform lives on the
 * button itself, so it composes with the roll-label (which animates the
 * inner label) without conflict. When disabled, the springs sit at 0.
 */
export function useMagnetic(): {
  ref: RefObject<HTMLButtonElement | null>;
  style: { x: MotionValue<number>; y: MotionValue<number> };
  onMouseMove: MouseEventHandler<HTMLElement>;
  onMouseLeave: () => void;
} {
  const enabled = usePointerMotionEnabled();
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 180, damping: 18, mass: 0.35 });
  const sy = useSpring(y, { stiffness: 180, damping: 18, mass: 0.35 });

  const onMouseMove: MouseEventHandler<HTMLElement> = (e) => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Proximity gate: when the handlers live on an ancestor, the cursor
    // can be far from the element (e.g. over the text input next to the
    // button). Only pull while the cursor is at or near the element
    // itself; otherwise spring back to rest instead of pinning to the cap.
    const margin = 48;
    if (
      e.clientX < r.left - margin ||
      e.clientX > r.right + margin ||
      e.clientY < r.top - margin ||
      e.clientY > r.bottom + margin
    ) {
      x.set(0);
      y.set(0);
      return;
    }
    const cap = 8;
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    x.set(Math.max(-cap, Math.min(cap, dx * 0.25)));
    y.set(Math.max(-cap, Math.min(cap, dy * 0.25)));
  };

  const onMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return { ref, style: { x: sx, y: sy }, onMouseMove, onMouseLeave };
}

/**
 * 3D tilt: rotateX/rotateY follow the cursor, capped at `maxDeg` at the
 * edges, spring-smoothed, resetting on leave. The consumer passes the
 * returned motion values in the element's `style` alongside
 * `transformPerspective`, so tilt composes with the same element's
 * framer-managed transforms (entrance variants, whileHover lift) in the
 * single transform pipeline — no second transform writer. When disabled,
 * the springs sit at 0.
 */
export function useTilt(maxDeg: number = 4): {
  rotateX: MotionValue<number>;
  rotateY: MotionValue<number>;
  onMouseMove: MouseEventHandler<HTMLElement>;
  onMouseLeave: () => void;
} {
  const enabled = usePointerMotionEnabled();
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rotateX = useSpring(rx, { stiffness: 160, damping: 20 });
  const rotateY = useSpring(ry, { stiffness: 160, damping: 20 });

  const onMouseMove: MouseEventHandler<HTMLElement> = (e) => {
    if (!enabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry.set(px * 2 * maxDeg);
    rx.set(-py * 2 * maxDeg);
  };

  const onMouseLeave = () => {
    rx.set(0);
    ry.set(0);
  };

  return { rotateX, rotateY, onMouseMove, onMouseLeave };
}
