/**
 * Callback invoked when a WASM server requests a file that isn't registered.
 * The background will fetch it and register it via textDocument/didOpen.
 */
export interface FileNotFoundCallback {
  (uri: string): void;
}

interface FileEntry {
  content: string;
  version: number;
}

/**
 * In-memory virtual file system for WASM language servers.
 * Since Web Workers have no filesystem access, all file content is
 * managed here with URI-based lookup.
 */
export class VirtualFileSystem {
  private files: Map<string, FileEntry> = new Map();
  private readonly onFileNotFound?: FileNotFoundCallback;

  constructor(onFileNotFound?: FileNotFoundCallback) {
    this.onFileNotFound = onFileNotFound;
  }

  /**
   * Registers a file (or overwrites an existing one).
   */
  registerFile(uri: string, content: string, version: number): void {
    this.files.set(uri, { content, version });
  }

  /**
   * Returns the file's content and version, or null if not registered.
   */
  getFile(uri: string): { content: string; version: number } | null {
    return this.files.get(uri) ?? null;
  }

  /**
   * Checks whether a file is registered.
   */
  hasFile(uri: string): boolean {
    return this.files.has(uri);
  }

  /**
   * Removes a file. Returns true if it existed, false otherwise.
   */
  removeFile(uri: string): boolean {
    return this.files.delete(uri);
  }

  /**
   * Returns all registered file URIs.
   */
  listFiles(): string[] {
    return [...this.files.keys()];
  }

  /**
   * Updates a file's content and increments its version number.
   * If the file doesn't exist, this is a no-op.
   */
  updateFile(uri: string, content: string): void {
    const entry = this.files.get(uri);
    if (!entry) {
      return;
    }
    entry.content = content;
    entry.version++;
  }

  /**
   * Attempts to get a file. If not found, invokes the onFileNotFound
   * callback (which should trigger a fetch from the background).
   */
  requestFile(uri: string): { content: string; version: number } | null {
    const file = this.getFile(uri);
    if (file) {
      return file;
    }

    if (this.onFileNotFound) {
      this.onFileNotFound(uri);
    }

    return null;
  }

  /**
   * Removes all registered files.
   */
  clear(): void {
    this.files.clear();
  }

  /**
   * Returns the number of registered files.
   */
  get size(): number {
    return this.files.size;
  }
}
