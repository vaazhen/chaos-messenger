import { useMemo, useRef, useState, useEffect } from "react";
import VoiceMessage from "./VoiceMessage";
import EmojiPicker, { EMOJI_CATEGORIES, loadRecentEmojis, saveRecentEmojis, MAX_RECENT_EMOJIS } from "./EmojiPicker";
import AttachmentMenu from "./AttachmentMenu";
import VoiceRecorder from "./VoiceRecorder";
import TtlPicker from "./TtlPicker";
import { MicIcon, SendIcon, EmojiIcon, AttachIcon, CloseIcon, ReplyIcon, VideoIcon, LockIcon } from "./Icons";
import SendMediaModal from "./SendMediaModal";

const MAX_VOICE_MS = 60_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export default function MessageInput({
  onSend,
  replyTo,
  onОтменаОтветить,
  disabled,
  onTyping,
  pendingFirstMessageOnly = false,
  muteInlineNotice = null,
  messagePlaceholder = "Сообщение...",
  replyPreviewTitle = "Ответить",
}) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiClosing, setEmojiClosing] = useState(false);
  const [emojiCat, setEmojiCat] = useState("recent");
  const [recentEmojis, setRecentEmojis] = useState(() => loadRecentEmojis());
  const [imgFile, setImgFile] = useState(null);
  const [generalFile, setGeneralFile] = useState(null);
  const [ttl, setTtl] = useState(null);
  const [showTtl, setShowTtl] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [voiceFile, setVoiceFile] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordingLocked, setRecordingLocked] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [voiceLevels, setVoiceLevels] = useState(() => Array(48).fill(0.18));
  const [voiceError, setVoiceError] = useState("");
  const [recordMode, setRecordMode] = useState("voice");
  const [slidingCancel, setSlidingCancel] = useState(false);
  const inpRef = useRef(null);
  const fileRef = useRef(null);
  const generalFileRef = useRef(null);
  const ttlRef = useRef(null);
  const attachMenuRef = useRef(null);
  const inputBarRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const recordingStartedAtRef = useRef(0);
  const recordingTimerRef = useRef(null);
  const recordingStartYRef = useRef(0);
  const recordingStartXRef = useRef(0);
  const autoSendVoiceRef = useRef(false);
  const discardVoiceRef = useRef(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const analyserFrameRef = useRef(null);
  const recordingPausedRef = useRef(false);
  const speechRef = useRef(null);
  const videoPreviewRef = useRef(null);
  const recordModeRef = useRef("voice");
  const transcriptRef = useRef("");
  const pauseStartedAtRef = useRef(0);
  const pausedTotalMsRef = useRef(0);
  const recordingLockedRef = useRef(false);
  const slidingCancelRef = useRef(false);
  const lockArmedRef = useRef(false);
  const [lockArmed, setLockArmed] = useState(false);
  const holdTimerRef = useRef(null);
  const ignoreClickRef = useRef(false);
  const pointerActiveRef = useRef(false);
  
  const sendingRef = useRef(false);
  const emojiRootRef = useRef(null);
const typingTimerRef = useRef(null);

  const emojiCategories = useMemo(() => {
    const recentCategory = {
      ...EMOJI_CATEGORIES[0],
      emojis: recentEmojis,
    };
    return [recentCategory, ...EMOJI_CATEGORIES.slice(1)];
  }, [recentEmojis]);

  const currentCategory = emojiCategories.find(c => c.key === emojiCat) || emojiCategories[1] || emojiCategories[0];
  const currentEmojis = currentCategory?.emojis?.length ? currentCategory.emojis : (emojiCat === "recent" ? EMOJI_CATEGORIES[1].emojis : []);

  const closeEmoji = () => {
    if (!showEmoji || emojiClosing) return;

    setEmojiClosing(true);

    window.setTimeout(() => {
      setShowEmoji(false);
      setEmojiClosing(false);
    }, 150);
  };

  const toggleEmoji = (e) => {
    e.stopPropagation();

    if (showEmoji) {
      closeEmoji();
      return;
    }

    setEmojiClosing(false);
    setShowEmoji(true);
  };

  const groupMuteLocksInput = Boolean(muteInlineNotice) && !recording;

  useEffect(() => {
    if (!muteInlineNotice) return;
    setShowEmoji(false);
    setEmojiClosing(false);
  }, [muteInlineNotice]);

  useEffect(() => {
    if (!showEmoji) return;

    const onDown = (e) => {
      const root = inputBarRef.current;

      if (root && !root.contains(e.target)) {
        closeEmoji();
      }
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        closeEmoji();
      }
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showEmoji, emojiClosing]);

  const handleTextChange = (e) => {
    setText(e.target.value);
    if (onTyping) {
      if (typingTimerRef.current) return;
      onTyping();
      typingTimerRef.current = setTimeout(() => { typingTimerRef.current = null; }, 2000);
    }
  };

  const handleSend = async (overrideVoiceFile = null, overrideVideoNote = null) => {
    const nextVoiceFile = overrideVoiceFile || voiceFile;
    const nextVideoNote = overrideVideoNote;
    if (!text.trim() && !imgFile && !nextVoiceFile && !nextVideoNote && !generalFile) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    setVoiceError("");
    try {
      await onSend({
        text: text.trim(),
        imgFile,
        voiceFile: nextVoiceFile,
        videoNoteFile: nextVideoNote,
        generalFile,
        ttl,
        replyTo,
      });
    } catch (err) {
      setVoiceError(formatSendError(err));
      return;
    } finally {
      sendingRef.current = false;
    }
    setText("");
    revokeImgPreview(imgFile);
    setImgFile(null);
    setGeneralFile(null);
    setVoiceFile(null);
    recordingLockedRef.current = false;
    setRecordingLocked(false);
    setVoiceError("");
    setShowEmoji(false);
    setEmojiClosing(false);
    inpRef.current?.focus();
  };

  const handleKey = e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const focusInput = () => {
    if (!disabled) inpRef.current?.focus();
  };

  const onFileChange = e => {
    const file = e.target.files[0]; if (!file) return;
    cancelVoice();
    if (String(file.type || "").startsWith("video/")) {
      revokeImgPreview(imgFile);
      setImgFile(null);
      setGeneralFile(file);
      e.target.value = "";
      return;
    }
    setGeneralFile(null);
    setImgFile((prev) => {
      revokeImgPreview(prev);
      return { src: URL.createObjectURL(file), file };
    });
    e.target.value = "";
  };

  const onGeneralFileChange = e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setVoiceError("File is too large (max 20MB)");
      e.target.value = "";
      return;
    }
    cancelVoice();
    revokeImgPreview(imgFile);
    setImgFile(null);
    setGeneralFile(file);
    e.target.value = "";
  };

  const clearPendingMedia = () => {
    revokeImgPreview(imgFile);
    setImgFile(null);
    setGeneralFile(null);
  };

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const cleanupRecordingStream = () => {
    mediaStreamRef.current?.getTracks?.().forEach(track => track.stop());
    mediaStreamRef.current = null;
  };

  const stopVoiceAnalyser = () => {
    if (analyserFrameRef.current) {
      cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    audioContextRef.current?.close?.().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;
  };

  const effectiveRecordingMs = () => {
    const pausedNow = pauseStartedAtRef.current ? Date.now() - pauseStartedAtRef.current : 0;
    return Math.max(0, Date.now() - recordingStartedAtRef.current - pausedTotalMsRef.current - pausedNow);
  };

  const startVoiceAnalyser = (stream) => {
    stopVoiceAnalyser();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        const current = analyserRef.current;
        if (!current) return;

        if (!recordingPausedRef.current) {
          current.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            const centered = (data[i] - 128) / 128;
            sum += centered * centered;
          }
          const rms = Math.sqrt(sum / data.length);
          const level = Math.min(1, Math.max(0.08, rms * 5));
          setVoiceLevels(prev => [...prev.slice(1), level]);
        }

        analyserFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch (_) {
      stopVoiceAnalyser();
    }
  };

  const stopRecording = (autoSend = false) => {
    autoSendVoiceRef.current = autoSend;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const setLocked = (value) => {
    recordingLockedRef.current = value;
    setRecordingLocked(value);
  };

  const setCancelSlide = (value) => {
    slidingCancelRef.current = value;
    setSlidingCancel(value);
  };

  const setLockNear = (value) => {
    lockArmedRef.current = value;
    setLockArmed(value);
  };

  const switchRecordMode = (mode) => {
    recordModeRef.current = mode;
    setRecordMode(mode);
  };

  const startSpeech = () => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof Ctor !== "function") return;
    try {
      const rec = new Ctor();
      rec.lang = (messagePlaceholder || "").includes("Сообщение") ? "ru-RU" : (navigator.language || "en-US");
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (event) => {
        let next = "";
        for (let i = 0; i < event.results.length; i += 1) {
          next += event.results[i][0]?.transcript || "";
        }
        transcriptRef.current = next.trim();
      };
      rec.start();
      speechRef.current = rec;
    } catch (_) {
      speechRef.current = null;
    }
  };

  const stopSpeech = () => {
    try { speechRef.current?.stop?.(); } catch (_) { /* ignore */ }
    speechRef.current = null;
    return transcriptRef.current;
  };

  const startRecording = async () => {
    if (disabled || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceError("Voice recording is not supported in this browser");
      return;
    }

    const mode = recordModeRef.current;
    try {
      setVoiceError("");
      clearPendingMedia();
      cancelVoice();
      transcriptRef.current = "";
      const stream = await navigator.mediaDevices.getUserMedia(
        mode === "video_note"
          ? { audio: true, video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } } }
          : { audio: true }
      );
      const mime = mode === "video_note" ? pickVideoNoteMimeType() : pickVoiceMimeType();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

      voiceChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      pauseStartedAtRef.current = 0;
      pausedTotalMsRef.current = 0;
      autoSendVoiceRef.current = false;
      setRecording(true);
      setLocked(false);
      setCancelSlide(false);
      setLockNear(false);
      recordingPausedRef.current = false;
      setRecordingPaused(false);
      setRecordingMs(0);
      setVoiceLevels(Array(48).fill(0.18));
      startVoiceAnalyser(stream);
      startSpeech();
      if (videoPreviewRef.current && mode === "video_note") {
        videoPreviewRef.current.srcObject = stream;
        void videoPreviewRef.current.play?.().catch(() => {});
      }

      recorder.ondataavailable = (event) => {
        if (event.data?.size) voiceChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stopRecordingTimer();
        cleanupRecordingStream();
        stopVoiceAnalyser();
        const spoken = stopSpeech();
        const shouldAutoSend = autoSendVoiceRef.current;
        const shouldDiscard = discardVoiceRef.current;
        autoSendVoiceRef.current = false;
        discardVoiceRef.current = false;
        setRecording(false);
        setLocked(false);
        setCancelSlide(false);
        setLockNear(false);
        recordingPausedRef.current = false;
        setRecordingPaused(false);

        const durationMs = Math.min(MAX_VOICE_MS, effectiveRecordingMs());
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || (mode === "video_note" ? "video/webm" : "audio/webm") });
        voiceChunksRef.current = [];

        if (shouldDiscard) return;
        if (durationMs < 400 || !blob.size) {
          setVoiceError(mode === "video_note" ? "Видео слишком короткое" : "Voice message is too short");
          return;
        }

        const file = {
          blob,
          mime: blob.type || (mode === "video_note" ? "video/webm" : "audio/webm"),
          size: blob.size,
          durationMs,
          previewUrl: URL.createObjectURL(blob),
          name: mode === "video_note" ? "video-note.webm" : "voice-message.webm",
          transcript: spoken,
        };

        if (shouldAutoSend) {
          if (mode === "video_note") handleSend(null, file);
          else handleSend(file);
          window.setTimeout(() => URL.revokeObjectURL(file.previewUrl), 1000);
          return;
        }

        if (mode === "video_note") {
          handleSend(null, file);
          return;
        }
        setVoiceFile(prev => {
          if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
          return file;
        });
      };

      if (mode === "video_note") recorder.start();
      else recorder.start(250);
      recordingTimerRef.current = setInterval(() => {
        const elapsed = effectiveRecordingMs();
        setRecordingMs(Math.min(MAX_VOICE_MS, elapsed));
        if (elapsed >= MAX_VOICE_MS) stopRecording(true);
      }, 200);
    } catch (e) {
      cleanupRecordingStream();
      stopVoiceAnalyser();
      stopSpeech();
      setRecording(false);
      recordingPausedRef.current = false;
      setRecordingPaused(false);
      setVoiceError(e?.message || "Could not access microphone");
    }
  };

  const cancelVoice = () => {
    if (voiceFile?.previewUrl) URL.revokeObjectURL(voiceFile.previewUrl);
    setVoiceFile(null);
    setVoiceError("");
  };
  useEffect(() => {
    if (!pendingFirstMessageOnly) return;
    if (recording) cancelRecording();
    if (imgFile) {
      revokeImgPreview(imgFile);
      setImgFile(null);
    }
    if (voiceFile?.previewUrl) URL.revokeObjectURL(voiceFile.previewUrl);
    if (voiceFile) setVoiceFile(null);
  }, [pendingFirstMessageOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelRecording = () => {
    autoSendVoiceRef.current = false;
    discardVoiceRef.current = true;
    voiceChunksRef.current = [];
    setLocked(false);
    setCancelSlide(false);
    setLockNear(false);
    stopSpeech();
    stopRecordingTimer();
    cleanupRecordingStream();
    stopVoiceAnalyser();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      setRecording(false);
      recordingPausedRef.current = false;
      setRecordingPaused(false);
    }
  };

  const toggleRecordingPause = (e) => {
    e?.stopPropagation?.();
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    if (recordingPausedRef.current) {
      if (typeof recorder.resume === "function" && recorder.state === "paused") {
        recorder.resume();
      }
      if (pauseStartedAtRef.current) {
        pausedTotalMsRef.current += Date.now() - pauseStartedAtRef.current;
      }
      pauseStartedAtRef.current = 0;
      recordingPausedRef.current = false;
      setRecordingPaused(false);
      return;
    }

    if (typeof recorder.pause === "function" && recorder.state === "recording") {
      recorder.pause();
    }
    pauseStartedAtRef.current = Date.now();
    recordingPausedRef.current = true;
    setRecordingPaused(true);
  };

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const pendingMediaKind = pendingFirstMessageOnly
    ? null
    : imgFile
      ? "image"
      : generalFile
        ? (String(generalFile.type || "").startsWith("video/")
          ? "video"
          : String(generalFile.type || "").startsWith("image/")
            ? "image"
            : "file")
        : null;
  const canQuickRecord = !pendingFirstMessageOnly && !text.trim() && !imgFile && !voiceFile && !generalFile;

  const onPrimaryPointerDown = (e) => {
    if (pendingFirstMessageOnly || disabled || !canQuickRecord || recording) return;
    pointerActiveRef.current = true;
    recordingStartYRef.current = e.clientY || e.touches?.[0]?.clientY || 0;
    recordingStartXRef.current = e.clientX || e.touches?.[0]?.clientX || 0;
    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      ignoreClickRef.current = true;
      startRecording();
    }, 400);
  };

  const onPrimaryPointerMove = (e) => {
    if (pendingFirstMessageOnly || !pointerActiveRef.current) return;
    if (!mediaRecorderRef.current || recordingLockedRef.current) return;
    const startY = recordingStartYRef.current;
    const startX = recordingStartXRef.current;
    const currentY = e.clientY || e.touches?.[0]?.clientY || startY;
    const currentX = e.clientX || e.touches?.[0]?.clientX || startX;
    const up = startY - currentY;
    const left = startX - currentX;
    setCancelSlide(left > 72);
    setLockNear(up > 28 && left < 48);
    if (up > 58 && left < 48) setLocked(true);
  };

  const onPrimaryPointerUp = (e) => {
    if (pendingFirstMessageOnly || !pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    const wasTap = Boolean(holdTimerRef.current);
    clearHoldTimer();
    if (wasTap && !mediaRecorderRef.current) {
      switchRecordMode(recordModeRef.current === "voice" ? "video_note" : "voice");
      ignoreClickRef.current = true;
      return;
    }
    if (!mediaRecorderRef.current) return;
    e.preventDefault();
    ignoreClickRef.current = true;
    if (slidingCancelRef.current) {
      cancelRecording();
      return;
    }
    if (!recordingLockedRef.current) stopRecording(true);
  };

  const onPrimaryPointerCancel = () => {
    pointerActiveRef.current = false;
    const wasTap = Boolean(holdTimerRef.current);
    clearHoldTimer();
    if (wasTap && !mediaRecorderRef.current) {
      switchRecordMode(recordModeRef.current === "voice" ? "video_note" : "voice");
      ignoreClickRef.current = true;
      return;
    }
    if (!mediaRecorderRef.current || recordingLockedRef.current) return;
    if (slidingCancelRef.current) return;
    setLocked(true);
  };

  const onPrimaryClick = (e) => {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    if (recording) {
      stopRecording(true);
      return;
    }
    if (canQuickRecord) {
      e.preventDefault();
      switchRecordMode(recordModeRef.current === "voice" ? "video_note" : "voice");
      return;
    }
    e.stopPropagation();
    handleSend();
  };

  const addRecentEmoji = (emoji) => {
    setRecentEmojis((prev) => {
      const next = [emoji, ...prev.filter((item) => item !== emoji)].slice(0, MAX_RECENT_EMOJIS);
      saveRecentEmojis(next);
      return next;
    });
  };

  const pickEmoji = (emoji) => {
    setText((prev) => prev + emoji);
    addRecentEmoji(emoji);
    if (emojiCat !== "recent" && !recentEmojis.length) {
      setEmojiCat("recent");
    }
    closeEmoji();
    inpRef.current?.focus();
  };

  useEffect(() => {
    if (!showAttachMenu) return;
    const closeAttachOutside = (event) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener("mousedown", closeAttachOutside, true);
    return () => document.removeEventListener("mousedown", closeAttachOutside, true);
  }, [showAttachMenu]);

  useEffect(() => {
    if (!showTtl) return;
    const closeTtlOutside = (event) => {
      if (ttlRef.current && !ttlRef.current.contains(event.target)) {
        setShowTtl(false);
      }
    };
    document.addEventListener("mousedown", closeTtlOutside, true);
    return () => document.removeEventListener("mousedown", closeTtlOutside, true);
  }, [showTtl]);

  // emoji-outside-close-pass
  useEffect(() => {
    if (!showEmoji) return;

    const closeEmojiOutside = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (emojiRootRef.current && !emojiRootRef.current.contains(target)) {
        setShowEmoji(false);
      }
    };

    document.addEventListener("mousedown", closeEmojiOutside, true);
    document.addEventListener("touchstart", closeEmojiOutside, true);

    return () => {
      document.removeEventListener("mousedown", closeEmojiOutside, true);
      document.removeEventListener("touchstart", closeEmojiOutside, true);
    };
  }, [showEmoji]);

  useEffect(() => {
    recordModeRef.current = recordMode;
  }, [recordMode]);

  useEffect(() => {
    if (!recording || recordMode !== "video_note") return;
    const el = videoPreviewRef.current;
    if (el && mediaStreamRef.current) {
      el.srcObject = mediaStreamRef.current;
      void el.play?.().catch(() => {});
    }
  }, [recording, recordMode]);

  useEffect(() => () => {
    stopRecordingTimer();
    cleanupRecordingStream();
    stopVoiceAnalyser();
    stopSpeech();
    if (voiceFile?.previewUrl) URL.revokeObjectURL(voiceFile.previewUrl);
  }, [voiceFile?.previewUrl]);

  useEffect(() => {
    const onGlobalType = (event) => {
      if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1 && event.key !== "Backspace") return;

      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      const isTypingTarget =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable;

      if (!isTypingTarget) {
        inpRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onGlobalType);
    return () => window.removeEventListener("keydown", onGlobalType);
  }, [disabled]);
