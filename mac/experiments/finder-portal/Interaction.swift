import Cocoa

// Only touches the selected disposable Finder window; no global input injection.
enum FinderAccess {
    static var backingDisplayID: CGDirectDisplayID?
    static func inputAllowed(_ window: AXUIElement) -> Bool {
        if let id = backingDisplayID {
            guard CGDisplayIsOnline(id) != 0, CGDisplayIsInMirrorSet(id) == 0,
                  CGDisplayVendorNumber(id) == 0x4d53, CGDisplayModelNumber(id) == 0x4d54, CGDisplaySerialNumber(id) == 0x4650,
                  let frame = frame(window) else { return false }
            return CGDisplayBounds(id).contains(frame)
        }
        return value(window, kAXMinimizedAttribute) as? Bool == true
    }
    static func value(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
        var v: CFTypeRef?
        return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
    }
    static func window(pid: pid_t, title: String) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 1)
        let windows = value(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
        return windows.first { value($0, kAXTitleAttribute) as? String == title }
    }
    static func nodes(_ root: AXUIElement) -> [AXUIElement] {
        var pending = [(root, 0)], found: [AXUIElement] = []
        while let (e, depth) = pending.popLast(), found.count < 1000 {
            found.append(e)
            if depth < 15 { pending += (value(e, kAXChildrenAttribute) as? [AXUIElement] ?? []).map { ($0, depth + 1) } }
        }
        return found
    }
    static func frame(_ e: AXUIElement) -> CGRect? {
        guard let pv = value(e, kAXPositionAttribute), let sv = value(e, kAXSizeAttribute),
              CFGetTypeID(pv) == AXValueGetTypeID(), CFGetTypeID(sv) == AXValueGetTypeID() else { return nil }
        var p = CGPoint.zero, s = CGSize.zero
        guard AXValueGetValue(pv as! AXValue, .cgPoint, &p), AXValueGetValue(sv as! AXValue, .cgSize, &s) else { return nil }
        return CGRect(origin: p, size: s)
    }
    static func describe(_ e: AXUIElement) -> [String: Any] {
        var result: [String: Any] = [:]
        for attr in [kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXMinimizedAttribute] {
            if let v = value(e, attr), v is String || v is NSNumber { result[attr] = v }
        }
        var actions: CFArray?
        if AXUIElementCopyActionNames(e, &actions) == .success { result["actions"] = actions }
        if let r = frame(e) { result["frame"] = NSStringFromRect(r) }
        return result
    }
    static func openItem(_ name: String, window: AXUIElement) -> [String: Any] {
        // Actual Finder AXOpen testing restored the minimized source. Never use
        // that mechanism in the viewer; return a capability error instead.
        return ["error": "Finder AXOpen is disabled: it restores the source window", "minimizedAfter": value(window, kAXMinimizedAttribute) as? Bool ?? false]
    }
    static func confirmSearch(window: AXUIElement) -> [String: Any] {
        guard inputAllowed(window) else { return ["error": "Source is neither minimized nor on the selected backing display; confirm refused"] }
        guard let field = nodes(window).first(where: {
            value($0, kAXRoleAttribute) as? String == kAXTextFieldRole && value($0, kAXSubroleAttribute) as? String == "AXSearchField"
        }) else { return ["error": "No source search field"] }
        let result = AXUIElementPerformAction(field, kAXConfirmAction as CFString)
        return ["AXError": result.rawValue, "minimizedAfter": value(window, kAXMinimizedAttribute) as? Bool ?? false]
    }
    static func setSearchText(_ text: String, window: AXUIElement) -> [String: Any] {
        guard inputAllowed(window) else { return ["error": "Source is neither minimized nor on the selected backing display; text refused"] }
        guard let field = nodes(window).first(where: {
            value($0, kAXRoleAttribute) as? String == kAXTextFieldRole &&
            value($0, kAXSubroleAttribute) as? String == "AXSearchField"
        }) else { return ["error": "No search text field in the selected Finder window"] }
        let result = AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, text as CFString)
        return ["AXError": result.rawValue, "element": describe(field), "minimizedAfter": value(window, kAXMinimizedAttribute) as? Bool ?? false]
    }
    static func press(_ e: AXUIElement, window: AXUIElement) -> [String: Any] {
        guard inputAllowed(window) else { return ["error": "Source is neither minimized nor on the selected backing display; input refused"] }
        let subrole = value(e, kAXSubroleAttribute) as? String ?? ""
        guard !["AXCloseButton", "AXMinimizeButton", "AXZoomButton", "AXFullScreenButton"].contains(subrole) else { return ["error": "Source window-management control blocked"] }
        let label = value(e, kAXDescriptionAttribute) as? String ?? ""
        guard ["Name", "Size", "Kind", "Date Modified", "Search"].contains(label) else {
            return ["error": "This control has not passed hidden-source validation", "control": label]
        }
        let code = AXUIElementPerformAction(e, kAXPressAction as CFString)
        return ["AXError": code.rawValue, "element": describe(e), "minimizedAfter": value(window, kAXMinimizedAttribute) as? Bool ?? false]
    }
}
