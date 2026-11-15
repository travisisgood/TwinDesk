// Compile with src/Screens.cs and System.Drawing.dll, without WinForms.
using System;
using System.Drawing;
namespace System.Windows.Forms {
    class Screen {
        public Rectangle Bounds;
        public string DeviceName;
        public static Screen[] AllScreens;
        public static Screen PrimaryScreen;
    }
}
namespace MacShare {
    static class Native {
        public struct POINT { public POINT(int x, int y) {} }
        public const uint MONITOR_DEFAULTTONEAREST = 2;
        public static IntPtr MonitorFromPoint(POINT p, uint flags) { return IntPtr.Zero; }
        public static int GetDpiForMonitor(IntPtr mon, uint type, out uint x, out uint y) { x = y = 96; return 0; }
    }
    static class PhysicalDesktopTests {
        static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
        static int Main() {
            var main = new System.Windows.Forms.Screen { DeviceName = "physical", Bounds = new Rectangle(0, 0, 1920, 1080) };
            var left = new System.Windows.Forms.Screen { DeviceName = "left", Bounds = new Rectangle(-1280, 0, 1280, 1024) };
            var backing = new System.Windows.Forms.Screen { DeviceName = "backing", Bounds = new Rectangle(1920, 0, 1440, 900) };
            System.Windows.Forms.Screen.AllScreens = new[] { main, left, backing };
            System.Windows.Forms.Screen.PrimaryScreen = main;
            Screens.AppDisplay = "backing";
            Check(Screens.All().Length == 2, "backing display must not be a physical target");
            Check(Screens.OnOuterEdge(1919, 300, "right"), "physical edge must remain a crossing edge");
            Check(!Screens.Contains(2000, 300), "physical mouse must not enter backing display");
            Check(Screens.Clamp(2000, 300, 1910, 300) == new Point(1919, 300), "overshoot must stop at crossing edge");
            Check(Screens.Clamp(-100, 300, 10, 300) == new Point(-100, 300), "physical monitor-to-monitor movement must remain valid");
            Screens.AppDisplay = "";
            Check(Screens.Contains(2000, 300), "ordinary Extend must keep its normal desktop semantics");
            Console.WriteLine("6 physical-desktop assertions passed");
            return 0;
        }
    }
}