return (
    <>
      {replyTo && !pendingMediaKind && (
        <div className="reply-prev" onClick={e => e.stopPropagation()}>
          <span className="reply-prev-icon"><ReplyIcon /></span>
          <div className="reply-prev-inner">
            <div className="reply-prev-name">{replyPreviewTitle}</div>
            <div className="reply-prev-txt">{replyPreview(replyTo)}</div>
          </div>
          <button className="icon-btn modal-close" onClick={onОтменаОтветить}><CloseIcon /></button>
        </div>
      )}

      {!pendingFirstMessageOnly && pendingMediaKind && (
        <SendMediaModal
          kind={pendingMediaKind}
          src={imgFile?.src || null}
          file={imgFile?.file || generalFile}
          caption={text}
          error={voiceError}
          onCaptionChange={setText}
          onSend={() => handleSend()}
          onClose={clearPendingMedia}
          l={(ru, en) => messagePlaceholder === "Сообщение..." ? ru : en}
        />
      )}

      {voiceError && !pendingMediaKind && (
        <div className="voice-error">{voiceError}</div>
      )}



      {!pendingMediaKind && !pendingFirstMessageOnly && voiceFile && (
        <div className="voice-preview-wrap" onClick={e => e.stopPropagation()}>
          <VoiceMessage
            variant="preview"
            src={voiceFile.previewUrl}
            durationMs={voiceFile.durationMs}
            onCancel={cancelVoice}
          />
          {voiceFile.transcript ? <div className="voice-transcript">{voiceFile.transcript}</div> : null}
        </div>
      )}

      {!pendingMediaKind && (
      <div ref={emojiRootRef} className="input-bar" onClick={e => e.stopPropagation()}>
        {recording && recordMode === "video_note" && (
          <div className="video-note-stage">
            <video ref={videoPreviewRef} autoPlay muted playsInline />
            <span className="video-note-stage-time">{formatRecTime(recordingMs)}</span>
          </div>
        )}
        {!groupMuteLocksInput && showEmoji && (
          <EmojiPicker
            emojiClosing={emojiClosing}
            emojiCategories={emojiCategories}
            emojiCat={emojiCat}
            setEmojiCat={setEmojiCat}
            currentEmojis={currentEmojis}
            recentEmojis={recentEmojis}
            setRecentEmojis={setRecentEmojis}
            onPick={pickEmoji}
            onClose={closeEmoji}
            saveRecentEmojis={saveRecentEmojis}
          />
        )}

        <div
          className={`inp-area${recording ? " recording-inline" : ""}${groupMuteLocksInput ? " inp-area--group-muted" : ""}`}
          onClick={recording ? e => e.stopPropagation() : focusInput}
        >
          {recording && (
            <VoiceRecorder
              recording={recording}
              recordingLocked={recordingLocked}
              recordingPaused={recordingPaused}
              recordingMs={recordingMs}
              voiceLevels={voiceLevels}
              mode={recordMode}
              slidingCancel={slidingCancel}
              onCancel={cancelRecording}
              onTogglePause={toggleRecordingPause}
            />
          )}

          {/* Attach button (inside input pill, left side) */}
          {!pendingFirstMessageOnly && !groupMuteLocksInput && !recording && (
            <div className="inp-btn-wrap" ref={attachMenuRef}>
              <button
                type="button"
                className="inp-icon-btn"
                onClick={(e) => { e.stopPropagation(); setShowAttachMenu(v => !v); }}
                title="Attach"
              >
                <AttachIcon />
              </button>
              <AttachmentMenu
                showAttachMenu={showAttachMenu}
                onClose={() => setShowAttachMenu(false)}
                onPhotoClick={() => fileRef.current?.click()}
                onDocClick={() => generalFileRef.current?.click()}
                l={(ru, en) => messagePlaceholder === "Сообщение..." ? ru : en}
              />
              <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden-inp" onChange={onFileChange} />
              <input ref={generalFileRef} type="file" className="hidden-inp" onChange={onGeneralFileChange} />
            </div>
          )}

          <div className={`msg-inp-wrap${muteInlineNotice && !recording ? " msg-inp-wrap--mute" : ""}`}>
            {muteInlineNotice && !recording && (
              <div className="group-mute-in-inp" role="status" aria-live="polite">
                <span className="group-mute-in-inp__text">{muteInlineNotice}</span>
              </div>
            )}
            <textarea
              ref={inpRef}
              className="msg-inp"
              rows={1}
              placeholder={muteInlineNotice && !recording ? "" : messagePlaceholder}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKey}
              disabled={disabled}
            />
          </div>

          {/* Emoji button (inside input pill, right side) */}
          {!groupMuteLocksInput && !recording && (
            <button type="button" className="inp-icon-btn" aria-label="Emoji" title="Emoji" onClick={toggleEmoji}>
              <EmojiIcon />
            </button>
          )}

          {/* Timer button (inside input pill, right side) */}
          {!groupMuteLocksInput && !pendingFirstMessageOnly && !recording && (
            <TtlPicker
              ttl={ttl}
              showTtl={showTtl}
              ttlRef={ttlRef}
              onToggle={() => setShowTtl(v => !v)}
              onSelect={(value) => { setTtl(value); setShowTtl(false); }}
            />
          )}
        </div>

        {!groupMuteLocksInput && (
          <div className="send-btn-wrap">
            {recording && !recordingLocked && (
              <div className={`record-lock-float${lockArmed ? " is-near" : ""}`} aria-hidden="true">
                <LockIcon />
              </div>
            )}
            <button
              type="button"
              className={`send-btn${canQuickRecord ? " voice-ready" : ""}${recording ? " recording" : ""}${recordingLocked ? " locked" : ""}${slidingCancel ? " cancel-armed" : ""}`}
              onClick={onPrimaryClick}
              onPointerDown={onPrimaryPointerDown}
              onPointerMove={onPrimaryPointerMove}
              onPointerUp={onPrimaryPointerUp}
              onPointerCancel={onPrimaryPointerCancel}
              disabled={disabled}
              title={
                recording
                  ? "Send voice"
                  : canQuickRecord
                    ? (recordMode === "video_note" ? "Нажми — голос, зажми — запись" : "Нажми — видео, зажми — запись")
                    : "Send"
              }
            >
              {recording ? <SendIcon /> : canQuickRecord ? (recordMode === "video_note" ? <VideoIcon /> : <MicIcon />) : <SendIcon />}
            </button>
          </div>
        )}
      </div>
      )}
    </>
  );
}

