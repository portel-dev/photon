import assert from 'node:assert/strict';
import {
  accessMetadataAllows,
  extractAccessMetadata,
  parseAccessMetadata,
} from '../src/access-control.js';
import { PhotonLoader } from '../src/loader.js';

const source = `
export default class Appointments {
  get role() { return this.caller.anonymous ? 'user' : 'host'; }
  /** @class Appointments {@role user} */
  async findSlots() {}
  /** @class Appointments {@role host @plan pro} */
  async updateAvailability() {}
  /** @class Appointments {@role user} */
  async *waitForPayment() {}
}`;

const metadata = extractAccessMetadata(source);
assert.deepEqual(parseAccessMetadata('@class Appointments {@role host}'), {
  className: 'Appointments',
  conditions: [{ property: 'role', value: 'host' }],
});
assert.deepEqual(metadata.findSlots.conditions, [{ property: 'role', value: 'user' }]);
assert.deepEqual(metadata.updateAvailability.conditions, [
  { property: 'role', value: 'host' },
  { property: 'plan', value: 'pro' },
]);
assert.deepEqual(metadata.waitForPayment.conditions, [{ property: 'role', value: 'user' }]);
assert.deepEqual(parseAccessMetadata('@class Appointments {malformed}'), {
  className: 'Appointments',
  conditions: [],
});

class Appointments {
  get role() {
    return this.caller.anonymous ? 'user' : 'host';
  }
  get plan() {
    return this.caller.claims?.plan;
  }
  caller: any = { anonymous: true, claims: {} };
}

const photon = new Appointments();
const classes = { Appointments };
assert.equal(
  accessMetadataAllows(metadata.findSlots, photon, classes, { caller: { anonymous: true } }),
  true
);
assert.equal(
  accessMetadataAllows(metadata.findSlots, photon, classes, { caller: { anonymous: false } }),
  false
);
assert.equal(
  accessMetadataAllows(metadata.updateAvailability, photon, classes, {
    caller: { anonymous: false, claims: { plan: 'pro' } },
  }),
  true
);
assert.equal(
  accessMetadataAllows(metadata.updateAvailability, photon, classes, {
    caller: { anonymous: false, claims: { plan: 'basic' } },
  }),
  false
);
assert.equal(
  accessMetadataAllows(
    { className: 'Missing', conditions: [{ property: 'role', value: 'host' }] },
    photon,
    classes,
    { caller: { anonymous: false } }
  ),
  false
);

console.log('access-control tests passed');

const loader = new PhotonLoader();
class LoadedAppointments {
  get role() {
    return this.caller.anonymous ? 'user' : 'host';
  }
  async publicTool() {
    return 'public';
  }
  async hostTool() {
    return 'host';
  }
  caller: any;
}
const loaded = await loader.loadFromModule(
  { default: LoadedAppointments },
  '/tmp/access-control.photon.ts',
  `export default class LoadedAppointments {
    /** @class LoadedAppointments {@role user} */
    async publicTool() { return 'public'; }
    /** @class LoadedAppointments {@role host} */
    async hostTool() { return 'host'; }
  }`
);
assert.equal(loader.isToolAccessible(loaded as any, 'publicTool', { anonymous: true }), true);
assert.equal(loader.isToolAccessible(loaded as any, 'hostTool', { anonymous: true }), false);
assert.equal(loader.isToolAccessible(loaded as any, 'hostTool', { anonymous: false }), true);
console.log('loader access filtering tests passed');
