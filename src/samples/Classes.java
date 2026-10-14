import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Shape> shapes = new ArrayList<>();
        shapes.add(new Circle(1.5));
        shapes.add(new Rectangle(2, 3));

        for (Shape shape : shapes) {
            System.out.printf("%-10s area = %.2f%n", shape.name(), shape.area());
        }
    }
}

interface Shape {
    String name();
    double area();
}

class Circle implements Shape {
    private final double radius;

    Circle(double radius) {
        this.radius = radius;
    }

    public String name() { return "Circle"; }
    public double area() { return Math.PI * radius * radius; }
}

class Rectangle implements Shape {
    private final double width, height;

    Rectangle(double width, double height) {
        this.width = width;
        this.height = height;
    }

    public String name() { return "Rectangle"; }
    public double area() { return width * height; }
}
