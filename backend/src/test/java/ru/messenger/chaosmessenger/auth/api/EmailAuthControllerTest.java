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
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.auth.service.DeviceRegistrationTokenService;
import ru.messenger.chaosmessenger.auth.service.RefreshTokenService;
import ru.messenger.chaosmessenger.infra.security.JwtService;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.domain.UserStatus;
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
class EmailAuthControllerTest {

    @Mock UserRepository userRepository;
    @Mock PasswordEncoder passwordEncoder;
    @Mock JwtService jwtService;
    @Mock RefreshTokenService refreshTokenService;
    @Mock DeviceRegistrationTokenService deviceRegTokenService;

    @InjectMocks EmailAuthController controller;

    private User alice;

    @BeforeEach
    void setUp() {
        alice = TestFixtures.user(1L, "alice");
        alice.setEmail("alice@test.com");
        alice.setPasswordHash("encoded-password");
        alice.setFirstName("Alice");
    }

    @Test
    void registerRejectsDuplicateEmail() {
        EmailAuthController.EmailRegisterRequest request = registerRequest(" Alice@Test.COM ", "secret123");

        when(userRepository.existsByEmail("alice@test.com")).thenReturn(true);

        assertThatThrownBy(() -> controller.register(request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.CONFLICT));

        verify(userRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void registerNormalizesEmailTrimsProfileEncodesPasswordAndReturnsAuthResponse() {
        EmailAuthController.EmailRegisterRequest request = registerRequest(" Alice@Test.COM ", "secret123");
        request.setUsername(" Alice--Profile ");
        request.setFirstName("  Alice  ");
        request.setLastName("  Smith  ");
        request.setAvatarUrl("  avatar.png  ");

        when(userRepository.existsByEmail("alice@test.com")).thenReturn(false);
        when(userRepository.existsByUsername("alice_profile")).thenReturn(false);
        when(passwordEncoder.encode("secret123")).thenReturn("encoded-secret");

        when(userRepository.save(org.mockito.ArgumentMatchers.any(User.class))).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            user.setId(10L);
            return user;
        });

        when(jwtService.generateToken("alice_profile")).thenReturn("jwt");
        when(refreshTokenService.issue("alice_profile")).thenReturn("refresh");
        when(deviceRegTokenService.issue("alice_profile")).thenReturn("device-token");

        ResponseEntity<Map<String, Object>> response = controller.register(request);

        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(userCaptor.capture());

        User saved = userCaptor.getValue();

        assertThat(saved.getEmail()).isEqualTo("alice@test.com");
        assertThat(saved.getUsername()).isEqualTo("alice_profile");
        assertThat(saved.getPasswordHash()).isEqualTo("encoded-secret");
        assertThat(saved.getFirstName()).isEqualTo("Alice");
        assertThat(saved.getLastName()).isEqualTo("Smith");
        assertThat(saved.getAvatarUrl()).isEqualTo("avatar.png");
        assertThat(saved.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(saved.getCreatedAt()).isNotNull();

        Map<String, Object> body = Objects.requireNonNull(response.getBody());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(body)
                .containsEntry("status", "ok")
                .containsEntry("exists", false)
                .containsEntry("isNewUser", true)
                .containsEntry("userId", 10L)
                .containsEntry("username", "alice_profile")
                .containsEntry("email", "alice@test.com")
                .containsEntry("token", "jwt")
                .containsEntry("refreshToken", "refresh")
                .containsEntry("deviceRegistrationToken", "device-token");
    }

    @Test
    void registerChoosesUsernameFromEmailAndAddsSuffixWhenTaken() {
        EmailAuthController.EmailRegisterRequest request = registerRequest(" John.Doe@Test.COM ", "secret123");
        request.setUsername(null);

        when(userRepository.existsByEmail("john.doe@test.com")).thenReturn(false);
        when(userRepository.existsByUsername("john_doe")).thenReturn(true);
        when(userRepository.existsByUsername("john_doe_1")).thenReturn(false);
        when(passwordEncoder.encode("secret123")).thenReturn("hash");

        when(userRepository.save(org.mockito.ArgumentMatchers.any(User.class))).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            user.setId(20L);
            return user;
        });

        when(jwtService.generateToken("john_doe_1")).thenReturn("jwt");
        when(refreshTokenService.issue("john_doe_1")).thenReturn("refresh");
        when(deviceRegTokenService.issue("john_doe_1")).thenReturn("device-token");

        ResponseEntity<Map<String, Object>> response = controller.register(request);

