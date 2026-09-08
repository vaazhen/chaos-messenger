import { useCallback, useState } from "react";
import { api } from "../api";
import { getE2ee } from "../e2ee";
import { computeSafetyNumber, computeContactSafetyNumber, formatSafetyNumber } from "../safety-number";

export function useSafetyNumberModal({ activeChat, meId, l }) {
  const [safetyModal, setSafetyModal] = useState({
    open: false,
    devices: [],
    selectedDeviceId: null,
    error: null,
  });

  const openSafetyNumber = useCallback(async () => {
    if (!activeChat || activeChat.type !== "direct") return;
    setSafetyModal({ open: true, devices: [], selectedDeviceId: null, error: null });
    try {
      const ownBundle = getE2ee()?.getLocalDeviceBundle?.();
      const ownIdentityKey = ownBundle?.identity?.publicKey;
      if (!ownIdentityKey) throw new Error(l("Локальный ключ устройства не найден", "Local device identity key is missing"));

      const resolved = await api.resolveDevicesForSafetyNumber(activeChat.id);
      const remoteDevices = (resolved?.targetDevices || []).filter(device =>
        String(device.userId) !== String(meId) &&
        device.identityPublicKey &&
        device.deviceId
      );
      if (remoteDevices.length === 0) {
        throw new Error(l("У собеседника нет активных E2EE-устройств", "The contact has no active E2EE devices"));
      }

      const devices = await Promise.all(remoteDevices.map(async device => {
        const fingerprint = await computeSafetyNumber(ownIdentityKey, device.identityPublicKey);
        const trust = getE2ee()?.getRemoteIdentityTrust?.(device.deviceId, device.identityPublicKey) || {
          trustState: "UNVERIFIED"
        };
        return {
          deviceId: device.deviceId,
          deviceName: device.deviceName || device.deviceId,
          identityPublicKey: device.identityPublicKey,
          fingerprint,
          display: formatSafetyNumber(fingerprint),
          trustState: trust.trustState || "UNVERIFIED"
        };
      }));
      const contactFingerprint = await computeContactSafetyNumber(
        ownIdentityKey,
        remoteDevices.map(device => device.identityPublicKey)
      );

      setSafetyModal({
        open: true,
        devices,
        selectedDeviceId: devices[0].deviceId,
        contactFingerprint,
        contactDisplay: formatSafetyNumber(contactFingerprint),
        error: null
      });
    } catch (error) {
      setSafetyModal({
        open: true,
        devices: [],
        selectedDeviceId: null,
        error: error?.message || l("Не удалось вычислить Safety Number", "Could not compute Safety Number")
      });
    }
  }, [activeChat, meId, l]);

  const verifySafetyDevice = useCallback(async (deviceId) => {
    const target = safetyModal.devices.find(device => device.deviceId === deviceId);
    if (!target) return;
    await getE2ee().verifyRemoteIdentity(target.deviceId, target.identityPublicKey, "SAFETY_NUMBER");
    setSafetyModal(current => ({
      ...current,
      devices: current.devices.map(device =>
        device.deviceId === deviceId ? { ...device, trustState: "VERIFIED" } : device
      )
    }));
  }, [safetyModal.devices]);

  const closeSafetyNumber = useCallback(() => {
    setSafetyModal({ open: false, devices: [], selectedDeviceId: null, error: null });
  }, []);

  const blockSafetyDevice = useCallback(async (deviceId) => {
    const target = safetyModal.devices.find(device => device.deviceId === deviceId);
    if (!target) return;
    await getE2ee().blockRemoteIdentity(target.deviceId, target.identityPublicKey);
    setSafetyModal(current => ({
      ...current,
      devices: current.devices.map(device =>
        device.deviceId === deviceId ? { ...device, trustState: "BLOCKED" } : device
      )
    }));
  }, [safetyModal.devices]);

  return { safetyModal, setSafetyModal, openSafetyNumber, verifySafetyDevice, blockSafetyDevice, closeSafetyNumber };
}
