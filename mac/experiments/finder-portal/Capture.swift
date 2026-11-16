import Cocoa
import ScreenCaptureKit
import Vision
import CryptoKit

// A separate-process Finder window is selected once and retained even when hidden.
// stdin: one output PNG path per line; stdout: one JSON result per request.
@main struct Probe {
    static func emit(_ object: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
        fflush(stdout)
    }
    static func main() async {
        do {
            if CommandLine.arguments.count == 1 {
                // Opening the standalone bundle explicitly requests its normal OS grant.
                emit(["screenRecording": CGRequestScreenCaptureAccess()])
                return
            }
            guard CommandLine.arguments.count == 2 else { throw NSError(domain: "Usage: Capture unique-window-title", code: 1) }
            let title = CommandLine.arguments[1]
            if title == "--permission" {
                emit(["screenRecording": CGPreflightScreenCaptureAccess()])
                return
            }
            if title == "--request-permission" {
                emit(["screenRecording": CGRequestScreenCaptureAccess()])
                return
            }
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            let matches = content.windows.filter { $0.owningApplication?.bundleIdentifier == "com.apple.finder" && $0.title == title }
            guard matches.count == 1, let window = matches.first else {
                throw NSError(domain: "Expected one dedicated Finder window; found \(matches.count)", code: 2)
            }
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let config = SCStreamConfiguration()
            config.width = Int(window.frame.width * 2)
            config.height = Int(window.frame.height * 2)
            config.showsCursor = false
            config.ignoreShadowsSingleWindow = true
            config.capturesAudio = false
            emit(["ready": true, "wid": window.windowID, "pid": window.owningApplication!.processID])
            while let path = readLine() {
                do {
                    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
                    let rep = NSBitmapImageRep(cgImage: image)
                    let png = rep.representation(using: .png, properties: [:])!
                    try png.write(to: URL(fileURLWithPath: path))
                    let request = VNRecognizeTextRequest()
                    request.recognitionLevel = .accurate
                    try VNImageRequestHandler(cgImage: image).perform([request])
                    let words = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
                    let current = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
                    let now = current.windows.first { $0.windowID == window.windowID }
                    let frame = now?.frame ?? .null
                    let intersects = current.displays.contains { $0.frame.intersects(frame) }
                    emit(["png": path, "sha256": SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined(),
                          "text": words, "listed": now != nil, "onScreen": now?.isOnScreen ?? false,
                          "intersectsDisplay": intersects, "frame": NSStringFromRect(frame)])
                } catch { emit(["error": String(describing: error)]) }
            }
        } catch { emit(["error": String(describing: error)]); exit(1) }
    }
}
