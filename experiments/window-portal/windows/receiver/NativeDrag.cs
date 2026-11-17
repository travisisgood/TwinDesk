using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Concurrent;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Standalone, bounded continuation of an already-held WINDOWS mouse drag.
// No SendInput, button synthesis, cursor warp, source-app access, or KVM changes.
class NativeDrag {
 [StructLayout(LayoutKind.Sequential)] struct POINT { public int X,Y; }
 [StructLayout(LayoutKind.Sequential)] struct RECT { public int L,T,R,B; }
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out RECT rect);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
 [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 static readonly JavaScriptSerializer json=new JavaScriptSerializer();
 static readonly ConcurrentQueue<string> commands=new ConcurrentQueue<string>();
 static volatile bool inputEnded;
 static bool Held(){return (GetAsyncKeyState(1)&0x8000)!=0;}
 static string Topology(){var parts=new System.Collections.Generic.List<string>();foreach(var s in Screen.AllScreens)parts.Add(s.DeviceName+":"+s.Bounds.ToString());parts.Sort(StringComparer.Ordinal);return string.Join("|",parts.ToArray());}
 static void Emit(object value){Console.WriteLine(json.Serialize(value));Console.Out.Flush();}
 static bool Identity(IntPtr h,int pid,long started){uint actual;GetWindowThreadProcessId(h,out actual);if(!IsWindow(h)||actual!=pid)return false;try{return Process.GetProcessById(pid).StartTime.ToUniversalTime().Ticks==started;}catch{return false;}}
 static double Unit(string s){double n=double.Parse(s,System.Globalization.CultureInfo.InvariantCulture);if(double.IsNaN(n)||n<0||n>1)throw new Exception("Invalid anchor");return n;}
 static int Main(string[] args){
  try {
   if(!SetProcessDpiAwarenessContext(new IntPtr(-4)))throw new Exception("Per-monitor DPI context unavailable");
   POINT cursor;
   if(args.Length==1&&args[0]=="--probe") {Emit(new{type="sample",held=Held(),cursorAvailable=GetCursorPos(out cursor),x=cursor.X,y=cursor.Y});return 0;}
   if(args.Length!=6||args[0]!="--follow")throw new Exception("Expected locally bound receiver identity and normalized anchor");
   IntPtr hwnd=new IntPtr(long.Parse(args[1]));int pid=int.Parse(args[2]);long started=Process.GetProcessById(pid).StartTime.ToUniversalTime().Ticks;double anchorX=Unit(args[3]),anchorY=Unit(args[4]);int duration=int.Parse(args[5]);
   if(duration<1||duration>60000)throw new Exception("Continuation must be bounded to 60 seconds");
   if(!Identity(hwnd,pid,started))throw new Exception("Receiver identity mismatch");
   if(IsWindowVisible(hwnd))throw new Exception("Expected hidden receiver before native ownership commit");
   var reader=new Thread(()=>{try{string line;while((line=Console.ReadLine())!=null){if(line.Length>64)break;commands.Enqueue(line);}}finally{inputEnded=true;}});reader.IsBackground=true;reader.Start();
   var clock=Stopwatch.StartNew();long leaseAt=0,lastSample=-50,lastTopology=0;string topology=Topology();bool committed=false,finished=false;string reason="deadline";
   while(clock.ElapsedMilliseconds<duration){
    if(inputEnded){reason="broker-disconnected";break;}
    if(!Identity(hwnd,pid,started)){reason="receiver-identity-lost";break;}
    if(clock.ElapsedMilliseconds-leaseAt>1500){reason="ownership-lease-expired";break;}
    if(clock.ElapsedMilliseconds-lastTopology>=100){lastTopology=clock.ElapsedMilliseconds;if(Topology()!=topology){reason="topology-changed";break;}}
    bool held=Held();if(!GetCursorPos(out cursor)){reason="cursor-unavailable";break;}
    string command;
    while(commands.TryDequeue(out command)){
     if(command=="lease")leaseAt=clock.ElapsedMilliseconds;
     else if(command=="cancel"){reason="cancelled";finished=true;break;}
     else if(command=="commit"&&!committed){
      if(!held){reason="button-released-before-commit";finished=true;break;}
      RECT bounds;if(!GetWindowRect(hwnd,out bounds)){reason="bounds-unavailable";finished=true;break;}
      int x=cursor.X-(int)Math.Round((bounds.R-bounds.L)*anchorX),y=cursor.Y-(int)Math.Round((bounds.B-bounds.T)*anchorY);
      if(!SetWindowPos(hwnd,IntPtr.Zero,x,y,0,0,0x0051)){reason="placement-failed";finished=true;break;} // NOSIZE|NOACTIVATE|SHOWWINDOW, native HWND only
      RECT actual;
      if(!Held()||!IsWindowVisible(hwnd)||!GetWindowRect(hwnd,out actual)||Math.Abs(actual.L-x)>1||Math.Abs(actual.T-y)>1){reason="placement-not-confirmed";finished=true;break;}
      committed=true;Emit(new{type="committed",x=actual.L,y=actual.T,held=true});
     }else if(command!="commit"){reason="invalid-command";finished=true;break;}
    }
    if(finished)break;
    if(committed){
     if(!held){reason="button-up";break;}
     RECT bounds;if(!GetWindowRect(hwnd,out bounds)||!SetWindowPos(hwnd,IntPtr.Zero,cursor.X-(int)Math.Round((bounds.R-bounds.L)*anchorX),cursor.Y-(int)Math.Round((bounds.B-bounds.T)*anchorY),0,0,0x0015)){reason="placement-failed";break;}
    }
    if(clock.ElapsedMilliseconds-lastSample>=50){lastSample=clock.ElapsedMilliseconds;Emit(new{type="sample",held,x=cursor.X,y=cursor.Y,committed});}
    Thread.Sleep(16);
   }
   // A normal up leaves the window where the user released it. Every abort
   // hides the receiver; source recovery remains the authenticated broker's job.
   if(reason!="button-up"&&Identity(hwnd,pid,started))ShowWindow(hwnd,0);
   Emit(new{type="ended",reason,committed});return reason=="button-up"?0:2;
  }catch(Exception error){Emit(new{type="error",reason=error.Message});return 1;}
 }
}
