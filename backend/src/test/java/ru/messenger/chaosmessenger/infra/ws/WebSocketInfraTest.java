package ru.messenger.chaosmessenger.infra.ws;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.crypto.device.UserDeviceRepository;
import ru.messenger.chaosmessenger.infra.presence.OnlineService;
import ru.messenger.chaosmessenger.infra.presence.UserStatusEvent;
import ru.messenger.chaosmessenger.infra.security.JwtService;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.security.Principal;
import java.util.HashMap;
import java.util.Optional;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WebSocketInfraTest {

    private JwtService jwtService;
    private UserDeviceRepository userDeviceRepository;
    private UserRepository userRepository;
    private ChatParticipantRepository participantRepository;
    private MessageChannel channel;
    private WebSocketAuthChannelInterceptor interceptor;

    @BeforeEach
    void setUp() {
        jwtService = mock(JwtService.class);
        userDeviceRepository = mock(UserDeviceRepository.class);
        userRepository = mock(UserRepository.class);
        participantRepository = mock(ChatParticipantRepository.class);
        channel = mock(MessageChannel.class);

        interceptor = new WebSocketAuthChannelInterceptor(
                jwtService,
                userDeviceRepository,
                userRepository,
                participantRepository
        );
    }

    @Test
    void connectRejectsMissingBearerToken() {
        Message<byte[]> message = stomp(StompCommand.CONNECT, "s1", null, accessor ->
                accessor.setNativeHeader("X-Device-Id", "dev-a")
        );

        assertThat(interceptor.preSend(message, channel)).isNull();
    }

    @Test
    void connectRejectsMissingDeviceId() {
        Message<byte[]> message = stomp(StompCommand.CONNECT, "s1", null, accessor ->
                accessor.setNativeHeader("Authorization", "Bearer jwt-token")
        );

        assertThat(interceptor.preSend(message, channel)).isNull();
    }

    @Test
    void connectRejectsInvalidToken() {
        Message<byte[]> message = connectMessage("s1", "dev-a");

        when(jwtService.extractUsername("jwt-token")).thenReturn("alice");
        when(jwtService.isTokenValid("jwt-token", "alice")).thenReturn(false);

        assertThat(interceptor.preSend(message, channel)).isNull();
    }

    @Test
    void connectAcceptsValidTokenAndRegisteredActiveDevice() {
        UserDevice device = TestFixtures.device(10L, 1L, "dev-a");
        Message<byte[]> message = connectMessage("s1", "dev-a");

        when(jwtService.extractUsername("jwt-token")).thenReturn("alice");
        when(jwtService.isTokenValid("jwt-token", "alice")).thenReturn(true);
        when(userDeviceRepository.findByUserUsernameAndDeviceIdAndActiveTrue("alice", "dev-a"))
                .thenReturn(Optional.of(device));
        when(userDeviceRepository.save(device)).thenReturn(device);

        Message<?> result = interceptor.preSend(message, channel);

        assertThat(result).isNotNull();
        assertThat(interceptor.getUsernameBySessionId("s1")).isEqualTo("alice");
        assertThat(device.getLastSeen()).isNotNull();

        verify(userDeviceRepository).save(device);
    }

    @Test
    void subscribeRejectsAnonymousSession() {
        Message<byte[]> message = stomp(StompCommand.SUBSCRIBE, "s1", "/topic/user/status", accessor -> {});

        assertThat(interceptor.preSend(message, channel)).isNull();
    }

    @Test
    void subscribeAllowsOwnUserChatsTopicAfterConnect() {
        connectSession("s1", "alice", "dev-a");

        Message<byte[]> subscribe = stomp(StompCommand.SUBSCRIBE, "s1", "/topic/users/alice/chats", accessor -> {});

        assertThat(interceptor.preSend(subscribe, channel)).isNotNull();
    }

    @Test
    void subscribeRejectsAnotherUsersChatsTopic() {
        connectSession("s1", "alice", "dev-a");

        Message<byte[]> subscribe = stomp(StompCommand.SUBSCRIBE, "s1", "/topic/users/bob/chats", accessor -> {});

        assertThat(interceptor.preSend(subscribe, channel)).isNull();
    }

    @Test
    void subscribeAllowsOnlyCurrentDeviceTopic() {
        connectSession("s1", "alice", "dev-a");

        Message<byte[]> ownDevice = stomp(StompCommand.SUBSCRIBE, "s1", "/topic/devices/dev-a", accessor -> {});
        Message<byte[]> anotherDevice = stomp(StompCommand.SUBSCRIBE, "s1", "/topic/devices/dev-b", accessor -> {});

        assertThat(interceptor.preSend(ownDevice, channel)).isNotNull();
        assertThat(interceptor.preSend(anotherDevice, channel)).isNull();
    }

    @Test
    void subscribeAllowsTypingTopicOnlyForChatParticipant() {
        User alice = TestFixtures.user(1L, "alice");
        connectSession("s1", "alice", "dev-a");

        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
        when(participantRepository.existsByChatIdAndUserId(100L, 1L)).thenReturn(true);

        Message<byte[]> allowed = stomp(StompCommand.SUBSCRIBE, "s1", "/topic/chats/100/typing", accessor -> {});

        assertThat(interceptor.preSend(allowed, channel)).isNotNull();
    }

    @Test
    void subscribeRejectsTypingTopicWithInvalidChatId() {
        connectSession("s1", "alice", "dev-a");

        Message<byte[]> denied = stomp(StompCommand.SUBSCRIBE, "s1", "/topic/chats/not-number/typing", accessor -> {});

        assertThat(interceptor.preSend(denied, channel)).isNull();
    }

    @Test
    void subscribeAllowsGlobalUserStatusTopic() {
        connectSession("s1", "alice", "dev-a");

        Message<byte[]> subscribe = stomp(StompCommand.SUBSCRIBE, "s1", "/topic/user/status", accessor -> {});

        assertThat(interceptor.preSend(subscribe, channel)).isNotNull();
    }

    @Test
    void disconnectClearsSessionMaps() {
        connectSession("s1", "alice", "dev-a");

        Message<byte[]> disconnect = stomp(StompCommand.DISCONNECT, "s1", null, accessor -> {});

        assertThat(interceptor.preSend(disconnect, channel)).isNotNull();
        assertThat(interceptor.getUsernameBySessionId("s1")).isNull();
    }

    @Test
    void eventListenerPublishesOnlineStatusOnConnect() {
        OnlineService onlineService = mock(OnlineService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        WebSocketEventListener listener = new WebSocketEventListener(onlineService, messagingTemplate);

        Message<byte[]> message = stomp(StompCommand.CONNECT, "s1", null, accessor ->
                accessor.setUser(principal("alice"))
        );

        listener.handleConnect(new SessionConnectedEvent(this, message));

        verify(onlineService).setOnline("alice");
        verify(messagingTemplate).convertAndSend(
                eq("/topic/user/status"),
                org.mockito.ArgumentMatchers.any(UserStatusEvent.class)
        );
    }

    @Test
    void eventListenerIgnoresAnonymousConnect() {
        OnlineService onlineService = mock(OnlineService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        WebSocketEventListener listener = new WebSocketEventListener(onlineService, messagingTemplate);

        Message<byte[]> message = stomp(StompCommand.CONNECT, "s1", null, accessor -> {});

        listener.handleConnect(new SessionConnectedEvent(this, message));

        verify(onlineService, never()).setOnline("alice");
        verify(messagingTemplate, never()).convertAndSend(
                eq("/topic/user/status"),
                org.mockito.ArgumentMatchers.any(UserStatusEvent.class)
        );
    }

    @Test
    void eventListenerPublishesOfflineStatusOnDisconnect() {
        OnlineService onlineService = mock(OnlineService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        WebSocketEventListener listener = new WebSocketEventListener(onlineService, messagingTemplate);

        Message<byte[]> message = stomp(StompCommand.DISCONNECT, "s1", null, accessor ->
                accessor.setUser(principal("alice"))
        );

        listener.handleDisconnect(new SessionDisconnectEvent(this, message, "s1", CloseStatus.NORMAL));

        verify(onlineService).setOffline("alice");
        verify(messagingTemplate).convertAndSend(
                eq("/topic/user/status"),
                org.mockito.ArgumentMatchers.any(UserStatusEvent.class)
        );
    }

    private void connectSession(String sessionId, String username, String deviceId) {
        UserDevice device = TestFixtures.device(10L, 1L, deviceId);
        Message<byte[]> connect = connectMessage(sessionId, deviceId);

        when(jwtService.extractUsername("jwt-token")).thenReturn(username);
        when(jwtService.isTokenValid("jwt-token", username)).thenReturn(true);
        when(userDeviceRepository.findByUserUsernameAndDeviceIdAndActiveTrue(username, deviceId))
                .thenReturn(Optional.of(device));
        when(userDeviceRepository.save(device)).thenReturn(device);

        assertThat(interceptor.preSend(connect, channel)).isNotNull();
    }

    private static Message<byte[]> connectMessage(String sessionId, String deviceId) {
        return stomp(StompCommand.CONNECT, sessionId, null, accessor -> {
            accessor.setNativeHeader("Authorization", "Bearer jwt-token");
            accessor.setNativeHeader("X-Device-Id", deviceId);
        });
    }

    private static Message<byte[]> stomp(
            StompCommand command,
            String sessionId,
            String destination,
            Consumer<StompHeaderAccessor> customizer
    ) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(command);
        accessor.setSessionId(sessionId);
        accessor.setSessionAttributes(new HashMap<>());

        if (destination != null) {
            accessor.setDestination(destination);
        }

        customizer.accept(accessor);

        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }

    private static Principal principal(String username) {
        return () -> username;
    }
}