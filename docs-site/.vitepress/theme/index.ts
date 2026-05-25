import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { registerPhotonDocsWebMcp } from './webmcp';

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp() {
    if (typeof window !== 'undefined') {
      registerPhotonDocsWebMcp();
    }
  },
};

export default theme;
