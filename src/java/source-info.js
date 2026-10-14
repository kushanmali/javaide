// Lightweight analysis of a Java source file: enough to pick the file name and main class
// without a full parser. Comments and literals are blanked first so they cannot confuse the regexes.

/** Replaces comments, strings and char literals with spaces, keeping offsets and line breaks intact. */
export function stripCommentsAndLiterals(source) {
  let out = '';
  let i = 0;
  const blank = (text) => text.replace(/[^\n]/g, ' ');

  while (i < source.length) {
    const rest = source.slice(i);
    let match =
      rest.match(/^\/\/[^\n]*/) ||
      rest.match(/^\/\*[\s\S]*?(\*\/|$)/) ||
      rest.match(/^"""[\s\S]*?("""|$)/) ||
      rest.match(/^"(?:\\.|[^"\\\n])*("|$)/m) ||
      rest.match(/^'(?:\\.|[^'\\\n])*('|$)/m);
    if (match) {
      out += blank(match[0]);
      i += match[0].length;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

export function findPackage(source) {
  const match = stripCommentsAndLiterals(source).match(/^\s*package\s+([\w.]+)\s*;/m);
  return match ? match[1] : null;
}

/** Top-level type declarations with their body text (depth-1 contents). */
export function findTopLevelTypes(source) {
  const code = stripCommentsAndLiterals(source);
  const types = [];
  const declaration = /\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;
  let depth = 0;
  let index = 0;

  while (index < code.length) {
    declaration.lastIndex = index;
    const match = declaration.exec(code);
    const nextBrace = code.slice(index).search(/[{}]/);
    const braceIndex = nextBrace === -1 ? -1 : index + nextBrace;

    if (match && depth === 0 && (braceIndex === -1 || match.index < braceIndex)) {
      const header = code.slice(lineStart(code, match.index), match.index);
      const open = code.indexOf('{', match.index);
      if (open === -1) break;
      const close = matchingBrace(code, open);
      types.push({
        kind: match[1],
        name: match[2],
        isPublic: /\bpublic\b/.test(header),
        body: code.slice(open + 1, close === -1 ? code.length : close),
      });
      index = close === -1 ? code.length : close + 1;
      continue;
    }
    if (braceIndex === -1) break;
    depth += code[braceIndex] === '{' ? 1 : -1;
    index = braceIndex + 1;
  }
  return types;
}

function lineStart(code, index) {
  const previous = code.lastIndexOf(';', index);
  const brace = Math.max(code.lastIndexOf('}', index), code.lastIndexOf('{', index));
  return Math.max(previous, brace, 0);
}

function matchingBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

const MAIN_METHOD = /\bstatic\b[^;{}()]*\bvoid\s+main\s*\(\s*(final\s+)?String\s*(\[\s*\]\s*[\w$]+|[\w$]+\s*\[\s*\]|\.\.\.\s*[\w$]+)\s*\)/;

/** Returns the source's file name, main class (fully qualified) and top-level types. */
export function analyzeSource(source) {
  const packageName = findPackage(source);
  const types = findTopLevelTypes(source);
  const publicType = types.find((t) => t.isPublic);
  const mainType =
    (publicType && hasMain(publicType) && publicType) || types.find(hasMain) || null;

  const qualify = (name) => (packageName ? `${packageName}.${name}` : name);
  const baseName = publicType?.name ?? mainType?.name ?? types[0]?.name ?? 'Main';

  return {
    packageName,
    fileName: `${baseName}.java`,
    mainClass: mainType ? qualify(mainType.name) : null,
    types: types.map(({ kind, name, isPublic }) => ({ kind, name, isPublic })),
  };
}

function hasMain(type) {
  // Only consider methods directly inside the type, not in nested classes
  return MAIN_METHOD.test(depthOneText(type.body));
}

function depthOneText(body) {
  let depth = 0;
  let out = '';
  for (const ch of body) {
    if (ch === '{') depth++;
    if (depth === 0) out += ch;
    if (ch === '}') depth--;
  }
  return out;
}

/**
 * Finds the line where a method is declared. Used for stack frames that carry no line number
 * (CheerpJ does not always report them). Returns null when the declaration cannot be found.
 * @param {string} source
 * @param {string} className  binary name, e.g. "Main" or "com.example.Outer$Inner"
 * @param {string} method     method name; "<init>" for constructors, "<clinit>" for static initialisers
 */
export function findMethodLine(source, className, method) {
  if (method === '<clinit>') return null;
  const code = stripCommentsAndLiterals(source);
  const simpleName = className.split('.').pop().split('$').pop();
  const name = method === '<init>' ? simpleName : method;
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || !/^[A-Za-z_$][\w$]*$/.test(simpleName)) return null;

  const typeMatch = new RegExp(String.raw`\b(class|interface|enum|record)\s+${escape(simpleName)}\b`).exec(code);
  if (!typeMatch) return null;
  const open = code.indexOf('{', typeMatch.index);
  if (open === -1) return null;
  const end = matchingBrace(code, open);
  const body = code.slice(open + 1, end === -1 ? code.length : end);

  // A declaration: name(params) [throws ...] { — excluding calls such as `x = name(...)` or `new Name(...)`
  const declaration = new RegExp(String.raw`(^|[\s>\]])${escape(name)}\s*\([^;{}]*\)\s*(throws\s[\w$.,\s]+)?\{`, 'g');
  let match;
  while ((match = declaration.exec(body))) {
    const before = body.slice(Math.max(0, match.index - 40), match.index + match[1].length);
    if (/\b(new|return)\s*$/.test(before) || /[=(,.]\s*$/.test(before)) continue;
    const offset = open + 1 + match.index + match[1].length;
    return code.slice(0, offset).split('\n').length;
  }
  return null;
}

function escape(text) {
  return text.replace(/[$]/g, String.raw`\$`);
}
