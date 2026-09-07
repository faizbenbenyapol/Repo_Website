import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CHANGELOG_DIR = join(ROOT, 'docs', 'changelog');
export const CHANGELOG_FILE = join(ROOT, 'CHANGELOG.md');
export const ROOT_PACKAGE = join(ROOT, 'package.json');
export const WORKSPACE_PACKAGES = [
  join(ROOT, 'packages', 'shared', 'package.json'),
  join(ROOT, 'packages', 'analyzer', 'package.json'),
  join(ROOT, 'packages', 'db', 'package.json'),
  join(ROOT, 'apps', 'api', 'package.json'),
  join(ROOT, 'apps', 'web', 'package.json'),
  join(ROOT, 'apps', 'worker', 'package.json'),
];
