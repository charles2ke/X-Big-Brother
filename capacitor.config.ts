import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ke.charles.xbigbrother',
  appName: 'X Big Brother',
  webDir: 'dist',
  loggingBehavior: 'none',
  android: { minWebViewVersion: 89 }
};

export default config;
