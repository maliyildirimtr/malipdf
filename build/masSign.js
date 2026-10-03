// Mac App Store signing (electron-builder `mas.sign`).
//
// electron-builder signs every nested binary with entitlementsInherit. App
// Store Connect then warns (ITMS-91166 "Invalid entitlement location") about
// the frameworks and dylibs inside Electron Framework.framework: entitlements
// belong only in executables (the app and its helper apps / tools).
//
// Same signing as electron-builder, except frameworks, dylibs and native
// modules are signed with an empty entitlements dictionary.
const path = require('path');
const { signAsync } = require('@electron/osx-sign');

const NO_ENTITLEMENTS = path.join(__dirname, 'entitlements.mas.none.plist');

/** Code that is loaded into a process rather than run as one. */
function isLibrary(file) {
  return /\.framework(\/|$)/.test(file) || /\.(dylib|so|node)$/.test(file);
}

module.exports = async function masSign(opts) {
  const base = opts.optionsForFile;
  return signAsync({
    ...opts,
    optionsForFile: (file) => {
      const options = base ? base(file) : {};
      return isLibrary(file) ? { ...options, entitlements: NO_ENTITLEMENTS } : options;
    },
  });
};

module.exports.isLibrary = isLibrary;
