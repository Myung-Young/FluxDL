import type { ReactNode } from "react";

/**
 * Original FluxDL icon set (hand-drawn, stroke-based, currentColor).
 * 24x24 grid, 2px rounded strokes — one visual language for the app mark,
 * every nav view, and future buttons. No emoji, no external assets.
 *
 * Note: the name union intentionally mirrors ShellView (+ "logo") without
 * importing Shell — icons must never depend on layout code.
 */
export type IconName =
  | "logo"
  | "home"
  | "downloads"
  | "library"
  | "stats"
  | "settings"
  | "logs"
  | "changelog"
  | "chevron";

const PATHS: Record<IconName, ReactNode> = {
  // App mark: rounded frame, arrow landing into a tray.
  logo: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M12 7v8m0 0-3.5-3.5M12 15l3.5-3.5" />
      <path d="M8 18.5h8" />
    </>
  ),
  // House with a chimney and a door.
  home: (
    <>
      <path d="M3 12l9-7 9 7" />
      <path d="M5.5 10.5V20h13v-9.5" />
      <path d="M10 20v-5h4v5" />
      <path d="M16.5 4.5V9" />
    </>
  ),
  // Arrow dropping into an open tray.
  downloads: (
    <>
      <path d="M12 3v10m0 0-4.5-4.5M12 13l4.5-4.5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
  // Two shelves with books standing upright on each one.
  library: (
    <>
      <path d="M7 10V4M10.5 10V6M14 10V4M17.5 10V6" />
      <path d="M3 10h18" />
      <path d="M7 20v-5M12 20v-3.5M16.5 20v-5" />
      <path d="M3 20h18" />
    </>
  ),
  // Chevron for expanding/collapsing (changelog read-more, details).
  chevron: (
    <>
      <path d="M6 9l6 6 6-6" />
    </>
  ),
  // Three bars rising off a baseline.
  stats: (
    <>
      <path d="M4 20h16" />
      <path d="M8 20v-6M13 20V6M18 20v-9" />
    </>
  ),
  // Two slider tracks with offset knobs.
  settings: (
    <>
      <path d="M4 8h7M17 8h3" />
      <circle cx="15" cy="8" r="2.2" />
      <path d="M4 16h3M11 16h9" />
      <circle cx="9" cy="16" r="2.2" />
    </>
  ),
  // Folded-corner document with two text lines.
  logs: (
    <>
      <path d="M6 3h8l5 5v13H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13.5h7M9 17.5h7" />
    </>
  ),
  // Circular history arrow with clock hands.
  changelog: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 3v4.5h-4.5" />
      <path d="M12 8v4.5h3" />
    </>
  ),
};

export function AppIcon({ name }: { readonly name: IconName }): React.JSX.Element {
  return (
    <svg
      className="app-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
