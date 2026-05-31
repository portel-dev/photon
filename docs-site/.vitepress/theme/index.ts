import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { trackPhotonDocsPageView } from './analytics';
import { registerPhotonDocsWebMcp } from './webmcp';
import './style.css';

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
