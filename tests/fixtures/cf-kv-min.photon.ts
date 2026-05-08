/**
 * CF runtime fixture covering KV, R2, and D1. Used by the `photon cli`
 * smoke test that exercises the local miniflare adapter end-to-end.
 */
export default class CfKvMin {
  protected cfBindings = {
    kv: { cache: 'cache' },
    r2: { photos: 'photos' },
    d1: { app: 'app' },
  };

  async put(p: { key: string; value: string }) {
    await (this as any).cf.kv('cache').put(p.key, p.value);
    return { ok: true };
  }

  async get(p: { key: string }) {
    const value = await (this as any).cf.kv('cache').get(p.key);
    return { value };
  }

  async upload(p: { name: string; body: string }) {
    await (this as any).cf.r2('photos').put(p.name, p.body);
    return { uploaded: p.name };
  }

  async download(p: { name: string }) {
    const obj = await (this as any).cf.r2('photos').get(p.name);
    return { body: obj ? await obj.text() : null };
  }

  async insert(p: { name: string }) {
    const cf = (this as any).cf;
    await cf
      .d1('app')
      .exec('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT);');
    await cf.d1('app').prepare('INSERT INTO items (name) VALUES (?)').bind(p.name).run();
    return { inserted: p.name };
  }

  async list() {
    const cf = (this as any).cf;
    const result = await cf.d1('app').prepare('SELECT name FROM items ORDER BY id').all();
    return { rows: result.results };
  }
}
