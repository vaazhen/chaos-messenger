import { useCallback, useEffect, useRef, useState } from "react";
import { ICE_SERVERS } from "../config";
import { getOrCreateDeviceId } from "../deviceId";
import { getE2ee } from "../e2ee";
import {
  decryptCallKeyEnvelope,
  encryptCallKeyForChat,
  generateCallKey,
  protectPeerConnection,
  protectReceiver,
  supportsMediaE2ee,
} from "../callMediaE2ee";

const SIGNAL_TYPES = new Set(["offer", "answer", "ice", "hangup", "busy", "media"]);
const VIDEO_CONSTRAINTS = { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } };
const ICE_GATHER_TIMEOUT_MS = 8000;
const CONNECT_TIMEOUT_MS = 20000;

function callLog(...args) {
  if (import.meta.env.DEV) console.warn("[call]", ...args);
}

function iceInit(candidate) {
  if (typeof candidate === "string") {
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  if (!candidate || typeof candidate !== "object") return null;
  if (!candidate.candidate && candidate.candidate !== "") return null;
  const index = candidate.sdpMLineIndex == null || candidate.sdpMLineIndex === ""
    ? null
    : Number(candidate.sdpMLineIndex);
  const init = { candidate: candidate.candidate };
  if (candidate.sdpMid != null && candidate.sdpMid !== "") init.sdpMid = String(candidate.sdpMid);
  if (Number.isFinite(index)) init.sdpMLineIndex = index;
  if (candidate.usernameFragment) init.usernameFragment = candidate.usernameFragment;
  if (!init.sdpMid && init.sdpMLineIndex == null) return null;
  return init;
}

function icePayload(candidate) {
  const json = candidate?.toJSON ? candidate.toJSON() : candidate;
  return iceInit(json);
}

async function addIceCandidateSafe(pc, init) {
  const normalized = iceInit(init);
  if (!pc || !normalized) return;
  try {
    const Ice = globalThis.RTCIceCandidate;
    await pc.addIceCandidate(typeof Ice === "function" ? new Ice(normalized) : normalized);
  } catch (error) {
    callLog("addIceCandidate failed", error, normalized);
  }
}

function waitForIceGathering(pc, timeoutMs = ICE_GATHER_TIMEOUT_MS) {
  if (!pc || !pc.iceGatheringState || pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      pc.removeEventListener?.("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = window.setTimeout(done, timeoutMs);
    pc.addEventListener?.("icegatheringstatechange", onChange);
    onChange();
  });
}

function transceiverOf(pc, kind) {
  return pc?.getTransceivers().find((item) => {
    const trackKind = item.sender?.track?.kind || item.receiver?.track?.kind;
    return trackKind === kind;
  }) || null;
}

function playMedia(el) {
  if (!el?.play) return;
  void el.play().catch(() => {});
}

export function useCall({ enabled, me, sendSignal, incoming }) {
  const [phase, setPhase] = useState("idle");
  const [remoteName, setRemoteName] = useState("");
  const [remoteChatId, setRemoteChatId] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [remoteVideoOn, setRemoteVideoOn] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [mediaProtection, setMediaProtection] = useState("dtls");
  const [recents, setRecents] = useState([]);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const phaseRef = useRef("idle");
  const chatIdRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const pendingIceRef = useRef([]);
  const pendingIceByChatRef = useRef(new Map());
  const pendingLocalIceRef = useRef([]);
  const trickleReadyRef = useRef(false);
  const acceptingRef = useRef(false);
  const applyingAnswerRef = useRef(false);
  const callKeyRef = useRef(null);
  const closingRef = useRef(false);
  const connectTimerRef = useRef(null);
  const sendRef = useRef(sendSignal);
  const startedAtRef = useRef(null);
  const directionRef = useRef("out");
  const enabledRef = useRef(enabled);
  const meRef = useRef(me);
  const ownDeviceIdRef = useRef(getOrCreateDeviceId());

  useEffect(() => {
    sendRef.current = sendSignal;
  }, [sendSignal]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  const setPhaseNow = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const publish = useCallback((payload) => sendRef.current?.(payload), []);

  const takePendingIce = useCallback((chatId) => {
    const key = String(chatId);
    const queued = pendingIceByChatRef.current.get(key) || [];
    pendingIceByChatRef.current.delete(key);
    return queued;
  }, []);

  const bufferIce = useCallback((chatId, candidate) => {
    const key = String(chatId);
    const queued = pendingIceByChatRef.current.get(key) || [];
    queued.push(candidate);
    pendingIceByChatRef.current.set(key, queued.slice(-40));
    if (pendingIceByChatRef.current.size > 8) {
      const oldest = pendingIceByChatRef.current.keys().next().value;
      pendingIceByChatRef.current.delete(oldest);
    }
  }, []);

  const flushLocalIce = useCallback(() => {
    trickleReadyRef.current = true;
    const queued = pendingLocalIceRef.current;
    pendingLocalIceRef.current = [];
    queued.forEach((payload) => publish(payload));
  }, [publish]);

  const rememberRecent = useCallback((entry) => {
    setRecents((prev) => {
      const next = [{ ...entry, at: Date.now() }, ...prev.filter((item) => Number(item.chatId) !== Number(entry.chatId))];
      return next.slice(0, 40);
    });
  }, []);

  const bindRemoteStream = useCallback((stream) => {
    remoteStreamRef.current = stream;
    const audioEl = remoteAudioRef.current;
    const videoEl = remoteVideoRef.current;
    if (audioEl) {
      audioEl.srcObject = new MediaStream(stream.getAudioTracks());
      playMedia(audioEl);
    }
    if (videoEl) {
      videoEl.srcObject = new MediaStream(stream.getVideoTracks());
      videoEl.muted = true;
      playMedia(videoEl);
    }
    const liveVideo = stream.getVideoTracks().some((track) => (
      track.readyState === "live" && track.enabled !== false
    ));
    if (liveVideo) setRemoteVideoOn(true);
  }, []);

  const bindLocalPreview = useCallback(() => {
    const stream = localStreamRef.current;
    if (!localVideoRef.current) return;
    const videoTracks = stream?.getVideoTracks() || [];
    localVideoRef.current.srcObject = videoTracks.length ? new MediaStream(videoTracks) : null;
    if (videoTracks.length) playMedia(localVideoRef.current);
  }, []);

  const cleanup = useCallback(() => {
    closingRef.current = true;
    if (connectTimerRef.current) {
      window.clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    const chatId = chatIdRef.current;
    if (chatId && phaseRef.current !== "idle" && phaseRef.current !== "error") {
      rememberRecent({
        chatId,
        name: pendingOfferRef.current?.fromUsername || null,
        direction: directionRef.current,
        missed: phaseRef.current === "incoming" || phaseRef.current === "outgoing",
      });
    }
    pendingOfferRef.current = null;
    pendingIceRef.current = [];
    pendingLocalIceRef.current = [];
    trickleReadyRef.current = false;
    acceptingRef.current = false;
    applyingAnswerRef.current = false;
    callKeyRef.current = null;
    if (chatId != null) pendingIceByChatRef.current.delete(String(chatId));
    chatIdRef.current = null;
    startedAtRef.current = null;
    if (pcRef.current) {
      try { pcRef.current.close(); } catch (_) { /* ignore */ }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch (_) { /* ignore */ }
      });
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setPhaseNow("idle");
    setRemoteName("");
    setRemoteChatId(null);
    setMicOn(true);
    setCameraOn(false);
    setRemoteVideoOn(false);
    setMediaProtection("dtls");
    closingRef.current = false;
  }, [rememberRecent, setPhaseNow]);

  const armConnectTimer = useCallback(() => {
    if (connectTimerRef.current) window.clearTimeout(connectTimerRef.current);
    connectTimerRef.current = window.setTimeout(() => {
      if (phaseRef.current !== "connecting") return;
      callLog("ICE timed out", pcRef.current?.iceConnectionState, pcRef.current?.connectionState);
      setMediaError("start");
      const chatId = chatIdRef.current;
      if (chatId) publish({ chatId, type: "hangup" });
      cleanup();
    }, CONNECT_TIMEOUT_MS);
  }, [cleanup, publish]);

  const markConnected = useCallback((pc) => {
    if (closingRef.current || pcRef.current !== pc) return;
    if (phaseRef.current === "active") return;
    if (connectTimerRef.current) {
      window.clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    startedAtRef.current = Date.now();
    setPhaseNow("active");
    playMedia(remoteAudioRef.current);
    playMedia(remoteVideoRef.current);
  }, [setPhaseNow]);

  const createPc = useCallback((chatId, asCaller) => {
    const RTCPeerConnectionImpl = globalThis.RTCPeerConnection;
    if (typeof RTCPeerConnectionImpl !== "function") {
      throw new Error("WebRTC is not available in this browser");
    }
    if (pcRef.current) {
      const previous = pcRef.current;
      pcRef.current = null;
      try { previous.close(); } catch (_) { /* ignore */ }
    }
    trickleReadyRef.current = false;
    pendingLocalIceRef.current = [];
    const pc = new RTCPeerConnectionImpl({
      iceServers: ICE_SERVERS,
      encodedInsertableStreams: true,
    });
    if (asCaller) {
      pc.addTransceiver("audio", { direction: "sendrecv" });
      pc.addTransceiver("video", { direction: "sendrecv" });
    }
    pc.onicecandidate = (event) => {
      if (!event?.candidate) return;
      const candidate = icePayload(event.candidate);
      if (!candidate) return;
      const payload = { chatId, type: "ice", candidate };
      if (!trickleReadyRef.current) {
        pendingLocalIceRef.current.push(payload);
        return;
      }
      publish(payload);
    };
    pc.onicecandidateerror = (event) => {
      callLog("ice candidate error", event?.errorCode, event?.errorText, event?.url);
    };
    pc.ontrack = (event) => {
      if (callKeyRef.current) void protectReceiver(event.receiver, callKeyRef.current);
      const stream = remoteStreamRef.current || new MediaStream();
      if (event.track && !stream.getTracks().some((track) => track.id === event.track.id)) {
        stream.addTrack(event.track);
      }
      const refreshVideo = () => {
        bindRemoteStream(stream);
        if (event.track?.kind === "video" && event.track.readyState === "live" && event.track.enabled !== false) {
          setRemoteVideoOn(true);
        }
      };
      event.track.onmute = () => {
        if (event.track.kind === "video") bindRemoteStream(stream);
      };
      event.track.onunmute = refreshVideo;
      event.track.onended = () => {
        if (event.track.kind === "video" && !stream.getVideoTracks().some((track) => track.readyState === "live")) {
          setRemoteVideoOn(false);
        }
      };
      refreshVideo();
    };
    pc.onconnectionstatechange = () => {
      if (closingRef.current || pcRef.current !== pc) return;
      callLog("connectionState", pc.connectionState, "ice", pc.iceConnectionState);
      if (pc.connectionState === "connected") markConnected(pc);
      if (pc.connectionState === "failed" && (phaseRef.current === "active" || phaseRef.current === "connecting")) {
        publish({ chatId, type: "hangup" });
        cleanup();
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (closingRef.current || pcRef.current !== pc) return;
      const ice = pc.iceConnectionState;
      callLog("iceConnectionState", ice);
      if (ice === "connected" || ice === "completed") markConnected(pc);
      if (ice === "failed" && (phaseRef.current === "active" || phaseRef.current === "connecting")) {
        publish({ chatId, type: "hangup" });
        cleanup();
      }
    };
    pcRef.current = pc;
    if (callKeyRef.current) void protectPeerConnection(pc, callKeyRef.current).then((ok) => {
      if (ok) setMediaProtection("e2ee");
    });
    return pc;
  }, [bindRemoteStream, cleanup, markConnected, publish]);

  const attachLocalAudio = useCallback(async (pc) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStreamRef.current = stream;
    const audioTrack = stream.getAudioTracks()[0];
    const audio = transceiverOf(pc, "audio");
    if (audio) await audio.sender.replaceTrack(audioTrack);
    else pc.addTrack(audioTrack, stream);
    setMicOn(true);
    playMedia(remoteAudioRef.current);
  }, []);

  const enableCamera = useCallback(async (pc = pcRef.current) => {
    if (!pc) return;
    const existing = localStreamRef.current?.getVideoTracks()[0];
    const attach = async (videoTrack) => {
      const video = transceiverOf(pc, "video");
      if (video) {
        try { video.direction = "sendrecv"; } catch (_) { /* Safari may keep current direction */ }
        await video.sender.replaceTrack(videoTrack);
      } else {
        pc.addTrack(videoTrack, localStreamRef.current);
      }
    };
    if (existing && existing.readyState === "live") {
      existing.enabled = true;
      await attach(existing);
      setCameraOn(true);
      bindLocalPreview();
      publish({ chatId: chatIdRef.current, type: "media", video: true });
      return;
    }
    const cam = await navigator.mediaDevices.getUserMedia({ audio: false, video: VIDEO_CONSTRAINTS });
    const videoTrack = cam.getVideoTracks()[0];
    if (!localStreamRef.current) localStreamRef.current = new MediaStream();
    localStreamRef.current.addTrack(videoTrack);
    await attach(videoTrack);
    setCameraOn(true);
    bindLocalPreview();
    publish({ chatId: chatIdRef.current, type: "media", video: true });
  }, [bindLocalPreview, publish]);

  const startCall = useCallback(async (chat, { video = false } = {}) => {
    if (!enabledRef.current || !chat || chat.type !== "direct") return;
    if (phaseRef.current !== "idle" && phaseRef.current !== "error") return;
    const chatId = Number(chat.id);
    if (!Number.isFinite(chatId)) return;
    setMediaError(null);
    directionRef.current = "out";
    chatIdRef.current = chatId;
    setRemoteName(chat.name || chat.username || "");
    setRemoteChatId(chatId);
    setPhaseNow("outgoing");
    playMedia(remoteAudioRef.current);
    try {
      const pc = createPc(chatId, true);
      await attachLocalAudio(pc);
      if (video) await enableCamera(pc);
      let mediaKeys = [];
      try {
        if (supportsMediaE2ee() && getE2ee()?.buildFanoutRequest) {
          const rawKey = generateCallKey();
          mediaKeys = await encryptCallKeyForChat(chatId, rawKey);
          callKeyRef.current = rawKey;
          const protectedOk = await protectPeerConnection(pc, rawKey);
          if (!protectedOk || mediaKeys.length === 0) {
            throw new Error("call-e2ee-unavailable");
          }
          setMediaProtection("e2ee");
        } else {
          setMediaProtection("dtls");
        }
      } catch (error) {
        callLog("media e2ee key wrap failed", error);
        setMediaError("e2ee");
        if (pcRef.current) {
          try { pcRef.current.close(); } catch (_) { /* ignore */ }
          pcRef.current = null;
        }
        setPhaseNow("error");
        return;
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      const sdp = pc.localDescription?.sdp || offer.sdp;
      const payload = { chatId, type: "offer", sdp, video: Boolean(video) };
      if (mediaKeys.length) payload.mediaKeys = mediaKeys;
      const sent = publish(payload);
      flushLocalIce();
      if (sent === false) {
        setMediaError("offline");
        setPhaseNow("error");
      }
    } catch (error) {
      console.warn("[call] start failed", error);
      setMediaError(error?.name === "NotAllowedError" ? "mic" : "start");
      if (pcRef.current) {
        try { pcRef.current.close(); } catch (_) { /* ignore */ }
        pcRef.current = null;
      }
      setPhaseNow("error");
    }
  }, [attachLocalAudio, createPc, enableCamera, flushLocalIce, publish, setPhaseNow]);

  const acceptCall = useCallback(async () => {
    if (acceptingRef.current || phaseRef.current !== "incoming") return;
    const offer = pendingOfferRef.current;
    if (!offer) return;
    acceptingRef.current = true;
    pendingOfferRef.current = null;
    const chatId = Number(offer.chatId);
    chatIdRef.current = chatId;
    setMediaError(null);
    setPhaseNow("connecting");
    playMedia(remoteAudioRef.current);
    try {
      if (supportsMediaE2ee()) {
        if (!Array.isArray(offer.mediaKeys) || offer.mediaKeys.length === 0) {
          throw new Error("call-e2ee-unavailable");
        }
        const rawKey = await decryptCallKeyEnvelope(offer.mediaKeys);
        if (!rawKey) {
          throw new Error("call-e2ee-unavailable");
        }
        callKeyRef.current = rawKey;
      }
      const pc = createPc(chatId, false);
      await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
      await attachLocalAudio(pc);
      for (const candidate of pendingIceRef.current) {
        await addIceCandidateSafe(pc, candidate);
      }
      pendingIceRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);
      if (pcRef.current !== pc || closingRef.current) return;
      const sdp = pc.localDescription?.sdp || answer.sdp;
      publish({ chatId, type: "answer", sdp });
      flushLocalIce();
      armConnectTimer();
    } catch (error) {
      console.warn("[call] accept failed", error);
      setMediaError(error?.name === "NotAllowedError"
        ? "mic"
        : error?.message === "call-e2ee-unavailable" ? "e2ee" : "start");
      publish({ chatId, type: "hangup" });
      cleanup();
      setPhaseNow("error");
    }
  }, [armConnectTimer, attachLocalAudio, cleanup, createPc, flushLocalIce, publish, setPhaseNow]);

  const declineCall = useCallback(() => {
    const chatId = pendingOfferRef.current?.chatId ?? chatIdRef.current;
    if (chatId) publish({ chatId, type: "busy" });
    cleanup();
  }, [cleanup, publish]);

  const hangup = useCallback(() => {
    const chatId = chatIdRef.current;
    if (chatId && phaseRef.current !== "idle" && phaseRef.current !== "error") {
      publish({ chatId, type: "hangup" });
    }
    cleanup();
  }, [cleanup, publish]);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, []);

  const toggleCamera = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || phaseRef.current === "idle" || phaseRef.current === "incoming" || phaseRef.current === "error") return;
    try {
      if (cameraOn) {
        const video = transceiverOf(pc, "video");
        if (video) await video.sender.replaceTrack(null);
        localStreamRef.current?.getVideoTracks().forEach((track) => {
          track.stop();
          localStreamRef.current.removeTrack(track);
        });
        setCameraOn(false);
        bindLocalPreview();
        publish({ chatId: chatIdRef.current, type: "media", video: false });
        return;
      }
      await enableCamera(pc);
    } catch (error) {
      console.warn("[call] camera failed", error);
      setMediaError("camera");
    }
  }, [bindLocalPreview, cameraOn, enableCamera, publish]);

  const handleSignal = useCallback((event) => {
    if (!enabledRef.current || !event) return;
    const ownDid = ownDeviceIdRef.current;
    if (event.fromDeviceId && event.fromDeviceId === ownDid) return;

    const type = String(event.type || "").toLowerCase();
    if (!SIGNAL_TYPES.has(type)) return;

    const myUsername = meRef.current?.username;
    if (type === "offer" && event.fromUsername && event.fromUsername === myUsername) return;

    if (type === "offer") {
      if (phaseRef.current !== "idle" && phaseRef.current !== "error") {
        publish({ chatId: event.chatId, type: "busy" });
        return;
      }
      pendingOfferRef.current = event;
      pendingIceRef.current = takePendingIce(event.chatId);
      directionRef.current = "in";
      chatIdRef.current = Number(event.chatId);
      setRemoteName(event.fromUsername || "");
      setRemoteChatId(event.chatId);
      if (event.video) setRemoteVideoOn(true);
      setPhaseNow("incoming");
      return;
    }

    if (type === "answer") {
      if (!pcRef.current) return;
      if (phaseRef.current !== "outgoing" && phaseRef.current !== "connecting") return;
      if (Number(event.chatId) !== Number(chatIdRef.current)) return;
      if (applyingAnswerRef.current || pcRef.current.remoteDescription) {
        callLog("ignore duplicate answer");
        return;
      }
      applyingAnswerRef.current = true;
      setPhaseNow("connecting");
      armConnectTimer();
      void pcRef.current.setRemoteDescription({ type: "answer", sdp: event.sdp }).then(async () => {
        for (const candidate of pendingIceRef.current) {
          await addIceCandidateSafe(pcRef.current, candidate);
        }
        pendingIceRef.current = [];
        playMedia(remoteAudioRef.current);
      }).catch((error) => {
        applyingAnswerRef.current = false;
        console.warn("[call] answer failed", error);
        setMediaError("start");
      });
      return;
    }

    if (type === "ice") {
      const candidate = iceInit(event.candidate);
      if (!candidate || event.chatId == null) return;
      const sameCall = Number(event.chatId) === Number(chatIdRef.current);
      if (sameCall && pcRef.current?.remoteDescription) {
        void addIceCandidateSafe(pcRef.current, candidate);
        return;
      }
      if (sameCall) {
        pendingIceRef.current.push(candidate);
        return;
      }
      bufferIce(event.chatId, candidate);
      return;
    }

    if (type === "media") {
      if (Number(event.chatId) !== Number(chatIdRef.current)) return;
      setRemoteVideoOn(Boolean(event.video));
      if (event.video) {
        const stream = remoteStreamRef.current;
        if (stream) bindRemoteStream(stream);
        playMedia(remoteVideoRef.current);
      }
      return;
    }

    if (type === "hangup" || type === "busy") {
      if (Number(event.chatId) === Number(chatIdRef.current) && phaseRef.current !== "idle") {
        cleanup();
      }
    }
  }, [armConnectTimer, bindRemoteStream, bufferIce, cleanup, publish, setPhaseNow, takePendingIce]);

  useEffect(() => {
    if (!incoming) return;
    handleSignal(incoming);
  }, [handleSignal, incoming]);

  useEffect(() => () => {
    if (phaseRef.current !== "idle" && phaseRef.current !== "error") {
      const chatId = chatIdRef.current;
      if (chatId) publish({ chatId, type: "hangup" });
    }
    cleanup();
  }, [cleanup, publish]);

  return {
    phase,
    remoteName,
    remoteChatId,
    micOn,
    cameraOn,
    remoteVideoOn,
    mediaError,
    mediaProtection,
    recents,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    handleSignal,
    startCall,
    acceptCall,
    declineCall,
    hangup,
    toggleMic,
    toggleCamera,
  };
}
