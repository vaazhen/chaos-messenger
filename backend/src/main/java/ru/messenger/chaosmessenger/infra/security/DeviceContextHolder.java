package ru.messenger.chaosmessenger.infra.security;

public final class DeviceContextHolder {
    private static final ThreadLocal<String> CURRENT_DEVICE_ID = new ThreadLocal<>();

    private DeviceContextHolder() {}

    public static void set(String deviceId) { CURRENT_DEVICE_ID.set(deviceId); }
    public static String get() { return CURRENT_DEVICE_ID.get(); }
    public static void clear() { CURRENT_DEVICE_ID.remove(); }
}
