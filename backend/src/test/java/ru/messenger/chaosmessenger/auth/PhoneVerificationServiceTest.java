package ru.messenger.chaosmessenger.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import ru.messenger.chaosmessenger.auth.domain.VerificationCode;
import ru.messenger.chaosmessenger.auth.repository.VerificationCodeRepository;
import ru.messenger.chaosmessenger.auth.service.PhoneVerificationService;
import ru.messenger.chaosmessenger.auth.service.SmsRateLimiter;
import ru.messenger.chaosmessenger.infra.security.JwtService;
import ru.messenger.chaosmessenger.infra.sms.SmsSender;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.domain.UserStatus;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;


class PhoneVerificationServiceTest {

    private VerificationCodeRepository codeRepo;
    private SmsSender smsSender;
    private UserRepository userRepository;
    private JwtService jwtService;
    private SmsRateLimiter rateLimiter;
    private PasswordEncoder passwordEncoder;
    private PhoneVerificationService service;

    @BeforeEach
    void setup() {
        codeRepo = mock(VerificationCodeRepository.class);
        smsSender = mock(SmsSender.class);
        userRepository = mock(UserRepository.class);
        jwtService = mock(JwtService.class);
        rateLimiter = mock(SmsRateLimiter.class);
        passwordEncoder = new BCryptPasswordEncoder();
        service = new PhoneVerificationService(codeRepo, smsSender, userRepository, jwtService, rateLimiter, passwordEncoder);
    }


    @Test
    void sendCode_persistsHashedCodeAndSendsRawCodeBySms() {
        String phone = "+79991234567";

        service.sendCode(phone, "SMS");

        ArgumentCaptor<VerificationCode> codeCaptor = ArgumentCaptor.forClass(VerificationCode.class);
        verify(codeRepo).saveAndFlush(codeCaptor.capture());

        VerificationCode saved = codeCaptor.getValue();
        assertThat(saved.getPhone()).isEqualTo(phone);
        assertThat(saved.getCode()).isNotBlank();

        ArgumentCaptor<String> smsCaptor = ArgumentCaptor.forClass(String.class);
        verify(smsSender).sendSms(eq(phone), smsCaptor.capture());

        String rawCode = smsCaptor.getValue().replace("Your verification code: ", "");
        assertThat(rawCode).matches("\\d{6}");
        assertThat(saved.getCode()).isNotEqualTo(rawCode);
        assertThat(passwordEncoder.matches(rawCode, saved.getCode())).isTrue();
    }

    @Test
    void verifyCode_marksCodeUsedAfterSuccessfulVerification() {
        String phone = "+79991234567";
        VerificationCode code = verificationCode(phone, "123456");
        User user = user(1L, "alice", phone);

        when(codeRepo.findTopByPhoneAndUsedAtIsNullOrderByIdDesc(phone)).thenReturn(Optional.of(code));
        when(userRepository.existsByPhone(phone)).thenReturn(true);
        when(userRepository.findByPhone(phone)).thenReturn(Optional.of(user));
        when(jwtService.generateToken("alice")).thenReturn("jwt-token");

        PhoneVerificationService.VerificationResult result = service.verifyCode(phone, "123456");

        assertThat(result.getStatus()).isEqualTo("ok");
        assertThat(result.getToken()).isEqualTo("jwt-token");
        assertThat(code.getUsedAt()).isNotNull();
        assertThat(code.getCode()).isNotEqualTo("123456");
        assertThat(passwordEncoder.matches("123456", code.getCode())).isTrue();
        verify(codeRepo).save(code);
    }

    @Test
    void verifyCode_doesNotReturnAlreadyUsedCodes() {
        String phone = "+79991234567";
        when(codeRepo.findTopByPhoneAndUsedAtIsNullOrderByIdDesc(phone)).thenReturn(Optional.empty());

        PhoneVerificationService.VerificationResult result = service.verifyCode(phone, "123456");

        assertThat(result.getStatus()).isEqualTo("not_found");
        verify(codeRepo, never()).save(any());
        verifyNoInteractions(userRepository, jwtService);
    }

    @Test
    void verifyCode_incrementsAttemptsForInvalidCodeAndKeepsCodeUnused() {
        String phone = "+79991234567";
        VerificationCode code = verificationCode(phone, "123456");

        when(codeRepo.findTopByPhoneAndUsedAtIsNullOrderByIdDesc(phone)).thenReturn(Optional.of(code));

        PhoneVerificationService.VerificationResult result = service.verifyCode(phone, "000000");

        assertThat(result.getStatus()).isEqualTo("invalid");
        assertThat(code.getAttempts()).isEqualTo(1);
        assertThat(code.getUsedAt()).isNull();
        verify(codeRepo).save(code);
        verifyNoInteractions(userRepository, jwtService);
    }

    private VerificationCode verificationCode(String phone, String rawCode) {
        VerificationCode vc = new VerificationCode();
        vc.setId(10L);
        vc.setPhone(phone);
        vc.setCode(passwordEncoder.encode(rawCode));
        vc.setAttempts(0);
        vc.setVia("SMS");
        vc.setCreatedAt(LocalDateTime.now().minusMinutes(1));
        vc.setExpiresAt(LocalDateTime.now().plusMinutes(5));
        return vc;
    }

    private User user(Long id, String username, String phone) {
        User user = new User();
        user.setId(id);
        user.setUsername(username);
        user.setPhone(phone);
        user.setEmail(username + "@test.local");
        user.setPasswordHash("PHONE_AUTH_ONLY");
        user.setStatus(UserStatus.ACTIVE);
        user.setCreatedAt(LocalDateTime.now());
        return user;
    }
}
