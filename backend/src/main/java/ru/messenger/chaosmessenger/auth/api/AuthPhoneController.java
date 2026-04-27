package ru.messenger.chaosmessenger.auth.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import ru.messenger.chaosmessenger.auth.service.DeviceRegistrationTokenService;
import ru.messenger.chaosmessenger.auth.service.PhoneVerificationService;
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

@Tag(name = "Authentication", description = "Registration and login")
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthPhoneController {

    private final PhoneVerificationService          verificationService;
    private final UserRepository                    userRepository;
    private final RefreshTokenService               refreshTokenService;
    private final DeviceRegistrationTokenService    deviceRegTokenService;
    private final JwtService                        jwtService;
    private final PasswordEncoder                   passwordEncoder;

    @Operation(summary = "Check whether an account exists for the given phone number")
    @GetMapping("/exists")
    public ResponseEntity<Map<String, Object>> exists(@RequestParam("phone") String phone) {
        String normalizedPhone = normalizePhone(phone);
        boolean exists = userRepository.existsByPhone(normalizedPhone);
        return ResponseEntity.ok(Map.of("exists", exists, "phone", normalizedPhone));
    }

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

        return ResponseEntity.ok(authResponse(user, true));
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

        return ResponseEntity.ok(authResponse(user, false));
    }

    @Operation(
        summary = "Send an SMS verification code",
        description = "Sends a one-time code to the specified number. `via` = `sms` or `call`. " +
                      "In dev mode the code is printed to the server log (NoopSmsSender)."
    )
    @PostMapping("/send-code")
    public ResponseEntity<Map<String, Object>> sendCode(@Valid @RequestBody SendCodeRequest req) {
        String normalizedPhone = normalizePhone(req.getPhone());
        verificationService.sendCode(normalizedPhone, req.getVia());
        return ResponseEntity.ok(Map.of("sent", true, "phone", normalizedPhone));
    }

    @Operation(
        summary = "Verify the code and obtain access + refresh tokens",
        description = "Returns `token` (JWT), `refreshToken`, and `deviceRegistrationToken` (60s, one-time) " +
                      "when verification succeeds. `isNewUser: true` means profile setup is required."
    )
    @PostMapping("/verify-code")
    public ResponseEntity<Map<String, Object>> verifyCode(@Valid @RequestBody VerifyCodeRequest req) {
        String normalizedPhone = normalizePhone(req.getPhone());
        var result = verificationService.verifyCode(normalizedPhone, req.getCode());

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("status",    result.getStatus());
        resp.put("exists",    result.isExistingUser());
        resp.put("isNewUser", result.isNewUser());
        resp.put("phone",     normalizedPhone);

        if (result.getToken() != null) {
            resp.put("token",                   result.getToken());
            resp.put("refreshToken",            refreshTokenService.issue(result.getUsername()));
            resp.put("deviceRegistrationToken", deviceRegTokenService.issue(result.getUsername()));
        }
        if (result.getUserId()  != null) resp.put("userId",   result.getUserId());
        if (result.getUsername() != null) resp.put("username", result.getUsername());

        return ResponseEntity.ok(resp);
    }

    @Operation(
        summary = "Refresh access token",
        description = "Exchange a valid refresh token for a new access token + rotated refresh token. " +
                      "The old refresh token is invalidated on use. Also returns a short-lived deviceRegistrationToken " +
                      "so the frontend can heal a missing local device after reload/dev DB reset."
    )
    @PostMapping("/refresh")
    public ResponseEntity<Map<String, Object>> refresh(@Valid @RequestBody RefreshRequest req) {
        String username = refreshTokenService.consumeAndGetUsername(req.getRefreshToken());
        if (username == null) {
            return ResponseEntity.status(401).body(Map.of("error", "invalid_refresh_token"));
        }
        String newAccessToken  = jwtService.generateToken(username);
        String newRefreshToken = refreshTokenService.issue(username);
        return ResponseEntity.ok(Map.of(
                "token",                   newAccessToken,
                "refreshToken",            newRefreshToken,
                "deviceRegistrationToken", deviceRegTokenService.issue(username)
        ));
    }

    @Operation(summary = "Logout — revoke the refresh token")
    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logout(@Valid @RequestBody RefreshRequest req) {
        refreshTokenService.revoke(req.getRefreshToken());
        return ResponseEntity.ok(Map.of("loggedOut", true));
    }

    private Map<String, Object> authResponse(User user, boolean isNewUser) {
        String token = jwtService.generateToken(user.getUsername());
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("status", "ok");
        resp.put("exists", !isNewUser);
        resp.put("isNewUser", isNewUser || user.getFirstName() == null || user.getFirstName().isBlank());
        resp.put("userId", user.getId());
        resp.put("username", user.getUsername());
        resp.put("email", user.getEmail());
        resp.put("token", token);
        resp.put("refreshToken", refreshTokenService.issue(user.getUsername()));
        resp.put("deviceRegistrationToken", deviceRegTokenService.issue(user.getUsername()));
        return resp;
    }

    private String chooseUsername(String requestedUsername, String email) {
        String base = trimToNull(requestedUsername);
        if (base == null) {
            base = email.substring(0, email.indexOf('@'));
        }
        base = base.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_]", "_");
        base = base.replaceAll("_+", "_").replaceAll("^_+|_+$", "");
        if (base.length() < 3) base = "user";
        if (base.length() > 24) base = base.substring(0, 24);

        String candidate = base;
        int i = 1;
        while (userRepository.existsByUsername(candidate)) {
            String suffix = "_" + i++;
            int maxBase = Math.min(base.length(), 32 - suffix.length());
            candidate = base.substring(0, maxBase) + suffix;
            if (i > 100) {
                candidate = "user_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
                if (!userRepository.existsByUsername(candidate)) return candidate;
            }
        }
        return candidate;
    }

    private String normalizeEmail(String rawEmail) {
        if (rawEmail == null || rawEmail.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Email is required");
        }
        return rawEmail.trim().toLowerCase(Locale.ROOT);
    }

    private String normalizePhone(String rawPhone) {
        if (rawPhone == null) throw new IllegalArgumentException("Phone number is required");
        String digits = rawPhone.replaceAll("\\D", "");
        if (digits.isBlank()) throw new IllegalArgumentException("Phone number is required");
        if (digits.length() == 11 && digits.startsWith("8")) digits = "7" + digits.substring(1);
        else if (digits.length() == 10)                      digits = "7" + digits;
        return "+" + digits;
    }

    private String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    @Data public static class EmailRegisterRequest {
        @Email(message = "Invalid email")
        @NotBlank(message = "Email is required")
        private String email;

        @Size(min = 6, max = 72, message = "Password must be between 6 and 72 characters")
        @NotBlank(message = "Password is required")
        private String password;

        private String username;
        private String firstName;
        private String lastName;
        private String avatarUrl;
    }

    @Data public static class EmailLoginRequest {
        @Email(message = "Invalid email")
        @NotBlank(message = "Email is required")
        private String email;

        @NotBlank(message = "Password is required")
        private String password;
    }

    @Data public static class SendCodeRequest  { @NotBlank(message = "Phone number is required")
        private String phone; private String via; }
    @Data public static class VerifyCodeRequest { @NotBlank(message = "Phone number is required")
        private String phone; @NotBlank(message = "Verification code is required")
        private String code; }
    @Data public static class RefreshRequest    { @NotBlank(message = "Refresh token is required")
        private String refreshToken; }
}
