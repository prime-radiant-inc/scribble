import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { metrics } from './metrics.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('Telemetry');

let sdk: NodeSDK | null = null;

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  prometheusPort?: number;
}

export function initTelemetry(config: TelemetryConfig): void {
  if (!config.enabled) {
    logger.info('Telemetry disabled');
    return;
  }

  try {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
    });

    const prometheusExporter = new PrometheusExporter({
      port: config.prometheusPort || 9464,
    });

    sdk = new NodeSDK({
      resource,
      metricReader: prometheusExporter,
    });

    sdk.start();
    logger.info('Started with Prometheus exporter', { port: config.prometheusPort || 9464 });
  } catch (error) {
    logger.error('Failed to initialize telemetry', error);
    // Don't throw - telemetry failure shouldn't crash the app
  }
}

export function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    return sdk.shutdown();
  }
  return Promise.resolve();
}

export { metrics };
