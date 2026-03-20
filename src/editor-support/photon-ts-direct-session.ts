import { createPhotonTsService } from './photon-ts-service.js';
import { PhotonTsSession } from './photon-ts-session.js';

export function createDirectPhotonTsSession(): PhotonTsSession {
  const service = createPhotonTsService();
  return new PhotonTsSession({
    send(request) {
      return service.handleRequest(request);
    },
  });
}
