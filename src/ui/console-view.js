// Terminal-style console: program output, inline input prompts and formatted runtime errors.

const MAX_CHARS = 400_000;
// Output goes into block-level chunks of about this size, split at line breaks. With all output in
// one inline run, the browser re-laid out everything printed so far on every frame.
const CHUNK_CHARS = 4_096;

export class ConsoleView {
  /**
   * @param {HTMLElement} element
   * @param {{
   *   onFrameClick?: (line: number) => void,
   *   sourceFile?: () => string,
   *   findMethodLine?: (className: string, method: string) => number|null,
   * }} options
   */
  constructor(element, options = {}) {
    this.element = element;
    this.options = options;
    this.lastStream = null;
    this.lastText = null;
    this.outputBlock = null;
    this.blockChars = 0;
    this.charCount = 0;
    this.activeInput = null;
    this.pending = [];
    this.flushFrame = 0;
    this.flushTimer = 0;
  }

  clear() {
    this.cancelInput();
    this.cancelFlush();
    this.pending = [];
    this.element.replaceChildren();
    this.lastStream = null;
    this.lastText = null;
    this.outputBlock = null;
    this.charCount = 0;
  }

  /**
   * Queues program output. Writes are applied at most once per frame: touching the DOM and
   * scrolling on every println made output time grow quadratically with the number of lines.
   */
  write(stream, text) {
    if (!text) return;
    this.pending.push([stream, text]);
    if (!this.flushFrame) {
      this.flushFrame = requestAnimationFrame(() => this.flush());
      // requestAnimationFrame does not fire in background tabs
      this.flushTimer = setTimeout(() => this.flush(), 100);
    }
  }

  /** Applies queued output to the DOM. */
  flush() {
    this.cancelFlush();
    if (!this.pending.length) return;
    for (const [stream, text] of this.pending) this.appendText(stream, text);
    this.pending = [];
    this.trim();
    this.scrollToEnd();
  }

  cancelFlush() {
    cancelAnimationFrame(this.flushFrame);
    clearTimeout(this.flushTimer);
    this.flushFrame = 0;
    this.flushTimer = 0;
  }

  appendText(stream, text) {
    // Split after each line break so a full chunk ends cleanly and the next line starts a new block
    for (const piece of text.match(/[^\n]*\n|[^\n]+/g)) {
      const blockFull = this.blockChars >= CHUNK_CHARS && this.lastText?.data.endsWith('\n');
      if (!this.outputBlock || blockFull) {
        this.outputBlock = document.createElement('div');
        this.outputBlock.className = 'out-block';
        this.insert(this.outputBlock);
        this.blockChars = 0;
        this.lastText = null;
      }
      if (this.lastStream !== stream || !this.lastText) {
        const span = document.createElement('span');
        span.className = `out out-${stream}`;
        this.lastText = document.createTextNode('');
        span.append(this.lastText);
        this.outputBlock.append(span);
        this.lastStream = stream;
      }
      this.lastText.appendData(piece);
      this.blockChars += piece.length;
      this.charCount += piece.length;
    }
  }

  /** A status line from the IDE itself (compiling, finished, ...). */
  system(message, tone = 'info') {
    this.breakLine();
    const line = document.createElement('div');
    line.className = `sys sys-${tone}`;
    line.textContent = message;
    this.insert(line);
    this.endBlock();
  }

  /** Renders an uncaught exception with clickable stack frames. */
  exception(info) {
    this.breakLine();
    const block = document.createElement('div');
    block.className = 'exception';
    this.renderException(block, info, false);
    this.insert(block);
    this.endBlock();
  }

