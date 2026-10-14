// Example programs, also used as the representative test programs for evaluation.
import helloWorld from './HelloWorld.java?raw';
import consoleInput from './ConsoleInput.java?raw';
import classes from './Classes.java?raw';
import compileError from './CompileError.java?raw';
import runtimeException from './RuntimeException.java?raw';
import infiniteLoop from './InfiniteLoop.java?raw';

export const examples = [
  { id: 'hello', title: 'Hello World', source: helloWorld },
  { id: 'input', title: 'Console input (Scanner)', source: consoleInput },
  { id: 'classes', title: 'Classes and interfaces', source: classes },
  { id: 'compile-error', title: 'Compilation errors', source: compileError },
  { id: 'runtime-error', title: 'Runtime exception', source: runtimeException },
  { id: 'loop', title: 'Long-running loop (Stop)', source: infiniteLoop },
];
