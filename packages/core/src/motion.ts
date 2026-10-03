import { gsap } from "gsap";
import { hexToRgb, rgbToHex } from "./color.js";

/**
 * Motion helpers over GSAP. Every helper is a no-op for state (never leaves
 * the UI in a half-animated state) when the user prefers reduced motion.
 * Note: no backdrop-filter/blur is used anywhere — long lists stay cheap.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Staggered card/nav entrance. Runs once per mount. */
export function staggerIn(container: Element, selector = "[data-entrance]"): void {
  if (prefersReducedMotion()) return;
  const items = container.querySelectorAll(selector);
  if (items.length === 0) return;
  gsap.fromTo(
    items,
    { y: 10, opacity: 0 },
    {
      y: 0,
      opacity: 1,
      duration: 0.35,
      stagger: 0.05,
      ease: "power2.out",
      overwrite: true,
      clearProps: "transform",
    },
  );
}

/** View transition: quick fade/slide out, swap content, fade back in. */
export function fadeSwap(element: Element, apply: () => void): void {
  if (prefersReducedMotion()) {
    apply();
    return;
  }
  gsap
    .timeline()
    .to(element, { opacity: 0, y: 6, duration: 0.12, ease: "power1.in", overwrite: true })
    .add(() => {
      apply();
    })
    .to(element, { opacity: 1, y: 0, duration: 0.22, ease: "power2.out", clearProps: "all" });
}

/** Button press micro-interaction (pointerdown scale). */
export function pressScale(element: Element): void {
  if (prefersReducedMotion()) return;
  gsap.fromTo(
    element,
    { scale: 1 },
    { scale: 0.97, duration: 0.08, ease: "power1.in", yoyo: true, repeat: 1, overwrite: true },
  );
}

/** Smooth progress morph toward a 0..1 ratio (width %). */
export function tweenProgress(element: HTMLElement, ratio: number): void {  const clamped = Math.min(1, Math.max(0, ratio));
  if (prefersReducedMotion()) {
    element.style.width = `${String(clamped * 100)}%`;
    return;
  }
  gsap.to(element, {
    width: `${String(clamped * 100)}%`,
    duration: 0.3,
    ease: "power1.out",
    overwrite: true,
  });
}

/**
 * FLIP settle: glide an element from a measured vertical offset back to
 * its laid-out place (used after queue reorders). Reduced-motion safe.
 */
export function flipShift(element: Element, fromY: number): void {
  if (prefersReducedMotion()) return;
  if (!Number.isFinite(fromY) || fromY === 0) return;
  gsap.from(element, {
    y: fromY,
    duration: 0.28,
    ease: "power2.out",
    overwrite: true,
    clearProps: "transform",
  });
}

/**
 * Tween a CSS colour variable between two hex values (thumbnail accent).
 * Reduced motion (or unparseable colours) sets the target directly.
 */
export function tweenAccentVar(
  element: HTMLElement,
  name: string,
  from: string | null,
  to: string,
): void {
  const target = hexToRgb(to);
  const start = from !== null ? hexToRgb(from) : null;
  if (target === null) return;
  if (start === null || prefersReducedMotion()) {
    element.style.setProperty(name, to);
    return;
  }
  const proxy = { t: 0 };
  gsap.to(proxy, {
    t: 1,
    duration: 0.4,
    ease: "power2.out",
    overwrite: true,
    onUpdate: () => {
      element.style.setProperty(
        name,
        rgbToHex({
          r: start.r + (target.r - start.r) * proxy.t,
          g: start.g + (target.g - start.g) * proxy.t,
          b: start.b + (target.b - start.b) * proxy.t,
        }),
      );
    },
  });
}
