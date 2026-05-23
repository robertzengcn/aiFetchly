// / <reference types="vite/client" />
interface ImportMetaEnv {
  readonly MODE: string;
  BASE_URL: string;
  PROD: boolean;
  SSR: boolean;
  readonly VITE_LOGIN_URL?: string;
  readonly VITE_LOGIN_URL_TEST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
