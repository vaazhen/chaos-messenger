package ru.messenger.chaosmessenger.infra.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

@Component
public class RequestLoggingFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(RequestLoggingFilter.class);

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain) throws ServletException, IOException {
        String rid = UUID.randomUUID().toString();
        MDC.put("requestId", rid);
        try {
            String uri = request.getRequestURI();
            // suppress noisy logging for Prometheus scrapes and static assets
            if (uri != null && (uri.contains("/actuator/prometheus") || uri.endsWith(".css") || uri.endsWith(".js") || uri.endsWith(".png") || uri.endsWith(".ico") || uri.endsWith(".svg"))) {
                // debug only for noisy endpoints
                log.debug("Request {} {} from {} (suppressed)", request.getMethod(), uri, request.getRemoteAddr());
                filterChain.doFilter(request, response);
            } else {
                log.info("Incoming request {} {} from {}", request.getMethod(), uri, request.getRemoteAddr());
                filterChain.doFilter(request, response);
                log.info("Completed request {} {} -> {}", request.getMethod(), uri, response.getStatus());
            }
        } finally {
            MDC.remove("requestId");
        }
    }
}
