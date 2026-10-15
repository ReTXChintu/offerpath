import { loadEnv } from '@offerpath/config';

// Placeholder: the BullMQ code-execution worker arrives with phase 1.
const env = loadEnv(import.meta.dirname);
console.warn(
  `offerpath-sandbox: no worker yet (redis ${env.REDIS_ENABLED ? 'on' : 'off'}, prefix ${env.REDIS_KEY_PREFIX})`,
);
