package ide;

import com.sun.source.util.JavacTask;

import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.PrintStream;
import java.io.Writer;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.security.Permission;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Long-lived helper started once from JavaScript with cheerpjRunMain("ide.Bridge", ...).
 *
 * Starting a Java main through CheerpJ costs seconds, so instead of one call per action the bridge
 * loops, receiving commands from the page through {@link #nextCommand()}:
 *
 *   compile SEP buildDir SEP FileName.java SEP sourceText SEP guard|noguard  ->  event "compiled"
 *   run SEP classDir SEP mainClass [SEP arg...]              ->  event "exited"
 *
 * Every command ends with exactly one terminal event ("compiled", "exited" or "failed").
 * The native methods are implemented in JavaScript (src/runtime/java-runtime.js).
 */
public final class Bridge {

    // Control characters that cannot appear in normal source text or console input (must match java-runtime.js)
    static final String SEPARATOR = String.valueOf((char) 1);
    static final String STOP_TOKEN = (char) 0 + "__STOP__";
    static final String EOF_TOKEN = (char) 0 + "__EOF__";

    /** Waits for the next command from the page. */
    static native String nextCommand();

    /** Writes program output to the console. Returns 1 if the user pressed Stop. */
    static native int write(String stream, String text);

    /** Sends a structured event (JSON payload) to the page. */
    static native void emit(String type, String json);

    /** Waits until the user enters a line in the console. */
    static native String readLine();

    /** Briefly yields to the browser. Returns 1 if the user pressed Stop. */
    static native int pause();

    private static JavaCompiler javac;
    private static volatile boolean trapExit;

    private Bridge() {
    }

    public static void main(String[] args) {
        installExitTrap();
        emit("ready", Json.object("javaVersion", System.getProperty("java.version")));
        while (true) {
            String[] command = nextCommand().split(SEPARATOR, -1);
            try {
                if (command.length == 5 && "compile".equals(command[0])) {
                    compile(command[1], command[2], command[3], !"noguard".equals(command[4]));
                } else if (command.length >= 3 && "run".equals(command[0])) {
                    run(command[1], command[2], Arrays.copyOfRange(command, 3, command.length));
                } else {
                    emit("failed", Json.object("message", "Invalid bridge command: " + command[0]));
                }
            } catch (Throwable t) {
                emit("failed", Json.object("message", "Internal IDE error: " + t));
            }
        }
    }

    // ------------------------------------------------------------------ compile

    static void compile(String buildDir, String fileName, String sourceText, boolean loopGuard) throws Exception {
        long start = System.currentTimeMillis();
        File build = new File(buildDir);
        deleteSiblings(build);
        File sourceFile = new File(new File(build, "src"), fileName);
        File out = new File(build, "classes");
        sourceFile.getParentFile().mkdirs();
        out.mkdirs();
        Writer writer = new OutputStreamWriter(new FileOutputStream(sourceFile), StandardCharsets.UTF_8);
        try {
            writer.write(sourceText);
        } finally {
            writer.close();
        }

        if (javac == null) {
            // javac from tools.jar, loaded reflectively so the bridge has no compile-time dependency on it
            javac = (JavaCompiler) Class.forName("com.sun.tools.javac.api.JavacTool").getMethod("create").invoke(null);
        }
        DiagnosticCollector<JavaFileObject> collector = new DiagnosticCollector<JavaFileObject>();
        StandardJavaFileManager fileManager =
                javac.getStandardFileManager(collector, Locale.ENGLISH, StandardCharsets.UTF_8);
        List<File> files = Collections.singletonList(sourceFile);
        List<String> options = Arrays.asList(
                "-d", out.getPath(), "-g", "-encoding", "UTF-8", "-proc:none", "-Xlint:unchecked,deprecation");

        boolean success;
        try {
            JavacTask task = (JavacTask) javac.getTask(null, fileManager, collector, options, null,
                    fileManager.getJavaFileObjectsFromFiles(files));
            if (loopGuard) {
                LoopGuard.install(task);
            }
            success = task.call();
        } finally {
            fileManager.close();
        }

        StringBuilder diagnostics = new StringBuilder("[");
        for (Diagnostic<? extends JavaFileObject> d : collector.getDiagnostics()) {
            if (diagnostics.length() > 1) {
                diagnostics.append(',');
            }
            long column = Math.max(1, d.getColumnNumber());
            long length = 1;
            if (d.getStartPosition() != Diagnostic.NOPOS && d.getEndPosition() != Diagnostic.NOPOS) {
                length = Math.max(1, d.getEndPosition() - d.getStartPosition());
            }
            String file = d.getSource() == null ? "" : new File(d.getSource().getName()).getName();
            diagnostics.append(Json.object(
                    "severity", d.getKind().name(),
                    "file", file,
                    "line", Math.max(1, d.getLineNumber()),
                    "column", column,
                    "endColumn", column + length,
                    "message", d.getMessage(Locale.ENGLISH)));
        }
        diagnostics.append(']');

        emit("compiled", Json.object(
                "success", success,
                "classDir", out.getPath(),
                "millis", System.currentTimeMillis() - start,
                "diagnostics", new Json.Raw(diagnostics.toString())));
    }

    /** Removes output from previous builds so stale classes never leak into a new run. */
    private static void deleteSiblings(File dir) {
        File parent = dir.getParentFile();
        File[] children = parent == null ? null : parent.listFiles();
        if (children == null) {
            return;
        }
        for (File child : children) {
            if (!child.getName().equals(dir.getName())) {
                deleteRecursively(child);
            }
        }
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        file.delete();
    }

    // ---------------------------------------------------------------------- run

    static void run(String classDir, String mainClass, String[] programArgs) throws Exception {
        PrintStream originalOut = System.out;
        PrintStream originalErr = System.err;
        InputStream originalIn = System.in;

        PrintStream out = new PrintStream(new ConsoleOutputStream("stdout"), true, "UTF-8");
        PrintStream err = new PrintStream(new ConsoleOutputStream("stderr"), true, "UTF-8");
        System.setOut(out);
        System.setErr(err);
        System.setIn(new ConsoleInputStream());

        String status = "completed";
        int exitCode = 0;
        long start = System.currentTimeMillis();
        try {
            // A fresh class loader per run, so an edited class is never served from cache
            URL classes = new URL("file:" + classDir + "/");
            URLClassLoader loader = new URLClassLoader(new URL[]{classes}, Bridge.class.getClassLoader());
            Method main = findMain(loader, mainClass);
            if (main != null) {
                start = System.currentTimeMillis();
                Guard.reset();
                trapExit = true;
                main.invoke(null, (Object) programArgs);
            } else {
                status = "error";
                exitCode = 1;
            }
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            if (cause instanceof ExceptionInInitializerError && cause.getCause() != null) {
                cause = cause.getCause();
            }
            if (cause instanceof StopSignal) {
                status = "stopped";
                exitCode = 130;
            } else if (cause instanceof ExitSignal) {
                exitCode = ((ExitSignal) cause).status;
            } else {
                status = "exception";
                exitCode = 1;
                emit("exception", describe(cause));
            }
        } catch (StopSignal e) {
            status = "stopped";
            exitCode = 130;
        } finally {
            trapExit = false;
            try {
                out.flush();
                err.flush();
            } catch (StopSignal ignored) {
                // output after Stop is discarded
            }
            System.setOut(originalOut);
            System.setErr(originalErr);
            System.setIn(originalIn);
        }
        emit("exited", Json.object(
                "status", status,
                "code", exitCode,
                "millis", System.currentTimeMillis() - start));
    }

    private static Method findMain(ClassLoader loader, String mainClass) {
        Class<?> type;
        try {
            type = Class.forName(mainClass, false, loader);
        } catch (ClassNotFoundException e) {
            emit("error", Json.object("message", "Could not find class '" + mainClass + "'."));
            return null;
        }
        try {
            Method main = type.getMethod("main", String[].class);
            if (Modifier.isStatic(main.getModifiers())) {
                main.setAccessible(true);
                return main;
            }
        } catch (NoSuchMethodException ignored) {
            // reported below
        }
        emit("error", Json.object("message",
                "Class '" + mainClass + "' has no method: public static void main(String[] args)"));
        return null;
    }

    /** While a program runs, System.exit(n) throws an ExitSignal instead of shutting down the JVM. */
    private static void installExitTrap() {
        try {
            System.setSecurityManager(new SecurityManager() {
                @Override
                public void checkExit(int status) {
                    if (trapExit) {
                        throw new ExitSignal(status);
                    }
                }

                @Override
                public void checkPermission(Permission perm) {
                    // allow everything else
                }

                @Override
                public void checkPermission(Permission perm, Object context) {
                    // allow everything else
                }
            });
        } catch (Throwable ignored) {
            // without the trap, System.exit ends the runtime; the page reports it and offers a reset
        }
    }

    // ------------------------------------------------------------- exceptions

    static String describe(Throwable t) {
        StringBuilder frames = new StringBuilder("[");
        for (StackTraceElement frame : t.getStackTrace()) {
            String cls = frame.getClassName();
            // Everything below the user's main() is reflection and IDE plumbing
            if (cls.startsWith("sun.reflect.") || cls.startsWith("java.lang.reflect.") || cls.startsWith("ide.")) {
                break;
            }
            if (frames.length() > 1) {
                frames.append(',');
            }
            frames.append(Json.object(
                    "className", cls,
                    "method", frame.getMethodName(),
                    "file", frame.getFileName(),
                    "line", frame.getLineNumber()));
        }
        frames.append(']');

        Throwable cause = t.getCause();
        return Json.object(
                "type", t.getClass().getName(),
                "message", t.getMessage(),
                "frames", new Json.Raw(frames.toString()),
                "cause", cause == null || cause == t ? null : new Json.Raw(describe(cause)));
    }

    /** Thrown into user code when the Stop button is pressed. */
    static final class StopSignal extends Error {
        StopSignal() {
            super("Program stopped by user", null, false, false);
        }
    }

    /** Thrown into user code when it calls System.exit. */
    static final class ExitSignal extends SecurityException {
        final int status;

        ExitSignal(int status) {
            super("System.exit(" + status + ")");
            this.status = status;
        }
    }
}
