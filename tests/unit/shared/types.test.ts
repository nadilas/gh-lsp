import { describe, it, expect } from 'vitest';
import { LspErrorCode } from '../../../src/shared/types';

describe('LspErrorCode', () => {
  it('contains correct JSON-RPC 2.0 and LSP error codes per specification', () => {
    // These values are mandated by the JSON-RPC 2.0 spec and LSP spec.
    // Changing them silently would break all LSP communication.
    expect(LspErrorCode.ParseError).toBe(-32700);
    expect(LspErrorCode.InvalidRequest).toBe(-32600);
    expect(LspErrorCode.MethodNotFound).toBe(-32601);
    expect(LspErrorCode.InvalidParams).toBe(-32602);
    expect(LspErrorCode.InternalError).toBe(-32603);
    expect(LspErrorCode.ServerNotInitialized).toBe(-32002);
    expect(LspErrorCode.RequestCancelled).toBe(-32800);
    expect(LspErrorCode.ContentModified).toBe(-32801);
  });

  it('exposes exactly the expected error code keys', () => {
    const expectedKeys = [
      'ParseError',
      'InvalidRequest',
      'MethodNotFound',
      'InvalidParams',
      'InternalError',
      'ServerNotInitialized',
      'RequestCancelled',
      'ContentModified',
    ];
    expect(Object.keys(LspErrorCode).sort()).toEqual(expectedKeys.sort());
  });
});
