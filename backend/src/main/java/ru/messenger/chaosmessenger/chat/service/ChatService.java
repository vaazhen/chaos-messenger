package ru.messenger.chaosmessenger.chat.service;

import lombok.RequiredArgsConstructor;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.messenger.chaosmessenger.chat.domain.Chat;
import ru.messenger.chaosmessenger.chat.domain.ChatParticipant;
import ru.messenger.chaosmessenger.chat.domain.Message;
import ru.messenger.chaosmessenger.chat.dto.ChatResponse;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
import ru.messenger.chaosmessenger.chat.repository.ChatRepository;
import ru.messenger.chaosmessenger.common.TransactionUtils;
import ru.messenger.chaosmessenger.common.exception.ChatException;
import ru.messenger.chaosmessenger.infra.presence.OnlineService;
import ru.messenger.chaosmessenger.infra.presence.UnreadService;
import ru.messenger.chaosmessenger.message.repository.MessageRepository;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ChatService {

    private final ChatRepository            chatRepository;
    private final ChatParticipantRepository participantRepository;
    private final UserRepository            userRepository;
    private final MessageRepository         messageRepository;
    private final UnreadService             unreadService;
    private final OnlineService             onlineService;
    private final SimpMessagingTemplate     messagingTemplate;
    private final MessageSource             messageSource;

    /** Resolve the localised name for the Saved Messages chat. */
    private String savedChatName() {
        return messageSource.getMessage("chat.saved.name", null, "Saved Messages", LocaleContextHolder.getLocale());
    }

    @Transactional
    public Long createDirectChat(String currentUsername, Long targetUserId) {
        User currentUser = userRepository.findByUsername(currentUsername)
                .orElseThrow(() -> new ChatException("Current user not found"));
        User targetUser  = userRepository.findById(targetUserId)
                .orElseThrow(() -> new ChatException("Target user not found"));

        if (currentUser.getId().equals(targetUser.getId())) {
            throw new ChatException("You cannot create a chat with yourself");
        }

        Optional<Long> existing = participantRepository.findDirectChatId(currentUser.getId(), targetUser.getId());
        if (existing.isPresent()) {
            Long chatId = existing.get();
            notifyChatListUpdated(currentUser.getUsername(), chatId, "chat_exists");
            notifyChatListUpdated(targetUser.getUsername(),  chatId, "chat_exists");
            return chatId;
        }

        Chat chat = new Chat();
        chat.setType("DIRECT");
        chat.setCreatedAt(LocalDateTime.now());
        chat = chatRepository.save(chat);

        participantRepository.save(new ChatParticipant(chat.getId(), currentUser.getId()));
        participantRepository.save(new ChatParticipant(chat.getId(), targetUser.getId()));

        final Long   chatId     = chat.getId();
        final String currentUsr = currentUser.getUsername();
        final String targetUsr  = targetUser.getUsername();
        TransactionUtils.afterCommit(() -> {
            notifyChatListUpdated(currentUsr, chatId, "chat_created");
            notifyChatListUpdated(targetUsr,  chatId, "chat_created");
        });

        return chatId;
    }

    @Transactional
    public Long createOrGetDirectChatByUsername(String currentUsername, String targetUsername) {
        User targetUser = userRepository.findByUsername(targetUsername)
                .orElseThrow(() -> new RuntimeException("Target user not found"));
        return createDirectChat(currentUsername, targetUser.getId());
    }

    @Transactional
    public Long createOrGetSavedMessagesChat(String currentUsername) {
        User user = userRepository.findByUsername(currentUsername)
                .orElseThrow(() -> new ChatException("Current user not found"));

        Optional<Long> existing = participantRepository.findSavedChatId(user.getId());
        if (existing.isPresent()) {
            Long   chatId   = existing.get();
            String username = user.getUsername();
            TransactionUtils.afterCommit(() -> notifyChatListUpdated(username, chatId, "saved_chat_exists"));
            return chatId;
        }

        Chat chat = new Chat();
        chat.setType("SAVED");
        chat.setName("SAVED");   // internal marker — display name comes from i18n
        chat.setCreatedAt(LocalDateTime.now());
        chat = chatRepository.save(chat);

        participantRepository.save(new ChatParticipant(chat.getId(), user.getId()));

        Long   chatId   = chat.getId();
        String username = user.getUsername();
        TransactionUtils.afterCommit(() -> notifyChatListUpdated(username, chatId, "saved_chat_created"));

        return chatId;
    }

    @Transactional
    public Long createGroupChat(String currentUsername, String name, List<Long> memberIds) {
        if (name == null || name.isBlank())           throw new ChatException("Group name is required");
        if (memberIds == null || memberIds.isEmpty()) throw new ChatException("Group must have at least one other member");

        User creator = userRepository.findByUsername(currentUsername)
                .orElseThrow(() -> new ChatException("Current user not found"));
        List<User> members = userRepository.findAllById(memberIds);
        if (members.size() != memberIds.size()) throw new ChatException("One or more member users not found");

        Chat chat = new Chat();
        chat.setType("GROUP");
        chat.setName(name.trim());
        chat.setCreatedAt(LocalDateTime.now());
        chat = chatRepository.save(chat);

        participantRepository.save(new ChatParticipant(chat.getId(), creator.getId()));
        for (User member : members) {
            if (!member.getId().equals(creator.getId())) {
                participantRepository.save(new ChatParticipant(chat.getId(), member.getId()));
            }
        }

        final Long         chatId      = chat.getId();
        final List<String> notifyUsers = new ArrayList<>();
        notifyUsers.add(creator.getUsername());
        members.forEach(m -> notifyUsers.add(m.getUsername()));
        TransactionUtils.afterCommit(() -> notifyUsers.forEach(u -> notifyChatListUpdated(u, chatId, "chat_created")));

        return chatId;
    }

    @Transactional(readOnly = true)
    public List<ChatResponse> getMyChats(String username) {
        User currentUser = userRepository.findByUsername(username)
                .orElseThrow(() -> new ChatException("User not found"));

        List<ChatParticipant> participations = participantRepository.findByUserId(currentUser.getId());
        if (participations.isEmpty()) return List.of();

        List<Long> chatIds = participations.stream()
                .map(ChatParticipant::getChatId)
                .collect(Collectors.toList());

        List<Chat> chats = chatRepository.findByIdIn(chatIds);

        List<ChatParticipant> allParticipants   = participantRepository.findByChatIdIn(chatIds);
        Map<Long, List<ChatParticipant>> byChat = allParticipants.stream()
                .collect(Collectors.groupingBy(ChatParticipant::getChatId));

        Set<Long> otherUserIds = allParticipants.stream()
                .map(ChatParticipant::getUserId)
                .filter(id -> !id.equals(currentUser.getId()))
                .collect(Collectors.toSet());

        Map<Long, User> usersById = userRepository.findAllById(otherUserIds).stream()
                .collect(Collectors.toMap(User::getId, u -> u));

        Map<Long, Message> lastMessagesByChatId = messageRepository.findLatestByChatIds(chatIds).stream()
                .collect(Collectors.toMap(Message::getChatId, m -> m,
                        (left, right) -> left.getCreatedAt().isAfter(right.getCreatedAt()) ? left : right));

        final String savedName = savedChatName();

        return chats.stream().map(chat -> {
            List<ChatParticipant> participants = byChat.getOrDefault(chat.getId(), List.of());
            Optional<Message>     lastMsg      = Optional.ofNullable(lastMessagesByChatId.get(chat.getId()));

            String        lastContent   = lastMsg.map(Message::getContent).orElse(null);
            Long          lastMessageId = lastMsg.map(Message::getId).orElse(null);
            LocalDateTime lastAt        = lastMsg.map(Message::getCreatedAt).orElse(null);
            Long          lastSenderId  = lastMsg.map(Message::getSenderId).orElse(null);
            long          unread        = unreadService.get(currentUser.getId(), chat.getId());
            boolean       isSaved       = "SAVED".equals(chat.getType());
            boolean       isGroup       = "GROUP".equals(chat.getType());

            if (isSaved) {
                return new ChatResponse(
                        chat.getId(), chat.getType(), savedName,
                        lastContent, lastMessageId, lastAt, lastSenderId,
                        participants.stream().map(ChatParticipant::getUserId).toList(),
                        null, null, null, null, null,
                        unread, false, null
                );
            }

            if (isGroup) {
                return new ChatResponse(
                        chat.getId(), chat.getType(), chat.getName(),
                        lastContent, lastMessageId, lastAt, lastSenderId,
                        participants.stream().map(ChatParticipant::getUserId).toList(),
                        null, null, null, null, null,
                        unread, false, null
                );
            }

            ChatParticipant otherP    = participants.stream()
                    .filter(p -> !p.getUserId().equals(currentUser.getId()))
                    .findFirst().orElse(null);
            User    otherUser = otherP != null ? usersById.get(otherP.getUserId()) : null;
            boolean online    = otherUser != null && onlineService.isOnline(otherUser.getUsername());
            LocalDateTime lastSeen = otherUser != null ? onlineService.getLastSeen(otherUser.getUsername()) : null;

            return new ChatResponse(
                    chat.getId(), chat.getType(), null,
                    lastContent, lastMessageId, lastAt, lastSenderId,
                    participants.stream().map(ChatParticipant::getUserId).toList(),
                    otherUser != null ? otherUser.getId()        : null,
                    otherUser != null ? otherUser.getUsername()  : null,
                    otherUser != null ? otherUser.getFirstName() : null,
                    otherUser != null ? otherUser.getLastName()  : null,
                    otherUser != null ? otherUser.getAvatarUrl() : null,
                    unread, online, lastSeen
            );
        })
        .sorted((a, b) -> {
            LocalDateTime aTime = a.getLastMessageAt();
            LocalDateTime bTime = b.getLastMessageAt();
            if (aTime == null && bTime == null) return Long.compare(
                    b.getChatId() == null ? 0L : b.getChatId(),
                    a.getChatId() == null ? 0L : a.getChatId());
            if (aTime == null) return  1;
            if (bTime == null) return -1;
            int byTime = bTime.compareTo(aTime);
            if (byTime != 0) return byTime;
            return Long.compare(
                    b.getChatId() == null ? 0L : b.getChatId(),
                    a.getChatId() == null ? 0L : a.getChatId());
        })
        .collect(Collectors.toList());
    }

    // ── private ───────────────────────────────────────────────────────────────

    private void notifyChatListUpdated(String username, Long chatId, String reason) {
        messagingTemplate.convertAndSend("/topic/users/" + username + "/chats", Map.of(
                "chatId",    chatId,
                "reason",    reason,
                "timestamp", System.currentTimeMillis()
        ));
    }
}