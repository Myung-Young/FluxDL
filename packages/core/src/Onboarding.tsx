import { useEffect, useState } from "react";
import type { StoreApi } from "zustand";
import type { DownloadEngine, EngineVersions } from "./engine.js";
import type { AudioPreset, DownloadPreset, ThemeName, VideoPreset } from "./types.js";
import { STRINGS } from "./strings.js";
import { pressScale } from "./motion.js";
import type { SettingsStoreState } from "./stores.js";

/**
 * First-run onboarding (M2.2): 3 steps — download folder, theme, default
 * preset (+ engine status check). Pure step machine below; the component
 * renders it. Never blocks use: skippable, re-runnable from Settings.
 * (Machine lives here, not onboarding.ts: Windows collides Onboarding.tsx
 * with onboarding.ts — see D26.)
 */

export const ONBOARDING_STEPS = ["folder", "theme", "preset"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingDraft {
  readonly downloadDir: string;
  readonly theme: ThemeName;
  readonly preset: DownloadPreset;
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const next = ONBOARDING_STEPS[stepIndex(step) + 1];
  return next ?? null;
}

export function prevStep(step: OnboardingStep): OnboardingStep | null {
  const prev = ONBOARDING_STEPS[stepIndex(step) - 1];
  return prev ?? null;
}

export function isFirstStep(step: OnboardingStep): boolean {
  return stepIndex(step) === 0;
}

export function isLastStep(step: OnboardingStep): boolean {
  return stepIndex(step) === ONBOARDING_STEPS.length - 1;
}

export interface OnboardingProps {
  readonly engine: Pick<DownloadEngine, "getEngineVersion" | "pickFolder">;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly onDone: () => void;
}

const THEMES: readonly ThemeName[] = ["obsidian", "midnight", "ember"];
const VIDEO_PRESETS: readonly VideoPreset[] = [
  "Compatible",
  "Best",
  "1080",
  "720",
  "480",
];
const AUDIO_PRESETS: readonly AudioPreset[] = ["MP3", "M4A", "Opus"];

/**
 * First-run wizard (M2.2). Non-blocking: Skip/X dismisses and marks done.
 * Draft commits on Done; Skip discards the draft.
 */
export function Onboarding({ engine, settings, onDone }: OnboardingProps): React.JSX.Element {
  const saved = settings.getState().settings;
  const [step, setStep] = useState<OnboardingStep>("folder");
  const [draft, setDraft] = useState<OnboardingDraft>({
    downloadDir: saved.downloadDir,
    theme: saved.theme,
    preset: saved.defaultPreset,
  });
  const [versions, setVersions] = useState<EngineVersions | null>(null);
  const [engineFailed, setEngineFailed] = useState<boolean>(false);

  useEffect(() => {
    engine
      .getEngineVersion()
      .then((v) => {
        setVersions(v);
      })
      .catch(() => {
        setEngineFailed(true);
      });
  }, [engine]);

  const finish = (commit: boolean): void => {
    const done = (): void => {
      onDone();
    };
    if (!commit) {
      void settings
        .getState()
        .save({ onboardingDone: true })
        .then(done, done);
      return;
    }
    void settings
      .getState()
      .save({
        onboardingDone: true,
        downloadDir: draft.downloadDir,
        theme: draft.theme,
        defaultPreset: draft.preset,
      })
      .then(done, done);
  };

  const browse = async (): Promise<void> => {
    const dir = await engine.pickFolder().catch(() => null);
    if (dir !== null) setDraft({ ...draft, downloadDir: dir });
  };

  const next = nextStep(step);
  const prev = prevStep(step);

  return (
    <div className="grabber-modal" role="dialog" aria-modal="true" aria-label={STRINGS.onboarding.title} data-testid="onboarding">
      <div className="grabber-card">
        <h2>{STRINGS.onboarding.title}</h2>
        <p className="hint">{STRINGS.onboarding.subtitle}</p>

        {step === "folder" && (
          <div>
            <label className="field-label" htmlFor="onboard-dir">
              {STRINGS.onboarding.stepFolder}
            </label>
            <div className="url-row">
              <input
                id="onboard-dir"
                className="input"
                value={draft.downloadDir}
                spellCheck={false}
                onChange={(e) => {
                  setDraft({ ...draft, downloadDir: e.target.value });
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void browse();
                }}
              >
                {STRINGS.onboarding.browse}
              </button>
            </div>
          </div>
        )}

        {step === "theme" && (
          <div>
            <span className="field-label">{STRINGS.onboarding.stepTheme}</span>
            <div className="chip-row" role="group" aria-label={STRINGS.onboarding.stepTheme}>
              {THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="chip"
                  aria-pressed={draft.theme === t}
                  onPointerDown={(e) => {
                    pressScale(e.currentTarget);
                  }}
                  onClick={() => {
                    setDraft({ ...draft, theme: t });
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "preset" && (
          <div>
            <span className="field-label">{STRINGS.onboarding.stepPreset}</span>
            <div className="chip-row" role="group" aria-label={STRINGS.onboarding.stepPreset}>
              {[...VIDEO_PRESETS.map((p) => `v:${p}`), ...AUDIO_PRESETS.map((p) => `a:${p}`)].map(
                (key) => {
                  const active =
                    draft.preset.kind === "video"
                      ? `v:${draft.preset.videoPreset}` === key
                      : `a:${draft.preset.audioPreset}` === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="chip"
                      aria-pressed={active}
                      onPointerDown={(e) => {
                        pressScale(e.currentTarget);
                      }}
                      onClick={() => {
                        const [kind, name] = key.split(":");
                        setDraft({
                          ...draft,
                          preset:
                            kind === "v"
                              ? {
                                  kind: "video",
                                  videoPreset: name as VideoPreset,
                                  audioPreset: "MP3",
                                  rawFormat: null,
                                }
                              : {
                                  kind: "audio",
                                  videoPreset: "Best",
                                  audioPreset: name as AudioPreset,
                                  rawFormat: null,
                                },
                        });
                      }}
                    >
                      {key.slice(2)}
                    </button>
                  );
                },
              )}
            </div>
            <p className="muted" role="status">
              {engineFailed
                ? STRINGS.onboarding.engineFail
                : versions !== null
                  ? `${STRINGS.onboarding.engineOk}: yt-dlp ${versions.ytdlp}`
                  : "…"}
            </p>
          </div>
        )}

        <div className="chip-row">
          {prev !== null && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setStep(prev);
              }}
            >
              {STRINGS.onboarding.back}
            </button>
          )}
          {next !== null ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setStep(next);
              }}
            >
              {STRINGS.onboarding.next}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="onboard-done"
              onClick={() => {
                finish(true);
              }}
            >
              {STRINGS.onboarding.done}
            </button>
          )}
          <button
            type="button"
            className="btn"
            data-testid="onboard-skip"
            onClick={() => {
              finish(false);
            }}
          >
            {STRINGS.onboarding.skip}
          </button>
        </div>
      </div>
    </div>
  );
}
