package ru.messenger.chaosmessenger.crypto.device;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserDeviceRepository extends JpaRepository<UserDevice, Long> {

    Optional<UserDevice> findByUserUsernameAndDeviceId(String username, String deviceId);

    Optional<UserDevice> findByUserUsernameAndDeviceIdAndActiveTrue(String username, String deviceId);

    List<UserDevice> findByUserUsernameAndActiveTrue(String username);

    Optional<UserDevice> findByUserIdAndDeviceIdAndActiveTrue(Long userId, String deviceId);

    List<UserDevice> findByUserIdAndActiveTrue(Long userId);

    List<UserDevice> findByUserIdOrderByCreatedAtDesc(Long userId);

    Optional<UserDevice> findByIdAndUserId(Long id, Long userId);

    long countByUserIdAndActiveTrue(Long userId);
}