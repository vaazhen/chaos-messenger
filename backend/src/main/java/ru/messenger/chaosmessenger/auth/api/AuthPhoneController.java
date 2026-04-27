package ru.messenger.chaosmessenger.auth.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import ru.messenger.chaosmessenger.auth.service.DeviceRegistrationTokenService;
import ru.messenger.chaosmessenger.auth.service.PhoneVerificationService;
import ru.messenger.chaosmessenger.auth.service.RefreshTokenService;
import ru.messenger.chaosmessenger.auth.service.SetupTokenService;
import ru.messenger.chaosmessenger.infra.security.JwtService;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Phone/SMS authentication and two-phase registration.
 *
 * Email/password endpoints (/register, /login) live in {@link EmailAuthController}.
 *
 * New user flow:
 *   POST /send-code → POST /verify-code → (receives setupToken, NOT a JWT)
 *   → POST /complete-setup → JWT issued
 *
 * Returning user flow:
 *   POST /send-code → POST /verify-code → JWT issued directly
 */
@Tag(name = "Authentication", description = "Registration and login")
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthPhoneController {

    private final PhoneVerificationService       verificationService;
    private final UserRepository                 userRepository;
    private final RefreshTokenService            refreshTokenService;
    private final DeviceRegistrationTokenService deviceRegTokenService;
    private final JwtService                     jwtService;
    private final SetupTokenService              setupTokenService;

    @Operation(summary = "Check whether an account exists for the given phone number")
    @GetMapping("/exists")
    public ResponseEntity<Map<String, Object>> exists(@RequestParam("phone") String phone) {
        String normalized = normalizePhone(phone);
        return ResponseEntity.ok(Map.of("exists", userRepository.existsByPhone(normalized), "phone", normalized));
    }


    @Operation(summary = "Check username availability during setup")
    @GetMapping("/username-available")
    public ResponseEntity<Map<String, Object>> usernameAvailable(@RequestParam("username") String username) {
        String normalized = username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
        boolean valid = normalized.matches("^[a-z0-9_]{3,32}$");
        boolean available = valid && !userRepository.existsByUsername(normalized);
        return ResponseEntity.ok(Map.of(
                "username", normalized,
                "valid", valid,
                "available", available
        ));
    }

    @Operation(summary = "Send SMS verification code")
    @PostMapping("/send-code")
    public ResponseEntity<Map<String, Object>> sendCode(@Valid @RequestBody SendCodeRequest req) {
        String normalized = normalizePhone(req.getPhone());
        verificationService.sendCode(normalized, req.getVia());
        return ResponseEntity.ok(Map.of("sent", true, "phone", normalized));
    }

    @Operation(
        summary = "Verify SMS code",
        description = "Existing users receive `token`/`refreshToken`/`deviceRegistrationToken`. " +
                      "New users receive `setupToken` — call `/auth/complete-setup` next."
    )
    @PostMapping("/verify-code")
    public ResponseEntity<Map<String, Object>> verifyCode(@Valid @RequestBody VerifyCodeRequest req) {
        String normalized = normalizePhone(req.getPhone());
        var result = verificationService.verifyCode(normalized, req.getCode());

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("status",    result.getStatus());
        resp.put("exists",    result.isExistingUser());
        resp.put("isNewUser", result.isNewUser());
        resp.put("phone",     normalized);

        if (result.getToken() != null) {
            if (result.isNewUser()) {
                // Two-phase registration: don't issue JWT until profile is complete
                resp.put("setupToken", setupTokenService.issue(normalized));
            } else {
                resp.put("token",                   result.getToken());
                resp.put("refreshToken",            refreshTokenService.issue(result.getUsername()));
                resp.put("deviceRegistrationToken", deviceRegTokenService.issue(result.getUsername()));
                if (result.getUserId()   != null) resp.put("userId",   result.getUserId());
                if (result.getUsername() != null) resp.put("username", result.getUsername());
            }
        }

        return ResponseEntity.ok(resp);
    }

    @Operation(
        summary = "Complete phone registration",
        description = "Exchange `setupToken` for a full JWT session after the user has filled in their profile."
    )
    @PostMapping("/complete-setup")
    public ResponseEntity<Map<String, Object>> completeSetup(@Valid @RequestBody CompleteSetupRequest req) {
        String phone = setupTokenService.consumePhone(req.getSetupToken());
        if (phone == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "invalid_or_expired_setup_token"));
        }

        User user = userRepository.findByPhone(phone)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found for phone"));

        String newUsername = req.getUsername().trim().toLowerCase();
        if (!newUsername.matches("^[a-z0-9_]{3,32}$")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Username must be 3-32 chars: lowercase letters, digits, underscore");
        }
        if (!newUsername.equals(user.getUsername()) && userRepository.existsByUsername(newUsername)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Username already taken");
        }

        user.setUsername(newUsername);
        user.setFirstName(req.getFirstName().trim());
        if (req.getLastName()  != null) user.setLastName(trimToNull(req.getLastName()));
        if (req.getAvatarUrl() != null) user.setAvatarUrl(trimToNull(req.getAvatarUrl()));
        user = userRepository.save(user);

        // false = setup is complete, user is no longer "new" — prevents navigation loop back to setup screen
        return ResponseEntity.ok(buildAuthResponse(user, false));
    }

    @Operation(summary = "Refresh access token")
    @PostMapping("/refresh")
    public ResponseEntity<Map<String, Object>> refresh(@Valid @RequestBody RefreshRequest req) {
        String username = refreshTokenService.consumeAndGetUsername(req.getRefreshToken());
        if (username == null) {
            return ResponseEntity.status(401).body(Map.of("error", "invalid_refresh_token"));
        }
        return ResponseEntity.ok(Map.of(
                "token",                   jwtService.generateToken(username),
                "refreshToken",            refreshTokenService.issue(username),
                "deviceRegistrationToken", deviceRegTokenService.issue(username)
        ));
    }

    @Operation(summary = "Logout — revoke the refresh token")
    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logout(@Valid @RequestBody RefreshRequest req) {
        refreshTokenService.revoke(req.getRefreshToken());
        return ResponseEntity.ok(Map.of("loggedOut", true));
    }

    // ── package-level: used by EmailAuthController ────────────────────────────

    Map<String, Object> buildAuthResponse(User user, boolean isNewUser) {
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

    String chooseUsername(String requested, String email) {
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

    // ── private ───────────────────────────────────────────────────────────────

    private String normalizePhone(String raw) {
        if (raw == null) throw new IllegalArgumentException("Phone number is required");
        String digits = raw.replaceAll("\\D", "");
        if (digits.isBlank()) throw new IllegalArgumentException("Phone number is required");
        if (digits.length() == 11 && digits.startsWith("8")) digits = "7" + digits.substring(1);
        else if (digits.length() == 10) digits = "7" + digits;
        return "+" + digits;
    }

    String trimToNull(String value) {
        if (value == null) return null;
        String t = value.trim();
        return t.isEmpty() ? null : t;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    @Data public static class SendCodeRequest {
        @NotBlank(message = "Phone number is required") private String phone;
        private String via;
    }
    @Data public static class VerifyCodeRequest {
        @NotBlank(message = "Phone number is required")      private String phone;
        @NotBlank(message = "Verification code is required") private String code;
    }
    @Data public static class RefreshRequest {
        @NotBlank(message = "Refresh token is required") private String refreshToken;
    }
    @Data public static class CompleteSetupRequest {
        @NotBlank(message = "Setup token is required")  private String setupToken;
        @NotBlank(message = "First name is required")   private String firstName;
        private String lastName;
        @NotBlank(message = "Username is required")     private String username;
        private String avatarUrl;
    }
}