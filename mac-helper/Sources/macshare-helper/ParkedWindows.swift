// TwinDesk — Copyright (C) 2026. GPL-3.0, see LICENSE.
import Cocoa
import ApplicationServices

/// One isolated display per transferred window. The AX reference and original frame survive
/// capture failure and are available during helper stdin shutdown.
final class ParkedWindows {
  static let shared = ParkedWindows()
  private final class Entry {
    let display = VirtualDisplay()
    let window: AXUIElement
    let home: CGRect
    var moved = false

    init(window: AXUIElement, home: CGRect) {
      self.window = window
      self.home = home
    }
  }

  private var entries: [Int: Entry] = [:]

  func park(wid: Int, pid: Int, done: @escaping (Result<[String: Any], HelperError>) -> Void) {
    guard wid > 0, wid <= Int(UInt32.max), entries[wid] == nil, entries.count < 4,
          let (window, owner) = Apps.ax(for: wid), owner == pid, let frame = Apps.frame(window),
          let identity = Apps.identity(pid: owner), frame.width <= 3680, frame.height <= 2000 else {
      return done(.failure(HelperError(message: "This window cannot be transferred")))
    }
    let entry = Entry(window: window, home: frame)
    entries[wid] = entry
    let width = max(1280, Int(ceil(frame.width + 160)))
    let height = max(900, Int(ceil(frame.height + 160)))
    entry.display.create(width: width, height: height, hiDPI: false, hz: 60,
                         name: "TwinDesk Window \(wid)", product: 0x4d54, serial: UInt32(wid)) { result in
      guard self.entries[wid] === entry else {
        return done(.failure(HelperError(message: "Window transfer cancelled")))
      }
      guard case .success(var info) = result, let id = entry.display.displayID else {
        self.restore(wid: wid)
        if case .failure(let error) = result { return done(.failure(error)) }
        return done(.failure(HelperError(message: "Window backing display unavailable")))
      }
      let bounds = CGDisplayBounds(id)
      entry.moved = true
      let placed = Apps.move(window, to: CGPoint(x: bounds.minX + 24, y: bounds.minY + 48))
      guard placed, let actual = Apps.frame(window), bounds.contains(actual) else {
        self.restore(wid: wid)
        return done(.failure(HelperError(message: "macOS did not place the window on its backing display")))
      }
      info["app"] = identity
      done(.success(info))
    }
  }

  func restore(wid: Int, atCursor: Bool = false) {
    guard let entry = entries.removeValue(forKey: wid) else { return }
    if entry.moved {
      let displays = Screens.displays()
      let cursor = CGEvent(source: nil)?.location
      let display = (atCursor ? cursor.flatMap { point in displays.first { $0.contains(point) } } : nil)
        ?? displays.max { $0.intersection(entry.home).area < $1.intersection(entry.home).area }
        ?? CGDisplayBounds(CGMainDisplayID())
      let frame = Apps.frame(entry.window) ?? entry.home
      let preferred = (atCursor ? cursor.map { CGPoint(x: $0.x - frame.width / 2, y: $0.y - 12) } : nil)
        ?? entry.home.origin
      let point = CGPoint(x: min(max(preferred.x, display.minX), max(display.minX, display.maxX - frame.width)),
                          y: min(max(preferred.y, display.minY + 24), max(display.minY + 24, display.maxY - frame.height)))
      _ = Apps.move(entry.window, to: point)
    }
    entry.display.destroy() // macOS also rehomes remaining windows when the display disappears.
  }

  func restoreAll() {
    for wid in Array(entries.keys) { restore(wid: wid) }
  }
}

private extension CGRect {
  var area: CGFloat { isNull ? 0 : width * height }
}
