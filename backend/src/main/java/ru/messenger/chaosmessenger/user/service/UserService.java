package ru.messenger.chaosmessenger.user.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import ru.messenger.chaosmessenger.user.dto.CurrentUserResponse;
import ru.messenger.chaosmessenger.user.dto.UpdateProfileRequest;
import ru.messenger.chaosmessenger.user.dto.UserProfileResponse;
import ru.messenger.chaosmessenger.user.dto.UserSummaryResponse;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.util.NoSuchElementException;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final UserIdentityService userIdentityService;

    public UserSummaryResponse findByUsername(String username) {
        var user = userRepository.findByUsername(username)
                .orElseThrow(() -> new NoSuchElementException("User not found: " + username));
        return new UserSummaryResponse(user.getId(), user.getUsername());
    }

    public CurrentUserResponse getCurrentUser(String identity) {
        var user = userIdentityService.require(identity);
        return new CurrentUserResponse(
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                user.getFirstName(),
                user.getLastName(),
                user.getAvatarUrl(),
                user.getPublicKey()
        );
    }

    public UserProfileResponse getProfile(String identity) {
        var user = userIdentityService.require(identity);
        return new UserProfileResponse(
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                user.getFirstName(),
                user.getLastName(),
                user.getAvatarUrl()
        );
    }

    public UserProfileResponse updateProfile(String currentIdentity, UpdateProfileRequest request) {
        var user = userIdentityService.require(currentIdentity);

        if (request.getFirstName() != null) {
            user.setFirstName(request.getFirstName().trim());
        }

        if (request.getLastName() != null) {
            user.setLastName(request.getLastName().trim());
        }

        if (request.getAvatarUrl() != null) {
            user.setAvatarUrl(request.getAvatarUrl().trim());
        }

        if (request.getUsername() != null && !request.getUsername().isBlank()) {
            String newUsername = request.getUsername().trim().toLowerCase();

            if (!newUsername.matches("^[a-z0-9_]{3,32}$")) {
                throw new IllegalArgumentException("Username must be 3-32 chars: a-z, 0-9, underscore");
            }

            if (!newUsername.equalsIgnoreCase(user.getUsername())) {
                boolean taken = userRepository.existsByUsername(newUsername);
                if (taken) {
                    throw new IllegalArgumentException("Username \"" + newUsername + "\" is already taken");
                }

                user.setUsername(newUsername);
            }
        }

        user = userRepository.save(user);

        return new UserProfileResponse(
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                user.getFirstName(),
                user.getLastName(),
                user.getAvatarUrl()
        );
    }
}