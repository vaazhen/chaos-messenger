package ru.messenger.chaosmessenger.message;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.chat.domain.Message;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
import ru.messenger.chaosmessenger.common.exception.MessageException;
import ru.messenger.chaosmessenger.crypto.device.CurrentDeviceService;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.crypto.device.UserDeviceRepository;
import ru.messenger.chaosmessenger.crypto.dto.EncryptedSendMessageRequestV2;
import ru.messenger.chaosmessenger.infra.presence.UnreadService;
import ru.messenger.chaosmessenger.message.dto.DeviceMessageEventResponse;
import ru.messenger.chaosmessenger.message.repository.MessageEnvelopeRepository;
import ru.messenger.chaosmessenger.message.repository.MessageEventRepository;
import ru.messenger.chaosmessenger.message.repository.MessageReactionRepository;
import ru.messenger.chaosmessenger.message.repository.MessageReceiptRepository;
import ru.messenger.chaosmessenger.message.repository.MessageRepository;
import ru.messenger.chaosmessenger.message.service.MessageService;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;
import ru.messenger.chaosmessenger.user.service.UserIdentityService;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("MessageService")
class MessageServiceTest {

    @Mock MessageRepository messageRepository;
    @Mock MessageEnvelopeRepository messageEnvelopeRepository;
    @Mock MessageEventRepository messageEventRepository;
    @Mock MessageReceiptRepository messageReceiptRepository;
    @Mock MessageReactionRepository messageReactionRepository;
    @Mock ChatParticipantRepository participantRepository;
    @Mock UserRepository userRepository;
    @Mock UserIdentityService userIdentityService;
    @Mock UserDeviceRepository userDeviceRepository;
    @Mock CurrentDeviceService currentDeviceService;
    @Mock UnreadService unreadService;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock ObjectMapper objectMapper;
    @Spy  MeterRegistry meterRegistry = new SimpleMeterRegistry();

    @InjectMocks MessageService messageService;

    User alice;
    User bob;
    UserDevice aliceDevice;

    @BeforeEach
    void setUp() {
        alice = TestFixtures.user(1L, "alice");
        bob = TestFixtures.user(2L, "bob");
        aliceDevice = TestFixtures.device(10L, 1L, "device-alice-1");
    }

    @Test
    @DisplayName("returns existing message for same clientMessageId retry")
    void returnsExistingMessageForSameClientMessageIdRetry() {
        Message existing = TestFixtures.sentMessage(100L, 5L, 1L, "device-alice-1");
        existing.setClientMessageId("client-100");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(aliceDevice);
        when(participantRepository.existsByChatIdAndUserId(5L, 1L)).thenReturn(true);
        when(messageRepository.findByClientMessageId("client-100")).thenReturn(Optional.of(existing));
        when(messageEnvelopeRepository.findByMessageIdAndTargetDeviceId(100L, "device-alice-1"))
                .thenReturn(Optional.empty());

        DeviceMessageEventResponse response = messageService.sendEncryptedMessageV2(
                "alice",
                sendRequest(5L, "client-100", "device-alice-1")
        );

        assertThat(response.getMessageId()).isEqualTo(100L);
        assertThat(response.getClientMessageId()).isEqualTo("client-100");
        verify(messageRepository, never()).save(any());
        verify(messageEnvelopeRepository, never()).save(any());
        verify(unreadService, never()).increment(anyLong(), anyLong());
    }

