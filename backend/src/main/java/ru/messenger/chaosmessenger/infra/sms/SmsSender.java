package ru.messenger.chaosmessenger.infra.sms;

public interface SmsSender {
    void sendSms(String phone, String text);
}
