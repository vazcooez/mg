export {};

interface Ok {
  ok: boolean;
  error?: string;
  canceled?: boolean;
}

export interface VaultFile {
  rel: string;
  name: string;
  type: 'todo' | 'note' | 'diagram';
  mtime: number;
}

export interface VaultDir {
  rel: string;
  name: string;
}

declare global {
  interface Window {
    api?: {
      vault: {
        get(): Promise<Ok & { path?: string }>;
        list(): Promise<Ok & { root?: string; files?: VaultFile[]; dirs?: VaultDir[] }>;
        choose(): Promise<Ok & { path?: string }>;
        reveal(): Promise<Ok>;
      };
      file: {
        read(rel: string): Promise<Ok & { content?: string; mtime?: number }>;
        write(rel: string, content: string): Promise<Ok & { mtime?: number; rel?: string }>;
        stat(rel: string): Promise<Ok & { exists?: boolean; mtime?: number | null }>;
        rename(from: string, to: string): Promise<Ok & { rel?: string }>;
        trash(rel: string): Promise<Ok>;
        reveal(rel: string): Promise<Ok>;
        unique(rel: string): Promise<Ok & { rel?: string }>;
        /** Bytes are passed as a plain number array so they survive IPC. */
        writeBinary(rel: string, bytes: number[]): Promise<Ok & { rel?: string }>;
        mkdir(rel: string): Promise<Ok & { rel?: string }>;
      };
      session: {
        read(): Promise<Ok & { data: unknown | null }>;
        write(data: unknown): Promise<Ok>;
      };
      dialog: {
        savePath(name: string, type: 'todo' | 'note' | 'diagram'): Promise<Ok & { rel?: string }>;
        confirmClose(
          title: string,
          neverSaved?: boolean
        ): Promise<{ choice: 'save' | 'discard' | 'cancel' }>;
        message(message: string, detail?: string): Promise<Ok>;
      };
      setUiScale(factor: number): Promise<Ok>;
      exportFile(defaultName: string, content: string): Promise<Ok & { path?: string }>;
      onMenu(handler: (action: string) => void): () => void;
      onVaultChanged(handler: (name: string) => void): () => void;
    };
  }
}
