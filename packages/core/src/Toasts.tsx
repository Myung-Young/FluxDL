import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import { STRINGS } from "./strings.js";
import type { ToastStoreState } from "./toast.js";

export function Toasts({ toast }: { toast: StoreApi<ToastStoreState> }): React.JSX.Element {
  const toasts = useStore(toast, (s) => s.toasts);
  const dismiss = (id: string): void => {
    toast.getState().dismiss(id);
  };
  if (toasts.length === 0) return <></>;
  return (
    <div className="toasts" aria-live="polite" aria-label={STRINGS.toast.region}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          role={t.kind === "error" ? "alert" : "status"}
        >
          <span>{t.message}</span>
          {t.action !== undefined && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            aria-label={STRINGS.toast.dismiss}
            onClick={() => {
              dismiss(t.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
