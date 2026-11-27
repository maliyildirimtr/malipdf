#!/usr/bin/env node
/**
 * Prepares the Xcode project made by `npx cap add ios` for MaliPDF on iPad & iPhone.
 * Safe to run again: settings already present are left alone.
 *
 * - The MaliPDF folder appears in the Files app ("On My iPad / On My iPhone › MaliPDF").
 * - MaliPDF is offered for PDFs ("Open in MaliPDF").
 * - Universal iPhone + iPad build (`TARGETED_DEVICE_FAMILY = "1,2"`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plistPath = path.join(root, 'ios/App/App/Info.plist');
const projectPath = path.join(root, 'ios/App/App.xcodeproj/project.pbxproj');

if (!fs.existsSync(plistPath) || !fs.existsSync(projectPath)) {
  console.error('ios/ was not found. Run "npx cap add ios" first.');
  process.exit(1);
}

const ENTRIES = {
  UIFileSharingEnabled: '<true/>',
  LSSupportsOpeningDocumentsInPlace: '<false/>',
  ITSAppUsesNonExemptEncryption: '<false/>',
  UIRequiresFullScreen: '<false/>',
  UIStatusBarHidden: '<true/>',
  UIViewControllerBasedStatusBarAppearance: '<true/>',
  NSUbiquitousContainers: `<dict>
		<key>iCloud.com.maliyildirimtr.malipdf</key>
		<dict>
			<key>NSUbiquitousContainerIsDocumentScopePublic</key>
			<true/>
			<key>NSUbiquitousContainerName</key>
			<string>MaliPDF</string>
			<key>NSUbiquitousContainerSupportedFolderLevels</key>
			<string>Any</string>
		</dict>
	</dict>`,
  NSPhotoLibraryUsageDescription: '<string>MaliPDF adds the pictures you choose to your documents.</string>',
  NSCameraUsageDescription: '<string>MaliPDF adds the photos you take to your documents.</string>',
  CFBundleDocumentTypes: `<array>
		<dict>
			<key>CFBundleTypeName</key>
			<string>PDF Document</string>
			<key>CFBundleTypeRole</key>
			<string>Editor</string>
			<key>LSHandlerRank</key>
			<string>Alternate</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>com.adobe.pdf</string>
			</array>
		</dict>
	</array>`,
};

let plist = fs.readFileSync(plistPath, 'utf8');
const added = [];
for (const [key, value] of Object.entries(ENTRIES)) {
  if (plist.includes(`<key>${key}</key>`)) continue;
  const end = plist.lastIndexOf('</dict>');
  plist = `${plist.slice(0, end)}\t<key>${key}</key>\n\t${value}\n${plist.slice(end)}`;
  added.push(key);
}
fs.writeFileSync(plistPath, plist);

let project = fs.readFileSync(projectPath, 'utf8');
let projectChanged = false;
const universalDevices = project.replace(/TARGETED_DEVICE_FAMILY = 2;/g, 'TARGETED_DEVICE_FAMILY = "1,2";');
if (universalDevices !== project) {
  project = universalDevices;
  projectChanged = true;
  added.push('Universal iPhone + iPad');
}

// iCloud Drive entitlement for container iCloud.com.maliyildirimtr.malipdf
const entitlementsPath = path.join(root, 'ios/App/App/App.entitlements');
const entitlementsContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.icloud-container-identifiers</key>
\t<array>
\t\t<string>iCloud.com.maliyildirimtr.malipdf</string>
\t</array>
\t<key>com.apple.developer.icloud-services</key>
\t<array>
\t\t<string>CloudDocuments</string>
\t</array>
\t<key>com.apple.developer.ubiquity-container-identifiers</key>
\t<array>
\t\t<string>iCloud.com.maliyildirimtr.malipdf</string>
\t</array>
</dict>
</plist>
`;
if (!fs.existsSync(entitlementsPath) || fs.readFileSync(entitlementsPath, 'utf8') !== entitlementsContent) {
  fs.writeFileSync(entitlementsPath, entitlementsContent);
  added.push('App.entitlements (iCloud Drive)');
}
if (!project.includes('CODE_SIGN_ENTITLEMENTS')) {
  const withEntitlements = project.replace(
    /INFOPLIST_FILE = App\/Info\.plist;/g,
    'CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n\t\t\t\tINFOPLIST_FILE = App/Info.plist;',
  );
  if (withEntitlements !== project) {
    project = withEntitlements;
    projectChanged = true;
    added.push('CODE_SIGN_ENTITLEMENTS');
  }
}
if (projectChanged) {
  fs.writeFileSync(projectPath, project);
}

// App Store Connect requires PrivacyInfo.xcprivacy declaring Required Reason APIs
// used by WebKit / Capacitor (UserDefaults and file timestamps).
const privacyPath = path.join(root, 'ios/App/App/PrivacyInfo.xcprivacy');
if (!fs.existsSync(privacyPath)) {
  const privacyManifest = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>NSPrivacyTracking</key>
\t<false/>
\t<key>NSPrivacyTrackingDomains</key>
\t<array/>
\t<key>NSPrivacyCollectedDataTypes</key>
\t<array/>
\t<key>NSPrivacyAccessedAPITypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSPrivacyAccessedAPIType</key>
\t\t\t<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>
\t\t\t<array>
\t\t\t\t<string>CA92.1</string>
\t\t\t</array>
\t\t</dict>
\t\t<dict>
\t\t\t<key>NSPrivacyAccessedAPIType</key>
\t\t\t<string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>
\t\t\t<array>
\t\t\t\t<string>C617.1</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
`;
  fs.writeFileSync(privacyPath, privacyManifest);
  added.push('PrivacyInfo.xcprivacy');
}

// Native Apple Pencil 2nd Gen / Pro support (UIPencilInteraction):
// - Double-tap on the Pencil barrel toggles Pen <-> Eraser
// - Apple Pencil Pro Squeeze (iOS 17.5+) opens the floating Quick Tool Palette
const appDelegatePath = path.join(root, 'ios/App/App/AppDelegate.swift');
if (fs.existsSync(appDelegatePath)) {
  let swift = fs.readFileSync(appDelegatePath, 'utf8');
  if (!swift.includes('MaliPDFPencilHandler')) {
    if (!swift.includes('import WebKit')) {
      swift = swift.replace('import UIKit', 'import UIKit\nimport WebKit');
    }
    const attachCall = '\n        MaliPDFPencilHandler.shared.attach(to: window)\n        MaliPDFiCloudBridge.shared.attach(to: window)\n';
    if (swift.includes('func application(_ application: UIApplication, didFinishLaunchingWithOptions')) {
      swift = swift.replace(
        /(\bfunc application\(_ application: UIApplication, didFinishLaunchingWithOptions[\s\S]*?)(return true)/,
        `$1DispatchQueue.main.async {\n            MaliPDFPencilHandler.shared.attach(to: self.window)\n            MaliPDFiCloudBridge.shared.attach(to: self.window)\n        }\n        $2`,
      );
    }
    if (swift.includes('func applicationDidBecomeActive(_ application: UIApplication) {')) {
      swift = swift.replace(
        'func applicationDidBecomeActive(_ application: UIApplication) {',
        `func applicationDidBecomeActive(_ application: UIApplication) {${attachCall}`,
      );
    }
    const pencilExtension = `

// MARK: - MaliPDF Apple Pencil Double-Tap & Pro Squeeze Bridge

final class MaliPDFPencilHandler: NSObject, UIPencilInteractionDelegate {
    static let shared = MaliPDFPencilHandler()
    private weak var webView: WKWebView?
    private weak var hostWindow: UIWindow?
    private var observingOrientation = false
    private var offsetObservation: NSKeyValueObservation?

    func attach(to window: UIWindow?) {
        guard let bridgeVC = window?.rootViewController as? CAPBridgeViewController,
              let hostView = bridgeVC.view,
              let wv = bridgeVC.webView else { return }
        self.webView = wv
        self.hostWindow = window

        // Hide the iOS/iPadOS status bar (clock, Wi-Fi, battery) using Capacitor's built-in API.
        bridgeVC.setStatusBarVisible(false)

        // Prevent UIKit text-selection / rotation from scrolling the outer WKWebView
        // up under the top edge / Dynamic Island, without replacing WKWebView's
        // internal UIScrollViewDelegate.
        wv.scrollView.bounces = false
        wv.scrollView.alwaysBounceVertical = false
        wv.scrollView.alwaysBounceHorizontal = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        if wv.scrollView.contentOffset != .zero {
            wv.scrollView.contentOffset = .zero
        }
        offsetObservation = wv.scrollView.observe(\\UIScrollView.contentOffset, options: [.new]) { scrollView, _ in
            if scrollView.contentOffset.x != 0 || scrollView.contentOffset.y != 0 {
                scrollView.contentOffset = .zero
            }
        }

        syncSafeAreaInsets()
        if !observingOrientation {
            observingOrientation = true
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleLayoutOrOrientationChange),
                name: UIDevice.orientationDidChangeNotification,
                object: nil
            )
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleLayoutOrOrientationChange),
                name: UIApplication.didBecomeActiveNotification,
                object: nil
            )
        }

        let alreadyAttached = hostView.interactions.contains { $0 is UIPencilInteraction }
        guard !alreadyAttached else { return }
        let interaction = UIPencilInteraction()
        interaction.delegate = self
        hostView.addInteraction(interaction)
    }

    @objc private func handleLayoutOrOrientationChange() {
        syncSafeAreaInsets()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
            self?.syncSafeAreaInsets()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.32) { [weak self] in
            self?.syncSafeAreaInsets()
        }
    }

    func syncSafeAreaInsets() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let win = self.hostWindow,
                  let wv = self.webView else { return }
            if wv.scrollView.contentOffset.x != 0 || wv.scrollView.contentOffset.y != 0 {
                wv.scrollView.contentOffset = .zero
            }
            let insets = win.safeAreaInsets
            let js = """
            document.documentElement.style.setProperty('--ios-safe-top', '\\(Int(insets.top.rounded()))px');
            document.documentElement.style.setProperty('--ios-safe-right', '\\(Int(insets.right.rounded()))px');
            document.documentElement.style.setProperty('--ios-safe-bottom', '\\(Int(insets.bottom.rounded()))px');
            document.documentElement.style.setProperty('--ios-safe-left', '\\(Int(insets.left.rounded()))px');
            if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
            """
            wv.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func dispatchDoubleTap() {
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent('malipdf:pencil-double-tap'))",
                completionHandler: nil
            )
        }
    }

    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        dispatchDoubleTap()
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        dispatchDoubleTap()
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        guard squeeze.phase == .ended else { return }
        let detail: String
        if let loc = squeeze.hoverPose?.location {
            detail = "{ x: \\(Int(loc.x)), y: \\(Int(loc.y)) }"
        } else {
            detail = "{}"
        }
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent('malipdf:pencil-squeeze', { detail: \\(detail) }))",
                completionHandler: nil
            )
        }
    }
}

// MARK: - MaliPDF Native iCloud Drive Ubiquity Container Bridge

final class MaliPDFiCloudBridge: NSObject, WKScriptMessageHandler {
    static let shared = MaliPDFiCloudBridge()
    private static let containerId = "iCloud.com.maliyildirimtr.malipdf"
    private weak var webView: WKWebView?
    private weak var attachedController: WKUserContentController?
    private let workQueue = DispatchQueue(label: "com.maliyildirimtr.malipdf.icloud", qos: .userInitiated)

    func attach(to window: UIWindow?) {
        guard let bridgeVC = window?.rootViewController as? CAPBridgeViewController,
              let wv = bridgeVC.webView else { return }
        self.webView = wv
        let controller = wv.configuration.userContentController
        if attachedController !== controller {
            controller.removeScriptMessageHandler(forName: "malipdfICloud")
            controller.add(self, name: "malipdfICloud")
            attachedController = controller
        }
    }

    private func docsDirectory() -> URL? {
        guard let root = FileManager.default.url(forUbiquityContainerIdentifier: Self.containerId) else {
            return nil
        }
        let docs = root.appendingPathComponent("Documents", isDirectory: true)
        if !FileManager.default.fileExists(atPath: docs.path) {
            try? FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        }
        return docs
    }

    private func safeFileURL(in docs: URL, name: String) -> URL? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              !trimmed.contains("/"),
              !trimmed.contains("\\\\"),
              trimmed != ".",
              trimmed != ".." else { return nil }
        return docs.appendingPathComponent(trimmed)
    }

    private func reply(id: String, payload: [String: Any]) {
        var msg = payload
        msg["id"] = id
        guard let jsonData = try? JSONSerialization.data(withJSONObject: msg, options: []),
              let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(
                "window.__malipdfICloudResolve && window.__malipdfICloudResolve(\\(jsonStr))",
                completionHandler: nil
            )
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let op = body["op"] as? String else { return }

        workQueue.async { [weak self] in
            guard let self = self else { return }
            let docs = self.docsDirectory()

            if op == "status" {
                self.reply(id: id, payload: ["ok": true, "available": docs != nil])
                return
            }

            guard let docs = docs else {
                self.reply(id: id, payload: ["ok": false, "error": "iCloud Drive is unavailable on this device."])
                return
            }

            switch op {
            case "list":
                var files: [[String: Any]] = []
                // A listing failure must be an error, not an empty folder.
                let listed: [URL]
                do {
                    listed = try FileManager.default.contentsOfDirectory(
                        at: docs,
                        includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey],
                        options: []
                    )
                } catch {
                    self.reply(id: id, payload: ["ok": false, "error": error.localizedDescription])
                    return
                }
                do {
                    for url in listed {
                        var fileName = url.lastPathComponent
                        if fileName.hasPrefix(".") && fileName.hasSuffix(".icloud") {
                            fileName = String(fileName.dropFirst().dropLast(".icloud".count))
                        } else if fileName.hasPrefix(".") {
                            continue
                        }
                        let vals = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                        let size = vals?.fileSize ?? 0
                        let mtime = Int((vals?.contentModificationDate?.timeIntervalSince1970 ?? Date().timeIntervalSince1970) * 1000)
                        files.append(["name": fileName, "size": size, "updatedAt": mtime])
                    }
                }
                self.reply(id: id, payload: ["ok": true, "files": files])

            case "read":
                guard let name = body["name"] as? String,
                      var fileURL = self.safeFileURL(in: docs, name: name) else {
                    self.reply(id: id, payload: ["ok": false, "error": "Invalid file name."])
                    return
                }
                let fm = FileManager.default
                let placeholder = docs.appendingPathComponent("." + name + ".icloud")
                // Trigger download AND wait until iCloud marks the item .current:
                // when an older local copy already exists on disk (fileExists == true)
                // while a newer edit from another device is in iCloud, status is .downloaded
                // (stale local copy) until bird finishes fetching .current!
                let isPlaceholderPresent = fm.fileExists(atPath: placeholder.path)
                let initialVals = try? fileURL.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey, .ubiquitousItemHasUnresolvedConflictsKey])
                let needsSyncWait = isPlaceholderPresent
                    || (initialVals?.ubiquitousItemDownloadingStatus != nil
                        && initialVals?.ubiquitousItemDownloadingStatus != .current)
                if fm.fileExists(atPath: fileURL.path) || isPlaceholderPresent {
                    try? fm.startDownloadingUbiquitousItem(at: fileURL)
                }
                if needsSyncWait {
                    for _ in 0..<35 {
                        fileURL.removeCachedResourceValue(forKey: .ubiquitousItemDownloadingStatusKey)
                        let vals = try? fileURL.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
                        if fm.fileExists(atPath: fileURL.path) && vals?.ubiquitousItemDownloadingStatus == .current {
                            break
                        }
                        Thread.sleep(forTimeInterval: 0.2)
                    }
                }
                // Auto-resolve any legacy NSFileVersion conflicts on JSON manifests so iCloud never stalls
                if name.lowercased().hasSuffix(".json"),
                   let conflicts = NSFileVersion.unresolvedConflictVersionsOfItem(at: fileURL),
                   !conflicts.isEmpty {
                    for c in conflicts { c.isResolved = true }
                    try? NSFileVersion.removeOtherVersionsOfItem(at: fileURL)
                }
                guard fm.fileExists(atPath: fileURL.path) else {
                    if fm.fileExists(atPath: placeholder.path) {
                        self.reply(id: id, payload: ["ok": false, "error": "iCloud is still downloading \\(name). Try again in a moment."])
                    } else {
                        self.reply(id: id, payload: ["ok": true, "data": NSNull()])
                    }
                    return
                }
                var coordError: NSError?
                var fileData: Data?
                NSFileCoordinator().coordinate(readingItemAt: fileURL, options: [], error: &coordError) { url in
                    fileData = try? Data(contentsOf: url)
                }
                if let data = fileData {
                    self.reply(id: id, payload: ["ok": true, "data": data.base64EncodedString()])
                } else {
                    self.reply(id: id, payload: ["ok": false, "error": coordError?.localizedDescription ?? "Could not read \\(name) from iCloud Drive."])
                }

            case "write":
                guard let name = body["name"] as? String,
                      let base64 = body["data"] as? String,
                      let data = Data(base64Encoded: base64),
                      let fileURL = self.safeFileURL(in: docs, name: name) else {
                    self.reply(id: id, payload: ["ok": false, "error": "Invalid write payload."])
                    return
                }
                var coordError: NSError?
                var writeError: Error?
                NSFileCoordinator().coordinate(writingItemAt: fileURL, options: .forReplacing, error: &coordError) { url in
                    do {
                        try data.write(to: url, options: .atomic)
                    } catch {
                        writeError = error
                    }
                }
                if let err = writeError ?? coordError {
                    self.reply(id: id, payload: ["ok": false, "error": err.localizedDescription])
                } else {
                    self.reply(id: id, payload: ["ok": true])
                }

            case "delete":
                guard let name = body["name"] as? String,
                      let fileURL = self.safeFileURL(in: docs, name: name) else {
                    self.reply(id: id, payload: ["ok": false, "error": "Invalid file name."])
                    return
                }
                let fm = FileManager.default
                var coordError: NSError?
                NSFileCoordinator().coordinate(writingItemAt: fileURL, options: .forDeleting, error: &coordError) { url in
                    try? fm.removeItem(at: url)
                }
                let placeholder = docs.appendingPathComponent("." + name + ".icloud")
                if fm.fileExists(atPath: placeholder.path) {
                    try? fm.removeItem(at: placeholder)
                }
                self.reply(id: id, payload: ["ok": true])

            default:
                self.reply(id: id, payload: ["ok": false, "error": "Unknown op"])
            }
        }
    }
}
`;
    swift += pencilExtension;
    fs.writeFileSync(appDelegatePath, swift);
    added.push('UIPencilInteraction (Double-Tap & Squeeze)');
  }
}

console.log(added.length ? `Updated: ${added.join(', ')}` : 'Already set up.');
