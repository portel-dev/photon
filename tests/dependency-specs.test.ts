import assert from 'node:assert/strict';
import { SourceDependencySpecParser } from '../src/dependency-specs.js';

const parser = new SourceDependencySpecParser();

assert.deepEqual(
  parser.parse(`/**\n * @dependencies axios@^1.0.0, @scope/pkg@2.0.0?, sharp\n */`),
  [
    { name: 'axios', version: '^1.0.0' },
    { name: '@scope/pkg', version: '2.0.0', optional: true },
    { name: 'sharp', version: '*' },
  ]
);

assert.deepEqual(parser.parse('const value = "@dependencies fake@1.0.0";'), []);
assert.deepEqual(parser.parse('/** @dependencies bad name@1.0.0, good@1.0.0 */'), [
  { name: 'good', version: '1.0.0' },
]);

assert.deepEqual(
  parser.merge(
    [
      { name: 'one', version: '1' },
      { name: 'two', version: '1' },
    ],
    [
      { name: 'one', version: '2' },
      { name: 'three', version: '1' },
    ]
  ),
  [
    { name: 'one', version: '2' },
    { name: 'two', version: '1' },
    { name: 'three', version: '1' },
  ]
);

console.log('dependency-specs tests passed');
