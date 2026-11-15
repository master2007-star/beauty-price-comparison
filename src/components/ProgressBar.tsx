"use client";

import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion";

/** Springy reading-progress bar. Transform-only (scaleX). */
export default function ProgressBar() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 });
  if (reduceMotion) return null;
  return <motion.div className="progress-bar" style={{ scaleX }} aria-hidden="true" />;
}
