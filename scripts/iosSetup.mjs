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

console.log(added.length ? `Updated: ${added.join(', ')}` : 'Already set up.');
