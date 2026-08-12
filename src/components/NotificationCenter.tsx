import { useEffect } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import type { NotificationLevel } from '../types';
import { ICONS } from '../config/constants';
import { useNotificationStore } from '../store/notificationStore';

const LEVEL_ICON: Record<NotificationLevel, string> = {
  success: ICONS.check,
  error: ICONS.error,
  warning: ICONS.warning,
  info: ICONS.info,
};

const LEVEL_BORDER: Record<NotificationLevel, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
};

/**
 * Bridges the notification store to react-hot-toast.
 *
 * The store stays the single source of truth so services can notify without a
 * React context, and this component is the only place that knows about the toast
 * library. Each notification is dismissed from the store once handed over, which
 * prevents a re-render from replaying the same toast.
 */
export function NotificationCenter(): React.JSX.Element {
  const notifications = useNotificationStore((state) => state.notifications);
  const dismiss = useNotificationStore((state) => state.dismiss);

  useEffect(() => {
    for (const notification of notifications) {
      toast.custom(
        () => (
          <div
            className={`callout callout--${notification.level}`}
            style={{
              maxWidth: 360,
              borderLeftWidth: 4,
              borderLeftColor: LEVEL_BORDER[notification.level],
            }}
            role={notification.level === 'error' ? 'alert' : 'status'}
          >
            <span className="callout__icon">{LEVEL_ICON[notification.level]}</span>
            <div style={{ minWidth: 0 }}>
              <strong style={{ display: 'block' }}>{notification.title}</strong>
              {notification.message.length > 0 && (
                <span style={{ fontSize: 13, opacity: 0.9, wordBreak: 'break-word' }}>
                  {notification.message}
                </span>
              )}
            </div>
          </div>
        ),
        { id: notification.id, duration: notification.durationMs },
      );
      dismiss(notification.id);
    }
  }, [notifications, dismiss]);

  return <Toaster position="top-right" gutter={10} />;
}
