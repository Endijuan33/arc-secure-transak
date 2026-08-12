/**
 * Notification store.
 *
 * Structured levels rather than ad-hoc `toast.success` calls scattered through
 * components: the store owns the queue, so tests can assert on emitted
 * notifications and the UI layer stays a pure renderer.
 */

import { create } from 'zustand';
import type { AppNotification, NotificationLevel } from '../types';
import { NOTIFICATION_DURATION_MS } from '../config/constants';

interface NotificationState {
  readonly notifications: readonly AppNotification[];
  push: (level: NotificationLevel, title: string, message: string) => string;
  success: (title: string, message?: string) => string;
  error: (title: string, message?: string) => string;
  warning: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** Newest-first, capped so a retry storm cannot grow the array without bound. */
const MAX_NOTIFICATIONS = 5;

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useNotificationStore = create<NotificationState>((set) => {
  const push = (level: NotificationLevel, title: string, message: string): string => {
    const notification: AppNotification = {
      id: newId(),
      level,
      title,
      message,
      createdAt: Date.now(),
      durationMs: NOTIFICATION_DURATION_MS[level],
    };
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS),
    }));
    return notification.id;
  };

  return {
    notifications: [],
    push,
    success: (title, message = '') => push('success', title, message),
    error: (title, message = '') => push('error', title, message),
    warning: (title, message = '') => push('warning', title, message),
    info: (title, message = '') => push('info', title, message),
    dismiss: (id) => {
      set((state) => ({
        notifications: state.notifications.filter((entry) => entry.id !== id),
      }));
    },
    clear: () => {
      set({ notifications: [] });
    },
  };
});

/** Imperative access for services that are outside React's render tree. */
export const notify = {
  success: (title: string, message = ''): string =>
    useNotificationStore.getState().success(title, message),
  error: (title: string, message = ''): string =>
    useNotificationStore.getState().error(title, message),
  warning: (title: string, message = ''): string =>
    useNotificationStore.getState().warning(title, message),
  info: (title: string, message = ''): string =>
    useNotificationStore.getState().info(title, message),
};
