/**
 * Notification preferences + helpers.
 *
 * expo-notifications removed Android push-notification support from Expo Go in
 * SDK 53. Importing the module at module-level (or via require()) throws before
 * any try/catch can intercept it on Android Expo Go, crashing the whole module
 * and cascading into a layout failure.
 *
 * All notification dispatch is therefore no-op in this file.  The preferences
 * themselves (user toggles) are still persisted in AsyncStorage so they are
 * ready when the app is built into a production APK/IPA where push
 * notifications work properly.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type NotifKey =
  | "notif_validator_paused"
  | "notif_epoch_signed"
  | "notif_new_epoch"
  | "notif_heartbeat_failed";

const DEFAULTS: Record<NotifKey, boolean> = {
  notif_validator_paused: true,
  notif_epoch_signed: false,
  notif_new_epoch: false,
  notif_heartbeat_failed: true,
};

export async function getNotifPref(key: NotifKey): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(key);
    if (val === null) return DEFAULTS[key];
    return val === "1";
  } catch {
    return DEFAULTS[key];
  }
}

export async function setNotifPref(key: NotifKey, enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(key, enabled ? "1" : "0");
  } catch {
    // Ignore storage errors
  }
}

export async function getAllNotifPrefs(): Promise<Record<NotifKey, boolean>> {
  const keys: NotifKey[] = [
    "notif_validator_paused",
    "notif_epoch_signed",
    "notif_new_epoch",
    "notif_heartbeat_failed",
  ];
  const pairs = await Promise.all(keys.map(async (k) => [k, await getNotifPref(k)] as const));
  return Object.fromEntries(pairs) as Record<NotifKey, boolean>;
}

/**
 * Request notification permission from the OS.
 * Returns false in Expo Go (Android SDK 53+) where push notifications are
 * unavailable. Returns true only in production builds where the native bridge
 * is present.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    // Dynamically import so a missing native bridge doesn't crash the module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifs = require("expo-notifications");
    const { status: existing } = await Notifs.getPermissionsAsync();
    if (existing === "granted") return true;
    const { status } = await Notifs.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

/**
 * Get current notification permission status.
 * Returns "undetermined" when expo-notifications is unavailable (Expo Go
 * Android SDK 53+) so the UI can show notifications as disabled.
 */
export async function getNotificationPermissionStatus(): Promise<"granted" | "denied" | "undetermined"> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifs = require("expo-notifications");
    const { status } = await Notifs.getPermissionsAsync();
    return status as "granted" | "denied" | "undetermined";
  } catch {
    return "undetermined";
  }
}

/**
 * Fire a local notification if the user has it enabled.
 * Silently does nothing when push notifications are unavailable.
 */
export async function sendNotifIfEnabled(
  key: NotifKey,
  title: string,
  body: string,
): Promise<void> {
  try {
    const enabled = await getNotifPref(key);
    if (!enabled) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifs = require("expo-notifications");
    const { status } = await Notifs.getPermissionsAsync();
    if (status !== "granted") return;
    await Notifs.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {
    // Notifications unavailable (Expo Go / simulator) — silent no-op
  }
}