    @Test
    @DisplayName("rejects clientMessageId conflict")
    void rejectsClientMessageIdConflict() {
        Message existing = TestFixtures.sentMessage(100L, 6L, 2L, "device-bob-1");
        existing.setClientMessageId("client-100");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(aliceDevice);
        when(participantRepository.existsByChatIdAndUserId(5L, 1L)).thenReturn(true);
        when(messageRepository.findByClientMessageId("client-100")).thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> messageService.sendEncryptedMessageV2(
                "alice",
                sendRequest(5L, "client-100", "device-alice-1")
        ))
                .isInstanceOf(MessageException.class)
                .hasMessageContaining("clientMessageId");
    }

    @Test
    @DisplayName("markChatAsDelivered writes receipt")
    void markChatAsDeliveredWritesReceipt() {
        Message msg = TestFixtures.sentMessage(100L, 5L, 2L, "device-bob-1");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(aliceDevice);
        when(participantRepository.existsByChatIdAndUserId(5L, 1L)).thenReturn(true);
        when(messageRepository.findByChatIdAndSenderIdNot(5L, 1L)).thenReturn(List.of(msg));
        when(participantRepository.findByChatId(5L))
                .thenReturn(List.of(TestFixtures.participant(5L, 1L), TestFixtures.participant(5L, 2L)));

        messageService.markChatAsDelivered("alice", 5L);

        verify(messageReceiptRepository).upsertDelivered(
                eq(100L),
                eq(5L),
                eq(1L),
                eq("device-alice-1"),
                any(java.time.LocalDateTime.class)
        );
    }

    @Test
    @DisplayName("markChatAsRead writes read receipt and resets unread")
    void markChatAsReadWritesReceipt() {
        Message msg = TestFixtures.sentMessage(100L, 5L, 2L, "device-bob-1");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(aliceDevice);
        when(participantRepository.existsByChatIdAndUserId(5L, 1L)).thenReturn(true);
        when(messageRepository.findByChatIdAndSenderIdNot(5L, 1L)).thenReturn(List.of(msg));
        when(participantRepository.findByChatId(5L))
                .thenReturn(List.of(TestFixtures.participant(5L, 1L), TestFixtures.participant(5L, 2L)));

        messageService.markChatAsRead("alice", 5L);

        verify(unreadService).reset(1L, 5L);
        verify(messageReceiptRepository).upsertRead(
                eq(100L),
                eq(5L),
                eq(1L),
                eq("device-alice-1"),
                any(java.time.LocalDateTime.class)
        );
    }

    @Test
    @DisplayName("sender cannot update own message status")
    void senderCannotUpdateOwnStatus() {
        Message msg = TestFixtures.sentMessage(1L, 5L, 1L, "device-alice");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(aliceDevice);
        when(messageRepository.findById(1L)).thenReturn(Optional.of(msg));
        when(participantRepository.existsByChatIdAndUserId(5L, 1L)).thenReturn(true);

        messageService.updateMessageStatus("alice", 1L, "READ");

        verify(messageReceiptRepository, never()).save(any());
        verify(messageRepository, never()).save(any());
    }

    @Test
    @DisplayName("toggleReaction adds reaction")
    void toggleReactionAddsReaction() throws Exception {
        Message msg = TestFixtures.sentMessage(100L, 5L, 2L, "device-bob-1");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(aliceDevice);
        when(messageRepository.findById(100L)).thenReturn(Optional.of(msg));
        when(participantRepository.existsByChatIdAndUserId(5L, 1L)).thenReturn(true);
        when(objectMapper.writeValueAsString(any())).thenReturn("{}");

        MessageService.ReactionEvent event = messageService.toggleReaction("alice", 100L, "👍");

        assertThat(event.getType()).isEqualTo("MESSAGE_REACTION");
        assertThat(event.getEmoji()).isEqualTo("👍");
        assertThat(event.isActive()).isTrue();

        verify(messageReactionRepository).save(argThat(reaction ->
                reaction.getMessageId().equals(100L)
                        && reaction.getChatId().equals(5L)
                        && reaction.getUserId().equals(1L)
                        && reaction.getEmoji().equals("👍")
        ));
    }

    private static EncryptedSendMessageRequestV2 sendRequest(Long chatId, String clientMessageId, String senderDeviceId) {
        EncryptedSendMessageRequestV2 request = new EncryptedSendMessageRequestV2();
        request.setChatId(chatId);
        request.setClientMessageId(clientMessageId);
        request.setSenderDeviceId(senderDeviceId);
        return request;
    }
}