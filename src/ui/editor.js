// Monaco Editor set up for Java: workers, snippets, compile-error markers and keyboard shortcuts.
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

self.MonacoEnvironment = {
  // Java has no language worker; the base editor worker covers everything we use
  getWorker: () => new EditorWorker(),
};

const MARKER_OWNER = 'javac';

const SNIPPETS = [
  ['main', 'public static void main(String[] args)', 'public static void main(String[] args) {\n\t$0\n}'],
  ['psvm', 'public static void main(String[] args)', 'public static void main(String[] args) {\n\t$0\n}'],
  ['sout', 'System.out.println()', 'System.out.println($0);'],
  ['souf', 'System.out.printf()', 'System.out.printf("$1%n"$0);'],
  ['fori', 'for loop with index', 'for (int ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {\n\t$0\n}'],
  ['foreach', 'enhanced for loop', 'for (${1:Type} ${2:item} : ${3:items}) {\n\t$0\n}'],
  ['scanner', 'Scanner reading System.in', 'Scanner ${1:in} = new Scanner(System.in);$0'],
  ['class', 'class declaration', 'public class ${1:Name} {\n\t$0\n}'],
  ['trycatch', 'try/catch block', 'try {\n\t$1\n} catch (${2:Exception} ${3:e}) {\n\t$0\n}'],
];

let snippetsRegistered = false;

function registerSnippets() {
  if (snippetsRegistered) return;
  snippetsRegistered = true;
  monaco.languages.registerCompletionItemProvider('java', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      return {
        suggestions: SNIPPETS.map(([label, detail, insertText]) => ({
          label,
          detail,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
      };
    },
  });
}

/**
 * @param {HTMLElement} container
 * @param {{ value: string, theme: 'dark'|'light', onChange: () => void, onRun: () => void, onSave: () => void, onCursor: (pos) => void }} options
 */
export function createEditor(container, options) {
  registerSnippets();

  const editor = monaco.editor.create(container, {
    value: options.value,
    language: 'java',
    theme: themeName(options.theme),
    automaticLayout: true,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
    fontLigatures: false, // students should see the real characters, e.g. <= rather than ≤
    fontSize: 14,
    lineHeight: 22,
    tabSize: 4,
    insertSpaces: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    padding: { top: 12, bottom: 12 },
    renderLineHighlight: 'all',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: 'active', indentation: true },
    stickyScroll: { enabled: false },
    fixedOverflowWidgets: true,
  });

  editor.onDidChangeModelContent(() => options.onChange());
  editor.onDidChangeCursorPosition((e) => options.onCursor(e.position));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => options.onRun());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => options.onSave());

  return {
    getValue: () => editor.getValue(),

    setValue(value) {
      editor.setValue(value);
      editor.setPosition({ lineNumber: 1, column: 1 });
      editor.focus();
    },

    setTheme: (theme) => monaco.editor.setTheme(themeName(theme)),

    /** @param {{severity: string, line: number, column: number, endColumn: number, message: string}[]} diagnostics */
    showDiagnostics(diagnostics) {
      const model = editor.getModel();
      monaco.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        diagnostics.map((d) => {
          const line = Math.min(d.line, model.getLineCount());
          const lineEnd = model.getLineMaxColumn(line);
          const startColumn = Math.min(d.column, lineEnd);
          return {
            severity: d.severity === 'ERROR' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
            message: d.message,
            source: 'javac',
            startLineNumber: line,
            startColumn,
            endLineNumber: line,
            endColumn: Math.max(startColumn + 1, Math.min(d.endColumn, lineEnd)),
          };
        }),
      );
    },

    clearDiagnostics: () => monaco.editor.setModelMarkers(editor.getModel(), MARKER_OWNER, []),

    revealLine(line, column = 1) {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
    },

    /** Briefly highlights a line, used when jumping to a runtime exception frame. */
    flashLine(line) {
      const decorations = editor.createDecorationsCollection([
        { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'line-flash' } },
      ]);
      setTimeout(() => decorations.clear(), 1600);
    },

    focus: () => editor.focus(),
  };
}

function themeName(theme) {
  return theme === 'light' ? 'vs' : 'vs-dark';
}
