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
        let seconds = CommandLine.arguments.count >= 2 ? Int(CommandLine.arguments[1]) ?? 0 : 180
        guard (30...3600).contains(seconds) else { emit(["error": "Duration must be 30..3600 seconds"]); return }
        var explicitOrigin: CGPoint?
        if CommandLine.arguments.count == 4 {
            guard let x = Int32(CommandLine.arguments[2]), let y = Int32(CommandLine.arguments[3]), abs(Int64(x)) <= 100000, abs(Int64(y)) <= 100000 else {
                emit(["error": "Invalid backing origin"]); return
            }
            explicitOrigin = CGPoint(x: Int(x), y: Int(y))
        } else if CommandLine.arguments.count > 2 { emit(["error": "Usage: holder [seconds [x y]]"]); return }
        let app = NSApplication.shared
        Task { @MainActor in
            let before = topology()
            let descriptor = CGVirtualDisplayDescriptor()
            descriptor.name = "TwinDesk Window Finder Portal (Experiment)"
            descriptor.vendorID = 0x4d53; descriptor.productID = 0x4d54; descriptor.serialNum = 0x4650
            descriptor.maxPixelsWide = 2560; descriptor.maxPixelsHigh = 1800
            descriptor.sizeInMillimeters = CGSize(width: 340, height: 239)
            descriptor.setDispatchQueue(.main)
            descriptor.terminationHandler = { _, _ in
                emit(["error": "Backing display terminated"])
                NSApplication.shared.terminate(nil)
            }
            let created = CGVirtualDisplay(descriptor: descriptor)
            display = created
            let settings = CGVirtualDisplaySettings()
            settings.hiDPI = 1
            // With hiDPI enabled the mode dimensions are logical, while the
            // descriptor's maximum dimensions are physical pixels.
            settings.modes = [CGVirtualDisplayMode(width: 1280, height: 900, refreshRate: 60)]
            guard created.apply(settings) else { emit(["error": "Display mode rejected"]); app.terminate(nil); return }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            let x = before.map { ($0["x"] as! CGFloat) + ($0["width"] as! CGFloat) }.max() ?? 0
            let origin = explicitOrigin ?? CGPoint(x: x, y: 0)
            let intended = CGRect(origin: origin, size: CGSize(width: 1280, height: 900))
            guard before.allSatisfy({ prior in
                !intended.intersects(CGRect(x: prior["x"] as! CGFloat, y: prior["y"] as! CGFloat, width: prior["width"] as! CGFloat, height: prior["height"] as! CGFloat))
            }) else { emit(["error": "Backing rectangle overlaps an existing display"]); app.terminate(nil); return }
            var config: CGDisplayConfigRef?
            let modes = CGDisplayCopyAllDisplayModes(created.displayID, [kCGDisplayShowDuplicateLowResolutionModes: true] as CFDictionary) as? [CGDisplayMode] ?? []
            guard let mode = modes.first(where: { $0.width == 1280 && $0.height == 900 && $0.pixelWidth == 2560 && $0.pixelHeight == 1800 }) else {
                emit(["error": "Required 2x backing mode unavailable", "modes": modes.map { ["width": $0.width, "height": $0.height, "pixelWidth": $0.pixelWidth, "pixelHeight": $0.pixelHeight] }]); app.terminate(nil); return
            }
            guard CGBeginDisplayConfiguration(&config) == .success, let config else {
                emit(["error": "Cannot configure backing display"]); app.terminate(nil); return
            }
            let placement = CGConfigureDisplayOrigin(config, created.displayID, Int32(origin.x), Int32(origin.y))
            let modeResult = CGConfigureDisplayWithDisplayMode(config, created.displayID, mode, nil)
            guard placement == .success, modeResult == .success else {
                CGCancelDisplayConfiguration(config); emit(["error": "Cannot place backing display"]); app.terminate(nil); return
            }
            guard CGCompleteDisplayConfiguration(config, .forSession) == .success else {
                emit(["error": "Cannot commit display placement"]); app.terminate(nil); return
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            let after = topology()
            guard CGDisplayIsOnline(created.displayID) != 0, CGDisplayIsInMirrorSet(created.displayID) == 0,
                  CGDisplayBounds(created.displayID) == intended,
                  CGDisplayCopyDisplayMode(created.displayID)?.pixelWidth == 2560,
                  CGDisplayCopyDisplayMode(created.displayID)?.pixelHeight == 1800,
                  before.allSatisfy({ prior in after.contains { NSDictionary(dictionary: $0).isEqual(to: prior) } }) else {
                emit(["error": "Independent display or preserved topology verification failed", "before": before, "after": after]); app.terminate(nil); return
            }
            emit(["ready": true, "displayID": created.displayID, "pixelWidth": mode.pixelWidth, "pixelHeight": mode.pixelHeight, "before": before, "topology": after, "physicalMap": Screens.displays().map { NSStringFromRect($0) }])
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
