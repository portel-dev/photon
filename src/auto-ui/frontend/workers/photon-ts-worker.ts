import type {
  PhotonTsWorkerRequest,
  PhotonTsWorkerResponse,
} from '../../../editor-support/photon-ts-protocol.js';
import { createPhotonTsService } from '../../../editor-support/photon-ts-service.js';

const service = createPhotonTsService();

self.onmessage = (event: MessageEvent<PhotonTsWorkerRequest>) => {
  const response: PhotonTsWorkerResponse = service.handleRequest(event.data);
  self.postMessage(response);
};
