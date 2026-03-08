import { describe, it, expect, vi } from 'vitest';
import { VirtualFileSystem } from '../../../src/workers/vfs';

describe('VirtualFileSystem', () => {
  describe('registerFile / getFile', () => {
    it('registers and retrieves a file', () => {
      const vfs = new VirtualFileSystem();
      vfs.registerFile('file:///src/index.ts', 'const x = 1;', 1);

      const file = vfs.getFile('file:///src/index.ts');
      expect(file).toEqual({ content: 'const x = 1;', version: 1 });
    });

    it('overwrites existing file', () => {
      const vfs = new VirtualFileSystem();
      vfs.registerFile('file:///src/index.ts', 'old content', 1);
      vfs.registerFile('file:///src/index.ts', 'new content', 2);

      const file = vfs.getFile('file:///src/index.ts');
      expect(file).toEqual({ content: 'new content', version: 2 });
    });
  });

  describe('getFile', () => {
    it('returns null for non-existent file', () => {
      const vfs = new VirtualFileSystem();
      expect(vfs.getFile('file:///missing.ts')).toBeNull();
    });
  });

  describe('hasFile', () => {
    it('returns true for registered files', () => {
      const vfs = new VirtualFileSystem();
      vfs.registerFile('file:///src/index.ts', '', 1);
      expect(vfs.hasFile('file:///src/index.ts')).toBe(true);
    });

    it('returns false for non-existent files', () => {
      const vfs = new VirtualFileSystem();
      expect(vfs.hasFile('file:///missing.ts')).toBe(false);
    });
  });

  describe('removeFile', () => {
    it('removes an existing file and returns true', () => {
      const vfs = new VirtualFileSystem();
      vfs.registerFile('file:///src/index.ts', '', 1);

      expect(vfs.removeFile('file:///src/index.ts')).toBe(true);
      expect(vfs.hasFile('file:///src/index.ts')).toBe(false);
    });

    it('returns false for non-existent files', () => {
      const vfs = new VirtualFileSystem();
      expect(vfs.removeFile('file:///missing.ts')).toBe(false);
    });
  });

  describe('listFiles', () => {
    it('returns all registered URIs', () => {
      const vfs = new VirtualFileSystem();
      vfs.registerFile('file:///a.ts', '', 1);
      vfs.registerFile('file:///b.ts', '', 1);
      vfs.registerFile('file:///c.ts', '', 1);

      const files = vfs.listFiles();
      expect(files).toHaveLength(3);
      expect(files).toContain('file:///a.ts');
      expect(files).toContain('file:///b.ts');
      expect(files).toContain('file:///c.ts');
    });

    it('returns empty array when no files registered', () => {
      const vfs = new VirtualFileSystem();
      expect(vfs.listFiles()).toEqual([]);
    });
  });

  describe('updateFile', () => {
    it('updates content and increments version', () => {
      const vfs = new VirtualFileSystem();
      vfs.registerFile('file:///src/index.ts', 'old', 1);

      vfs.updateFile('file:///src/index.ts', 'new');

      const file = vfs.getFile('file:///src/index.ts');
      expect(file).toEqual({ content: 'new', version: 2 });
    });

    it('increments version each time', () => {
      const vfs = new VirtualFileSystem();
      vfs.registerFile('file:///src/index.ts', 'v1', 1);

      vfs.updateFile('file:///src/index.ts', 'v2');
      vfs.updateFile('file:///src/index.ts', 'v3');

      expect(vfs.getFile('file:///src/index.ts')?.version).toBe(3);
    });

    it('is a no-op for non-existent files', () => {
      const vfs = new VirtualFileSystem();
      vfs.updateFile('file:///missing.ts', 'content');
      expect(vfs.hasFile('file:///missing.ts')).toBe(false);
    });
  });

  describe('requestFile', () => {
    it('returns file if it exists', () => {
      const vfs = new VirtualFileSystem();
      vfs.registerFile('file:///src/index.ts', 'content', 1);

      const file = vfs.requestFile('file:///src/index.ts');
      expect(file).toEqual({ content: 'content', version: 1 });
    });

    it('invokes onFileNotFound callback when file is missing', () => {
      const callback = vi.fn();
      const vfs = new VirtualFileSystem(callback);

      const file = vfs.requestFile('file:///missing.ts');

      expect(file).toBeNull();
      expect(callback).toHaveBeenCalledWith('file:///missing.ts');
    });

    it('returns null without callback when file is missing and no callback provided', () => {
      const vfs = new VirtualFileSystem();

      const file = vfs.requestFile('file:///missing.ts');
      expect(file).toBeNull();
    });

    it('does not invoke callback when file exists', () => {
      const callback = vi.fn();
      const vfs = new VirtualFileSystem(callback);
      vfs.registerFile('file:///src/index.ts', 'content', 1);

      vfs.requestFile('file:///src/index.ts');

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('removes all files', () => {
      const vfs = new VirtualFileSystem();
      vfs.registerFile('file:///a.ts', '', 1);
      vfs.registerFile('file:///b.ts', '', 1);

      vfs.clear();

      expect(vfs.size).toBe(0);
      expect(vfs.listFiles()).toEqual([]);
    });
  });

  describe('size', () => {
    it('returns 0 for empty VFS', () => {
      const vfs = new VirtualFileSystem();
      expect(vfs.size).toBe(0);
    });

    it('reflects current file count', () => {
      const vfs = new VirtualFileSystem();
      vfs.registerFile('file:///a.ts', '', 1);
      expect(vfs.size).toBe(1);
      vfs.registerFile('file:///b.ts', '', 1);
      expect(vfs.size).toBe(2);
      vfs.removeFile('file:///a.ts');
      expect(vfs.size).toBe(1);
    });
  });
});
