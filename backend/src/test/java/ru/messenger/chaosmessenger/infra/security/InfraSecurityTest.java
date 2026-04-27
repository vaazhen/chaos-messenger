package ru.messenger.chaosmessenger.infra.security;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.test.util.ReflectionTestUtils;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.common.exception.CryptoException;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class InfraSecurityTest {

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        DeviceContextHolder.clear();
    }

    @Test
    void jwtServiceGeneratesExtractsAndValidatesToken() {
        JwtService jwtService = jwtService("0123456789abcdef0123456789abcdef", 60_000L);

        jwtService.init();

        String token = jwtService.generateToken("alice");

        assertThat(jwtService.extractUsername(token)).isEqualTo("alice");
        assertThat(jwtService.isTokenValid(token, "alice")).isTrue();
        assertThat(jwtService.isTokenValid(token, "bob")).isFalse();
    }

    @Test
    void jwtServiceRejectsShortSecretOnInit() {
        JwtService jwtService = jwtService("short", 60_000L);

        assertThatThrownBy(jwtService::init)
                .isInstanceOf(CryptoException.class)
                .hasMessageContaining("JWT_SECRET must be at least 32 characters long");
    }

    @Test
    void jwtServiceRejectsBlankSecretWhenGeneratingToken() {
        JwtService jwtService = jwtService(" ", 60_000L);

        assertThatThrownBy(() -> jwtService.generateToken("alice"))
                .isInstanceOf(CryptoException.class)
                .hasMessageContaining("JWT secret is not configured");
    }

    @Test
    void customUserDetailsServiceLoadsUserByUsername() {
        UserRepository userRepository = mock(UserRepository.class);
        User alice = TestFixtures.user(1L, "alice");
        alice.setPasswordHash("hash");

        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));

        CustomUserDetailsService service = new CustomUserDetailsService(userRepository);

        var details = service.loadUserByUsername("alice");

        assertThat(details.getUsername()).isEqualTo("alice");
        assertThat(details.getPassword()).isEqualTo("hash");
        assertThat(details.getAuthorities())
                .anySatisfy(authority -> assertThat(authority.getAuthority()).isEqualTo("ROLE_USER"));
    }

    @Test
    void customUserDetailsServiceThrowsForMissingUser() {
        UserRepository userRepository = mock(UserRepository.class);

        when(userRepository.findByUsername("missing")).thenReturn(Optional.empty());

        CustomUserDetailsService service = new CustomUserDetailsService(userRepository);

        assertThatThrownBy(() -> service.loadUserByUsername("missing"))
                .isInstanceOf(UsernameNotFoundException.class)
                .hasMessageContaining("User not found: missing");
    }

    @Test
    void jwtAuthenticationFilterLeavesRequestUnauthenticatedWhenHeaderIsMissing() throws Exception {
        JwtService jwtService = mock(JwtService.class);
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(jwtService);

        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void jwtAuthenticationFilterSetsAuthenticationForValidBearerToken() throws Exception {
        JwtService jwtService = mock(JwtService.class);
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(jwtService);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer jwt-token");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        when(jwtService.extractUsername("jwt-token")).thenReturn("alice");
        when(jwtService.isTokenValid("jwt-token", "alice")).thenReturn(true);

        filter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication().getName()).isEqualTo("alice");
    }

    @Test
    void jwtAuthenticationFilterIgnoresInvalidTokenAndContinuesChain() throws Exception {
        JwtService jwtService = mock(JwtService.class);
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(jwtService);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer broken");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        when(jwtService.extractUsername("broken")).thenThrow(new RuntimeException("invalid"));

        filter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void deviceContextFilterSetsHeaderDuringChainAndClearsAfterwards() throws Exception {
        DeviceContextFilter filter = new DeviceContextFilter();

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Device-Id", "dev-a");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        doAnswer(invocation -> {
            assertThat(DeviceContextHolder.get()).isEqualTo("dev-a");
            return null;
        }).when(chain).doFilter(request, response);

        filter.doFilter(request, response, chain);

        assertThat(DeviceContextHolder.get()).isNull();
    }

    @Test
    void deviceContextHolderStoresAndClearsCurrentDeviceId() {
        DeviceContextHolder.set("dev-a");

        assertThat(DeviceContextHolder.get()).isEqualTo("dev-a");

        DeviceContextHolder.clear();

        assertThat(DeviceContextHolder.get()).isNull();
    }

    private static JwtService jwtService(String secret, long expiration) {
        JwtService jwtService = new JwtService();
        ReflectionTestUtils.setField(jwtService, "secret", secret);
        ReflectionTestUtils.setField(jwtService, "expiration", expiration);
        return jwtService;
    }
}