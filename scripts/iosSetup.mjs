#!/usr/bin/env node
/**
 * Prepares the Xcode project made by `npx cap add ios` for MaliPDF on iPad.
 * Safe to run again: settings already present are left alone.
 *
 * - The MaliPDF folder appears in the Files app ("On My iPad › MaliPDF").
 * - MaliPDF is offered for PDFs ("Open in MaliPDF").
 * - iPad only (no iPhone build for now).
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
const ipadOnly = project.replace(/TARGETED_DEVICE_FAMILY = "1,2";/g, 'TARGETED_DEVICE_FAMILY = 2;');
if (ipadOnly !== project) {
  fs.writeFileSync(projectPath, ipadOnly);
  added.push('iPad only');
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
    const attachCall = '\n        MaliPDFPencilHandler.shared.attach(to: window)\n';
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

    func attach(to window: UIWindow?) {
        guard let bridgeVC = window?.rootViewController as? CAPBridgeViewController,
              let hostView = bridgeVC.view,
              let wv = bridgeVC.webView else { return }
        self.webView = wv
        let alreadyAttached = hostView.interactions.contains { $0 is UIPencilInteraction }
        guard !alreadyAttached else { return }
        let interaction = UIPencilInteraction()
        interaction.delegate = self
        hostView.addInteraction(interaction)
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
`;
    swift += pencilExtension;
    fs.writeFileSync(appDelegatePath, swift);
    added.push('UIPencilInteraction (Double-Tap & Squeeze)');
  }
}

console.log(added.length ? `Updated: ${added.join(', ')}` : 'Already set up.');
