/**
 * Plugin Host (ADR-0006). No plugin reaches the network unless its manifest
 * lists the host and the user granted it. Grants name what they cover.
 */
import type { Grant, PluginManifest } from '@gw/plugin-sdk';
import type { StorageAdapter } from '@gw/storage';

const GRANTS_JSON = 'meta/grants.json';

export interface NetworkRequest {
  plugin: PluginManifest;
  host: string;
  /** What will be downloaded and why, in plain words. */
  purpose: string;
  /** Bytes, when known, so the dialog can state the size. */
  bytes?: number;
}

export type PromptAnswer = 'deny' | 'session' | 'persistent';

export class NetworkNotGranted extends Error {
  constructor(public host: string, public pluginId: string) {
    super(`${pluginId} has no grant for ${host}`);
  }
}

export class PluginHost {
  private plugins = new Map<string, PluginManifest>();
  private persistent: Grant[] = [];
  private session: Grant[] = [];
  private listeners = new Set<() => void>();
  private prompter: ((req: NetworkRequest) => Promise<PromptAnswer>) | null = null;

  constructor(private storage: StorageAdapter) {}

  async init(): Promise<void> {
    this.persistent = (await this.storage.readJson<Grant[]>(GRANTS_JSON)) ?? [];
  }

  register(manifest: PluginManifest): void {
    this.plugins.set(manifest.id, manifest);
    this.changed();
  }

  manifests(): PluginManifest[] {
    return [...this.plugins.values()];
  }

  /** The UI supplies the dialog that asks the user. */
  setPrompter(fn: (req: NetworkRequest) => Promise<PromptAnswer>): void {
    this.prompter = fn;
  }

  grants(): Grant[] {
    return [...this.persistent, ...this.session];
  }

  networkHosts(): string[] {
    return [...new Set(this.grants().flatMap((g) => g.networkHosts ?? []))];
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  hasNetworkGrant(pluginId: string, host: string): boolean {
    return this.grants().some((g) => g.pluginId === pluginId && g.networkHosts?.includes(host));
  }

  async revoke(grantId: string): Promise<void> {
    this.session = this.session.filter((g) => g.id !== grantId);
    this.persistent = this.persistent.filter((g) => g.id !== grantId);
    await this.storage.writeJson(GRANTS_JSON, this.persistent);
    this.changed();
  }

  /** Ask for network access to `host` for a plugin, unless already granted. */
  async ensureNetwork(pluginId: string, host: string, purpose: string, bytes?: number): Promise<void> {
    if (this.hasNetworkGrant(pluginId, host)) return;
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new NetworkNotGranted(host, pluginId);
    const declared = plugin.permissions?.network ?? [];
    if (!declared.includes(host) && !declared.includes('self')) throw new NetworkNotGranted(host, pluginId);
    const answer = this.prompter ? await this.prompter({ plugin, host, purpose, bytes }) : 'deny';
    if (answer === 'deny') throw new NetworkNotGranted(host, pluginId);
    const grant: Grant = {
      id: crypto.randomUUID(),
      pluginId,
      networkHosts: [host],
      grantedAt: new Date().toISOString(),
      scope: answer,
    };
    if (answer === 'persistent') {
      this.persistent.push(grant);
      await this.storage.writeJson(GRANTS_JSON, this.persistent);
    } else {
      this.session.push(grant);
    }
    this.changed();
  }

  /** The only way a plugin reaches the network. */
  async fetch(pluginId: string, url: string | URL, init?: RequestInit): Promise<Response> {
    const u = new URL(url, location.href);
    if (!this.hasNetworkGrant(pluginId, u.host)) throw new NetworkNotGranted(u.host, pluginId);
    return fetch(u, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' });
  }
}
