// Records which CheerpJ runtime files the IDE needs, for preloading at start-up.
//
// Loads the production build with preloading off, runs a representative set of programs
// (compile, compile errors, exceptions, console input, Stop, System.exit and common library
// classes), then saves cjGetRuntimeResources() to src/runtime/preload-resources.json.
//
// Usage: npm run profile:preload   (re-run after changing the CheerpJ version or the bridge)
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';

const OUTPUT = 'src/runtime/preload-resources.json';
const samples = (name) => readFileSync(`src/samples/${name}.java`, 'utf8');

// Classes students commonly use, so their parts of the class library are preloaded too
const LIBRARY_TOUR = `import java.util.*;
import java.util.function.*;
import java.util.stream.*;

public class Main {
    enum Color { RED, GREEN }

    public static void main(String[] args) throws Exception {
        List<Integer> list = new ArrayList<>(Arrays.asList(5, 3, 8, 1));
        Collections.sort(list);
        LinkedList<String> linked = new LinkedList<>();
        linked.add("a");
        Map<String, Integer> counts = new HashMap<>();
        counts.merge("x", 1, Integer::sum);
        TreeMap<String, Integer> tree = new TreeMap<>(counts);
        Set<Integer> set = new HashSet<>(list);
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(1);
        PriorityQueue<Integer> queue = new PriorityQueue<>(list);
        Iterator<Integer> it = list.iterator();
        while (it.hasNext()) it.next();

        String s = String.join(",", "a", "b").toUpperCase().substring(1).trim();
        StringBuilder sb = new StringBuilder().append(s).reverse();
        String formatted = String.format("%5.2f %d %s %c", Math.PI, 42, sb, 'c');
        int parsed = Integer.parseInt("12") + (int) Double.parseDouble("1.5");
        char[] chars = "hello".toCharArray();
        Arrays.sort(chars);
        int[] numbers = {3, 1, 2};
        Arrays.sort(numbers);
        System.out.println(Arrays.toString(numbers) + " " + String.valueOf(chars) + " " + formatted + " " + parsed);

        Random random = new Random(1);
        double value = Math.sqrt(Math.pow(random.nextInt(10), 2)) + Math.max(1, 2) + Math.abs(-1) + Math.random();
        long rounded = Math.round(value);

        Function<Integer, Integer> square = x -> x * x;
        Supplier<String> supplier = () -> "supplied";
        Predicate<Integer> even = x -> x % 2 == 0;
        List<Integer> squares = list.stream().filter(even.negate()).map(square).collect(Collectors.toList());
        int total = IntStream.rangeClosed(1, 10).sum();
        Optional<Integer> max = list.stream().max(Comparator.naturalOrder());
        System.out.printf("%s %d %s %s %d %s %s%n", squares, total, max.orElse(0), supplier.get(), rounded, Color.GREEN, tree);

        Object o = Integer.valueOf(3);
        if (o instanceof Integer) System.out.println(((Integer) o).compareTo(2) + " " + Character.isDigit('7') + " " + Long.MAX_VALUE);

        try {
            Object[] objects = new String[1];
            objects[0] = 1;
        } catch (ArrayStoreException e) {
            System.err.println(e.getClass().getSimpleName());
        }
        try {
            throw new IllegalStateException("checked");
        } catch (IllegalStateException | IllegalArgumentException e) {
            System.out.println(e.getMessage());
        }
        try {
            Integer.parseInt("not a number");
        } catch (NumberFormatException e) {
            System.out.println("NumberFormatException");
        }
        Thread worker = new Thread(() -> System.out.println("thread"));
        worker.start();
        worker.join();
        Thread.sleep(10);
        System.out.println(System.currentTimeMillis() > 0 && System.nanoTime() > 0);
    }
}
`;

const EXTRA_PROGRAMS = [
  `public class Main {
    public static void main(String[] args) {
        String s = null;
        System.out.println(s.length());
    }
}
`,
  `public class Main {
    public static void main(String[] args) {
        System.out.println(10 / Integer.parseInt("0"));
    }
}
`,
  `public class Main {
    public static void main(String[] args) {
        System.out.println("exit");
        System.exit(2);
    }
}
`,
  `package com.example;

class App {
    public static void main(String[] args) {
        System.out.println(new java.util.Scanner("1 2").nextInt());
    }
}
`,
];

const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);

async function waitIdle(page) {
  await page.waitForFunction(() => document.getElementById('stop-button').disabled, null, { timeout: 120_000 });
}

async function run(page, source, { input = [], stopAfterMs = 0 } = {}) {
  await page.evaluate((code) => window.__javaIde.setSource(code), source);
  await page.click('#run-button');
  for (const line of input) {
    const field = page.locator('.console-input');
    await field.waitFor({ timeout: 60_000 });
    await field.fill(line);
    await field.press('Enter');
    await field.waitFor({ state: 'detached' });
  }
  if (stopAfterMs) {
    await page.waitForTimeout(stopAfterMs);
    await page.click('#stop-button');
  }
  await waitIdle(page);
}

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto('http://localhost:4174/?preload=off');
  await page.waitForFunction(() => !document.getElementById('run-button').disabled, null, { timeout: 300_000 });
  log('runtime ready');

  await run(page, samples('HelloWorld'));
  await run(page, samples('Classes'));
  await run(page, samples('CompileError'));
  await run(page, samples('RuntimeException'));
  await run(page, samples('ConsoleInput'), { input: ['Ada', '36'] });
  await run(page, samples('InfiniteLoop'), { stopAfterMs: 1_000 });
  await run(page, 'public class Main { public static void main(String[] a) { long n = 0; while (true) { n++; } } }', { stopAfterMs: 1_000 });
  for (const program of EXTRA_PROGRAMS) await run(page, program);
  await run(page, LIBRARY_TOUR);
  const tour = await page.locator('#console-output').innerText();
  if (!tour.includes('exit code 0')) throw new Error(`Library tour did not finish cleanly:\n${tour}`);
  log('programs finished');

  const resources = JSON.parse(await page.evaluate(() => window.cjGetRuntimeResources()));
  const ranges = Object.values(resources).reduce((sum, list) => sum + list.length / 2, 0);
  writeFileSync(
    OUTPUT,
    JSON.stringify(
      {
        note: 'Generated by scripts/profile-runtime-resources.mjs. Regenerate after changing the CheerpJ or Java version.',
        cheerpjVersion: '4.3',
        javaVersion: 8,
        resources,
      },
      null,
      2,
    ) + '\n',
  );
  log(`Wrote ${OUTPUT}: ${Object.keys(resources).length} files, about ${ranges} ranges`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
