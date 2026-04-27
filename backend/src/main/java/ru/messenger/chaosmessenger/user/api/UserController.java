package ru.messenger.chaosmessenger.user.api;

import jakarta.validation.Valid;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
import ru.messenger.chaosmessenger.infra.security.JwtService;
import ru.messenger.chaosmessenger.user.dto.CurrentUserResponse;
import ru.messenger.chaosmessenger.user.dto.UpdateProfileRequest;
import ru.messenger.chaosmessenger.user.dto.UserProfileResponse;
import ru.messenger.chaosmessenger.user.repository.UserRepository;
import ru.messenger.chaosmessenger.user.service.UserService;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Tag(name = "Users", description = "User profile and search")
@SecurityRequirement(name = "bearerAuth")
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;
    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final ChatParticipantRepository participantRepository;
    private final SimpMessagingTemplate messagingTemplate;

    @Operation(summary = "Search users by username", description = "Case-insensitive partial match.")
    @GetMapping("/search")
    public List<Map<String, Object>> search(@RequestParam String q) {
        return userRepository.findByUsernameContainingIgnoreCase(q)
                .stream()
                .map(u -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", u.getId());
                    item.put("username", u.getUsername());
                    item.put("firstName", u.getFirstName());
                    item.put("lastName", u.getLastName());
                    item.put("avatarUrl", u.getAvatarUrl());
                    return item;
                })
                .toList();
    }

    @Operation(summary = "Current user data")
    @GetMapping("/me")
    public CurrentUserResponse me(Authentication authentication) {
        return userService.getCurrentUser(authentication.getName());
    }

    @Operation(summary = "Current user profile")
    @GetMapping("/profile")
    public UserProfileResponse profile(Authentication authentication) {
        return userService.getProfile(authentication.getName());
    }

    @Operation(summary = "Update profile", description = "Returns the updated profile and a new JWT if the username changed.")
    @PutMapping("/profile")
    public Map<String, Object> updateProfile(Authentication authentication, @Valid @RequestBody UpdateProfileRequest request) {
        UserProfileResponse updated = userService.updateProfile(authentication.getName(), request);
        String newToken = jwtService.generateToken(updated.getUsername());

        notifySharedChatsAboutProfileUpdate(updated.getId());

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("id", updated.getId());
        response.put("username", updated.getUsername());
        response.put("email", updated.getEmail());
        response.put("firstName", updated.getFirstName());
        response.put("lastName", updated.getLastName());
        response.put("avatarUrl", updated.getAvatarUrl());
        response.put("token", newToken);
        return response;
    }

    private void notifySharedChatsAboutProfileUpdate(Long updatedUserId) {
        Set<Long> chatIds = new LinkedHashSet<>();

        participantRepository.findByUserId(updatedUserId)
                .forEach(participant -> chatIds.add(participant.getChatId()));

        for (Long chatId : chatIds) {
            participantRepository.findByChatId(chatId).forEach(participant ->
                    userRepository.findById(participant.getUserId()).ifPresent(user ->
                            messagingTemplate.convertAndSend(
                                    "/topic/users/" + user.getUsername() + "/chats",
                                    Map.of(
                                            "chatId", chatId,
                                            "reason", "profile_updated",
                                            "updatedUserId", updatedUserId,
                                            "timestamp", System.currentTimeMillis()
                                    )
                            )
                    )
            );
        }
    }
}