import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const deviceMocks = vi.hoisted(() => ({
  getOrCreateDeviceId: vi.fn(() => "alice-phone"),
}));

const callMediaMocks = vi.hoisted(() => ({
  decryptCallKeyEnvelope: vi.fn(async () => null),
}));

vi.mock("../deviceId", () => ({
  getOrCreateDeviceId: deviceMocks.getOrCreateDeviceId,
}));

vi.mock("../callMediaE2ee", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    decryptCallKeyEnvelope: (...args) => callMediaMocks.decryptCallKeyEnvelope(...args),
  };
});

function track(kind = "audio") {
  return {
    kind,
    id: `${kind}-${Math.random()}`,
    enabled: true,
    readyState: "live",
    muted: false,
    stop: vi.fn(),
  };
}

const createdPcs = [];

class MockPC {
  constructor() {
    createdPcs.push(this);
    this.localDescription = null;
    this.remoteDescription = null;
    this.connectionState = "new";
    this._transceivers = [];
    this.onicecandidate = null;
    this.ontrack = null;
    this.onconnectionstatechange = null;
    this.addTransceiver = vi.fn((kind) => {
      const transceiver = {
        sender: {
          track: null,
          replaceTrack: vi.fn(async (next) => {
            transceiver.sender.track = next;
          }),
        },
        receiver: { track: { kind } },
      };
      this._transceivers.push(transceiver);
      return transceiver;
    });
    this.getTransceivers = () => this._transceivers;
    this.getSenders = () => this._transceivers.map((item) => item.sender);
    this.addTrack = vi.fn();
    this.addIceCandidate = vi.fn(async () => {});
    this.createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer-sdp" }));
    this.createAnswer = vi.fn(async () => ({ type: "answer", sdp: "answer-sdp" }));
    this.setLocalDescription = vi.fn(async (desc) => {
      this.localDescription = desc;
    });
    this.setRemoteDescription = vi.fn(async (desc) => {
      this.remoteDescription = desc;
    });
    this.close = vi.fn();
  }
}

