/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_GOOGLE_CLIENT_ID: string
  // 34-C: Microsoft public client id + tenant for the in-app "Connect Outlook" flow. Empty when
  // unconfigured → the Outlook connect is a no-op (mirrors VITE_GOOGLE_CLIENT_ID).
  readonly VITE_MS_CLIENT_ID: string
  readonly VITE_MS_TENANT_ID: string
  // CHANGE-41: the deploy run number + the commit it was built from, shown at the foot of the
  // sidebar. Both empty off a deploy → the app reads "Build dev".
  readonly VITE_BUILD_NUMBER: string
  readonly VITE_BUILD_SHA: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
