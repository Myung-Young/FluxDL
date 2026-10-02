import { gsap } from "gsap";

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
export function tweenProgress(element: HTMLElement, ratio: number): void {
  const clamped = Math.min(1, Math.max(0, ratio));
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
