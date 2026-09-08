import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SafetyNumberModal from "../components/SafetyNumberModal";

const l = (ru, en) => en || ru;
const fingerprint = {
  fingerprint: "alpha beta gamma delta\necho foxtrot golf hotel",
};
const display = {
  numeric: "1234 5678 9012",
  hex: "aa:bb:cc:dd:ee:ff",
};

function modal(overrides = {}) {
  return {
    open: true,
    selectedDeviceId: "device-bob-1",
    error: null,
    devices: [
      {
        deviceId: "device-bob-1",
        deviceName: "Bob phone",
        identityPublicKey: "identity-1",
        fingerprint,
        display,
        trustState: "UNVERIFIED",
      },
      {
        deviceId: "device-bob-2",
        deviceName: "Bob laptop",
        identityPublicKey: "identity-2",
        fingerprint,
        display,
        trustState: "KEY_CHANGED",
      },
    ],
    ...overrides,
  };
}

describe("SafetyNumberModal", () => {
  afterEach(cleanup);

  it("verifies the selected device only after an explicit action", async () => {
    const onVerify = vi.fn().mockResolvedValue(undefined);

    render(
      <SafetyNumberModal
        safetyModal={modal()}
        onClose={vi.fn()}
        onSelectDevice={vi.fn()}
        onVerify={onVerify}
        l={l}
      />
    );

    expect(screen.getByText("Device not verified yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(onVerify).toHaveBeenCalledWith("device-bob-1"));
  });

  it("shows a critical state for a changed identity key and switches devices", () => {
    const onSelectDevice = vi.fn();

    render(
      <SafetyNumberModal
        safetyModal={modal({ selectedDeviceId: "device-bob-2" })}
        onClose={vi.fn()}
        onSelectDevice={onSelectDevice}
        onVerify={vi.fn()}
        l={l}
      />
    );

    expect(screen.getByText(/device key changed/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "device-bob-1" } });
    expect(onSelectDevice).toHaveBeenCalledWith("device-bob-1");
  });

  it("blocks a device from the modal", async () => {
    const onBlock = vi.fn().mockResolvedValue(undefined);

    render(
      <SafetyNumberModal
        safetyModal={modal()}
        onClose={vi.fn()}
        onSelectDevice={vi.fn()}
        onVerify={vi.fn()}
        onBlock={onBlock}
        l={l}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    await waitFor(() => expect(onBlock).toHaveBeenCalledWith("device-bob-1"));
  });
});
