#!/usr/bin/env node

/**
 * Photon MCP CLI
 *
 * Thin entry point — delegates to cli/index.ts which registers
 * all command modules and handles argv preprocessing.
 */

import { main } from './cli/index.js';

void main();
