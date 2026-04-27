package ru.messenger.chaosmessenger.user;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.dto.UpdateProfileRequest;
import ru.messenger.chaosmessenger.user.repository.UserRepository;
import ru.messenger.chaosmessenger.user.service.UserIdentityService;
import ru.messenger.chaosmessenger.user.service.UserService;

import java.util.NoSuchElementException;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock UserRepository userRepository;
    @Mock UserIdentityService userIdentityService;

    @InjectMocks UserService userService;

    private User alice;

    @BeforeEach
    void setUp() {
        alice = TestFixtures.user(1L, "alice");
        alice.setEmail("alice@test.com");
        alice.setFirstName("Alice");
        alice.setLastName("Smith");
        alice.setAvatarUrl("avatar.png");
        alice.setPublicKey("legacy-public-key");
    }

    @Test
    void findByUsernameReturnsSummary() {
        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));

        var response = userService.findByUsername("alice");

        assertThat(response.getId()).isEqualTo(1L);
        assertThat(response.getUsername()).isEqualTo("alice");
    }

    @Test
    void findByUsernameThrowsWhenMissing() {
        when(userRepository.findByUsername("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> userService.findByUsername("missing"))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessageContaining("User not found: missing");
    }

    @Test
    void getCurrentUserMapsAllFields() {
        when(userIdentityService.require("alice")).thenReturn(alice);

        var response = userService.getCurrentUser("alice");

        assertThat(response.getId()).isEqualTo(1L);
        assertThat(response.getUsername()).isEqualTo("alice");
        assertThat(response.getEmail()).isEqualTo("alice@test.com");
        assertThat(response.getFirstName()).isEqualTo("Alice");
        assertThat(response.getLastName()).isEqualTo("Smith");
        assertThat(response.getAvatarUrl()).isEqualTo("avatar.png");
        assertThat(response.getPublicKey()).isEqualTo("legacy-public-key");
    }

    @Test
    void getProfileMapsPublicProfileFields() {
        when(userIdentityService.require("alice")).thenReturn(alice);

        var response = userService.getProfile("alice");

        assertThat(response.getId()).isEqualTo(1L);
        assertThat(response.getUsername()).isEqualTo("alice");
        assertThat(response.getEmail()).isEqualTo("alice@test.com");
        assertThat(response.getFirstName()).isEqualTo("Alice");
        assertThat(response.getLastName()).isEqualTo("Smith");
        assertThat(response.getAvatarUrl()).isEqualTo("avatar.png");
    }

    @Test
    void updateProfileTrimsNamesAvatarAndLowercasesUsername() {
        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setFirstName("  John  ");
        request.setLastName("  Doe  ");
        request.setAvatarUrl("  data:image/jpeg;base64,abc  ");
        request.setUsername("  New_Name  ");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(userRepository.existsByUsername("new_name")).thenReturn(false);
        when(userRepository.save(alice)).thenReturn(alice);

        var response = userService.updateProfile("alice", request);

        assertThat(alice.getFirstName()).isEqualTo("John");
        assertThat(alice.getLastName()).isEqualTo("Doe");
        assertThat(alice.getAvatarUrl()).isEqualTo("data:image/jpeg;base64,abc");
        assertThat(alice.getUsername()).isEqualTo("new_name");

        assertThat(response.getUsername()).isEqualTo("new_name");
        assertThat(response.getFirstName()).isEqualTo("John");
        assertThat(response.getLastName()).isEqualTo("Doe");

        verify(userRepository).save(alice);
    }

    @Test
    void updateProfileDoesNotCheckAvailabilityWhenUsernameIsSameIgnoringCase() {
        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setUsername("ALICE");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(userRepository.save(alice)).thenReturn(alice);

        var response = userService.updateProfile("alice", request);

        assertThat(response.getUsername()).isEqualTo("alice");
        verify(userRepository, never()).existsByUsername("alice");
    }

    @Test
    void updateProfileIgnoresBlankUsername() {
        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setUsername("   ");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(userRepository.save(alice)).thenReturn(alice);

        var response = userService.updateProfile("alice", request);

        assertThat(response.getUsername()).isEqualTo("alice");
        verify(userRepository, never()).existsByUsername(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void updateProfileRejectsInvalidUsername() {
        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setUsername("bad-name!");

        when(userIdentityService.require("alice")).thenReturn(alice);

        assertThatThrownBy(() -> userService.updateProfile("alice", request))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Username must be 3-32 chars");

        verify(userRepository, never()).save(alice);
    }

    @Test
    void updateProfileRejectsTakenUsername() {
        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setUsername("bob");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(userRepository.existsByUsername("bob")).thenReturn(true);

        assertThatThrownBy(() -> userService.updateProfile("alice", request))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Username \"bob\" is already taken");

        verify(userRepository, never()).save(alice);
    }
}