export default class CfKvMin {
  protected cfBindings = {
    kv: { cache: 'cache' },
  };

  async put(p: { key: string; value: string }) {
    await (this as any).cf.kv('cache').put(p.key, p.value);
    return { ok: true };
  }

  async get(p: { key: string }) {
    const value = await (this as any).cf.kv('cache').get(p.key);
    return { value };
  }
}
