package ru.messenger.chaosmessenger.infra.presence;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import ru.messenger.chaosmessenger.infra.ws.WebSocketAuthChannelInterceptor;

@Slf4j
@Controller
@RequiredArgsConstructor
public class PresenceController {

    private final OnlineService onlineService;
    private final SimpMessagingTemplate messagingTemplate;
    private final WebSocketAuthChannelInterceptor authInterceptor;

    @MessageMapping("/user.online")
    public void userOnline(@Header("simpSessionId") String sessionId) {
        // Resolve username from the session map set during STOMP CONNECT
        String username = authInterceptor.getUsernameBySessionId(sessionId);

        if (username == null) {
            log.warn("No username found for sessionId: {}", sessionId);
            return;
        }

        log.info("📡 /user.online received from: {}", username);

        onlineService.setOnline(username);
        messagingTemplate.convertAndSend("/topic/user/status",
                new UserStatusEvent(username, "ONLINE", System.currentTimeMillis()));
    }

    @MessageMapping("/user.offline")
    public void userOffline(@Header("simpSessionId") String sessionId) {
        String username = authInterceptor.getUsernameBySessionId(sessionId);

        if (username == null) return;

        log.info("📡 /user.offline received from: {}", username);

        onlineService.setOffline(username);
        messagingTemplate.convertAndSend("/topic/user/status",
                new UserStatusEvent(username, "OFFLINE", System.currentTimeMillis()));
    }
}