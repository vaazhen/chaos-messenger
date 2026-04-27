package ru.messenger.chaosmessenger.auth.api;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.auth.service.DeviceRegistrationTokenService;
import ru.messenger.chaosmessenger.auth.service.PhoneVerificationService;
import ru.messenger.chaosmessenger.auth.service.RefreshTokenService;
import ru.messenger.chaosmessenger.auth.service.SetupTokenService;
import ru.messenger.chaosmessenger.infra.security.JwtService;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthPhoneControllerTest {

    @Mock PhoneVerificationService verificationService;
    @Mock UserRepository userRepository;
    @Mock RefreshTokenService refreshTokenService;
    @Mock DeviceRegistrationTokenService deviceRegTokenService;
    @Mock JwtService jwtService;
    @Mock SetupTokenService setupTokenService;

    @InjectMocks AuthPhoneController controller;

    private User alice;

    @BeforeEach
    void setUp() {
        alice = TestFixtures.user(1L, "alice");
        alice.setPhone("+79001234567");
        alice.setFirstName("Alice");
        alice.setLastName("Smith");
        alice.setAvatarUrl("avatar.png");
    }

    @Test
    void existsNormalizesRussianPhoneAndChecksRepository() {
        when(userRepository.existsByPhone("+79001234567")).thenReturn(true);

        ResponseEntity<Map<String, Object>> response = controller.exists("8 (900) 123-45-67");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(Objects.requireNonNull(response.getBody()))
                .containsEntry("exists", true)
                .containsEntry("phone", "+79001234567");
    }

    @Test
    void existsRejectsBlankPhone() {
        assertThatThrownBy(() -> controller.exists("----"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Phone number is required");
    }

    @Test
    void sendCodeNormalizesPhoneAndDelegatesToVerificationService() {
        AuthPhoneController.SendCodeRequest request = new AuthPhoneController.SendCodeRequest();
        request.setPhone("9001234567");
        request.setVia("telegram");

        ResponseEntity<Map<String, Object>> response = controller.sendCode(request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(Objects.requireNonNull(response.getBody()))
                .containsEntry("sent", true)
                .containsEntry("phone", "+79001234567");

        verify(verificationService).sendCode("+79001234567", "telegram");
    }

    @Test
    void verifyCodeForNewUserReturnsSetupTokenWithoutJwt() {
        AuthPhoneController.VerifyCodeRequest request = new AuthPhoneController.VerifyCodeRequest();
        request.setPhone("+79001234567");
        request.setCode("111111");

        var result = new PhoneVerificationService.VerificationResult(
                "ok",
                false,
                true,
                "temporary-token-from-service",
                1L,
                "user_abcd12"
        );

        when(verificationService.verifyCode("+79001234567", "111111")).thenReturn(result);
        when(setupTokenService.issue("+79001234567")).thenReturn("setup-token-1");

        ResponseEntity<Map<String, Object>> response = controller.verifyCode(request);

        Map<String, Object> body = Objects.requireNonNull(response.getBody());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(body)
                .containsEntry("status", "ok")
                .containsEntry("exists", false)
                .containsEntry("isNewUser", true)
                .containsEntry("phone", "+79001234567")
                .containsEntry("setupToken", "setup-token-1");

        assertThat(body).doesNotContainKeys("token", "refreshToken", "deviceRegistrationToken");
        verify(refreshTokenService, never()).issue("user_abcd12");
        verify(deviceRegTokenService, never()).issue("user_abcd12");
    }

    @Test
    void verifyCodeForExistingUserReturnsJwtRefreshAndDeviceRegistrationToken() {
        AuthPhoneController.VerifyCodeRequest request = new AuthPhoneController.VerifyCodeRequest();
        request.setPhone("8 900 123 45 67");
        request.setCode("222222");

        var result = new PhoneVerificationService.VerificationResult(
                "ok",
                true,
                false,
                "jwt-token",
                1L,
                "alice"
        );

        when(verificationService.verifyCode("+79001234567", "222222")).thenReturn(result);
        when(refreshTokenService.issue("alice")).thenReturn("refresh-token");
        when(deviceRegTokenService.issue("alice")).thenReturn("device-token");

        ResponseEntity<Map<String, Object>> response = controller.verifyCode(request);

        Map<String, Object> body = Objects.requireNonNull(response.getBody());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(body)
                .containsEntry("status", "ok")
                .containsEntry("exists", true)
                .containsEntry("isNewUser", false)
                .containsEntry("phone", "+79001234567")
                .containsEntry("token", "jwt-token")
                .containsEntry("refreshToken", "refresh-token")
                .containsEntry("deviceRegistrationToken", "device-token")
                .containsEntry("userId", 1L)
                .containsEntry("username", "alice");

        assertThat(body).doesNotContainKey("setupToken");
        verify(setupTokenService, never()).issue("+79001234567");
    }

    @Test
    void verifyCodeNonOkResultReturnsStatusWithoutTokens() {
        AuthPhoneController.VerifyCodeRequest request = new AuthPhoneController.VerifyCodeRequest();
        request.setPhone("+79001234567");
        request.setCode("bad");

        var result = new PhoneVerificationService.VerificationResult(
                "invalid",
                false,
                false,
                null,
                null,
                null
        );

        when(verificationService.verifyCode("+79001234567", "bad")).thenReturn(result);

        ResponseEntity<Map<String, Object>> response = controller.verifyCode(request);

        Map<String, Object> body = Objects.requireNonNull(response.getBody());

        assertThat(body)
                .containsEntry("status", "invalid")
                .containsEntry("exists", false)
                .containsEntry("isNewUser", false)
                .containsEntry("phone", "+79001234567");

        assertThat(body).doesNotContainKeys("token", "refreshToken", "deviceRegistrationToken", "setupToken");
    }

    @Test
    void completeSetupRejectsInvalidSetupToken() {
        AuthPhoneController.CompleteSetupRequest request = completeSetupRequest("bad-token", "Alice", "alice");

        when(setupTokenService.consumePhone("bad-token")).thenReturn(null);

        ResponseEntity<Map<String, Object>> response = controller.completeSetup(request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(Objects.requireNonNull(response.getBody()))
                .containsEntry("error", "invalid_or_expired_setup_token");

        verify(userRepository, never()).save(alice);
    }

    @Test
    void completeSetupRejectsMissingUserForConsumedPhone() {
        AuthPhoneController.CompleteSetupRequest request = completeSetupRequest("setup-token", "Alice", "alice");

        when(setupTokenService.consumePhone("setup-token")).thenReturn("+79001234567");
        when(userRepository.findByPhone("+79001234567")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> controller.completeSetup(request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void completeSetupRejectsInvalidUsername() {
        AuthPhoneController.CompleteSetupRequest request = completeSetupRequest("setup-token", "Alice", "bad-name!");

        when(setupTokenService.consumePhone("setup-token")).thenReturn("+79001234567");
        when(userRepository.findByPhone("+79001234567")).thenReturn(Optional.of(alice));

        assertThatThrownBy(() -> controller.completeSetup(request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));

        verify(userRepository, never()).save(alice);
    }

    @Test
    void completeSetupRejectsTakenUsername() {
        AuthPhoneController.CompleteSetupRequest request = completeSetupRequest("setup-token", "Alice", "bob");

        when(setupTokenService.consumePhone("setup-token")).thenReturn("+79001234567");
        when(userRepository.findByPhone("+79001234567")).thenReturn(Optional.of(alice));
        when(userRepository.existsByUsername("bob")).thenReturn(true);

        assertThatThrownBy(() -> controller.completeSetup(request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.CONFLICT));

        verify(userRepository, never()).save(alice);
    }

    @Test
    void completeSetupTrimsProfileLowercasesUsernameAndReturnsAuthResponse() {
        AuthPhoneController.CompleteSetupRequest request = completeSetupRequest("setup-token", "  Alice  ", "  Alice_New  ");
        request.setLastName("  Smith  ");
        request.setAvatarUrl("  data:image/png;base64,abc  ");

        when(setupTokenService.consumePhone("setup-token")).thenReturn("+79001234567");
        when(userRepository.findByPhone("+79001234567")).thenReturn(Optional.of(alice));
        when(userRepository.existsByUsername("alice_new")).thenReturn(false);
        when(userRepository.save(alice)).thenReturn(alice);

        when(jwtService.generateToken("alice_new")).thenReturn("jwt-new");
        when(refreshTokenService.issue("alice_new")).thenReturn("refresh-new");
        when(deviceRegTokenService.issue("alice_new")).thenReturn("device-new");

        ResponseEntity<Map<String, Object>> response = controller.completeSetup(request);

        assertThat(alice.getUsername()).isEqualTo("alice_new");
        assertThat(alice.getFirstName()).isEqualTo("Alice");
        assertThat(alice.getLastName()).isEqualTo("Smith");
        assertThat(alice.getAvatarUrl()).isEqualTo("data:image/png;base64,abc");

        Map<String, Object> body = Objects.requireNonNull(response.getBody());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(body)
                .containsEntry("status", "ok")
                .containsEntry("exists", true)
                .containsEntry("isNewUser", false)
                .containsEntry("userId", 1L)
                .containsEntry("username", "alice_new")
                .containsEntry("email", "alice@test.com")
                .containsEntry("token", "jwt-new")
                .containsEntry("refreshToken", "refresh-new")
                .containsEntry("deviceRegistrationToken", "device-new");
    }

    @Test
    void usernameAvailableReturnsValidAndAvailableState() {
        when(userRepository.existsByUsername("free_name")).thenReturn(false);
        when(userRepository.existsByUsername("taken")).thenReturn(true);

        assertThat(Objects.requireNonNull(controller.usernameAvailable(" Free_Name ").getBody()))
                .containsEntry("username", "free_name")
                .containsEntry("valid", true)
                .containsEntry("available", true);

        assertThat(Objects.requireNonNull(controller.usernameAvailable("taken").getBody()))
                .containsEntry("username", "taken")
                .containsEntry("valid", true)
                .containsEntry("available", false);

        assertThat(Objects.requireNonNull(controller.usernameAvailable("bad-name!").getBody()))
                .containsEntry("username", "bad-name!")
                .containsEntry("valid", false)
                .containsEntry("available", false);
    }

    @Test
    void refreshRejectsInvalidToken() {
        AuthPhoneController.RefreshRequest request = new AuthPhoneController.RefreshRequest();
        request.setRefreshToken("bad-refresh");

        when(refreshTokenService.consumeAndGetUsername("bad-refresh")).thenReturn(null);

        ResponseEntity<Map<String, Object>> response = controller.refresh(request);

        assertThat(response.getStatusCode().value()).isEqualTo(401);
        assertThat(Objects.requireNonNull(response.getBody()))
                .containsEntry("error", "invalid_refresh_token");

        verify(jwtService, never()).generateToken("alice");
    }

    @Test
    void refreshRotatesRefreshTokenAndIssuesDeviceRegistrationToken() {
        AuthPhoneController.RefreshRequest request = new AuthPhoneController.RefreshRequest();
        request.setRefreshToken("old-refresh");

        when(refreshTokenService.consumeAndGetUsername("old-refresh")).thenReturn("alice");
        when(jwtService.generateToken("alice")).thenReturn("new-jwt");
        when(refreshTokenService.issue("alice")).thenReturn("new-refresh");
        when(deviceRegTokenService.issue("alice")).thenReturn("new-device-token");

        ResponseEntity<Map<String, Object>> response = controller.refresh(request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(Objects.requireNonNull(response.getBody()))
                .containsEntry("token", "new-jwt")
                .containsEntry("refreshToken", "new-refresh")
                .containsEntry("deviceRegistrationToken", "new-device-token");
    }

    @Test
    void logoutRevokesRefreshToken() {
        AuthPhoneController.RefreshRequest request = new AuthPhoneController.RefreshRequest();
        request.setRefreshToken("refresh-token");

        ResponseEntity<Map<String, Object>> response = controller.logout(request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(Objects.requireNonNull(response.getBody()))
                .containsEntry("loggedOut", true);

        verify(refreshTokenService).revoke("refresh-token");
    }

    @Test
    void chooseUsernameNormalizesAndAddsSuffixWhenTaken() {
        when(userRepository.existsByUsername("john_doe")).thenReturn(true);
        when(userRepository.existsByUsername("john_doe_1")).thenReturn(false);

        assertThat(controller.chooseUsername(" John---Doe ", "fallback@test.com"))
                .isEqualTo("john_doe_1");
    }

    @Test
    void chooseUsernameFallsBackToEmailLocalPart() {
        when(userRepository.existsByUsername("mail_user")).thenReturn(false);

        assertThat(controller.chooseUsername(null, "mail.user@test.com"))
                .isEqualTo("mail_user");
    }

    @Test
    void trimToNullReturnsNullForBlankAndTrimmedValueForText() {
        assertThat(controller.trimToNull(null)).isNull();
        assertThat(controller.trimToNull("   ")).isNull();
        assertThat(controller.trimToNull("  abc  ")).isEqualTo("abc");
    }

    private static AuthPhoneController.CompleteSetupRequest completeSetupRequest(String setupToken, String firstName, String username) {
        AuthPhoneController.CompleteSetupRequest request = new AuthPhoneController.CompleteSetupRequest();
        request.setSetupToken(setupToken);
        request.setFirstName(firstName);
        request.setUsername(username);
        return request;
    }
}