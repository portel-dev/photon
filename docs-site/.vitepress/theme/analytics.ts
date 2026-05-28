declare const __PHOTON_GA_MEASUREMENT_ID__: string;

type GtagCommand = 'config' | 'event' | 'js';

type Gtag = (command: GtagCommand, target: string | Date, params?: Record<string, unknown>) => void;

function gtag(): Gtag | undefined {
  return (window as Window & { gtag?: Gtag }).gtag;
}

function pagePath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function trackPhotonDocsPageView(path = pagePath()) {
  if (!__PHOTON_GA_MEASUREMENT_ID__ || typeof window === 'undefined') {
    return;
  }

  gtag()?.('config', __PHOTON_GA_MEASUREMENT_ID__, {
    page_path: path,
    page_title: document.title,
    page_location: window.location.href,
  });
}
