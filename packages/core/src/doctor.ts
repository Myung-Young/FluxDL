/**
 * Doctor report shapes + pure helpers (Phase 2). Data collection lives
 * main-side (runDoctor); these helpers stay testable without spawning.
 */
import { compareVersions } from "./tools.js";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly status: DoctorStatus;
  /** One-line human detail (version, path, or the failure). */
  readonly detail: string;
  /** Fix action the UI can offer, if any. */
  readonly fix?: "update" | "repair" | "reinstall" | "rollback" | "open-settings" | "install-guide";
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly checkedAt: number;
  readonly checks: readonly DoctorCheck[];
}

/** Throttle helper: true when a fresh check is due (≤1/day default). */
export function isCheckDue(lastAt: number | null, now: number, everyMs = 86_400_000): boolean {
  if (lastAt === null) return true;
  if (!Number.isFinite(lastAt) || !Number.isFinite(now)) return true;
  return now - lastAt >= everyMs;
}

/** Version gate: null version fails; below-minimum warns (tool still runs). */
export function versionCheck(
  id: string,
  label: string,
  version: string | null,
  minimum: string | null,
): DoctorCheck {
  if (version === null || version === "unknown") {
    return { id, label, status: "fail", detail: "not found" };
  }
  if (minimum !== null && compareVersions(version, minimum) < 0) {
    return { id, label, status: "warn", detail: `${version} (want ≥ ${minimum})` };
  }
  return { id, label, status: "ok", detail: version };
}

export function buildDoctorReport(checks: readonly DoctorCheck[], now: number): DoctorReport {
  return {
    ok: checks.every((c) => c.status === "ok"),
    checkedAt: now,
    checks,
  };
}

/** True when no stdout arrived within the stall window (0 = watchdog off). */
export function isStalled(lastActivityAt: number | null, now: number, timeoutSec: number): boolean {
  if (timeoutSec <= 0) return false;
  if (lastActivityAt === null) return false;
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now)) return false;
  return now - lastActivityAt >= timeoutSec * 1000;
}
