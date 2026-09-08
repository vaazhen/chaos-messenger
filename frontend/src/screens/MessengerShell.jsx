import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import useNowTicker from "../hooks/useNowTicker";
import useTheme from "../hooks/useTheme";
import useSidebarResize from "../hooks/useSidebarResize";
import { useSafetyNumberModal } from "../hooks/useSafetyNumberModal";
import { useMessengerRealtime } from "../hooks/useMessengerRealtime";
import { getActiveGroupMuteUntilMs, formatMuteCountdown } from "../groupMute";

import ChatList from "../components/ChatList";
import ProfileModal from "../components/ProfileModal";
import NewChatModal from "../components/NewChatModal";
import SafetyNumberModal from "../components/SafetyNumberModal";
import EditMessageModal from "../components/EditMessageModal";
import DeleteMessageModal from "../components/DeleteMessageModal";
import ContextMenu from "../components/ContextMenu";
import SettingsPage from "../components/SettingsPage";
import ChatView from "../components/ChatView";
import CallOverlay from "../components/CallOverlay";
import CallsPage from "../components/CallsPage";
import MediaViewer from "../components/MediaViewer";
import { api } from "../api";
import { CALLS_ENABLED } from "../config";
import { useCall } from "../hooks/useCall";

import { getTime, messageMatchesQuery } from "../helpers";
import { clearPreviewCacheForUser } from "../previewCache";
import { displayNameForChat } from "../contactAliases";
import { getChatUiPrefs, toggleArchived, toggleMuted } from "../chatUiPrefs";
import { collectMediaItems, indexOfMediaItem } from "../mediaItems";

