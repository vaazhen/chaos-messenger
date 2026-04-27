package ru.messenger.chaosmessenger.user;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;
import ru.messenger.chaosmessenger.user.service.UserIdentityService;

import java.util.NoSuchElementException;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UserIdentityServiceTest {

    @Mock UserRepository userRepository;

    @InjectMocks UserIdentityService userIdentityService;

    @Test
    void resolveReturnsEmptyForNullOrBlankIdentity() {
        assertThat(userIdentityService.resolve(null)).isEmpty();
        assertThat(userIdentityService.resolve("   ")).isEmpty();

        verify(userRepository, never()).findByUsername(org.mockito.ArgumentMatchers.anyString());
        verify(userRepository, never()).findByPhone(org.mockito.ArgumentMatchers.anyString());
        verify(userRepository, never()).findByEmail(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void resolveFindsUserByUsernameFirst() {
        User alice = TestFixtures.user(1L, "alice");

        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));

        assertThat(userIdentityService.resolve("  alice  ")).containsSame(alice);

        verify(userRepository, never()).findByPhone("alice");
        verify(userRepository, never()).findByEmail("alice");
    }

    @Test
    void resolveFallsBackToPhone() {
        User alice = TestFixtures.user(1L, "alice");

        when(userRepository.findByUsername("+79001234567")).thenReturn(Optional.empty());
        when(userRepository.findByPhone("+79001234567")).thenReturn(Optional.of(alice));

        assertThat(userIdentityService.resolve("+79001234567")).containsSame(alice);

        verify(userRepository, never()).findByEmail("+79001234567");
    }

    @Test
    void resolveFallsBackToEmail() {
        User alice = TestFixtures.user(1L, "alice");

        when(userRepository.findByUsername("alice@test.com")).thenReturn(Optional.empty());
        when(userRepository.findByPhone("alice@test.com")).thenReturn(Optional.empty());
        when(userRepository.findByEmail("alice@test.com")).thenReturn(Optional.of(alice));

        assertThat(userIdentityService.resolve("alice@test.com")).containsSame(alice);
    }

    @Test
    void resolveFallsBackToNumericId() {
        User alice = TestFixtures.user(42L, "alice");

        when(userRepository.findByUsername("42")).thenReturn(Optional.empty());
        when(userRepository.findByPhone("42")).thenReturn(Optional.empty());
        when(userRepository.findByEmail("42")).thenReturn(Optional.empty());
        when(userRepository.findById(42L)).thenReturn(Optional.of(alice));

        assertThat(userIdentityService.resolve("42")).containsSame(alice);
    }

    @Test
    void resolveReturnsEmptyForUnknownNonNumericIdentity() {
        when(userRepository.findByUsername("missing")).thenReturn(Optional.empty());
        when(userRepository.findByPhone("missing")).thenReturn(Optional.empty());
        when(userRepository.findByEmail("missing")).thenReturn(Optional.empty());

        assertThat(userIdentityService.resolve("missing")).isEmpty();

        verify(userRepository, never()).findById(org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void resolveReturnsEmptyForTooLargeNumericIdentity() {
        String tooLarge = "999999999999999999999999999999999999999";

        when(userRepository.findByUsername(tooLarge)).thenReturn(Optional.empty());
        when(userRepository.findByPhone(tooLarge)).thenReturn(Optional.empty());
        when(userRepository.findByEmail(tooLarge)).thenReturn(Optional.empty());

        assertThat(userIdentityService.resolve(tooLarge)).isEmpty();
    }

    @Test
    void requireReturnsResolvedUser() {
        User alice = TestFixtures.user(1L, "alice");

        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));

        assertThat(userIdentityService.require("alice")).isSameAs(alice);
    }

    @Test
    void requireThrowsWhenUserIsMissing() {
        when(userRepository.findByUsername("missing")).thenReturn(Optional.empty());
        when(userRepository.findByPhone("missing")).thenReturn(Optional.empty());
        when(userRepository.findByEmail("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> userIdentityService.require("missing"))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessageContaining("User not found: missing");
    }

    @Test
    void requireUsesSafeNullMessage() {
        assertThatThrownBy(() -> userIdentityService.require(null))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessageContaining("User not found: <null>");
    }
}