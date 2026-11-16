using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
using System.IO;
using System.Drawing.Imaging;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class Native {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; public POINT(int x,int y){X=x;Y=y;} }
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h,int a,ref int v,int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int a,out RECT v,int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int a,out int v,int size);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h,ref POINT p);
  [DllImport("user32.dll")] static extern IntPtr ChildWindowFromPointEx(IntPtr h,POINT p,uint flags);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  static void Dpi(){try{if(SetProcessDpiAwarenessContext(new IntPtr(-4)))return;}catch{}SetProcessDPIAware();}
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
  static JavaScriptSerializer json = new JavaScriptSerializer();
  static Form form;
  static IntPtr target, child;
  static Process guard;
  static int clicks,ticks;
  static int originalX,originalY;
  static TextBox input;
  static long Number(Dictionary<string,object> c,string key) { return Convert.ToInt64(c[key]); }
  static void Write(object value){ Console.WriteLine(json.Serialize(value));Console.Out.Flush(); }
  static void Restore() { if(target!=IntPtr.Zero && IsWindow(target)){int off=0;DwmSetWindowAttribute(target,13,ref off,4);SetWindowPos(target,IntPtr.Zero,originalX,originalY,0,0,0x4015);} }
  static RECT Frame(){ RECT r; if(DwmGetWindowAttribute(target,9,out r,16)!=0)GetWindowRect(target,out r);return r; }
  static object Command(Dictionary<string,object> c){
    string cmd=(string)c["cmd"];
    if(cmd=="select"){
      Restore(); if(guard!=null){guard.StandardInput.WriteLine("done");guard.StandardInput.Close();guard=null;}
      target=new IntPtr(Number(c,"wid"));child=IntPtr.Zero;
      if(!IsWindow(target))throw new Exception("Source window is no longer available");
      RECT original;GetWindowRect(target,out original);originalX=original.L;originalY=original.T;
      // Separate process restores the source if this helper or Electron crashes.
      var info=new ProcessStartInfo(Application.ExecutablePath,"watch "+Process.GetCurrentProcess().Id+" "+target.ToInt64()+" "+originalX+" "+originalY);
      info.UseShellExecute=false;info.CreateNoWindow=true;info.RedirectStandardInput=true;
      guard=Process.Start(info);
      uint pid;GetWindowThreadProcessId(target,out pid);
      return new {wid=target.ToInt64(),processName=Process.GetProcessById((int)pid).ProcessName};
    }
    if(cmd=="status"){
      int cloaked=0;if(target!=IntPtr.Zero)DwmGetWindowAttribute(target,14,out cloaked,4);
      POINT p;GetCursorPos(out p);
      RECT bounds=Frame();
      return new {wid=target.ToInt64(),cloaked,clicks,ticks,text=input.Text,cursor=new{x=p.X,y=p.Y},bounds=new{x=bounds.L,y=bounds.T,width=bounds.R-bounds.L,height=bounds.B-bounds.T}};
    }
    if(cmd=="restore"){Restore();return new {restored=true};}
    if(target==IntPtr.Zero || !IsWindow(target))throw new Exception("Select an existing source window first");
    if(cmd=="cloak"){
      int v=Convert.ToBoolean(c["on"])?1:0;
      int hr=DwmSetWindowAttribute(target,13,ref v,4);
      if(hr!=0)throw new Exception("Cloak rejected: 0x"+hr.ToString("X8"));
      return new {cloaked=v==1};
    }
    if(cmd=="park"){
      Rectangle desktop=SystemInformation.VirtualScreen;
      int px=c.ContainsKey("x")?(int)Number(c,"x"):desktop.Right+200;
      int py=c.ContainsKey("y")?(int)Number(c,"y"):desktop.Top+40;
      if(!SetWindowPos(target,IntPtr.Zero,px,py,0,0,0x4015))throw new Exception("Could not move source");
      return new{queued=true};
    }
    if(cmd=="click"){
      RECT frame=Frame();
      int sx=frame.L+(int)(Convert.ToDouble(c["x"])*(frame.R-frame.L));
      int sy=frame.T+(int)(Convert.ToDouble(c["y"])*(frame.B-frame.T));
      IntPtr h=target;
      for(int i=0;i<12;i++){POINT p=new POINT(sx,sy);ScreenToClient(h,ref p);IntPtr next=ChildWindowFromPointEx(h,p,7);if(next==IntPtr.Zero||next==h)break;h=next;}
      POINT local=new POINT(sx,sy);ScreenToClient(h,ref local);child=h;
      var className=new StringBuilder(256);GetClassName(h,className,256);
      if(className.ToString().StartsWith("Button",StringComparison.OrdinalIgnoreCase)||className.ToString().StartsWith("WindowsForms10.BUTTON",StringComparison.OrdinalIgnoreCase)){
        PostMessage(h,0xF5,IntPtr.Zero,IntPtr.Zero);return new {posted=true,route="button-invoke"};
      }
      IntPtr position=new IntPtr((local.X&65535)|((local.Y&65535)<<16));
      PostMessage(h,0x201,new IntPtr(1),position);PostMessage(h,0x202,IntPtr.Zero,position);
      return new {posted=true,route="mouse-messages"}; // Posted is not proof that the app accepted it.
    }
    if(cmd=="text"){
      if(child==IntPtr.Zero)throw new Exception("Click the text control first");
      foreach(char ch in ((string)c["text"]).Substring(0,Math.Min(256,((string)c["text"]).Length)))PostMessage(child,0x102,new IntPtr(ch),IntPtr.Zero);
      return new {posted=true};
    }
    throw new Exception("Unknown command");
  }
  [STAThread] static void Main(string[] args){
    if(args.Length==2 && args[0]=="print"){
      Dpi();IntPtr h=new IntPtr(long.Parse(args[1]));RECT r,v;
      if(!IsWindow(h)||!GetWindowRect(h,out r))return;
      int w=r.R-r.L,height=r.B-r.T;if(w<=0||height<=0||(long)w*height>16000000)return;
      using(var bitmap=new Bitmap(w,height))using(var g=Graphics.FromImage(bitmap)){
        IntPtr dc=g.GetHdc();bool ok;try{ok=PrintWindow(h,dc,2);}finally{g.ReleaseHdc(dc);}
        if(!ok)return;
        if(DwmGetWindowAttribute(h,9,out v,16)!=0)v=r;
        var crop=Rectangle.Intersect(new Rectangle(0,0,w,height),new Rectangle(v.L-r.L,v.T-r.T,v.R-v.L,v.B-v.T));
        using(var cropped=bitmap.Clone(crop,PixelFormat.Format32bppArgb))using(var bytes=new MemoryStream()){
          cropped.Save(bytes,ImageFormat.Png);Write(new{image="data:image/png;base64,"+Convert.ToBase64String(bytes.ToArray())});
        }
      }return;
    }
    if(args.Length==5 && args[0]=="watch"){
      IntPtr h=new IntPtr(long.Parse(args[2]));
      var done=new ManualResetEvent(false);
      new Thread(()=>{Console.ReadLine();done.Set();}){IsBackground=true}.Start();
      try{var owner=Process.GetProcessById(int.Parse(args[1]));while(!owner.HasExited&&!done.WaitOne(200)){} }catch{}
      if(IsWindow(h)){int off=0;DwmSetWindowAttribute(h,13,ref off,4);SetWindowPos(h,IntPtr.Zero,int.Parse(args[3]),int.Parse(args[4]),0,0,0x4015);}return;
    }
    Dpi();Application.EnableVisualStyles();
    form=new Form{Text="WindowPortal Test Source",ClientSize=new Size(440,230),StartPosition=FormStartPosition.Manual,Location=new Point(Screen.PrimaryScreen.WorkingArea.Left+60,Screen.PrimaryScreen.WorkingArea.Top+60)};
    var label=new Label{Location=new Point(15,15),Size=new Size(400,45),Font=new Font("Segoe UI",18)};
    var button=new Button{Text="Test click (0)",Location=new Point(20,75),Size=new Size(190,42)};
    button.Click+=(s,e)=>{clicks++;button.Text="Test click ("+clicks+")";Write(new{eventName="clicked",clicks});};
    input=new TextBox{Location=new Point(20,135),Size=new Size(360,30)};
    var note=new Label{Text="Disposable test only. No display driver or global input.",Location=new Point(20,180),AutoSize=true};
    form.Controls.AddRange(new Control[]{label,button,input,note});
    var timer=new System.Windows.Forms.Timer{Interval=250};
    timer.Tick+=(s,e)=>{ticks++;label.Text="Live frame "+ticks;form.BackColor=ticks%2==0?Color.LightBlue:Color.LightGreen;};timer.Start();
    form.Shown+=(s,e)=>{
      if(args.Length==1 && args[0]=="controller")form.Hide();
      RECT frame;DwmGetWindowAttribute(form.Handle,9,out frame,16);
      Point center=button.PointToScreen(new Point(button.Width/2,button.Height/2));
      Write(new {eventName="ready",wid=form.Handle.ToInt64(),buttonX=(double)(center.X-frame.L)/(frame.R-frame.L),buttonY=(double)(center.Y-frame.T)/(frame.B-frame.T)});
      new Thread(()=>{string line;while((line=Console.ReadLine())!=null){string text=line;try{form.BeginInvoke((Action)(()=>{Dictionary<string,object> c=null;try{c=json.Deserialize<Dictionary<string,object>>(text);Write(new{id=c["id"],ok=true,result=Command(c)});}catch(Exception ex){Write(new{id=c==null?null:c["id"],ok=false,error=ex.Message});}}));}catch{break;}}try{form.BeginInvoke((Action)(()=>form.Close()));}catch{} }){IsBackground=true}.Start();
    };
    form.FormClosing+=(s,e)=>Restore();
    Application.Run(form);Restore();
    if(guard!=null){try{guard.StandardInput.Close();}catch{}}
  }
}
