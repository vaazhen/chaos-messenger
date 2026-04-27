package ru.messenger.chaosmessenger.crypto.prekey;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface OneTimePreKeyRepository extends JpaRepository<OneTimePreKey, Long> {

    List<OneTimePreKey> findByDeviceIdAndUsedAtIsNull(Long deviceId);

    Optional<OneTimePreKey> findByDeviceIdAndPreKeyId(Long deviceId, Integer preKeyId);

    void deleteByDeviceId(Long deviceId);

    void flush();

    @Query("""
           select o
           from OneTimePreKey o
           where o.device.id = :deviceId
             and o.usedAt is null
           order by o.createdAt asc
           """)
    List<OneTimePreKey> findAvailableReadOnly(@Param("deviceId") Long deviceId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
           select o
           from OneTimePreKey o
           where o.device.id = :deviceId
             and o.usedAt is null
           order by o.createdAt asc
           """)
    List<OneTimePreKey> findAvailableForUpdate(@Param("deviceId") Long deviceId);
}