import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeSource, findMethodLine, stripCommentsAndLiterals } from '../src/java/source-info.js';

const sample = (name) => readFileSync(new URL(`../src/samples/${name}.java`, import.meta.url), 'utf8');

describe('stripCommentsAndLiterals', () => {
  it('blanks comments and strings but keeps line structure', () => {
    const code = 'int a = 1; // class Fake\nString s = "class Other {";\n/* multi\nline */ int b;';
    const stripped = stripCommentsAndLiterals(code);
    expect(stripped).not.toContain('Fake');
    expect(stripped).not.toContain('Other');
    expect(stripped.split('\n')).toHaveLength(code.split('\n').length);
    expect(stripped).toHaveLength(code.length);
  });
});

describe('analyzeSource', () => {
  it('uses the public class for the file name and main class', () => {
    expect(analyzeSource(sample('HelloWorld'))).toMatchObject({ fileName: 'Main.java', mainClass: 'Main' });
  });

  it('handles several top-level types', () => {
    const info = analyzeSource(sample('Classes'));
    expect(info.mainClass).toBe('Main');
    expect(info.types.map((t) => t.name)).toEqual(['Main', 'Shape', 'Circle', 'Rectangle']);
  });

  it('qualifies the main class with its package', () => {
    const info = analyzeSource('package com.example.app;\n\npublic class App {\n  public static void main(String... args) {}\n}\n');
    expect(info).toMatchObject({ packageName: 'com.example.app', fileName: 'App.java', mainClass: 'com.example.app.App' });
  });

  it('finds main in a non-public class', () => {
    const info = analyzeSource('class Helper {}\nclass Program {\n  static void main(String args[]) {}\n}\n');
    expect(info).toMatchObject({ fileName: 'Program.java', mainClass: 'Program' });
  });

  it('ignores main methods in nested classes, comments and strings', () => {
    const source = [
      'public class Outer {',
      '  // public static void main(String[] args) {}',
      '  String s = "static void main(String[] a)";',
      '  static class Inner { public static void main(String[] args) {} }',
      '}',
    ].join('\n');
    expect(analyzeSource(source).mainClass).toBeNull();
  });

  it('defaults to Main.java when there are no types', () => {
    expect(analyzeSource('// nothing yet')).toMatchObject({ fileName: 'Main.java', mainClass: null });
  });
});

describe('findMethodLine', () => {
  it('locates method declarations for stack frames without line numbers', () => {
    const source = sample('RuntimeException');
    expect(findMethodLine(source, 'Main', 'main')).toBe(2);
    expect(findMethodLine(source, 'Main', 'average')).toBe(7);
  });

  it('skips calls and finds constructors and nested types', () => {
    const source = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    int a = helper(2);',
      '    new Box(1);',
      '  }',
      '  static int helper(int x) {',
      '    return x;',
      '  }',
      '  static class Box {',
      '    Box(int v) {',
      '    }',
      '  }',
      '}',
    ].join('\n');
    expect(findMethodLine(source, 'Main', 'helper')).toBe(6);
    expect(findMethodLine(source, 'Main$Box', '<init>')).toBe(10);
    expect(findMethodLine(source, 'Main', 'missing')).toBeNull();
    expect(findMethodLine(source, 'java.util.ArrayList', 'get')).toBeNull();
  });
});
