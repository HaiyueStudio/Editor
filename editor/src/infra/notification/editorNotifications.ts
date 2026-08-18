export type EditorNotificationType = 'info' | 'error';

let notificationHost: HTMLElement | null = null;

function getNotificationHost(): HTMLElement {
  if (notificationHost?.isConnected) return notificationHost;
  notificationHost = document.createElement('div');
  notificationHost.className = 'editor-notifications';
  notificationHost.setAttribute('role', 'status');
  notificationHost.setAttribute('aria-live', 'polite');
  document.body.append(notificationHost);
  return notificationHost;
}

export function showEditorNotification(message: string, type: EditorNotificationType = 'info'): void {
  const host = getNotificationHost();
  const item = document.createElement('div');
  item.className = `editor-notification ${type}`;
  item.textContent = message;
  host.append(item);
  window.setTimeout(() => {
    item.classList.add('closing');
    window.setTimeout(() => item.remove(), 180);
  }, type === 'error' ? 5200 : 3200);
}

export function showEditorError(message: string): void {
  showEditorNotification(message, 'error');
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
