package ru.messenger.chaosmessenger.crypto.prekey;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SignedPreKeyRepository extends JpaRepository<SignedPreKey, Long> {

    Optional<SignedPreKey> findTopByDeviceIdOrderByCreatedAtDesc(Long deviceId);

    Optional<SignedPreKey> findByDeviceIdAndPreKeyId(Long deviceId, Integer preKeyId);

    void deleteByDeviceId(Long deviceId);

    void flush();
}