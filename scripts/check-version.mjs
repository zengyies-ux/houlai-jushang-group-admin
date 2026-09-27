import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
if (lock.packages?.['']?.version !== manifest.version)
  throw new Error('package.json 与锁文件版本不一致');
for (const workspace of ['apps/server', 'apps/web', 'packages/shared']) {
  const packageManifest = JSON.parse(readFileSync(`${workspace}/package.json`, 'utf8'));
  if (
    packageManifest.version !== manifest.version ||
    lock.packages?.[workspace]?.version !== manifest.version
  )
    throw new Error(`${workspace} 与根包版本不一致`);
}
for (const [file, field] of [
  ['apps/server/src/app.ts', 'version'],
  ['apps/server/src/maintenance.ts', 'appVersion'],
]) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes(`${field}: '${manifest.version}'`))
    throw new Error(`${file} 中的 ${field} 与根包版本不一致`);
}
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${manifest.version}`)
  throw new Error('Git 标签与应用版本不一致');
console.log(`版本一致: v${manifest.version}`);
