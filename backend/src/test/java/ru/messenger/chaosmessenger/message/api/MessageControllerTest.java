package ru.messenger.chaosmessenger.message.api;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.core.Authentication;
import ru.messenger.chaosmessenger.crypto.device.CurrentDeviceService;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.crypto.dto.EncryptedEditMessageRequestV2;
import ru.messenger.chaosmessenger.crypto.dto.EncryptedMessageEnvelopeInput;
import ru.messenger.chaosmessenger.crypto.dto.EncryptedSendMessageRequestV2;
import ru.messenger.chaosmessenger.infra.ws.WebSocketAuthChannelInterceptor;
import ru.messenger.chaosmessenger.message.dto.DeviceMessageEventResponse;
import ru.messenger.chaosmessenger.message.dto.MessageTimelineItemResponse;
import ru.messenger.chaosmessenger.message.dto.TypingEvent;
import ru.messenger.chaosmessenger.message.dto.TypingRequest;
import ru.messenger.chaosmessenger.message.dto.UpdateMessageStatusRequest;
import ru.messenger.chaosmessenger.message.service.MessageService;
import ru.messenger.chaosmessenger.message.service.MessageService.ReactionEvent;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MessageControllerTest {

    @Mock MessageService messageService;
    @Mock CurrentDeviceService currentDeviceService;
    @Mock Authentication authentication;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock WebSocketAuthChannelInterceptor authInterceptor;

    @InjectMocks MessageController messageController;
    @InjectMocks ChatMessageController chatMessageController;
    @InjectMocks TypingController typingController;

    @Test
    void sendEncryptedMessageRequiresCurrentDeviceAndDelegatesToService() {
        EncryptedSendMessageRequestV2 request = sendRequest();

        DeviceMessageEventResponse expected = eventResponse("MESSAGE_CREATED");

        when(authentication.getName()).thenReturn("alice");
        when(currentDeviceService.requireCurrentDevice()).thenReturn(new UserDevice());
        when(messageService.sendEncryptedMessageV2("alice", request)).thenReturn(expected);

        DeviceMessageEventResponse response = messageController.sendEncryptedMessage(request, authentication);

        assertThat(response).isSameAs(expected);
        verify(currentDeviceService).requireCurrentDevice();
        verify(messageService).sendEncryptedMessageV2("alice", request);
    }

    @Test
    void getChatTimelineRequiresCurrentDeviceAndDelegatesToService() {
        MessageTimelineItemResponse item = new MessageTimelineItemResponse(
                1L,
                100L,
                1L,
                "dev-a",
                "client-1",
                1,
                false,
                LocalDateTime.now(),
                null,
                "SENT",
                null,
                Map.of(),
                Set.of()
        );

        when(authentication.getName()).thenReturn("alice");
        when(currentDeviceService.requireCurrentDevice()).thenReturn(new UserDevice());
        when(messageService.getChatTimeline("alice", 100L, 50L, 25)).thenReturn(List.of(item));

        List<MessageTimelineItemResponse> response =
                messageController.getChatTimeline(100L, 50L, 25, authentication);

        assertThat(response).containsExactly(item);
        verify(currentDeviceService).requireCurrentDevice();
        verify(messageService).getChatTimeline("alice", 100L, 50L, 25);
    }

    @Test
    void markChatReadRequiresCurrentDeviceAndDelegatesToService() {
        when(authentication.getName()).thenReturn("alice");
        when(currentDeviceService.requireCurrentDevice()).thenReturn(new UserDevice());

        messageController.markChatRead(100L, authentication);

        verify(currentDeviceService).requireCurrentDevice();
        verify(messageService).markChatAsRead("alice", 100L);
    }

    @Test
    void markChatDeliveredRequiresCurrentDeviceAndDelegatesToService() {
        when(authentication.getName()).thenReturn("alice");
        when(currentDeviceService.requireCurrentDevice()).thenReturn(new UserDevice());

        messageController.markChatDelivered(100L, authentication);

        verify(currentDeviceService).requireCurrentDevice();
        verify(messageService).markChatAsDelivered("alice", 100L);
    }

    @Test
    void updateStatusRequiresCurrentDeviceAndDelegatesToService() {
        UpdateMessageStatusRequest request = new UpdateMessageStatusRequest();
        request.setMessageId(500L);
        request.setStatus("READ");

        when(authentication.getName()).thenReturn("alice");
        when(currentDeviceService.requireCurrentDevice()).thenReturn(new UserDevice());

        messageController.updateStatus(request, authentication);

        verify(currentDeviceService).requireCurrentDevice();
        verify(messageService).updateMessageStatus("alice", 500L, "READ");
    }

    @Test
    void editEncryptedMessageRequiresCurrentDeviceAndDelegatesToService() {
        EncryptedEditMessageRequestV2 request = editRequest();
        DeviceMessageEventResponse expected = eventResponse("MESSAGE_EDITED");

        when(authentication.getName()).thenReturn("alice");
        when(currentDeviceService.requireCurrentDevice()).thenReturn(new UserDevice());
        when(messageService.editEncryptedMessageV2("alice", 500L, request)).thenReturn(expected);

        DeviceMessageEventResponse response = messageController.editMessage(500L, request, authentication);

        assertThat(response).isSameAs(expected);
        verify(currentDeviceService).requireCurrentDevice();
        verify(messageService).editEncryptedMessageV2("alice", 500L, request);
    }

    @Test
    void toggleReactionRequiresCurrentDeviceAndDelegatesToService() {
        MessageController.ReactionRequest request = new MessageController.ReactionRequest();
        request.setEmoji("👍");

        ReactionEvent expected = new ReactionEvent(
                "REACTION_UPDATED",
                500L,
                100L,
                1L,
                "dev-a",
                "👍",
                true,
                Map.of("👍", 1L),
                123L
        );

        when(authentication.getName()).thenReturn("alice");
        when(currentDeviceService.requireCurrentDevice()).thenReturn(new UserDevice());
        when(messageService.toggleReaction("alice", 500L, "👍")).thenReturn(expected);

        ReactionEvent response = messageController.toggleReaction(500L, request, authentication);

        assertThat(response).isSameAs(expected);
        verify(currentDeviceService).requireCurrentDevice();
        verify(messageService).toggleReaction("alice", 500L, "👍");
    }

    @Test
    void deleteMessageRequiresCurrentDeviceAndReturnsSuccess() {
        when(authentication.getName()).thenReturn("alice");
        when(currentDeviceService.requireCurrentDevice()).thenReturn(new UserDevice());

        Map<String, Object> response = messageController.deleteMessage(500L, authentication);

        assertThat(response).containsEntry("success", true);
        verify(currentDeviceService).requireCurrentDevice();
        verify(messageService).deleteMessage("alice", 500L);
    }

    @Test
    void websocketChatMessageSendsEventWhenSessionIsAuthenticated() {
        ChatMessageController.ChatMessageRequest request = new ChatMessageController.ChatMessageRequest();
        request.setChatId(100L);
        request.setContent("hello");

        when(authInterceptor.getUsernameBySessionId("session-1")).thenReturn("alice");

        chatMessageController.sendMessage(request, "session-1");

        ArgumentCaptor<ChatMessageController.ChatMessageEvent> captor =
                ArgumentCaptor.forClass(ChatMessageController.ChatMessageEvent.class);

        verify(messagingTemplate).convertAndSend(eq("/topic/chat/100"), captor.capture());

        assertThat(captor.getValue().getChatId()).isEqualTo(100L);
        assertThat(captor.getValue().getSenderUsername()).isEqualTo("alice");
        assertThat(captor.getValue().getContent()).isEqualTo("hello");
        assertThat(captor.getValue().getTimestamp()).isPositive();
    }

    @Test
    void websocketChatMessageDoesNotSendWhenSessionHasNoUsername() {
        ChatMessageController.ChatMessageRequest request = new ChatMessageController.ChatMessageRequest();
        request.setChatId(100L);
        request.setContent("hello");

        when(authInterceptor.getUsernameBySessionId("session-1")).thenReturn(null);

        chatMessageController.sendMessage(request, "session-1");

        verify(messagingTemplate, never()).convertAndSend(
                eq("/topic/chat/100"),
                org.mockito.ArgumentMatchers.any(ChatMessageController.ChatMessageEvent.class)
        );
    }

    @Test
    void typingSendsEventWhenSessionIsAuthenticated() {
        TypingRequest request = new TypingRequest();
        request.setChatId(100L);
        request.setTyping(true);

        when(authInterceptor.getUsernameBySessionId("session-1")).thenReturn("alice");

        typingController.typing(request, "session-1");

        ArgumentCaptor<TypingEvent> captor = ArgumentCaptor.forClass(TypingEvent.class);

        verify(messagingTemplate).convertAndSend(eq("/topic/chats/100/typing"), captor.capture());

        assertThat(captor.getValue().getUsername()).isEqualTo("alice");
        assertThat(captor.getValue().isTyping()).isTrue();
    }

    @Test
    void typingDoesNotSendWhenSessionHasNoUsername() {
        TypingRequest request = new TypingRequest();
        request.setChatId(100L);
        request.setTyping(true);

        when(authInterceptor.getUsernameBySessionId("session-1")).thenReturn(null);

        typingController.typing(request, "session-1");

        verify(messagingTemplate, never()).convertAndSend(
                eq("/topic/chats/100/typing"),
                org.mockito.ArgumentMatchers.any(TypingEvent.class)
        );
    }

    private static EncryptedSendMessageRequestV2 sendRequest() {
        EncryptedSendMessageRequestV2 request = new EncryptedSendMessageRequestV2();
        request.setChatId(100L);
        request.setClientMessageId("client-1");
        request.setSenderDeviceId("dev-a");
        request.setEnvelopes(List.of(envelope()));
        return request;
    }

    private static EncryptedEditMessageRequestV2 editRequest() {
        EncryptedEditMessageRequestV2 request = new EncryptedEditMessageRequestV2();
        request.setSenderDeviceId("dev-a");
        request.setEnvelopes(List.of(envelope()));
        return request;
    }

    private static EncryptedMessageEnvelopeInput envelope() {
        EncryptedMessageEnvelopeInput envelope = new EncryptedMessageEnvelopeInput();
        envelope.setTargetDeviceId("dev-b");
        envelope.setTargetUserId(2L);
        envelope.setMessageType("WHISPER");
        envelope.setSenderIdentityPublicKey("identity");
        envelope.setCiphertext("ciphertext");
        envelope.setNonce("nonce");
        envelope.setTimestamp(123L);
        envelope.setMessageIndex(1);
        return envelope;
    }

    private static DeviceMessageEventResponse eventResponse(String type) {
        return new DeviceMessageEventResponse(
                type,
                500L,
                100L,
                1L,
                "dev-a",
                "client-1",
                1,
                LocalDateTime.now(),
                null,
                null,
                "SENT",
                null,
                Map.of(),
                Set.of()
        );
    }
}