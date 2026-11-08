import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';

/** Locate npm without assuming the Windows Node installation layout. */
export function resolveNpmCli({ executable = process.execPath, environment = process.env, platform = process.platform, exists = existsSync } = {}) {
  const paths = platform === 'win32' ? win32 : posix;
  const directory = paths.dirname(executable);
  const candidates = [
    environment.npm_execpath,
    paths.join(directory, 'node_modules/npm/bin/npm-cli.js'),
    paths.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js'),
    ...(platform === 'win32' ? [] : ['/usr/share/nodejs/npm/bin/npm-cli.js', '/usr/lib/node_modules/npm/bin/npm-cli.js']),
  ];
  const cli = candidates.find(candidate => typeof candidate === 'string' && candidate.length > 0 && exists(candidate));
  if (!cli) throw new Error('npm could not be located. Install a supported Node.js version and run this command through npm.');
  return cli;
}
