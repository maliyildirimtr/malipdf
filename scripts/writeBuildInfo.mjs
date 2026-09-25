// Writes dist-electron/buildInfo.json (version, build number, commit) for
// "About MaliPDF". CI sets GITHUB_RUN_NUMBER / GITHUB_SHA; local builds use git.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let commit = process.env.GITHUB_SHA?.slice(0, 7);
if (!commit) {
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    commit = 'local';
  }
}
const info = {
  version: pkg.version,
  build: process.env.GITHUB_RUN_NUMBER ?? 'local',
  commit,
  date: new Date().toISOString(),
};
mkdirSync(new URL('../dist-electron/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist-electron/buildInfo.json', import.meta.url), `${JSON.stringify(info, null, 2)}\n`);
console.log(`buildInfo: ${info.version} (build ${info.build}, ${info.commit})`);
