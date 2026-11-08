import { api } from '../api/client';
import { isNativeApp, nativePush } from '../printing/nativePrint';

const ANDROID_TOKEN_KEY = 'bm_push_android_token';

export interface DevicePermissionState {
  notifications: string;
  camera: string;
  location: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function subscribeWebPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const { data } = await api.get<{ publicKey: string }>('/push/vapid-public-key');
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey) as BufferSource,
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
  await api.post('/push/web', { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
}

export async function enableAndroidPush(): Promise<void> {
  const stored = localStorage.getItem(ANDROID_TOKEN_KEY) || undefined;
  const { data } = await api.post<{ token: string }>('/push/android', { token: stored });
  localStorage.setItem(ANDROID_TOKEN_KEY, data.token);
  const { plugin } = await nativePush();
  await plugin.start({ apiBase: window.location.origin, token: data.token });
}

async function registerPushIfAllowed(notifications: string): Promise<void> {
  if (notifications !== 'granted') return;
  if (isNativeApp()) {
    await enableAndroidPush();
    return;
  }
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    await subscribeWebPush();
  }
}

/** Chiede solo le notifiche. Sull'APK è il dialogo di sistema; sulla PWA quello del browser. */
export async function requestNotificationPermission(): Promise<string> {
  if (isNativeApp()) {
    const { plugin } = await nativePush();
    const result = await plugin.requestNotifications();
    const state = result.notifications ?? 'denied';
    try {
      await registerPushIfAllowed(state);
    } catch {
      // Il permesso resta valido anche se la registrazione sul server fallisce.
    }
    return state;
  }
  if (!('Notification' in window)) return 'unsupported';
  const state = await Notification.requestPermission();
  try {
    await registerPushIfAllowed(state);
  } catch {
    // Il permesso resta valido anche se la registrazione sul server fallisce.
  }
  return state;
}

async function queryWeb(name: 'notifications' | 'camera' | 'geolocation'): Promise<string> {
  if (name === 'notifications') {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }
  try {
    const status = await navigator.permissions.query({ name });
    return status.state;
  } catch {
    return 'prompt';
  }
}

async function requestWebCamera(): Promise<string> {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    stream.getTracks().forEach((track) => track.stop());
    return 'granted';
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') return 'missing';
    return 'denied';
  }
}

function requestWebLocation(): Promise<string> {
  if (!navigator.geolocation) return Promise.resolve('unsupported');
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve('granted'),
      (error) => resolve(error.code === error.PERMISSION_DENIED ? 'denied' : 'missing'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}

/**
 * Richiede notifiche, fotocamera (QR di timbratura) e posizione (timbratura sul posto).
 * Se sull'APK il sistema non mostra più la richiesta, apre le impostazioni dell'app.
 */
export async function requestDevicePermissions(): Promise<{ ok: boolean; message: string }> {
  let state: DevicePermissionState;
  let openSettings = false;

  if (isNativeApp()) {
    const { plugin } = await nativePush();
    const before = await plugin.permissionStatus();
    state = await plugin.requestDevicePermissions();
    openSettings = (['notifications', 'camera', 'location'] as const).some(
      (key) => before[key] === 'denied' && state[key] !== 'granted',
    );
    if (openSettings) {
      await plugin.openAppSettings();
    }
  } else {
    const notifications = 'Notification' in window ? await Notification.requestPermission() : 'unsupported';
    const [camera, location] = await Promise.all([requestWebCamera(), requestWebLocation()]);
    state = { notifications, camera, location };
  }

  try {
    await registerPushIfAllowed(state.notifications);
  } catch {
    // Il permesso può essere concesso e la registrazione fallire: il messaggio resta sulle autorizzazioni.
  }

  return { ok: state.notifications === 'granted' && state.camera === 'granted' && state.location === 'granted' && !openSettings, message: describePermissions(state, openSettings) };
}

function labelFor(key: keyof DevicePermissionState, value: string): string {
  const name = key === 'notifications' ? 'notifiche' : key === 'camera' ? 'fotocamera' : 'posizione';
  const active = key === 'notifications' ? 'attive' : 'attiva';
  const unavailable = key === 'notifications' ? 'non disponibili' : 'non disponibile';
  const denied = key === 'notifications' ? 'non concesse' : 'non concessa';
  if (value === 'granted') return `${name} ${active}`;
  if (value === 'missing' || value === 'unsupported') return `${name} ${unavailable} su questo dispositivo`;
  return `${name} ${denied}`;
}

function describePermissions(state: DevicePermissionState, openedSettings: boolean): string {
  const raw = `${labelFor('notifications', state.notifications)}, ${labelFor('camera', state.camera)}, ${labelFor('location', state.location)}.`;
  const summary = raw.charAt(0).toUpperCase() + raw.slice(1);
  if (openedSettings) {
    return `${summary} Abilita quelle mancanti nelle impostazioni dell'app.`;
  }
  if (state.notifications === 'denied' || state.camera === 'denied' || state.location === 'denied') {
    return `${summary} Se il dispositivo non mostra la richiesta, abilitale dalle sue impostazioni.`;
  }
  return summary;
}
