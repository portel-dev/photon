export interface BeamRoutePhotonLike {
  name: string;
  namespace?: string;
  shortName?: string;
}

export interface ParsedBeamRoute {
  photonName: string | null;
  methodNames: string[];
}

export function decodeBeamPathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function matchesNamespacedPhoton(
  photon: BeamRoutePhotonLike,
  namespace: string,
  shortName: string
): boolean {
  return photon.namespace === namespace && (photon.shortName || photon.name) === shortName;
}

export function parseBeamRoutePath(
  pathname: string,
  photons: BeamRoutePhotonLike[],
  externalMCPs: BeamRoutePhotonLike[] = []
): ParsedBeamRoute {
  const segments = decodeBeamPathSegments(pathname);
  if (segments.length === 0) {
    return { photonName: null, methodNames: [] };
  }

  if (segments.length === 1) {
    return { photonName: segments[0], methodNames: [] };
  }

  if (segments.length === 2) {
    const [first, second] = segments;
    const namespacedPhoton = photons.find((photon) =>
      matchesNamespacedPhoton(photon, first, second)
    );
    if (namespacedPhoton) {
      return { photonName: namespacedPhoton.name, methodNames: [] };
    }

    return { photonName: first, methodNames: second.split('+').filter(Boolean) };
  }

  const namespace = segments[segments.length - 3];
  const shortName = segments[segments.length - 2];
  const methodSegment = segments[segments.length - 1];
  const namespacedPhoton =
    photons.find((photon) => matchesNamespacedPhoton(photon, namespace, shortName)) ||
    externalMCPs.find((photon) => matchesNamespacedPhoton(photon, namespace, shortName));

  if (namespacedPhoton) {
    return {
      photonName: namespacedPhoton.name,
      methodNames: methodSegment.split('+').filter(Boolean),
    };
  }

  const photonName = segments[segments.length - 2];
  return { photonName, methodNames: methodSegment.split('+').filter(Boolean) };
}

export function buildBeamRoutePath(
  photon: BeamRoutePhotonLike | null,
  methodName?: string | null,
  splitPanelMethodNames: string[] = []
): string {
  if (!photon) return '/';

  const baseSegments =
    photon.namespace && photon.shortName ? [photon.namespace, photon.shortName] : [photon.name];

  if (!methodName) {
    return '/' + baseSegments.map((segment) => encodeURIComponent(segment)).join('/');
  }

  const methodSegments = [methodName, ...splitPanelMethodNames].map((name) =>
    encodeURIComponent(name)
  );
  return (
    '/' +
    baseSegments.map((segment) => encodeURIComponent(segment)).join('/') +
    '/' +
    methodSegments.join('+')
  );
}
