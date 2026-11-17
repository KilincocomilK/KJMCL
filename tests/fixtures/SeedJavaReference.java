// Regenerate seed-java-reference.json with JDK 17+: java SeedJavaReference.java.
// Uses java.lang.String.hashCode, Long.parseLong and java.util.Random directly.
import java.util.Random;
public class SeedJavaReference {
  public static void main(String[] args) {
    String[] texts = {"0", "+000262", "-9223372036854775808", "9223372036854775807", "9223372036854775808", "9007199254740993", "Minecraft", "种子地图", "🌱", "\uD800", "Aa", "BB"};
    System.out.print("{\"source\":\"JDK java.lang.String.hashCode / Long.parseLong / java.util.Random\",\"seeds\":[");
    for (int i=0; i<texts.length; i++) {
      if(i>0) System.out.print(",");
      long seed;
      try { seed=Long.parseLong(texts[i]); } catch(NumberFormatException e) { seed=texts[i].hashCode(); }
      System.out.print("\""+seed+"\"");
    }
    System.out.print("],\"slime\":[");
    long[] seeds={0L,262L,-1L,9007199254740993L,Long.MIN_VALUE,Long.MAX_VALUE};
    int[][] chunks={{0,0},{1,1},{-1,-1},{35,-70},{-90,123},{46341,-46341},{1874999,-1875000},{-1875000,1874999},{150,-96},{-345,-223},{-16,5},{17,-300}};
    boolean first=true;
    for(long seed:seeds) for(int[] c:chunks) {
      int x=c[0],z=c[1];
      // Java int products are deliberately promoted at the same positions as Minecraft.
      boolean slime=new Random(seed+(long)(x*x*4987142)+(long)(x*5947611)+(long)(z*z)*4392871L+(long)(z*389711)^987234911L).nextInt(10)==0;
      if(!first) System.out.print(","); first=false;
      System.out.print("[\""+seed+"\","+x+","+z+","+slime+"]");
    }
    System.out.println("]}");
  }
}
