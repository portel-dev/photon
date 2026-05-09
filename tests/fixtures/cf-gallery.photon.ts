/**
 * Gallery — dogfood photon for the CF runtime. Demonstrates a
 * representative cross-section of `this.cf.*` bindings working
 * together: R2 stores blobs, D1 indexes them, KV caches recent
 * lookups. Run locally for the miniflare-backed end-to-end:
 *
 *   photon cli cf-gallery upload --name "1.jpg" --bytes "raw bytes"
 *   photon cli cf-gallery list
 *   photon cli cf-gallery fetch --name "1.jpg"
 */
export default class CfGallery {
  protected cfBindings = {
    r2: { blobs: 'gallery-blobs' },
    d1: { catalog: 'gallery-catalog' },
    kv: { recent: 'gallery-recent' },
  };

  async upload(p: { name: string; bytes: string }) {
    const cf = (this as any).cf;
    await cf.r2('blobs').put(p.name, p.bytes);
    await cf
      .d1('catalog')
      .exec(
        'CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT UNIQUE, uploaded_at INTEGER);'
      );
    await cf
      .d1('catalog')
      .prepare('INSERT OR IGNORE INTO items (name, uploaded_at) VALUES (?, ?)')
      .bind(p.name, Date.now())
      .run();
    await cf.kv('recent').put('last-upload', p.name, { expirationTtl: 3600 });
    return { uploaded: p.name };
  }

  async list() {
    const cf = (this as any).cf;
    await cf
      .d1('catalog')
      .exec(
        'CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT UNIQUE, uploaded_at INTEGER);'
      );
    const result = await cf
      .d1('catalog')
      .prepare('SELECT name, uploaded_at FROM items ORDER BY uploaded_at DESC')
      .all();
    return { items: result.results };
  }

  async fetch(p: { name: string }) {
    const cf = (this as any).cf;
    const obj = await cf.r2('blobs').get(p.name);
    return { name: p.name, body: obj ? await obj.text() : null };
  }

  async lastUpload() {
    const cf = (this as any).cf;
    const last = await cf.kv('recent').get('last-upload');
    return { last };
  }
}
