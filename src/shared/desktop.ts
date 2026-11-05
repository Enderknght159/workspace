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
  chooseFile(): Promise<string | null>;
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): Promise<void>;
  quit(): Promise<void>;
  hideWindow(): Promise<void>;
  getStartup(): Promise<boolean>;
  setStartup(enabled: boolean): Promise<boolean>;
  createPremiereProject(scriptPath: string): Promise<{ ok: boolean; message?: string }>;
  installPremiereBridge(): Promise<{ ok: boolean; message?: string }>;
}
