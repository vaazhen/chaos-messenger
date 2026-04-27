package ru.messenger.chaosmessenger.infra.sms;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class NoopSmsSender implements SmsSender {
    private static final Logger log = LoggerFactory.getLogger(NoopSmsSender.class);

    @Override
    public void sendSms(String phone, String text) {
        log.info("(NOOP SMS) To {}: {}", phone, text);
    }
}