export default function MessengerShell({
  auth,
  lang,
  t,
  l,
  switchLang,
  chatStore,
  msgStore,
}) {
  const [replyTo, setReplyTo] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [ctxClosing, setCtxClosing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatInitialTab, setNewChatInitialTab] = useState("direct");
  const [chatSearch, setChatSearch] = useState("");
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [scrollToMessageId, setScrollToMessageId] = useState(null);
  const [groupAdminOpen, setGroupAdminOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [aliasTick, setAliasTick] = useState(0);
  const [chatPrefsTick, setChatPrefsTick] = useState(0);
  const [chatBgs, setChatBgs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cm_chat_bgs") || "{}"); }
    catch { return {}; }
  });
  const [chatFilter, setChatFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("chats");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editText, setEditText] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);

  const ctxMenuRef = useRef(null);
  const chatSearchRef = useRef(null);
  const chatSearchBtnRef = useRef(null);
  const atBottomRef = useRef(true);

  const resetMessageSearch = useCallback(() => {
    setMessageSearch("");
    setMatchIndex(0);
    setScrollToMessageId(null);
    setChatSearchOpen(false);
  }, []);

  const openMedia = useCallback((msg, kind) => {
    const items = collectMediaItems(msgStore.msgs[chatStore.activeId] || []);
    const idx = indexOfMediaItem(items, msg?.id ?? msg?.messageId, kind);
    if (idx < 0) return;
    setViewerIndex(idx);
  }, [chatStore.activeId, msgStore.msgs]);

  const { theme, toggleTheme } = useTheme();
  const {
    sidebarWidth,
    sidebarCompact,
    sidebarDragging,
    sidebarDesktop,
    onSidebarResizePointerDown,
    onSidebarResizePointerMove,
    onSidebarResizePointerUp,
    onSidebarResizeLostCapture,
  } = useSidebarResize();

  const activeChat = chatStore.chats.find(c => c.id === chatStore.activeId);
  const activeMsgs = msgStore.msgs[chatStore.activeId] || [];
  const mediaItems = useMemo(() => collectMediaItems(activeMsgs), [activeMsgs]);
  const chatMuted = activeChat ? getChatUiPrefs(auth.me?.id).muted.has(String(activeChat.id)) : false;

  useEffect(() => {
    setViewerIndex(null);
  }, [chatStore.activeId]);

  useEffect(() => {
    if (viewerIndex == null) return;
    if (!mediaItems.length || viewerIndex >= mediaItems.length) setViewerIndex(null);
  }, [mediaItems, viewerIndex]);

  const aliasedChats = useMemo(() => {
    void aliasTick;
    const prefs = getChatUiPrefs(auth.me?.id);
    void chatPrefsTick;
    return chatStore.chats.map(c => ({
      ...c,
      name: displayNameForChat(c, auth.me?.id),
      muted: prefs.muted.has(String(c.id)),
      archived: prefs.archived.has(String(c.id)),
    }));
  }, [chatStore.chats, auth.me?.id, aliasTick, chatPrefsTick]);

  const activeChatName = useMemo(() => {
    if (!activeChat) return "";
    void aliasTick;
    return displayNameForChat(activeChat, auth.me?.id);
  }, [activeChat, auth.me?.id, aliasTick]);

  const { safetyModal, setSafetyModal, openSafetyNumber, verifySafetyDevice, blockSafetyDevice, closeSafetyNumber } =
    useSafetyNumberModal({ activeChat, meId: auth.me?.id, l });

  const myMutedUntilIso = useMemo(() => {
    if (activeChat?.type !== "group" || !auth.me?.id) return null;
    const me = activeChat.groupParticipants?.find((p) => String(p.userId) === String(auth.me.id));
    return me?.mutedUntil || null;
  }, [activeChat, auth.me?.id]);

  const groupMuteTickerNow = useNowTicker(Boolean(myMutedUntilIso));
  const myGroupMuteUntilMs = useMemo(
    () =>
      activeChat?.type === "group" && auth.me?.id
        ? getActiveGroupMuteUntilMs(activeChat.groupParticipants, auth.me.id)
        : null,
    [activeChat, auth.me?.id, groupMuteTickerNow]
  );
  const myGroupMuteCountdown = useMemo(
    () => formatMuteCountdown(myGroupMuteUntilMs, groupMuteTickerNow),
    [myGroupMuteUntilMs, groupMuteTickerNow]
  );

  const loadChats = chatStore.loadChats;
  useEffect(() => {
    if (!myMutedUntilIso || myGroupMuteUntilMs != null) return;
    const parsed = Date.parse(myMutedUntilIso);
    if (!Number.isFinite(parsed) || parsed > Date.now()) return;
    const uid = auth.me?.id;
    if (uid == null) return;
    loadChats(uid);
  }, [myMutedUntilIso, myGroupMuteUntilMs, auth.me?.id, loadChats]);

  const isPendingRequestChat = useMemo(() => {
    if (!activeChat || activeChat.type !== "direct") return false;
    return String(activeChat.directStatus || "").toUpperCase() === "PENDING";
  }, [activeChat]);
  const isRequesterInPendingChat = useMemo(() => {
    if (!isPendingRequestChat) return false;
    return String(activeChat?.directRequestedBy || "") === String(auth.me?.id || "");
  }, [isPendingRequestChat, activeChat?.directRequestedBy, auth.me?.id]);
  const requesterFirstMsgSent = useMemo(() => {
    if (!isRequesterInPendingChat) return false;
    return activeMsgs.some(m => m?._out && !m?._temp);
  }, [isRequesterInPendingChat, activeMsgs]);
  const requestChatIds = useMemo(
    () => new Set((chatStore.requests || []).map(c => String(c.id))),
    [chatStore.requests]
  );
  const wsChatIds = useMemo(
    () => Array.from(new Set([...(chatStore.chats || []), ...(chatStore.requests || [])].map(c => c.id))),
    [chatStore.chats, chatStore.requests]
  );

  const matchIds = useMemo(() => {
    const q = String(messageSearch || "").trim();
    if (!q) return [];
    return activeMsgs
      .filter(m => messageMatchesQuery(m, q))
      .map(m => (m.id ?? m.messageId))
      .filter(Boolean);
  }, [activeMsgs, messageSearch]);

  useEffect(() => {
    setMatchIndex(0);
    setScrollToMessageId(null);
  }, [messageSearch]);

  useEffect(() => {
    resetMessageSearch();
  }, [chatStore.activeId, resetMessageSearch]);

  useEffect(() => {
    setGroupAdminOpen(false);
  }, [chatStore.activeId]);

  useEffect(() => {
    if (!groupAdminOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setGroupAdminOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groupAdminOpen]);

  const activeMatchId = matchIds.length ? matchIds[Math.max(0, Math.min(matchIndex, matchIds.length - 1))] : null;

  const goToMatch = (delta) => {
    if (!matchIds.length) return;
    const next = (matchIndex + delta + matchIds.length) % matchIds.length;
    setMatchIndex(next);
    setScrollToMessageId(matchIds[next]);
  };

  useEffect(() => {
    const isInside = (ref, target) => Boolean(ref.current && ref.current.contains(target));

    const closeExternalPopovers = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (ctxMenuRef.current && !ctxMenuRef.current.contains(target)) {
        setCtx(null);
      }

      const insideSearch =
        isInside(chatSearchRef, target) ||
        isInside(chatSearchBtnRef, target);

      if (chatSearchOpen && !insideSearch) {
        resetMessageSearch();
      }
    };

    document.addEventListener("mousedown", closeExternalPopovers, true);
    document.addEventListener("touchstart", closeExternalPopovers, true);

    return () => {
      document.removeEventListener("mousedown", closeExternalPopovers, true);
      document.removeEventListener("touchstart", closeExternalPopovers, true);
    };
  }, [ctx, chatSearchOpen, resetMessageSearch]);

  useEffect(() => {
    localStorage.setItem("cm_chat_bgs", JSON.stringify(chatBgs));
  }, [chatBgs]);

  useEffect(() => {
    atBottomRef.current = false;
  }, [chatStore.activeId]);

  useEffect(() => {
    if (chatStore.activeId) {
      msgStore.loadMessages(chatStore.activeId);
    }
  }, [chatStore.activeId]); // eslint-disable-line

  const markActiveChatRead = useCallback((chatId) => {
    const id = chatId ?? chatStore.activeId;
    if (!id) return;
    atBottomRef.current = true;
    chatStore.resetUnread(id);
    api.markRead(id).catch(() => {});
    api.markDelivered(id).catch(() => {});
  }, [chatStore]);

  const callHandlerRef = useRef(null);

  const { typingUsers, sendTyping, sendCall } = useMessengerRealtime({
    me: auth.me,
    enabled: auth.screen === "app",
    chatStore,
    msgStore,
    requestChatIds,
    wsChatIds,
    atBottomRef,
    onCallSignal: (event) => callHandlerRef.current?.(event),
  });

  const call = useCall({
    enabled: CALLS_ENABLED && auth.screen === "app",
    me: auth.me,
    sendSignal: sendCall,
  });
  callHandlerRef.current = call.handleSignal;

  const callTitle = useMemo(() => {
    const chatId = call.remoteChatId;
    if (chatId == null) return call.remoteName || "";
    const chat = [...(chatStore.chats || []), ...(chatStore.requests || [])]
      .find((item) => Number(item.id) === Number(chatId));
    if (!chat) return call.remoteName || "";
    return displayNameForChat(chat, auth.me?.id) || call.remoteName || "";
  }, [auth.me?.id, call.remoteChatId, call.remoteName, chatStore.chats, chatStore.requests]);

  const callPeer = useMemo(() => {
    if (call.remoteChatId == null) return null;
    return aliasedChats.find((item) => Number(item.id) === Number(call.remoteChatId))
      || (chatStore.requests || []).find((item) => Number(item.id) === Number(call.remoteChatId))
      || null;
  }, [aliasedChats, call.remoteChatId, chatStore.requests]);

  const unreadTotal = useMemo(
    () => aliasedChats.filter((c) => c.unread > 0).length,
    [aliasedChats]
  );
  const myName = [auth.me?.firstName, auth.me?.lastName].filter(Boolean).join(" ") || auth.me?.username || l("Я", "Me");

  const logout = async () => {
    clearPreviewCacheForUser(auth.me?.id);
    await auth.logout();
    chatStore.setChats([]);
    chatStore.setActiveId(null);
    msgStore.setMsgs({});
    setShowSettings(false);
  };

  const sendMsg = async ({ text, imgFile, voiceFile, videoNoteFile, generalFile, ttl, replyTo }) => {
    if ((!String(text || "").trim() && !imgFile && !voiceFile && !videoNoteFile && !generalFile) || !chatStore.activeId) return;
    const preview = generalFile
      ? (String(text || "").trim() ? `📎 ${String(text).trim()}` : `📎 ${generalFile.name}`)
      : imgFile
        ? (String(text || "").trim() ? `📷 ${String(text).trim()}` : "📷 Фото")
        : videoNoteFile
          ? (String(text || "").trim() ? `🎥 ${String(text).trim()}` : "Video message")
        : voiceFile
          ? (String(text || "").trim() || voiceFile.transcript
            ? `Voice: ${String(text || voiceFile.transcript).trim()}`
            : "Voice message")
        : String(text).trim();
    const result = await msgStore.sendMessage(chatStore.activeId, { text, imgFile, voiceFile, videoNoteFile, generalFile, ttl, replyTo });
    if (!result) {
      chatStore.loadChats(auth.me?.id);
      throw new Error("Сообщение не отправилось");
    }
    chatStore.updateChatPreview(chatStore.activeId, preview, true, getTime());
    setReplyTo(null);
  };

  const closeCtx = () => {
    if (!ctx || ctxClosing) return;
    setCtxClosing(true);
    window.setTimeout(() => {
      setCtx(null);
      setCtxClosing(false);
    }, 140);
  };

  useEffect(() => {
    const onWindowClick = () => closeCtx();
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeCtx();
    };
    window.addEventListener("click", onWindowClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", onWindowClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [ctx, ctxClosing]);

  const openCtx = (e, msg) => {
    e.preventDefault(); e.stopPropagation();
    setCtxClosing(false);
    setCtx({
      x: Math.min(e.clientX, window.innerWidth  - 208),
      y: Math.min(e.clientY, window.innerHeight - 280),
      msg,
    });
  };

  const reactToMsg = (msg, emoji) => {
    setCtx(null);
    if (!chatStore.activeId || !msg?.id || msg._temp) return;
    if (typeof msgStore.toggleReaction === "function") {
      msgStore.toggleReaction(chatStore.activeId, msg, emoji);
    }
  };

  const beginEdit = (msg) => {
    setCtx(null);
    setEditTarget(msg);
    setEditText(msg?._text || "");
  };

  const submitEdit = async () => {
    const text = editText.trim();
    if (!text || !editTarget || !chatStore.activeId) return;
    setEditLoading(true);
    try {
      const result = await msgStore.editMessage(chatStore.activeId, editTarget, text);
      if (result) {
        const last = activeMsgs[activeMsgs.length - 1];
        if (String(last?.id) === String(editTarget.id)) {
          chatStore.updateChatPreview(chatStore.activeId, result.preview || text, true, getTime());
        }
        setEditTarget(null);
        setEditText("");
      }
    } finally {
      setEditLoading(false);
    }
  };

  const beginDelete = (msg) => { setCtx(null); setDeleteTarget(msg); };

  const confirmDelete = (scope) => {
    if (!deleteTarget || !chatStore.activeId) return;
    msgStore.deleteMessage(chatStore.activeId, deleteTarget, scope);
    setDeleteTarget(null);
    if (scope === "everyone") {
      setTimeout(() => chatStore.loadChats(auth.me?.id), 250);
    }
  };

  const onChatCreated = async (chatId) => {
    setShowNewChat(false);
    msgStore.setMsgs(p => ({ ...p, [chatId]: undefined }));
    chatStore.revealChat(chatId);
    await chatStore.loadChats(auth.me?.id);
    chatStore.setActiveId(chatId);
  };

  const goBackToList = () => {
    chatStore.setActiveId(null);
    setReplyTo(null);
    setCtx(null);
    resetMessageSearch();
    setChatSearchOpen(false);
    setGroupAdminOpen(false);
  };

  const chatBg = chatBgs[String(chatStore.activeId)] || "clean";

  return (
    <div className={`app mobile-product-shell${activeChat ? " has-active-chat" : ""}`} onClick={closeCtx}>
      {activeTab === "settings" ? (
        <SettingsPage
          me={auth.me}
          theme={theme}
          lang={lang}
          l={l}
          onToggleTheme={toggleTheme}
          onSwitchLang={() => switchLang(lang === "ru" ? "en" : "ru")}
          onLogout={logout}
          onEditProfile={() => setShowSettings(true)}
          onOpenChat={onChatCreated}
          onNavChange={setActiveTab}
          unreadTotal={unreadTotal}
          callsEnabled={CALLS_ENABLED}
        />
      ) : activeTab === "calls" && CALLS_ENABLED ? (
        <CallsPage
          me={auth.me}
          myName={myName}
          l={l}
          chats={aliasedChats}
          recents={call.recents}
          unreadTotal={unreadTotal}
          onNavChange={setActiveTab}
          onStartCall={call.startCall}
          callsEnabled={CALLS_ENABLED}
        />
      ) : (
      <div
        className={`app-frame${sidebarDragging ? " app-frame--sidebar-dragging" : ""}`}
        style={
          sidebarDesktop
            ? { gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }
            : undefined
        }
      >
        <ChatList
          me={auth.me}
          chats={aliasedChats}
          requests={chatStore.requests.map(c => ({ ...c, name: displayNameForChat(c, auth.me?.id) }))}
          activeId={chatStore.activeId}
          loadingChats={chatStore.loadingChats}
          search={chatSearch}
          onSearch={setChatSearch}
          filter={chatFilter}
          onFilterChange={setChatFilter}
          onSelectChat={chatStore.selectChat}
          onNewChat={() => {
            if (auth.me?.id) chatStore.loadRequests(auth.me.id);
            setNewChatInitialTab("direct");
            setShowNewChat(true);
          }}
          onMarkAllRead={() => {
            chatStore.chats.forEach(c => {
              api.markRead(c.id).catch(() => {});
            });
            chatStore.setChats(prev => prev.map(c => ({ ...c, unread: 0 })));
          }}
          onDeleteChat={async (chatId) => {
            const ok = window.confirm(
              l("Удалить переписку только у себя?", "Delete this chat only for you?")
            );
            if (!ok) return;
            chatStore.deleteChatForMe(chatId);
            if (String(chatStore.activeId) === String(chatId)) {
              chatStore.setActiveId(null);
            }
          }}
          onDeleteChatEveryone={async (chatId) => {
            const ok = window.confirm(
              l("Удалить переписку у всех участников?", "Delete this chat for everyone?")
            );
            if (!ok) return;
            try {
              await api.deleteChatForEveryone(chatId);
              chatStore.deleteChatForMe(chatId);
              if (String(chatStore.activeId) === String(chatId)) {
                chatStore.setActiveId(null);
              }
            } catch (e) {
              window.alert(e.message || l("Ошибка", "Error"));
            }
          }}
          onToggleMuteChat={(chatId) => {
            toggleMuted(auth.me?.id, chatId);
            setChatPrefsTick(v => v + 1);
          }}
          onToggleArchiveChat={(chatId) => {
            const archived = toggleArchived(auth.me?.id, chatId);
            setChatPrefsTick(v => v + 1);
            if (archived && String(chatStore.activeId) === String(chatId)) {
              chatStore.setActiveId(null);
            }
          }}
          sidebarCompact={sidebarCompact}
          activeTab={activeTab}
          onNavChange={setActiveTab}
          callsEnabled={CALLS_ENABLED}
          sidebarResizeEnabled={sidebarDesktop}
          onSidebarResizePointerDown={onSidebarResizePointerDown}
          onSidebarResizePointerMove={onSidebarResizePointerMove}
          onSidebarResizePointerUp={onSidebarResizePointerUp}
          onSidebarResizePointerCancel={onSidebarResizePointerUp}
          onSidebarResizeLostCapture={onSidebarResizeLostCapture}
          l={l}
        />

        <ChatView
          chatBg={chatBg}
          activeChat={activeChat}
          activeChatName={activeChatName}
          l={l}
          t={t}
          goBackToList={goBackToList}
          setProfileOpen={setProfileOpen}
          setChatSearchOpen={setChatSearchOpen}
          groupAdminOpen={groupAdminOpen}
          setGroupAdminOpen={setGroupAdminOpen}
          openSafetyNumber={openSafetyNumber}
          chatSearchOpen={chatSearchOpen}
          chatSearchRef={chatSearchRef}
          messageSearch={messageSearch}
          setMessageSearch={setMessageSearch}
          matchIds={matchIds}
          matchIndex={matchIndex}
          goToMatch={goToMatch}
          resetMessageSearch={resetMessageSearch}
          setChatBgs={setChatBgs}
          me={auth.me}
          chatStore={chatStore}
          profileOpen={profileOpen}
          chatMuted={chatMuted}
          toggleMuted={(userId, chatId) => {
            toggleMuted(userId, chatId);
            setChatPrefsTick(v => v + 1);
          }}
          onAliasChange={() => setAliasTick(v => v + 1)}
          activeMsgs={activeMsgs}
          loadingMsgs={msgStore.loadingMsgs}
          openCtx={openCtx}
          reactToMsg={reactToMsg}
          typingUsername={typingUsers[chatStore.activeId] || null}
          activeMatchId={activeMatchId}
          scrollToMessageId={scrollToMessageId}
          unreadCount={Number(activeChat?.unread || 0)}
          onPinChange={(pinned) => { atBottomRef.current = pinned; }}
          onReachedBottom={() => markActiveChatRead(chatStore.activeId)}
          isRequesterInPendingChat={isRequesterInPendingChat}
          requesterFirstMsgSent={requesterFirstMsgSent}
          sendMsg={sendMsg}
          replyTo={replyTo}
          setReplyTo={setReplyTo}
          sendTyping={() => sendTyping(chatStore.activeId)}
          isPendingRequestChat={isPendingRequestChat}
          myGroupMuteUntilMs={myGroupMuteUntilMs}
          myGroupMuteCountdown={myGroupMuteCountdown}
          messagePlaceholder={t.message_placeholder}
          callsEnabled={CALLS_ENABLED}
          callPhase={call.phase}
          callChatId={call.remoteChatId}
          micError={Boolean(call.mediaError)}
          onStartCall={call.startCall}
          onHangup={call.hangup}
          onOpenMedia={openMedia}
        />
      </div>
      )}

      <ContextMenu
        ctx={ctx}
        ctxClosing={ctxClosing}
        ctxMenuRef={ctxMenuRef}
        onReact={reactToMsg}
        onReply={(msg) => { setReplyTo(msg); setCtx(null); }}
        onEdit={beginEdit}
        onCopy={(msg) => { navigator.clipboard?.writeText(msg._text || ""); setCtx(null); }}
        onDelete={beginDelete}
        l={l}
      />

      <EditMessageModal
        editTarget={editTarget}
        editText={editText}
        editLoading={editLoading}
        setEditText={setEditText}
        setEditTarget={setEditTarget}
        submitEdit={submitEdit}
        l={l}
      />

      <DeleteMessageModal
        deleteTarget={deleteTarget}
        setDeleteTarget={setDeleteTarget}
        confirmDelete={confirmDelete}
        l={l}
      />

      {showSettings && (
        <ProfileModal
          me={auth.me}
          lang={lang}
          onClose={() => setShowSettings(false)}
          onSaved={(u) => { auth.setMe(u); setShowSettings(false); chatStore.loadChats(u?.id || auth.me?.id); }}
        />
      )}

      {showNewChat && (
        <NewChatModal
          me={auth.me}
          l={l}
          onClose={() => setShowNewChat(false)}
          onCreated={onChatCreated}
          initialTab={newChatInitialTab}
          suggestedContacts={chatStore.chats.filter(c => c.type === "direct" && c.otherUserId).map(c => ({
            id: c.otherUserId,
            username: c.username,
            firstName: c.name,
            lastName: "",
            avatarUrl: c.avatarUrl,
          }))}
          requests={chatStore.requests.map(c => ({ ...c, name: displayNameForChat(c, auth.me?.id) }))}
          loadingRequests={chatStore.loadingRequests}
          onAcceptRequest={async (chatId) => {
            try { await api.acceptRequest(chatId); } catch (_) { /* ignore stale request state */ }
            await chatStore.loadRequests(auth.me?.id);
            await chatStore.loadChats(auth.me?.id);
            setShowNewChat(false);
            chatStore.selectChat(chatId);
          }}
          onDeclineRequest={async (chatId) => {
            try { await api.declineRequest(chatId); } catch (_) { /* ignore stale request state */ }
            chatStore.loadRequests(auth.me?.id);
            chatStore.loadChats(auth.me?.id);
          }}
        />
      )}

      <SafetyNumberModal
        safetyModal={safetyModal}
        onSelectDevice={(selectedDeviceId) => setSafetyModal(current => ({ ...current, selectedDeviceId }))}
        onVerify={verifySafetyDevice}
        onBlock={blockSafetyDevice}
        onClose={closeSafetyNumber}
        l={l}
      />

      <audio ref={call.remoteAudioRef} autoPlay style={{ display: "none" }} />
      <CallOverlay
        phase={call.phase}
        title={callTitle}
        avatarUrl={callPeer?.avatarUrl}
        colorIdx={callPeer?.colorIdx}
        micOn={call.micOn}
        cameraOn={call.cameraOn}
        remoteVideoOn={call.remoteVideoOn}
        mediaError={call.mediaError}
        mediaProtection={call.mediaProtection}
        localVideoRef={call.localVideoRef}
        remoteVideoRef={call.remoteVideoRef}
        onAccept={call.acceptCall}
        onDecline={call.declineCall}
        onHangup={call.hangup}
        onToggleMic={call.toggleMic}
        onToggleCamera={call.toggleCamera}
        l={l}
      />
      {viewerIndex != null && mediaItems[viewerIndex] && (
        <MediaViewer
          items={mediaItems}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
          l={l}
        />
      )}
    </div>
  );
}
