using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation;
class ExplorerInput {
 [StructLayout(LayoutKind.Sequential)]struct RECT{public int L,T,R,B;}
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr c);
 [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr h,int attr,out RECT r,int size);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out RECT r);
 [STAThread]static void Main(string[] args){
  var json=new JavaScriptSerializer();
  try{
   SetProcessDpiAwarenessContext(new IntPtr(-4));
   IntPtr handle=new IntPtr(long.Parse(args[1]));uint pid;GetWindowThreadProcessId(handle,out pid);
   if(Process.GetProcessById((int)pid).ProcessName!="explorer")throw new Exception("Explorer-only action refused");
   var root=AutomationElement.FromHandle(handle);
   var headers=root.FindAll(TreeScope.Descendants,new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.HeaderItem),new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.SplitButton),new PropertyCondition(AutomationElement.NameProperty,"Name"))));
   if(args[0]=="inspect"){
    var rows=new List<object>();
    foreach(AutomationElement e in headers){var r=e.Current.BoundingRectangle;var patterns=new List<string>();foreach(var p in e.GetSupportedPatterns())patterns.Add(p==null?"unknown":p.ProgrammaticName);rows.Add(new{name=e.Current.Name,type=e.Current.ControlType==null?"unknown":e.Current.ControlType.ProgrammaticName,x=r.X,y=r.Y,width=r.Width,height=r.Height,patterns});}
    RECT f;if(DwmGetWindowAttribute(handle,9,out f,16)!=0)throw new Exception("Window bounds unavailable");Console.WriteLine(json.Serialize(new{headers=rows,frame=new{x=f.L,y=f.T,width=f.R-f.L,height=f.B-f.T}}));return;
   }
   if(args[0]!="press"||args.Length!=4)throw new Exception("Unsupported operation");
   double nx=double.Parse(args[2],CultureInfo.InvariantCulture),ny=double.Parse(args[3],CultureInfo.InvariantCulture);
   if(double.IsNaN(nx)||double.IsNaN(ny)||nx<0||nx>1||ny<0||ny>1)throw new Exception("Invalid point");
   RECT frame;if(DwmGetWindowAttribute(handle,9,out frame,16)!=0&&!GetWindowRect(handle,out frame))throw new Exception("Window disappeared");
   var point=new Point(frame.L+nx*(frame.R-frame.L),frame.T+ny*(frame.B-frame.T));
   foreach(AutomationElement e in headers){
    if(e.Current.ProcessId!=(int)pid||!e.Current.BoundingRectangle.Contains(point))continue;
    string invokedName=e.Current.Name;object pattern;string route;
    if(e.TryGetCurrentPattern(InvokePattern.Pattern,out pattern)){((InvokePattern)pattern).Invoke();route="header-invoke";}

    else throw new Exception("Header has no supported action");
    Console.WriteLine(json.Serialize(new{dispatched=true,route,name=invokedName}));return;
   }
   throw new Exception("Only Explorer column header actions are currently supported");
  }catch(Exception e){Console.WriteLine(json.Serialize(new{error=e.Message}));}
 }
}




