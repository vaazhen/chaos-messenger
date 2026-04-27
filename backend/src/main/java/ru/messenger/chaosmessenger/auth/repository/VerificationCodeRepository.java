package ru.messenger.chaosmessenger.auth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.messenger.chaosmessenger.auth.domain.VerificationCode;

import java.util.Optional;

public interface VerificationCodeRepository extends JpaRepository<VerificationCode, Long> {
    Optional<VerificationCode> findTopByPhoneAndUsedAtIsNullOrderByIdDesc(String phone);
}