        assertThat(Objects.requireNonNull(response.getBody()))
                .containsEntry("username", "john_doe_1");

        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(userCaptor.capture());
        assertThat(userCaptor.getValue().getUsername()).isEqualTo("john_doe_1");
    }

    @Test
    void loginRejectsUnknownEmail() {
        EmailAuthController.EmailLoginRequest request = loginRequest("Missing@Test.COM", "secret123");

        when(userRepository.findByEmail("missing@test.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> controller.login(request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void loginRejectsBlankPasswordHash() {
        alice.setPasswordHash(" ");

        EmailAuthController.EmailLoginRequest request = loginRequest("alice@test.com", "secret123");

        when(userRepository.findByEmail("alice@test.com")).thenReturn(Optional.of(alice));

        assertThatThrownBy(() -> controller.login(request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));

        verify(passwordEncoder, never()).matches("secret123", " ");
    }

    @Test
    void loginRejectsPhoneOnlyAccount() {
        alice.setPasswordHash("PHONE_AUTH_ONLY");

        EmailAuthController.EmailLoginRequest request = loginRequest("alice@test.com", "secret123");

        when(userRepository.findByEmail("alice@test.com")).thenReturn(Optional.of(alice));

        assertThatThrownBy(() -> controller.login(request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));

        verify(passwordEncoder, never()).matches("secret123", "PHONE_AUTH_ONLY");
    }

    @Test
    void loginRejectsWrongPassword() {
        EmailAuthController.EmailLoginRequest request = loginRequest("alice@test.com", "wrong");

        when(userRepository.findByEmail("alice@test.com")).thenReturn(Optional.of(alice));
        when(passwordEncoder.matches("wrong", "encoded-password")).thenReturn(false);

        assertThatThrownBy(() -> controller.login(request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void loginReturnsAuthResponseForValidCredentials() {
        EmailAuthController.EmailLoginRequest request = loginRequest(" Alice@Test.COM ", "secret123");

        when(userRepository.findByEmail("alice@test.com")).thenReturn(Optional.of(alice));
        when(passwordEncoder.matches("secret123", "encoded-password")).thenReturn(true);
        when(jwtService.generateToken("alice")).thenReturn("jwt");
        when(refreshTokenService.issue("alice")).thenReturn("refresh");
        when(deviceRegTokenService.issue("alice")).thenReturn("device-token");

        ResponseEntity<Map<String, Object>> response = controller.login(request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(Objects.requireNonNull(response.getBody()))
                .containsEntry("status", "ok")
                .containsEntry("exists", true)
                .containsEntry("isNewUser", false)
                .containsEntry("userId", 1L)
                .containsEntry("username", "alice")
                .containsEntry("email", "alice@test.com")
                .containsEntry("token", "jwt")
                .containsEntry("refreshToken", "refresh")
                .containsEntry("deviceRegistrationToken", "device-token");
    }

    @Test
    void loginMarksUserAsNewWhenFirstNameIsBlank() {
        alice.setFirstName(" ");

        EmailAuthController.EmailLoginRequest request = loginRequest("alice@test.com", "secret123");

        when(userRepository.findByEmail("alice@test.com")).thenReturn(Optional.of(alice));
        when(passwordEncoder.matches("secret123", "encoded-password")).thenReturn(true);
        when(jwtService.generateToken("alice")).thenReturn("jwt");
        when(refreshTokenService.issue("alice")).thenReturn("refresh");
        when(deviceRegTokenService.issue("alice")).thenReturn("device-token");

        assertThat(Objects.requireNonNull(controller.login(request).getBody()))
                .containsEntry("isNewUser", true);
    }

    @Test
    void registerRejectsBlankEmailBeforeRepositoryAccess() {
        EmailAuthController.EmailRegisterRequest request = registerRequest(" ", "secret123");

        assertThatThrownBy(() -> controller.register(request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));

        verify(userRepository, never()).existsByEmail(org.mockito.ArgumentMatchers.anyString());
    }

    private static EmailAuthController.EmailRegisterRequest registerRequest(String email, String password) {
        EmailAuthController.EmailRegisterRequest request = new EmailAuthController.EmailRegisterRequest();
        request.setEmail(email);
        request.setPassword(password);
        return request;
    }

    private static EmailAuthController.EmailLoginRequest loginRequest(String email, String password) {
        EmailAuthController.EmailLoginRequest request = new EmailAuthController.EmailLoginRequest();
        request.setEmail(email);
        request.setPassword(password);
        return request;
    }
}