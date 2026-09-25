/**
 * Tiny app-wide notification channel. Commands and components that are not
 * React-aware call notifyUser(); App.tsx renders it as a toast.
 */
export type NotifyKind = 'info' | 'success' | 'error';

export interface NotifyDetail {
  kind: NotifyKind;
  message: string;
}

export const NOTIFY_EVENT = 'malipdf:notify';

export function notifyUser(kind: NotifyKind, message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<NotifyDetail>(NOTIFY_EVENT, { detail: { kind, message } }));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
