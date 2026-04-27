package ru.messenger.chaosmessenger.common.api;

import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.context.i18n.LocaleContextHolder;

import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;

@RestController
@RequestMapping("/api/v1/i18n")
public class TranslationsController {

    @GetMapping(value = "/messages", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, String>> getMessages(@RequestParam(value = "lang", required = false) String lang) throws IOException {
        if (lang == null || lang.isBlank()) {
            Locale locale = LocaleContextHolder.getLocale();
            lang = locale != null ? locale.getLanguage() : "en";
        }
        String suffix = "ru".equalsIgnoreCase(lang) ? "_ru" : "";
        String resourceName = "messages" + suffix + ".properties";

        Properties props = new Properties();
        ClassPathResource resource = new ClassPathResource(resourceName);
        try (InputStreamReader reader = new InputStreamReader(resource.getInputStream(), StandardCharsets.UTF_8)) {
            props.load(reader);
        }

        Map<String, String> map = new HashMap<>();
        for (String name : props.stringPropertyNames()) {
            map.put(name, props.getProperty(name));
        }
        return ResponseEntity.ok(map);
    }
}
