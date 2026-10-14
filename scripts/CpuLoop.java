// Native JVM baseline for the CPU benchmark in scripts/benchmark.mjs (same loop). Run: java scripts/CpuLoop.java
public class CpuLoop {
    public static void main(String[] args) {
        long start = System.currentTimeMillis();
        long sum = 0;
        for (int i = 0; i < 20_000_000; i++) {
            sum += i % 7;
        }
        System.out.println("elapsed=" + (System.currentTimeMillis() - start) + " sum=" + sum);
    }
}