function formatRecTime(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function pickVoiceMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || "";
}

function pickVideoNoteMimeType() {
  const candidates = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || "";
}

function replyPreview(msg) {
  if (msg?._img) return "Photo";
  if (msg?._videoNote) return "Video message";
  if (msg?._voice) return msg._voice.transcript || "Voice message";
  if (msg?._attachment?.fileName) return msg._attachment.fileName;
  return msg?._text || "";
}

function formatSendError(err) {
  const status = Number(err?.status);
  const raw = String(err?.message || "");
  if (raw.startsWith("UNVERIFIED_DEVICE:")) {
    return "У собеседника появилось новое устройство. Сначала проверьте Safety Number.";
  }
  if (raw.startsWith("IDENTITY_KEY_CHANGED:")) {
    return "Ключ устройства изменился. Проверьте Safety Number, прежде чем писать.";
  }
  if (raw.startsWith("IDENTITY_BLOCKED:")) {
    return "Это устройство заблокировано.";
  }
  if (raw.startsWith("ONE_TIME_PREKEY_EXHAUSTED:")) {
    return "У собеседника закончились одноразовые ключи. Попросите открыть приложение и попробуйте снова.";
  }
  if (status === 409 || /\b409\b/.test(raw) || /conflict/i.test(raw) || /конфликт/i.test(raw)) {
    if (/device id/i.test(raw)) return "Это устройство уже привязано к другому аккаунту. Выйди и зайди заново.";
    if (/one message|until request/i.test(raw)) return "Пока запрос не принят, можно отправить только одно сообщение.";
    if (/integrity/i.test(raw) || /не удалось загрузить файл/i.test(raw)) {
      return "Не удалось сохранить файл. Обнови страницу и попробуй ещё раз.";
    }
    return "Сервер отклонил отправку. Попробуй ещё раз.";
  }
  return raw || "Сообщение не отправилось";
}

function revokeImgPreview(value) {
  const src = value?.src;
  if (src && String(src).startsWith("blob:")) URL.revokeObjectURL(src);
}
