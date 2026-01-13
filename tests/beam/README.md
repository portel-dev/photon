# BEAM UI Tests

Automated E2E tests for BEAM (Photon's interactive UI).

## Structure

```
tests/beam/
├── README.md
├── helpers.ts          # Test utilities and BeamContext
├── fixtures/
│   └── demo.photon.ts  # Test photon with predictable outputs
├── rendering.test.ts   # Table, markdown, mermaid rendering
├── interaction.test.ts # Marketplace, elicitation, navigation
└── snapshots/          # Visual regression snapshots
```

## Running Tests

```bash
# Run all BEAM tests
npm run test:beam

# Run with visible browser (debugging)
HEADLESS=false npm run test:beam

# Update snapshots
UPDATE_SNAPSHOTS=true npm run test:beam
```

## Writing Tests

```typescript
import { withBeam, expect } from './helpers';

await withBeam(async (beam) => {
  // Navigate to a method
  await beam.selectMethod('demo', 'getString');

  // Check result rendering
  await beam.expectResult({
    type: 'primitive',
    value: 'Hello from Photon!'
  });

  // Check table rendering
  await beam.selectMethod('demo', 'getUsers');
  await beam.expectResult({
    type: 'grid-table',
    columns: ['id', 'name', 'email'],
    rowCount: 3
  });

  // Visual snapshot
  await beam.snapshot('users-table');
});
```
