import { create, type StoreApi } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface ToastAction {
  readonly label: string;
  run(): void;
}

export interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  readonly message: string;
  readonly action?: ToastAction;
}

export interface ToastStoreState {
  readonly toasts: readonly Toast[];
  push(message: string, kind?: ToastKind, action?: ToastAction): string;
  dismiss(id: string): void;
  clear(): void;
}

let counter = 0;

function nextId(): string {
  counter += 1;
  return `toast-${Date.now().toString(36)}-${String(counter)}`;
}

/**
 * Ephemeral UI messages. No engine involved; auto-dismiss keeps the
 * stack bounded. TTL is injectable for tests.
 */
export function createToastStore(ttlMs = 4000): StoreApi<ToastStoreState> {
  return create<ToastStoreState>()((set, get) => ({
    toasts: [],
    push: (message, kind = "info", action) => {
      const id = nextId();
      const trimmed = get().toasts.slice(-2);
      const toast: Toast = action === undefined ? { id, kind, message } : { id, kind, message, action };
      set({ toasts: [...trimmed, toast] });
      setTimeout(() => {
        get().dismiss(id);
      }, ttlMs);
      return id;
    },
    dismiss: (id) => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
    clear: () => {
      set({ toasts: [] });
    },
  }));
}
