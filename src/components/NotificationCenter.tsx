import { useEffect } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { CheckCircle, XCircle, AlertTriangle, Info, type LucideIcon } from 'lucide-react';
import type { NotificationLevel } from '../types';
import { useNotificationStore } from '../store/notificationStore';

const LEVEL_ICON: Record<NotificationLevel, LucideIcon> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const LEVEL_BORDER: Record<NotificationLevel, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
};

export function NotificationCenter(): React.JSX.Element {
  const notifications = useNotificationStore((state) => state.notifications);
  const dismiss = useNotificationStore((state) => state.dismiss);

  useEffect(() => {
    for (const notification of notifications) {
      const Icon = LEVEL_ICON[notification.level];
      toast.custom(
        () => (
          <div
            className={`callout callout--${notification.level}`}
            style={{
              maxWidth: 360,
              borderLeftWidth: 3,
              borderLeftColor: LEVEL_BORDER[notification.level],
              boxShadow: 'var(--shadow-elevated)',
            }}
            role={notification.level === 'error' ? 'alert' : 'status'}
          >
            <span className="callout__icon">
              <Icon size={15} aria-hidden="true" />
            </span>
            <div style={{ minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: 13 }}>{notification.title}</strong>
              {notification.message.length > 0 && (
                <span style={{ fontSize: 12, opacity: 0.9, wordBreak: 'break-word', lineHeight: 1.5 }}>
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

  return <Toaster position="top-right" gutter={8} />;
}
