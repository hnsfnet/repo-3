import type { IPlugin, PluginContext, PluginConfig } from '../types';
import { AuthPlugin } from './authPlugin';
import { RateLimitPlugin } from './rateLimitPlugin';
import { LoggingPlugin } from './loggingPlugin';

const BUILTIN_PLUGINS: Record<string, new () => IPlugin> = {
  'auth': AuthPlugin,
  'rate-limit': RateLimitPlugin,
  'logging': LoggingPlugin,
};

export class PluginManager {
  private plugins: IPlugin[];

  constructor() {
    this.plugins = [];
  }

  loadFromConfig(configs: PluginConfig[]): void {
    for (const config of configs) {
      if (!config.enabled) continue;

      const PluginClass = BUILTIN_PLUGINS[config.name];
      if (!PluginClass) {
        throw new Error(`Unknown plugin: ${config.name}`);
      }

      const plugin = new PluginClass();
      plugin.init(config.options);
      this.plugins.push(plugin);
    }
  }

  register(plugin: IPlugin): void {
    this.plugins.push(plugin);
  }

  async runOnRequest(ctx: PluginContext): Promise<PluginContext | null> {
    for (const plugin of this.plugins) {
      const result = await plugin.onRequest(ctx);
      if (result === null) {
        return null;
      }
      ctx = result;
    }
    return ctx;
  }

  async runOnResponse(ctx: PluginContext): Promise<PluginContext> {
    for (const plugin of this.plugins) {
      ctx = await plugin.onResponse(ctx);
    }
    return ctx;
  }

  async runOnError(ctx: PluginContext, error: unknown): Promise<PluginContext> {
    for (const plugin of this.plugins) {
      ctx = await plugin.onError(ctx, error);
    }
    return ctx;
  }

  getPlugins(): IPlugin[] {
    return [...this.plugins];
  }
}
