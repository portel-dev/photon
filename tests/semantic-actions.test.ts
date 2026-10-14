import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSemanticAction,
  requestCurrentLocation,
  type GeolocationLike,
} from '../src/auto-ui/frontend/utils/semantic-actions.js';

test('coordinate semantics expose a geolocation action', () => {
  assert.deepEqual(getSemanticAction('latitude', { type: 'number' }), {
    action: 'geolocation',
    target: 'latitude',
    label: 'Use current location',
  });
  assert.deepEqual(getSemanticAction('longitude', { type: 'number' }), {
    action: 'geolocation',
    target: 'longitude',
    label: 'Use current location',
  });
  assert.equal(getSemanticAction('amount', { type: 'number' }), undefined);
});

test('explicit semantic formats take precedence over field names', () => {
  assert.deepEqual(getSemanticAction('amount', { type: 'number', format: 'latitude' }), {
    action: 'geolocation',
    target: 'latitude',
    label: 'Use current location',
  });
  assert.equal(getSemanticAction('latitude', { type: 'number', format: 'decimal' }), undefined);
});

test('current location resolves numeric coordinates and accuracy', async () => {
  const geolocation: GeolocationLike = {
    getCurrentPosition(success) {
      success({
        coords: { latitude: 1.3521, longitude: 103.8198, accuracy: 12 },
        timestamp: 123,
      });
    },
  };

  assert.deepEqual(await requestCurrentLocation(geolocation), {
    latitude: 1.3521,
    longitude: 103.8198,
    accuracy: 12,
    timestamp: 123,
  });
});

test('location permission failures become safe user-facing errors', async () => {
  const geolocation: GeolocationLike = {
    getCurrentPosition(_success, error) {
      error?.({ code: 1, message: 'denied' });
    },
  };

  await assert.rejects(requestCurrentLocation(geolocation), {
    code: 'permission-denied',
    message: 'Location permission was denied. Enter coordinates manually.',
  });
});
