package ru.messenger.chaosmessenger.auth.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import ru.messenger.chaosmessenger.auth.service.DeviceRegistrationTokenService;
import ru.messenger.chaosmessenger.auth.service.RefreshTokenService;
import ru.messenger.chaosmessenger.infra.security.JwtService;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.domain.UserStatus;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Tag(name = "Email auth", description = "Email/password registration and login")
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class EmailAuthController {

    private final UserRepository                 userRepository;
    private final PasswordEncoder                passwordEncoder;
    private final JwtService                     jwtService;
    private final RefreshTokenService            refreshTokenService;
    private final DeviceRegistrationTokenService deviceRegTokenService;

    @Operation(summary = "Register by email and password")
    @PostMapping("/register")
    public ResponseEntity<Map<String, Object>> register(@Valid @RequestBody EmailRegisterRequest req) {
        String email = normalizeEmail(req.getEmail());
        if (userRepository.existsByEmail(email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email is already registered");
        }
        String username = chooseUsername(req.getUsername(), email);

        User user = new User();
        user.setEmail(email);
        user.setUsername(username);
        user.setPasswordHash(passwordEncoder.encode(req.getPassword()));
        user.setFirstName(trimToNull(req.getFirstName()));
        user.setLastName(trimToNull(req.getLastName()));
        user.setAvatarUrl(trimToNull(req.getAvatarUrl()));
        user.setStatus(UserStatus.ACTIVE);
        user.setCreatedAt(LocalDateTime.now());
        user = userRepository.save(user);

        return ResponseEntity.ok(buildAuthResponse(user, true));
    }

    @Operation(summary = "Login by email and password")
    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@Valid @RequestBody EmailLoginRequest req) {
        String email = normalizeEmail(req.getEmail());
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password"));

        if (user.getPasswordHash() == null
                || user.getPasswordHash().isBlank()
                || "PHONE_AUTH_ONLY".equals(user.getPasswordHash())
                || !passwordEncoder.matches(req.getPassword(), user.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
        }

        return ResponseEntity.ok(buildAuthResponse(user, false));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private Map<String, Object> buildAuthResponse(User user, boolean isNewUser) {
        String token = jwtService.generateToken(user.getUsername());
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("status",    "ok");
        resp.put("exists",    !isNewUser);
        resp.put("isNewUser", isNewUser || user.getFirstName() == null || user.getFirstName().isBlank());
        resp.put("userId",    user.getId());
        resp.put("username",  user.getUsername());
        resp.put("email",     user.getEmail());
        resp.put("token",     token);
        resp.put("refreshToken",            refreshTokenService.issue(user.getUsername()));
        resp.put("deviceRegistrationToken", deviceRegTokenService.issue(user.getUsername()));
        return resp;
    }

    private String normalizeEmail(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Email is required");
        }
        return raw.trim().toLowerCase(Locale.ROOT);
    }

    private String trimToNull(String value) {
        if (value == null) return null;
        String t = value.trim();
        return t.isEmpty() ? null : t;
    }

    private String chooseUsername(String requested, String email) {
        String base = trimToNull(requested);
        if (base == null) base = email.substring(0, email.indexOf('@'));
        base = base.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_]", "_");
        base = base.replaceAll("_+", "_").replaceAll("^_+|_+$", "");
        if (base.length() < 3) base = "user";
        if (base.length() > 24) base = base.substring(0, 24);
        String candidate = base;
        int i = 1;
        while (userRepository.existsByUsername(candidate)) {
            String suffix = "_" + i++;
            candidate = base.substring(0, Math.min(base.length(), 32 - suffix.length())) + suffix;
            if (i > 100) {
                candidate = "user_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
                if (!userRepository.existsByUsername(candidate)) return candidate;
            }
        }
        return candidate;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    @Data public static class EmailRegisterRequest {
        @Email(message = "Invalid email") @NotBlank(message = "Email is required") private String email;
        @Size(min = 6, max = 72) @NotBlank(message = "Password is required") private String password;
        private String username; private String firstName; private String lastName; private String avatarUrl;
    }

    @Data public static class EmailLoginRequest {
        @Email(message = "Invalid email") @NotBlank(message = "Email is required") private String email;
        @NotBlank(message = "Password is required") private String password;
    }
}