/**
 * Types related to alert and notification delivery mechanisms
 */

/**
 * Configuration for email delivery of alerts
 */
export interface EmailDeliveryConfig {
  enabled: boolean;
  to: string[];
  from: string;
  subject: string;
  template?: string;
  smtpHost?: string;
  smtpPort?: number;
  username?: string;
  password?: string;
  secure?: boolean;
  tls?: {
    rejectUnauthorized?: boolean;
  };
}

/**
 * Configuration for webhook delivery of alerts
 */
export interface WebhookDeliveryConfig {
  enabled: boolean;
  url: string;
  method: "POST" | "PUT";
  headers: Record<string, string>;
  timeout: number;
  retry?: {
    attempts: number;
    delay: number;
  };
}

/**
 * Configuration for alert delivery methods
 */
export interface AlertDeliveryConfig {
  email?: EmailDeliveryConfig;
  webhook?: WebhookDeliveryConfig;
}
