package ru.messenger.chaosmessenger.crypto.api;
import jakarta.validation.Valid;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import ru.messenger.chaosmessenger.auth.service.DeviceRegistrationTokenService;
import ru.messenger.chaosmessenger.crypto.device.DeviceService;
import ru.messenger.chaosmessenger.crypto.dto.DeviceRegistrationRequest;
import ru.messenger.chaosmessenger.crypto.dto.DeviceRegistrationResponse;

/**
 * Device registration endpoint.
 *
 * <p>This endpoint is intentionally NOT protected by a JWT — the user has no JWT yet
 * when registering their first device. Instead it uses a short-lived
 * <em>device registration token</em> issued by {@code POST /api/auth/verify-code}
 * (TTL 60 s, one-time-use, stored in Redis).
 *
 * <p>The token must be passed in the {@code X-Device-Registration-Token} header.
 */
@Tag(name = "Crypto / Devices", description = "X3DH key bundle management")
@RestController
@RequestMapping("/api/crypto/devices")
@RequiredArgsConstructor
public class DeviceController {

    private final DeviceService                  deviceService;
    private final DeviceRegistrationTokenService deviceRegTokenService;

    @Operation(
        summary = "Register a device and upload its X3DH key bundle",
        description = "Requires `X-Device-Registration-Token` header issued by /api/auth/verify-code. " +
                      "The token is one-time-use with a 60-second TTL."
    )
    @PostMapping("/register")
    public DeviceRegistrationResponse register(
            @RequestHeader(value = "X-Device-Registration-Token", required = false) String registrationToken,
            @Valid @RequestBody DeviceRegistrationRequest request
    ) {
        if (registrationToken == null || registrationToken.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.UNAUTHORIZED,
                    "Missing device registration token. Obtain a fresh token from POST /api/auth/verify-code."
            );
        }

        String username = deviceRegTokenService.consumeAndGetUsername(registrationToken);
        if (username == null) {
            throw new ResponseStatusException(
                    HttpStatus.UNAUTHORIZED,
                    "Invalid or expired device registration token. " +
                    "Obtain a fresh token from POST /api/auth/verify-code."
            );
        }
        return deviceService.registerDevice(username, request);
    }

    @Operation(
        summary = "Validate current device",
        description = "Requires JWT authentication and X-Device-Id. Used by the frontend after page reload."
    )
    @GetMapping("/current")
    public DeviceRegistrationResponse current(
            Authentication authentication,
            @RequestHeader(value = "X-Device-Id", required = false) String deviceId
    ) {
        if (authentication == null || authentication.getName() == null || authentication.getName().isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "JWT authentication is required");
        }
        if (deviceId == null || deviceId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "X-Device-Id header is required");
        }

        return deviceService.findCurrentDevice(authentication.getName(), deviceId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED,
                        "Current device is not registered or inactive"
                ));
    }
}
