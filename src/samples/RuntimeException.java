public class Main {
    public static void main(String[] args) {
        int[] scores = {72, 85, 91};
        System.out.println("Average: " + average(scores, 4));
    }

    static double average(int[] values, int count) {
        int sum = 0;
        for (int i = 0; i < count; i++) {
            sum += values[i];
        }
        return (double) sum / count;
    }
}
