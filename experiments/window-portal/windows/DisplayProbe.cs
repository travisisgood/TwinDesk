using System;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
class DisplayProbe {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  static void Main() {
    SetProcessDPIAware();
    Console.WriteLine(new JavaScriptSerializer().Serialize(MacShare.Display.List()));
  }
}
