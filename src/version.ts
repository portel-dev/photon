import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const PHOTON_VERSION: string = pkg.version;
