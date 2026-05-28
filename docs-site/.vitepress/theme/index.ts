import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { trackPhotonDocsPageView } from './analytics';
import { registerPhotonDocsWebMcp } from './webmcp';

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    if (typeof window !== 'undefined') {
      registerPhotonDocsWebMcp();
      window.requestAnimationFrame(() => trackPhotonDocsPageView());
      router.onAfterRouteChanged = (path) => {
        trackPhotonDocsPageView(path);
      };
    }
  },
};

export default theme;
