import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const destination = resolve(root, '.cache/pages-public');
mkdirSync(destination, { recursive: true });
const files = [];
function retain(source, target = source, transform) {
  const original = readFileSync(resolve(root, source));
  const bytes = transform ? Buffer.from(transform(original.toString('utf8'))) : original;
  const output = resolve(destination, target);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes);
  files.push({ source, path: target, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const module of ['app', 'model', 'data', 'ai-examples']) {
  retain(`docs/try/${module}.mjs`, `docs/try/${module}.js`, source => source.replace(/from (['"])\.\/(model|data|ai-examples)\.mjs\1/g, "from './$2.js'"));
}
retain('docs/try/index.html', 'docs/try/index.html', source => source.replace('./app.mjs', './app.js'));
retain('docs/try/style.css');
for (const path of ['public/duke-cs-logo.png', 'public/campusworks-logo.svg', 'LICENSE', 'docs/demo/index.html']) retain(path);
const gallery = readFileSync('docs/demo/index.html', 'utf8');
const names = [...new Set([...gallery.matchAll(/src="screenshots\/([^"/]+\.png)"/g)].map(match => match[1]))];
if (names.length !== 15) throw new Error('The published gallery must contain fifteen source captures.');
for (const name of names) retain(`docs/demo/screenshots/${name}`);
const landing = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=./docs/try/"><title>CampusWorks</title></head><body><a href="./docs/try/">Open the CampusWorks four-role browser demo</a></body></html>\n';
writeFileSync(resolve(destination, 'index.html'), landing);
writeFileSync(resolve(destination, '404.html'), landing);
writeFileSync(resolve(destination, '.nojekyll'), '');
writeFileSync(resolve(destination, 'README.md'), `# CampusWorks browser demo

Try the four-role workflow at https://userzeroa.github.io/campusworks-demo/.

Choose a Student, TA, Instructor or Administrator identity. Explore TA/RA applications, offers, clearance, dated TA course access, office-hour queues and course insights. The initial workspace includes 41 synthetic people, ten courses, 21 positions and 68 applications. Changes stay in your browser; Reset demo restores its initial scenario.

This public GitHub Pages experience uses browser-local state. It does not run the full application's Node/MongoDB backend, upload documents or contact OpenAI. The AI panels are labeled saved examples from actual OpenAI responses. No API Key is embedded or requested here.

The full application uses Nuxt, Vue, TypeScript, Node.js, MongoDB transactions and server-side OpenAI assistance. The [product gallery](docs/demo/index.html) contains genuine application captures. Browser-demo code and synthetic data are the only application artifacts published by this repository; the full application repository retains its existing access settings.

All people, workload and feedback are synthetic. This is an independent project demonstration, not an institutional service. The proprietary terms in LICENSE apply.
`);
const allowed = new Set([...files.map(file => file.path), 'index.html', '404.html', '.nojekyll', 'README.md']);
function verifyDirectory(directory = destination) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const name = relative(destination, path).replaceAll('\\', '/');
    if (directory === destination && entry.name === '.git' && entry.isDirectory()) continue;
    if (entry.isSymbolicLink()) throw new Error('The public package must not contain symbolic links.');
    if (entry.isDirectory()) verifyDirectory(path);
    else if (!allowed.has(name)) throw new Error(`Unexpected public artifact: ${name}. Move it outside the public package before publishing.`);
  }
}
verifyDirectory();
const content = [...allowed].filter(path => /\.(?:js|html|css|md)$/.test(path)).map(path => readFileSync(resolve(destination,path),'utf8')).join('\n');
if (/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) throw new Error('A credential pattern was found in the public package.');
writeFileSync(resolve(root,'.cache/browser-demo-package.json'), JSON.stringify({ output: relative(root,destination).replaceAll('\\','/'), scope:'Allowlisted static browser demo and genuine product gallery only; no private application source, runtime settings, database or Key files.', files }, null, 2)+'\n');
console.log(`Prepared ${files.length + 4} public static files in ${relative(root,destination)}.`);
