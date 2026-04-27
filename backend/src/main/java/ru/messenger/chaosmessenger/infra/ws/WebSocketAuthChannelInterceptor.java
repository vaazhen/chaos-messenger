package ru.messenger.chaosmessenger.infra.ws;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.stereotype.Component;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
import ru.messenger.chaosmessenger.crypto.device.UserDeviceRepository;
import ru.messenger.chaosmessenger.infra.security.JwtService;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.security.Principal;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class WebSocketAuthChannelInterceptor implements ChannelInterceptor {

    private final JwtService jwtService;
    private final UserDeviceRepository userDeviceRepository;
    private final UserRepository userRepository;
    private final ChatParticipantRepository participantRepository;

    private final ConcurrentHashMap<String, String> sessionUserMap = new ConcurrentHashMap<>();

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(message);

        if (StompCommand.CONNECT.equals(accessor.getCommand())) {
            return authenticateConnect(message, accessor);
        }

        if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
            return authorizeSubscribe(message, accessor);
        }

        if (StompCommand.DISCONNECT.equals(accessor.getCommand())) {
            String sessionId = accessor.getSessionId();
            sessionUserMap.remove(sessionId);
            log.info("WebSocket DISCONNECT sessionId={}", sessionId);
        }

        return message;
    }

    private Message<?> authenticateConnect(Message<?> message, StompHeaderAccessor accessor) {
        String token = extractBearerToken(accessor.getNativeHeader("Authorization"));
        if (token == null) {
            log.warn("WebSocket CONNECT denied: missing Bearer token");
            return null;
        }

        try {
            String username = jwtService.extractUsername(token);
            if (!jwtService.isTokenValid(token, username)) {
                log.warn("WebSocket CONNECT denied: invalid token for user={}", username);
                return null;
            }

            String sessionId = accessor.getSessionId();
            Principal userPrincipal = () -> username;
            sessionUserMap.put(sessionId, username);
            accessor.setUser(userPrincipal);
            accessor.getSessionAttributes().put("username", username);
            log.info("WebSocket CONNECT user={} sessionId={}", username, sessionId);
            return message;
        } catch (Exception e) {
            log.warn("WebSocket CONNECT denied: {}", e.getMessage());
            return null;
        }
    }

    private Message<?> authorizeSubscribe(Message<?> message, StompHeaderAccessor accessor) {
        String username = resolveUsername(accessor);
        String dest = accessor.getDestination();

        if (username == null || dest == null) {
            log.warn("WebSocket SUBSCRIBE denied: anonymous sessionId={} dest={}", accessor.getSessionId(), dest);
            return null;
        }

        boolean allowed = isSubscriptionAllowed(username, dest);
        if (!allowed) {
            log.warn("WebSocket SUBSCRIBE denied user={} dest={}", username, dest);
            return null;
        }

        log.debug("WebSocket SUBSCRIBE allowed user={} dest={}", username, dest);
        return message;
    }

    private boolean isSubscriptionAllowed(String username, String dest) {
        if (dest.startsWith("/topic/devices/")) {
            String deviceId = pathSegment(dest, 3);
            return deviceId != null && userDeviceRepository.findByUserUsernameAndDeviceId(username, deviceId).isPresent();
        }

        if (dest.startsWith("/topic/users/") && dest.endsWith("/chats")) {
            String destinationUsername = pathSegment(dest, 3);
            return username.equals(destinationUsername);
        }

        if (dest.startsWith("/topic/chats/") && dest.endsWith("/typing")) {
            Long chatId = parseLong(pathSegment(dest, 3));
            if (chatId == null) {
                return false;
            }
            return userRepository.findByUsername(username)
                    .map(User::getId)
                    .map(userId -> participantRepository.existsByChatIdAndUserId(chatId, userId))
                    .orElse(false);
        }

        if (dest.equals("/topic/user/status")) {
            return true;
        }

        return false;
    }

    private String resolveUsername(StompHeaderAccessor accessor) {
        if (accessor.getUser() != null) {
            return accessor.getUser().getName();
        }
        return sessionUserMap.get(accessor.getSessionId());
    }

    private String extractBearerToken(List<String> authHeaders) {
        if (authHeaders == null || authHeaders.isEmpty()) {
            return null;
        }
        String token = authHeaders.get(0);
        if (token == null || !token.startsWith("Bearer ")) {
            return null;
        }
        return token.substring(7);
    }

    private String pathSegment(String path, int index) {
        String[] parts = path.split("/");
        return parts.length > index ? parts[index] : null;
    }

    private Long parseLong(String value) {
        try {
            return value == null ? null : Long.parseLong(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public String getUsernameBySessionId(String sessionId) {
        return sessionUserMap.get(sessionId);
    }
}
