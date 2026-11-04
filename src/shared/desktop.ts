export interface BridgeInfo {
  apiBase: string;
  token: string;
  appVersion: string;
  platform: string;
  arch: string;
  officeDir: string;
  isPackaged: boolean;
}

export interface WorkspaceBridge extends BridgeInfo {
  chooseDirectory(): Promise<string | null>;
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): Promise<void>;
  quit(): Promise<void>;
  hideWindow(): Promise<void>;
}
