package ru.messenger.chaosmessenger.infra.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Swagger UI / OpenAPI 3 configuration.
 * Interactive docs available at: /swagger-ui.html
 */
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI openAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("Chaos Messenger API")
                        .description("""
                                E2EE messenger backend based on the X3DH key-agreement protocol + Symmetric Ratchet (inspired by Signal).
                                
                                **Authentication:** all protected endpoints require a JWT token in the header:
                                `Authorization: Bearer <token>`
                                
                                **Device:** most endpoints require the `X-Device-Id` header containing the registered device UUID.
                                
                                Obtain a token via `/api/auth/login` or `/api/auth/phone/verify`.
                                """)
                        .version("1.0.0")
                        .contact(new Contact()
                                .name("Chaos Messenger")
                                .url("https://github.com/your-username/chaos-messenger")))
                .addServersItem(new Server().url("/").description("Current server"))
                // Global JWT auth scheme — adds the Authorize button to Swagger UI
                .addSecurityItem(new SecurityRequirement().addList("bearerAuth"))
                .components(new Components()
                        .addSecuritySchemes("bearerAuth", new SecurityScheme()
                                .name("bearerAuth")
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")
                                .description("JWT token from /api/auth/login. Paste the value without the Bearer prefix.")));
    }
}
