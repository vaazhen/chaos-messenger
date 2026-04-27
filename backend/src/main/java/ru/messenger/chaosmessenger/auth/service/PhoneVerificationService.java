package ru.messenger.chaosmessenger.auth.service;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.messenger.chaosmessenger.auth.domain.VerificationCode;
import ru.messenger.chaosmessenger.auth.repository.VerificationCodeRepository;
import ru.messenger.chaosmessenger.infra.sms.SmsSender;
import ru.messenger.chaosmessenger.infra.security.JwtService;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.domain.UserStatus;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class PhoneVerificationService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(PhoneVerificationService.class);
    private static final int MAX_ATTEMPTS = 5;

    private final VerificationCodeRepository codeRepo;
    private final SmsSender smsSender;
    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final SmsRateLimiter rateLimiter;
    private final PasswordEncoder passwordEncoder;

    private final SecureRandom rnd = new SecureRandom();

    public void sendCode(String phone, String via) {
        String normalizedPhone = normalizePhone(phone);

        // Check rate limits BEFORE generating the code — throws RateLimitException if exceeded
        rateLimiter.checkAndIncrement(normalizedPhone);

        String code = String.format("%06d", rnd.nextInt(1_000_000));
        VerificationCode vc = new VerificationCode();
        vc.setPhone(normalizedPhone);
        vc.setCode(passwordEncoder.encode(code));
        vc.setExpiresAt(LocalDateTime.now().plusMinutes(5));
        vc.setVia(via == null || via.isBlank() ? "SMS" : via);
        vc.setAttempts(0);
        vc.setCreatedAt(LocalDateTime.now());
        codeRepo.saveAndFlush(vc);

        smsSender.sendSms(normalizedPhone, "Your verification code: " + code);
        log.debug("Sent verification code to {}", normalizedPhone);
    }

    @Transactional
    public VerificationResult verifyCode(String phone, String code) {
        String normalizedPhone = normalizePhone(phone);
        try {
            log.debug("Verifying code for phone={}", normalizedPhone);

            Optional<VerificationCode> maybe = codeRepo.findTopByPhoneAndUsedAtIsNullOrderByIdDesc(normalizedPhone);
            if (maybe.isEmpty()) {
                return new VerificationResult("not_found", false, false, null, null, null);
            }

            VerificationCode vc = maybe.get();
            int attempts = vc.getAttempts() == null ? 0 : vc.getAttempts();
            if (attempts >= MAX_ATTEMPTS) {
                log.warn("Too many attempts for phone={}", normalizedPhone);
                return new VerificationResult("too_many_attempts", false, false, null, null, null);
            }

            if (vc.getExpiresAt() == null || vc.getExpiresAt().isBefore(LocalDateTime.now())) {
                return new VerificationResult("expired", false, false, null, null, null);
            }

            if (!passwordEncoder.matches(code, vc.getCode())) {
                vc.setAttempts(attempts + 1);
                codeRepo.save(vc);
                return new VerificationResult("invalid", false, false, null, null, null);
            }

            vc.setUsedAt(LocalDateTime.now());
            codeRepo.save(vc);

            boolean existedBefore = userRepository.existsByPhone(normalizedPhone);
            User user = userRepository.findByPhone(normalizedPhone).orElseGet(() -> {
                User created = new User();
                created.setUsername(generateUniqueUsername());
                created.setPhone(normalizedPhone);
                created.setEmail(normalizedPhone.replace("+", "") + "@no-email.local");
                created.setPasswordHash("PHONE_AUTH_ONLY");
                created.setStatus(UserStatus.ACTIVE);
                created.setCreatedAt(LocalDateTime.now());
                return userRepository.save(created);
            });

            String token = jwtService.generateToken(user.getUsername());
            boolean isNewUser = !existedBefore;
            return new VerificationResult(
                    "ok",
                    existedBefore,
                    isNewUser,
                    token,
                    user.getId(),
                    user.getUsername()
            );

        } catch (Exception ex) {
            log.error("Error while verifying code for phone={}", normalizedPhone, ex);
            throw ex;
        }
    }

    private String normalizePhone(String rawPhone) {
        if (rawPhone == null) {
            throw new IllegalArgumentException("Phone number is required");
        }

        String digits = rawPhone.replaceAll("\\D", "");
        if (digits.isBlank()) {
            throw new IllegalArgumentException("Phone number is required");
        }
        if (digits.length() == 11 && digits.startsWith("8")) {
            digits = "7" + digits.substring(1);
        } else if (digits.length() == 10) {
            digits = "7" + digits;
        }
        return "+" + digits;
    }

    private String generateUniqueUsername() {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        for (int attempt = 0; attempt < 10; attempt++) {
            StringBuilder sb = new StringBuilder("user_");
            for (int i = 0; i < 6; i++) {
                sb.append(chars.charAt(rnd.nextInt(chars.length())));
            }
            String candidate = sb.toString();
            if (!userRepository.existsByUsername(candidate)) {
                return candidate;
            }
        }
        return "user_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }

    @Data
    public static class VerificationResult {
        private final String status;
        private final boolean existingUser;
        private final boolean newUser;
        private final String token;
        private final Long userId;
        private final String username;

        public boolean isNewUser() {
            return newUser;
        }
    }
}