  renderException(block, info, isCause) {
    const title = document.createElement('div');
    title.className = 'exception-title';
    const type = document.createElement('strong');
    type.textContent = (isCause ? 'Caused by: ' : 'Exception: ') + info.type;
    title.append(type);
    if (info.message) title.append(document.createTextNode(`: ${info.message}`));
    block.append(title);

    const hint = explainException(info.type);
    if (hint && !isCause) {
      const help = document.createElement('div');
      help.className = 'exception-hint';
      help.textContent = hint;
      block.append(help);
    }

    const list = document.createElement('ol');
    list.className = 'frames';
    for (const frame of info.frames) {
      const item = document.createElement('li');
      // CheerpJ may omit file names and line numbers; fall back to the method's declaration in the editor
      const sourceFile = this.options.sourceFile?.();
      const declarationLine = frame.line > 0 ? null : this.options.findMethodLine?.(frame.className, frame.method);
      const file = frame.file ?? (declarationLine ? sourceFile : null);
      const isUserCode = file === sourceFile && (frame.line > 0 || declarationLine);
      const targetLine = frame.line > 0 ? frame.line : declarationLine;
      const location =
        frame.line > 0 ? `${file}:${frame.line}` : declarationLine ? `${file}, declared at line ${declarationLine}` : file ?? 'Unknown Source';
      const label = `at ${frame.className}.${frame.method} (${location})`;
      if (isUserCode) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'frame-link';
        button.textContent = label;
        button.title = `Go to line ${targetLine}`;
        button.addEventListener('click', () => this.options.onFrameClick?.(targetLine));
        item.append(button);
      } else {
        item.className = 'frame-library';
        item.textContent = label;
      }
      list.append(item);
    }
    block.append(list);
    if (info.cause) this.renderException(block, info.cause, true);
  }

  /** Shows an inline input field and resolves with the entered line (null on Ctrl+D). */
  requestInput() {
    this.cancelInput();
    // The prompt (e.g. "Name: ") must be on screen before the input field
    this.flush();
    return new Promise((resolve) => {
      const wrapper = document.createElement('span');
      wrapper.className = 'input-line';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'console-input';
      input.setAttribute('aria-label', 'Program input');
      input.autocomplete = 'off';
      input.spellcheck = false;
      wrapper.append(input);
      // Inside the current output block, so the field sits on the same line as the prompt
      (this.outputBlock ?? this.element).append(wrapper);
      this.lastStream = null;
      this.scrollToEnd();
      input.focus({ preventScroll: true });

      const finish = (value) => {
        this.activeInput = null;
        wrapper.remove();
        if (value !== null && value !== undefined) this.write('stdin', `${value}\n`);
        else if (value === null) this.write('stdin', '^D\n');
        resolve(value);
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(input.value);
        } else if (event.key === 'd' && event.ctrlKey) {
          event.preventDefault();
          finish(null);
        }
      });
      this.activeInput = { wrapper, cancel: () => { wrapper.remove(); this.activeInput = null; resolve(undefined); } };
    });
  }

  cancelInput() {
    this.activeInput?.cancel();
  }

  focusInput() {
    this.activeInput?.wrapper.querySelector('input')?.focus();
  }

  insert(node) {
    this.element.append(node);
  }

  /** Flushes queued output and makes sure the next block starts on a new line. */
  breakLine() {
    this.flush();
    if (this.lastText && !this.lastText.data.endsWith('\n')) this.appendText(this.lastStream, '\n');
  }

  endBlock() {
    this.lastStream = null;
    this.lastText = null;
    this.outputBlock = null;
    this.scrollToEnd();
  }

  trim() {
    while (this.charCount > MAX_CHARS && this.element.firstChild) {
      const first = this.element.firstChild;
      this.charCount -= first.textContent.length;
      if (first === this.outputBlock) {
        this.outputBlock = null;
        this.lastText = null;
        this.lastStream = null;
      }
      first.remove();
    }
  }

  scrollToEnd() {
    const scroller = this.element.parentElement;
    scroller.scrollTop = scroller.scrollHeight;
  }
}

const HINTS = {
  'java.lang.ArrayIndexOutOfBoundsException': 'An array was accessed with an index outside its valid range (0 to length - 1).',
  'java.lang.StringIndexOutOfBoundsException': 'A string position was outside the valid range (0 to length() - 1).',
  'java.lang.IndexOutOfBoundsException': 'A list or collection was accessed with an index outside its size.',
  'java.lang.NullPointerException': 'A variable that holds null was used as if it referred to an object.',
  'java.lang.ArithmeticException': 'An invalid arithmetic operation occurred, such as dividing an integer by zero.',
  'java.lang.NumberFormatException': 'Text could not be converted to a number. Check the value being parsed.',
  'java.lang.ClassCastException': 'An object was cast to a type it is not an instance of.',
  'java.util.InputMismatchException': 'The input did not match the expected type, e.g. text where a number was expected.',
  'java.util.NoSuchElementException': 'Input was requested but none was available (end of input).',
  'java.lang.StackOverflowError': 'The call stack overflowed, usually because of infinite recursion.',
  'java.lang.OutOfMemoryError': 'The program ran out of memory.',
};

export function explainException(type) {
  return HINTS[type] ?? null;
}
