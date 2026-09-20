/**
 * Plugin Host (ADR-0006). No plugin reaches the network unless its manifest
 * lists the host and the user granted it. Grants name what they cover.
 */
import { HOST_API_VERSION, satisfiesHostApi, type Grant, type KitSubject, type PluginManifest } from '@gw/plugin-sdk';
import type { StorageAdapter } from '@gw/storage';

const GRANTS_JSON = 'meta/grants.json';

export interface NetworkRequest {
  kind: 'network';
  plugin: PluginManifest;
  host: string;
  /** What will be downloaded and why, in plain words. */
  purpose: string;
  /** Bytes, when known, so the dialog can state the size. */
  bytes?: number;
}

/** A plugin asking to read whole kits, naming every one of them. */
export interface KitsRequest {
  kind: 'kits';
  plugin: PluginManifest;
  /** The kits that may be granted: every one has a consent basis. */
  kits: KitSubject[];
  /** The kits left out for want of a consent record, named so the UI can say so. */
  excluded: KitSubject[];
  purpose: string;
}

export type GrantRequest = NetworkRequest | KitsRequest;

export type PromptAnswer = 'deny' | 'session' | 'persistent';

export class NetworkNotGranted extends Error {
  constructor(public host: string, public pluginId: string) {
    super(`${pluginId} has no grant for ${host}`);
  }
}

/** Refusing to read someone's DNA, with a sentence the UI can show as is. */
export class KitsNotGranted extends Error {
  constructor(public pluginId: string, message: string) {
    super(message);
  }
}

export class PluginHost {
  private plugins = new Map<string, PluginManifest>();
  private persistent: Grant[] = [];
  private session: Grant[] = [];
  private listeners = new Set<() => void>();
  private prompter: ((req: GrantRequest) => Promise<PromptAnswer>) | null = null;

  constructor(private storage: StorageAdapter) {}

  async init(): Promise<void> {
    this.persistent = (await this.storage.readJson<Grant[]>(GRANTS_JSON)) ?? [];
  }

  /** Refuses a plugin built against a host API this host does not implement. */
  register(manifest: PluginManifest): void {
    if (!satisfiesHostApi(manifest.hostApi)) {
      throw new Error(
        `${manifest.id} ${manifest.version} asks for host API ${manifest.hostApi}; this host is ${HOST_API_VERSION}.`,
      );
    }
    this.plugins.set(manifest.id, manifest);
    this.changed();
  }

  manifests(): PluginManifest[] {
    return [...this.plugins.values()];
  }

  /** The UI supplies the dialog that asks the user. */
  setPrompter(fn: (req: GrantRequest) => Promise<PromptAnswer>): void {
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
    const answer = this.prompter ? await this.prompter({ kind: 'network', plugin, host, purpose, bytes }) : 'deny';
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

  hasKitGrant(pluginId: string, kitId: string): boolean {
    return this.grants().some((g) => g.pluginId === pluginId && g.kits?.includes(kitId));
  }

  /**
   * Ask to read whole kits (ADR-0009, ADR-0015).
   *
   * A kit whose custody record has no consent basis is never granted, whatever
   * the user answers here — consent to read someone's DNA is recorded against
   * the kit, not clicked past in a dialog. Those kits come back in `excluded`
   * so the caller can say which, and why, rather than quietly dropping them.
   *
   * Returns the kit ids the plugin may now read.
   */
  async ensureKits(pluginId: string, kits: KitSubject[], purpose: string): Promise<string[]> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new KitsNotGranted(pluginId, `${pluginId} is not a registered plugin.`);
    if (!plugin.permissions?.multiKit && kits.length > 1) {
      throw new KitsNotGranted(pluginId, `${plugin.title} does not declare that it reads more than one kit.`);
    }

    const excluded = kits.filter((k) => k.consentBasis === 'none');
    const allowed = kits.filter((k) => k.consentBasis !== 'none');
    if (allowed.length === 0) {
      throw new KitsNotGranted(pluginId, 'No consent is recorded for any of these kits, so no analysis may read them.');
    }

    const missing = allowed.filter((k) => !this.hasKitGrant(pluginId, k.kitId));
    if (missing.length === 0) return allowed.map((k) => k.kitId);

    const answer = this.prompter
      ? await this.prompter({ kind: 'kits', plugin, kits: missing, excluded, purpose })
      : 'deny';
    if (answer === 'deny') {
      throw new KitsNotGranted(pluginId, `${plugin.title} was not granted permission to read these kits.`);
    }

    const grant: Grant = {
      id: crypto.randomUUID(),
      pluginId,
      kits: missing.map((k) => k.kitId),
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
    return allowed.map((k) => k.kitId);
  }

  /** The only way a plugin reaches the network. */
  async fetch(pluginId: string, url: string | URL, init?: RequestInit): Promise<Response> {
    const u = new URL(url, location.href);
    if (!this.hasNetworkGrant(pluginId, u.host)) throw new NetworkNotGranted(u.host, pluginId);
    return fetch(u, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' });
  }
}