describe("useCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdPcs.length = 0;
    delete window.e2ee;
    delete globalThis.RTCRtpScriptTransform;
    globalThis.RTCPeerConnection = MockPC;
    globalThis.RTCIceCandidate = class RTCIceCandidate {
      constructor(init) {
        Object.assign(this, init);
      }
    };
    navigator.mediaDevices = {
      getUserMedia: vi.fn(async ({ audio, video }) => ({
        getAudioTracks: () => (audio ? [track("audio")] : []),
        getVideoTracks: () => (video ? [track("video")] : []),
        getTracks: function getTracks() {
          return [...this.getAudioTracks(), ...this.getVideoTracks()];
        },
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
      })),
    };
  });

  it("starts an outgoing offer with audio and video transceivers", async () => {
    const { useCall } = await import("../hooks/useCall");
    const sendSignal = vi.fn();
    const { result } = renderHook(() => useCall({
      enabled: true,
      me: { username: "alice" },
      sendSignal,
    }));

    await act(async () => {
      await result.current.startCall({ id: 100, type: "direct", name: "Bob" });
    });

    await waitFor(() => expect(result.current.phase).toBe("outgoing"));
    expect(sendSignal).toHaveBeenCalledWith({
      chatId: 100,
      type: "offer",
      sdp: "offer-sdp",
      video: false,
    });
    expect(result.current.remoteChatId).toBe(100);
  });

  it("shows incoming offer and ignores own device echo", async () => {
    const { useCall } = await import("../hooks/useCall");
    const sendSignal = vi.fn();
    const { result, rerender } = renderHook(
      ({ incoming }) => useCall({
        enabled: true,
        me: { username: "alice" },
        sendSignal,
        incoming,
      }),
      { initialProps: { incoming: null } },
    );

    rerender({ incoming: { type: "offer", chatId: 50, fromUsername: "alice", fromDeviceId: "alice-phone", receivedAt: 1 } });
    expect(result.current.phase).toBe("idle");

    rerender({ incoming: { type: "offer", chatId: 50, fromUsername: "bob", fromDeviceId: "bob-laptop", receivedAt: 2 } });
    expect(result.current.phase).toBe("incoming");
    expect(result.current.remoteName).toBe("bob");
  });

  it("toggles microphone on an active local track", async () => {
    const { useCall } = await import("../hooks/useCall");
    const { result } = renderHook(() => useCall({
      enabled: true,
      me: { username: "alice" },
      sendSignal: vi.fn(),
    }));

    await act(async () => {
      await result.current.startCall({ id: 100, type: "direct", name: "Bob" });
    });
    expect(result.current.micOn).toBe(true);

    act(() => {
      result.current.toggleMic();
    });
    expect(result.current.micOn).toBe(false);
  });

  it("applies callee answer even if ICE arrived first", async () => {
    const { useCall } = await import("../hooks/useCall");
    const { result } = renderHook(() => useCall({
      enabled: true,
      me: { username: "alice" },
      sendSignal: vi.fn(),
    }));

    await act(async () => {
      await result.current.startCall({ id: 100, type: "direct", name: "Bob" });
    });

    const pc = createdPcs[0];
    await act(async () => {
      result.current.handleSignal({
        type: "ice",
        chatId: 100,
        fromUsername: "bob",
        candidate: { candidate: "candidate:1", sdpMid: "0" },
      });
      result.current.handleSignal({
        type: "answer",
        chatId: 100,
        fromUsername: "bob",
        sdp: "answer-sdp",
      });
    });

    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" });
    await waitFor(() => expect(pc.addIceCandidate).toHaveBeenCalled());
    await waitFor(() => expect(result.current.phase).toBe("connecting"));
  });

  it("keeps ICE that arrived before the offer and applies it on accept", async () => {
    const { useCall } = await import("../hooks/useCall");
    const sendSignal = vi.fn();
    const { result } = renderHook(() => useCall({
      enabled: true,
      me: { username: "alice" },
      sendSignal,
    }));

    await act(async () => {
      result.current.handleSignal({
        type: "ice",
        chatId: 50,
        fromUsername: "bob",
        candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: "0" },
      });
      result.current.handleSignal({
        type: "offer",
        chatId: 50,
        fromUsername: "bob",
        fromDeviceId: "bob-laptop",
        sdp: "offer-sdp",
      });
    });
    expect(result.current.phase).toBe("incoming");

    await act(async () => {
      await result.current.acceptCall();
    });

    const pc = createdPcs[0];
    expect(pc.addIceCandidate).toHaveBeenCalledWith(expect.objectContaining({
      candidate: "candidate:1",
      sdpMid: "0",
      sdpMLineIndex: 0,
    }));
    expect(result.current.phase).toBe("connecting");
    expect(sendSignal).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 50,
      type: "answer",
      sdp: "answer-sdp",
    }));
  });

  it("accepts an incoming call only once", async () => {
    const { useCall } = await import("../hooks/useCall");
    const sendSignal = vi.fn();
    const { result } = renderHook(() => useCall({
      enabled: true,
      me: { username: "alice" },
      sendSignal,
    }));

    await act(async () => {
      result.current.handleSignal({
        type: "offer",
        chatId: 50,
        fromUsername: "bob",
        fromDeviceId: "bob-laptop",
        sdp: "offer-sdp",
      });
    });

    await act(async () => {
      await Promise.all([result.current.acceptCall(), result.current.acceptCall()]);
    });

    expect(createdPcs).toHaveLength(1);
    expect(sendSignal.mock.calls.filter((call) => call[0]?.type === "answer")).toHaveLength(1);
  });

  it("signals camera state so the remote UI can show video", async () => {
    const { useCall } = await import("../hooks/useCall");
    const sendSignal = vi.fn();
    const { result } = renderHook(() => useCall({
      enabled: true,
      me: { username: "alice" },
      sendSignal,
    }));

    await act(async () => {
      await result.current.startCall({ id: 100, type: "direct", name: "Bob" });
    });
    await act(async () => {
      await result.current.toggleCamera();
    });

    expect(sendSignal).toHaveBeenCalledWith({ chatId: 100, type: "media", video: true });
    expect(result.current.cameraOn).toBe(true);
  });

  it("turns remote video on from a media signal even without unmute", async () => {
    const { useCall } = await import("../hooks/useCall");
    const { result } = renderHook(() => useCall({
      enabled: true,
      me: { username: "alice" },
      sendSignal: vi.fn(),
    }));

    await act(async () => {
      await result.current.startCall({ id: 100, type: "direct", name: "Bob" });
      result.current.handleSignal({
        type: "media",
        chatId: 100,
        fromUsername: "bob",
        video: true,
      });
    });

    expect(result.current.remoteVideoOn).toBe(true);
  });

  it("rejects an incoming offer whose mediaKeys cannot be decrypted", async () => {
    globalThis.RTCRtpScriptTransform = function RTCRtpScriptTransform() {};
    callMediaMocks.decryptCallKeyEnvelope.mockResolvedValueOnce(null);
    const { useCall } = await import("../hooks/useCall");
    const sendSignal = vi.fn();
    const { result } = renderHook(() => useCall({
      enabled: true,
      me: { username: "alice" },
      sendSignal,
    }));

    await act(async () => {
      result.current.handleSignal({
        type: "offer",
        chatId: 50,
        fromUsername: "bob",
        fromDeviceId: "bob-laptop",
        sdp: "offer-sdp",
        mediaKeys: [{ targetDeviceId: "alice-phone", ciphertext: "x" }],
      });
    });

    await act(async () => {
      await result.current.acceptCall();
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.mediaError).toBe("e2ee");
    expect(sendSignal).toHaveBeenCalledWith({ chatId: 50, type: "hangup" });
    expect(sendSignal.mock.calls.some((call) => call[0]?.type === "answer")).toBe(false);
  });

  it("rejects an incoming offer whose mediaKeys were stripped", async () => {
    globalThis.RTCRtpScriptTransform = function RTCRtpScriptTransform() {};
    const { useCall } = await import("../hooks/useCall");
    const sendSignal = vi.fn();
    const { result } = renderHook(() => useCall({
      enabled: true,
      me: { username: "alice" },
      sendSignal,
    }));

    await act(async () => {
      result.current.handleSignal({
        type: "offer",
        chatId: 50,
        fromUsername: "bob",
        fromDeviceId: "bob-laptop",
        sdp: "offer-sdp",
      });
    });

    await act(async () => {
      await result.current.acceptCall();
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.mediaError).toBe("e2ee");
    expect(sendSignal).toHaveBeenCalledWith({ chatId: 50, type: "hangup" });
  });
});
