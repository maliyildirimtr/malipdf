// @pdf-lib/fontkit ships without TypeScript declarations.
declare module '@pdf-lib/fontkit' {
  import type { Fontkit } from 'pdf-lib/cjs/types/fontkit';
  const fontkit: Fontkit;
  export default fontkit;
}
