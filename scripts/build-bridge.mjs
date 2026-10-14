// Compiles java/src/ide/*.java to Java 8 bytecode and packages public/runtime/ide-bridge.jar.
// Requires a JDK (11+) on PATH; public/lib/tools.jar supplies the javac tree API used by LoopGuard.
// The jar is committed, so this only needs re-running after bridge changes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sourceDir = join(root, 'java', 'src', 'ide');
const classesDir = join(root, 'build', 'bridge');
const jarPath = join(root, 'public', 'runtime', 'ide-bridge.jar');

rmSync(classesDir, { recursive: true, force: true });
mkdirSync(classesDir, { recursive: true });
mkdirSync(join(root, 'public', 'runtime'), { recursive: true });

const sources = readdirSync(sourceDir).filter((f) => f.endsWith('.java')).map((f) => join(sourceDir, f));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

// CheerpJ runs Java 8, so target 8 bytecode
const toolsJar = join(root, 'public', 'lib', 'tools.jar');
run('javac', ['--release', '8', '-Xlint:-options', '-cp', toolsJar, '-d', classesDir, ...sources]);
run('jar', ['cf', jarPath, '-C', classesDir, '.']);
console.log(`Built ${jarPath}`);
