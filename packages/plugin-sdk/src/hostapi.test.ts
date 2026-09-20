import { describe, expect, it } from 'vitest';
import { HOST_API_VERSION, satisfiesHostApi } from './index';

describe('satisfiesHostApi', () => {
  it('accepts the range every first-party manifest declares today', () => {
    expect(satisfiesHostApi('^0.1', HOST_API_VERSION)).toBe(true);
  });

  it('refuses a plugin built against a later host API', () => {
    expect(satisfiesHostApi('^0.2', '0.1.0')).toBe(false);
  });

  it('pins the minor below 1.0.0, because the contract may still break there', () => {
    expect(satisfiesHostApi('^0.1', '0.2.0')).toBe(false);
    expect(satisfiesHostApi('^0.1', '0.1.7')).toBe(true);
  });

  it('lets the minor float once the contract reaches 1.0.0', () => {
    expect(satisfiesHostApi('^1.2', '1.4.0')).toBe(true);
    expect(satisfiesHostApi('^1.2', '1.1.0')).toBe(false);
    expect(satisfiesHostApi('^1.2', '2.0.0')).toBe(false);
  });

  it('treats a bare version as exact', () => {
    expect(satisfiesHostApi('0.1.0', '0.1.0')).toBe(true);
    expect(satisfiesHostApi('0.1.0', '0.1.1')).toBe(false);
  });
});
