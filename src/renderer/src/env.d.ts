/// <reference types="vite/client" />
import type { McApi } from '@shared/api'

declare global {
  interface Window {
    mc: McApi
  }
}

export {}
