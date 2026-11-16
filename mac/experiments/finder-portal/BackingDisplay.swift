import Cocoa
import VirtualDisplayBridge

// Standalone, session-owned display. Window return/close never changes topology.
// Private CGVirtualDisplay API, using the repository's existing DeskPad header.
@main struct BackingDisplayProbe {
    static var display: CGVirtualDisplay?
    static func emit(_ value: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self)); fflush(stdout)
    }
    static func topology() -> [[String: Any]] {
        var ids = [CGDirectDisplayID](repeating: 0, count: 32), count: UInt32 = 0
        guard CGGetActiveDisplayList(32, &ids, &count) == .success else { return [] }
        return ids.prefix(Int(count)).map { id in
            let r = CGDisplayBounds(id)
            return ["id": id, "x": r.minX, "y": r.minY, "width": r.width, "height": r.height]
        }
    }
    @MainActor static func main() {
        let seconds = CommandLine.arguments.count == 2 ? Int(CommandLine.arguments[1]) ?? 0 : 180
        guard (30...3600).contains(seconds) else { emit(["error": "Duration must be 30..3600 seconds"]); return }
        let app = NSApplication.shared
        Task { @MainActor in
            let before = topology()
            let descriptor = CGVirtualDisplayDescriptor()
            descriptor.name = "Finder Portal Backing (Experiment)"
            descriptor.vendorID = 0x4d53; descriptor.productID = 0x4650; descriptor.serialNum = 1
            descriptor.maxPixelsWide = 1280; descriptor.maxPixelsHigh = 900
            descriptor.sizeInMillimeters = CGSize(width: 340, height: 239)
            descriptor.setDispatchQueue(.main)
            descriptor.terminationHandler = { _, _ in
                emit(["error": "Backing display terminated"])
                NSApplication.shared.terminate(nil)
            }
            let created = CGVirtualDisplay(descriptor: descriptor)
            display = created
            let settings = CGVirtualDisplaySettings()
            settings.hiDPI = 0
            settings.modes = [CGVirtualDisplayMode(width: 1280, height: 900, refreshRate: 60)]
            guard created.apply(settings) else { emit(["error": "Display mode rejected"]); app.terminate(nil); return }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            let x = before.map { ($0["x"] as! CGFloat) + ($0["width"] as! CGFloat) }.max() ?? 0
            var config: CGDisplayConfigRef?
            guard CGBeginDisplayConfiguration(&config) == .success, let config else {
                emit(["error": "Cannot configure backing display"]); app.terminate(nil); return
            }
            let placement = CGConfigureDisplayOrigin(config, created.displayID, Int32(x), 0)
            guard placement == .success else {
                CGCancelDisplayConfiguration(config); emit(["error": "Cannot place backing display"]); app.terminate(nil); return
            }
            guard CGCompleteDisplayConfiguration(config, .forSession) == .success else {
                emit(["error": "Cannot commit display placement"]); app.terminate(nil); return
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            let after = topology()
            guard CGDisplayIsOnline(created.displayID) != 0, CGDisplayIsInMirrorSet(created.displayID) == 0,
                  before.allSatisfy({ prior in after.contains { NSDictionary(dictionary: $0).isEqual(to: prior) } }) else {
                emit(["error": "Independent display or preserved topology verification failed", "before": before, "after": after]); app.terminate(nil); return
            }
            emit(["ready": true, "displayID": created.displayID, "before": before, "topology": after])
            // Bounded experiment, not a service; EOF/timeout releases only our display.
            Task { try? await Task.sleep(nanoseconds: UInt64(seconds) * 1_000_000_000); app.terminate(nil) }
            while let line = await Task.detached(operation: { readLine() }).value {
                if line == "status" { emit(["displayID": created.displayID, "topology": topology()]) }
                else if line == "quit" { break }
                else { emit(["error": "Unknown command"]) }
            }
            display = nil
            app.terminate(nil)
        }
        app.run()
    }
}
