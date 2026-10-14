// Builds public/lib/tools.jar: the parts of the JDK 8 tools.jar that javac needs.
//
// The full tools.jar is 18.3 MB, most of it javadoc, RMI, CORBA and the debugger, which the IDE never
// uses. Every byte of it is downloaded by the browser before the first compile, so only the compiler,
// its resources and the tree API used by LoopGuard are kept.
//
// Usage: node scripts/build-tools-jar.mjs <full-tools.jar>
// The stripped jar is committed, so this only needs re-running when the JDK 8 source jar changes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// javac itself, the tree API (com.sun.source, used by LoopGuard) and javac's message bundles
const KEEP = ['com/sun/tools/javac/*', 'com/sun/source/*', 'com/sun/tools/doclint/*'];

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/build-tools-jar.mjs <full-tools.jar>');
  process.exit(1);
}
const output = new URL('../public/lib/tools.jar', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const work = mkdtempSync(join(tmpdir(), 'tools-jar-'));
const mb = (file) => (statSync(file).size / 1048576).toFixed(1);

try {
  execFileSync('jar', ['xf', source, ...KEEP.map((p) => p.replace('/*', ''))], { cwd: work, stdio: 'inherit' });
  execFileSync('jar', ['cf', output, '.'], { cwd: work, stdio: 'inherit' });
  console.log(`Built ${output}: ${mb(output)} MB (from ${mb(source)} MB)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
