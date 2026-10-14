public class Main {
    public static void main(String[] args) throws InterruptedException {
        long tick = 0;
        while (true) {
            System.out.println("tick " + tick++ + " - press Stop to end the program");
            Thread.sleep(250);
        }
    }
}
