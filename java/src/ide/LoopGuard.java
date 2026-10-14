package ide;

import com.sun.source.util.JavacTask;
import com.sun.source.util.TaskEvent;
import com.sun.source.util.TaskListener;
import com.sun.tools.javac.api.BasicJavacTask;
import com.sun.tools.javac.tree.JCTree;
import com.sun.tools.javac.tree.TreeMaker;
import com.sun.tools.javac.tree.TreeTranslator;
import com.sun.tools.javac.util.Context;
import com.sun.tools.javac.util.List;
import com.sun.tools.javac.util.Names;

/**
 * Rewrites every loop body in the parsed source from {@code body} to {@code { ide.Guard.tick(); body }}
 * before javac attributes it. Inserted nodes reuse the loop's source position, so diagnostics and
 * line numbers still point at the student's code.
 */
final class LoopGuard implements TaskListener {

    private final TreeMaker make;
    private final Names names;

    private LoopGuard(Context context) {
        this.make = TreeMaker.instance(context);
        this.names = Names.instance(context);
    }

    static void install(JavacTask task) {
        Context context = ((BasicJavacTask) task).getContext();
        task.addTaskListener(new LoopGuard(context));
    }

    @Override
    public void started(TaskEvent event) {
    }

    @Override
    public void finished(TaskEvent event) {
        if (event.getKind() == TaskEvent.Kind.PARSE) {
            new Translator().translate((JCTree) event.getCompilationUnit());
        }
    }

    private final class Translator extends TreeTranslator {

        @Override
        public void visitWhileLoop(JCTree.JCWhileLoop tree) {
            super.visitWhileLoop(tree);
            tree.body = guard(tree.body);
        }

        @Override
        public void visitDoLoop(JCTree.JCDoWhileLoop tree) {
            super.visitDoLoop(tree);
            tree.body = guard(tree.body);
        }

        @Override
        public void visitForLoop(JCTree.JCForLoop tree) {
            super.visitForLoop(tree);
            tree.body = guard(tree.body);
        }

        @Override
        public void visitForeachLoop(JCTree.JCEnhancedForLoop tree) {
            super.visitForeachLoop(tree);
            tree.body = guard(tree.body);
        }
    }

    private JCTree.JCStatement guard(JCTree.JCStatement body) {
        make.at(body.pos);
        JCTree.JCExpression tick = make.Select(
                make.Select(make.Ident(names.fromString("ide")), names.fromString("Guard")),
                names.fromString("tick"));
        JCTree.JCStatement call = make.Exec(make.Apply(List.<JCTree.JCExpression>nil(), tick,
                List.<JCTree.JCExpression>nil()));
        return make.Block(0, List.of(call, body));
    }
}
