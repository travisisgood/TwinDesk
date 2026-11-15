// TwinDesk — Copyright (C) 2026. GPL-3.0, see LICENSE.
import CoreGraphics

@main
struct DragEdgeTest {
  static func main() {
    let main = CGRect(x: 0, y: 0, width: 1440, height: 900)
    let left = CGRect(x: -1920, y: 0, width: 1920, height: 1080)
    let inset: CGFloat = 12
    precondition(!Screens.isOuterEdge(CGPoint(x: 8, y: 450), side: "left", displays: [main]))
    precondition(Screens.isOuterEdge(CGPoint(x: 8, y: 450), side: "left", inset: inset, displays: [main]))
    precondition(!Screens.isOuterEdge(CGPoint(x: 14, y: 450), side: "left", inset: inset, displays: [main]))
    precondition(!Screens.isOuterEdge(CGPoint(x: 8, y: 450), side: "left", inset: inset, displays: [main, left]))
    precondition(Screens.isOuterEdge(CGPoint(x: 1432, y: 450), side: "right", inset: inset, displays: [main, left]))
    precondition(Screens.isOuterEdge(CGPoint(x: 600, y: 8), side: "top", inset: inset, displays: [main]))
    precondition(Screens.isOuterEdge(CGPoint(x: 600, y: 892), side: "bottom", inset: inset, displays: [main]))
    print("Seven native geometry assertions passed.")
  }
}
