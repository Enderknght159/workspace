/// <reference types="vite/client" />
import type { WorkspaceBridge } from '../shared/desktop.js';

declare global {
  interface Window {
    workspace?: WorkspaceBridge;
  }
}

export {};
