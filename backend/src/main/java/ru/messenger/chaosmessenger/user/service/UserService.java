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

    public UserSummaryResponse findByUsername(String username) {
        var user = userRepository.findByUsername(username)
                .orElseThrow(() -> new NoSuchElementException("User not found: " + username));
        return new UserSummaryResponse(user.getId(), user.getUsername());
    }

    public CurrentUserResponse getCurrentUser(String username) {
        var user = userRepository.findByUsername(username)
                .orElseThrow(() -> new NoSuchElementException("User not found"));
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

    public UserProfileResponse getProfile(String username) {
        var user = userRepository.findByUsername(username)
                .orElseThrow(() -> new NoSuchElementException("User not found: " + username));
        return new UserProfileResponse(
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                user.getFirstName(),
                user.getLastName(),
                user.getAvatarUrl()
        );
    }

    public UserProfileResponse updateProfile(String currentUsername, UpdateProfileRequest request) {
        var user = userRepository.findByUsername(currentUsername)
                .orElseThrow(() -> new NoSuchElementException("User not found: " + currentUsername));

        // Update display name fields
        if (request.getFirstName() != null) user.setFirstName(request.getFirstName());
        if (request.getLastName() != null) user.setLastName(request.getLastName());
        if (request.getAvatarUrl() != null) user.setAvatarUrl(request.getAvatarUrl());

        // Update username if provided and not already taken
        if (request.getUsername() != null && !request.getUsername().isBlank()) {
            String newUsername = request.getUsername().trim().toLowerCase();

            // Username unchanged — skip
            if (!newUsername.equals(user.getUsername())) {
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
