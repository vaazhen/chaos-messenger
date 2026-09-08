package ru.messenger.chaosmessenger.crypto.prekey;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface OneTimePreKeyRepository extends JpaRepository<OneTimePreKey, Long> {

    List<OneTimePreKey> findByDeviceIdAndUsedAtIsNull(Long deviceId);

    @Query(value = """
            select distinct on (device_db_id) *
            from one_time_prekeys
            where device_db_id in (:deviceIds)
              and used_at is null
            order by device_db_id, created_at asc, id asc
            """, nativeQuery = true)
    List<OneTimePreKey> findFirstAvailableReadOnlyByDeviceIds(
            @Param("deviceIds") Collection<Long> deviceIds
    );

    Optional<OneTimePreKey> findByDeviceIdAndPreKeyId(Long deviceId, Integer preKeyId);

    void deleteByDeviceId(Long deviceId);

    long countByDeviceIdAndUsedAtIsNull(Long deviceId);

    void deleteByDeviceIdAndUsedAtIsNull(Long deviceId);

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

    /**
     * Reserve a single available one-time prekey for a device.
     * <p>
     * Uses {@code FOR UPDATE SKIP LOCKED} to avoid locking the entire key pool under contention.
     */
    @Query(value = """
            select *
            from one_time_prekeys
            where device_db_id = :deviceId
              and used_at is null
            order by created_at asc, id asc
            limit 1
            for update skip locked
            """, nativeQuery = true)
    Optional<OneTimePreKey> findOneAvailableForUpdate(@Param("deviceId") Long deviceId);
}