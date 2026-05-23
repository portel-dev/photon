import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const templatePath = path.join(process.cwd(), 'templates', 'cloudflare', 'worker.ts.template');

describe('Cloudflare schedule provider template', () => {
  it('matches the local ScheduleProvider name and status management surface', () => {
    const source = fs.readFileSync(templatePath, 'utf8');

    for (const method of ['getByName', 'cancelByName', 'has', 'pause', 'resume']) {
      expect(source).toContain(`async ${method}(`);
    }
  });
});
