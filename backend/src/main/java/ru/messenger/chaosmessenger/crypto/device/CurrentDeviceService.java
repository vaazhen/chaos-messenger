package ru.messenger.chaosmessenger.crypto.device;

import ru.messenger.chaosmessenger.common.exception.*;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

@Service
@RequiredArgsConstructor
public class CurrentDeviceService {

    private final HttpServletRequest request;
    private final UserDeviceRepository userDeviceRepository;
    private final UserRepository userRepository;

    public UserDevice requireCurrentDevice() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        if (authentication == null || authentication.getName() == null) {
            throw new AuthException("Unauthenticated request");
        }

        String username = authentication.getName();
        String deviceId = request.getHeader("X-Device-Id");

        if (deviceId == null || deviceId.isBlank()) {
            throw new AuthException("X-Device-Id header is required");
        }

        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new AuthException("User not found"));

        return userDeviceRepository.findByUserIdAndDeviceIdAndActiveTrue(user.getId(), deviceId)
                .orElseThrow(() -> new AuthException("Active device not found for current user"));
    }
}