// The Notification Service Extension (Swift, compiled only in CI on macOS) must agree with the
// TypeScript side: the relay's payload keys, the seal format, the Keychain names the app stores
// seal keys under, and the userInfo keys tap routing reads. Swift can't run here, so this greps it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const nse = read('mobile/ios/App/NotificationService/NotificationService.swift');
const keychain = read('mobile/ios/App/App/KeychainPlugin.swift');
const appDelegate = read('mobile/ios/App/App/AppDelegate.swift');
const prefixSwift = read('mobile/ios/App/Shared/AppIdentifierPrefix.swift');
const iosYml = read('.github/workflows/ios.yml');
const apns = read('relay/src/apns.ts');
const routing = read('mobile/src/push/routing.ts');
const registration = read('mobile/src/push/registration.ts');
const pbxproj = read('mobile/ios/App/App.xcodeproj/project.pbxproj');
const shared = '$(AppIdentifierPrefix)com.project96.sai.shared';

describe('NSE contract', () => {
  it('reads the sealed blob from userInfo "s", the key the relay writes', () => {
    expect(nse).toMatch(/userInfo\["s"\]/);
    expect(apns).toMatch(/\bs: sealed\b/);
    // Nothing but the sealed blob: the kind is not forwarded (the relay sees ids, blobs and timestamps only).
    expect(apns).not.toMatch(/\bk: /);
    expect(nse).not.toMatch(/userInfo\["k"\]/);
    expect(apns).toMatch(/'mutable-content': 1/);
  });

  it('writes m (keyId), c (chatId) and p (projectPath) for tap routing', () => {
    expect(nse).toMatch(/info\["m"\] = opened\.keyId/);
    expect(nse).toMatch(/info\["c"\] = opened\.plain\.chatId/);
    expect(nse).toMatch(/info\["p"\] = opened\.plain\.projectPath/);
    expect(nse).toMatch(/content\.userInfo = info/);
    expect(nse).toMatch(/threadIdentifier = opened\.plain\.chatId/);
    for (const k of ['m', 'c', 'p']) expect(routing).toMatch(new RegExp(`o\\.${k}\\b`));
  });

  it('opens with AES-GCM combined (nonce 12 || ct || tag 16), like src/lib/push/seal.ts', () => {
    expect(nse).toContain('AES.GCM.SealedBox(combined:');
    expect(nse).toContain('AES.GCM.open(');
    expect(nse).toMatch(/12 \+ 16/);
    expect(read('src/lib/push/seal.ts')).toContain('AES.GCM.SealedBox(combined:)');
  });

  it('checks the plaintext like isPushPlain (v 1, the four kinds)', () => {
    expect(nse).toMatch(/plain\.v == 1/);
    for (const kind of ['done', 'approval', 'question', 'error']) expect(nse).toContain(`"${kind}"`);
    for (const f of ['chatId', 'projectPath', 'title', 'body', 'ts']) expect(nse).toMatch(new RegExp(`let ${f}: `));
  });

  it('tries every seal:<keyId> item in the shared group of the app\'s Keychain service', () => {
    expect(registration).toContain('`seal:${keyId}`');
    expect(nse).toContain('"seal:"');
    expect(nse).toMatch(/hasPrefix\(sealAccountPrefix\)/);
    expect(nse).toContain('"com.project96.sai.machines"');
    expect(keychain).toContain('"com.project96.sai.machines"');
    expect(nse).toContain('"com.project96.sai.shared"');
    expect(nse).toContain('kSecMatchLimitAll');
    expect(nse).toContain('kSecReturnAttributes');
    expect(nse).toContain('kSecReturnData');
    expect(nse).toContain('kSecAttrAccessGroup');
  });

  it('stores Keychain items readable after first unlock, so a locked phone can open pushes', () => {
    expect(keychain).toContain('kSecAttrAccessibleAfterFirstUnlock');
    expect(keychain).not.toContain('kSecAttrAccessibleWhenUnlocked');
  });

  it('leaves the fallback untouched on failure', () => {
    // The original content is what's delivered unless decryption fully succeeded.
    expect(nse).toMatch(/self\.fallbackContent = request\.content/);
    expect(nse).toMatch(/bestAttemptContent \?\? fallbackContent/);
    // Every mutation happens on a copy, inside the success branch.
    const success = nse.indexOf('if let opened = NotificationService.open(');
    const deliver = nse.indexOf('deliver()', success);
    expect(success).toBeGreaterThan(0);
    for (const m of nse.matchAll(/content\.(title|body|userInfo|threadIdentifier) =/g)) {
      expect(m.index).toBeGreaterThan(success);
      expect(m.index).toBeLessThan(deliver);
    }
    expect(nse).not.toMatch(/request\.content\.(title|body|userInfo) =/);
    expect(nse).toMatch(/func serviceExtensionTimeWillExpire\(\)[\s\S]*?deliver\(\)/);
  });

  it('the Keychain plugin takes accessGroup and adds the AppIdentifierPrefix', () => {
    expect(keychain).toContain('call.getString("accessGroup")');
    expect(keychain).toContain('AppIdentifierPrefix.resolve(service: KeychainPlugin.service)');
    for (const m of ['get', 'set', 'remove', 'buildEnv', 'openSettings']) {
      expect(keychain).toContain(`CAPPluginMethod(name: "${m}"`);
      expect(keychain).toMatch(new RegExp(`@objc func ${m}\\(_ call: CAPPluginCall\\)`));
    }
    expect(keychain).toContain('"aps-environment"');
    expect(keychain).toContain('embedded');
    expect(keychain).toContain('UIApplication.openSettingsURLString');
  });

  it('delivers exactly once under a lock (timeWillExpire can race didReceive)', () => {
    expect(nse).toContain('private let lock = NSLock()');
    const deliverFn = nse.slice(nse.indexOf('private func deliver()'));
    const body = deliverFn.slice(0, deliverFn.indexOf('\n    }\n'));
    expect(body).toMatch(/lock\.lock\(\)[\s\S]*contentHandler = nil[\s\S]*lock\.unlock\(\)[\s\S]*handler\(content\)/);
    // bestAttemptContent is only written under the lock.
    expect(nse).toMatch(/lock\.lock\(\)\s*bestAttemptContent = content\s*lock\.unlock\(\)/);
  });

  it('both targets resolve the App ID prefix from Info.plist, else a Keychain probe', () => {
    expect(prefixSwift).toContain('forInfoDictionaryKey: "AppIdentifierPrefix"');
    expect(prefixSwift).toContain('!value.contains("$(")');
    expect(prefixSwift).toContain('value.hasSuffix(".")');
    // Probe: an item added without a group reports the default group, TEAMID.<group>.
    expect(prefixSwift).toContain('"__prefix_probe"');
    expect(prefixSwift).toContain('kSecReturnAttributes');
    expect(prefixSwift).toContain('attributes[kSecAttrAccessGroup as String]');
    expect(prefixSwift).toMatch(/group\.firstIndex\(of: "\."\)/);
    expect(prefixSwift).toMatch(/fromInfoPlist\(\) \?\? fromKeychain\(service: service\)/);
    expect(prefixSwift).toMatch(/cached = prefix/);
    expect(nse).toContain('AppIdentifierPrefix.resolve(service: service)');
    expect(keychain).toContain('AppIdentifierPrefix.resolve(service:');
    // Compiled into both targets: two Sources build files for the one file reference.
    const buildFiles = [...pbxproj.matchAll(/(\w{24}) \/\* AppIdentifierPrefix\.swift in Sources \*\/ = \{isa = PBXBuildFile/g)].map((m) => m[1]);
    expect(buildFiles).toHaveLength(2);
    const sourcesPhases = [...pbxproj.matchAll(/isa = PBXSourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/g)].map((m) => m[1]);
    expect(sourcesPhases).toHaveLength(2);
    for (const phase of sourcesPhases) expect(buildFiles.some((id) => phase.includes(id))).toBe(true);
  });

  it('ios.yml writes the team into AppIdentifierPrefix in both Info.plists before signing, and checks it', () => {
    expect(iosYml).toContain('NSE="$APP/PlugIns/NotificationService.appex"');
    expect(iosYml).toMatch(/for plist in "\$APP\/Info\.plist" "\$NSE\/Info\.plist"/);
    expect(iosYml).toContain('Set :AppIdentifierPrefix $TEAM_ID.');
    expect(iosYml).toContain('Add :AppIdentifierPrefix string $TEAM_ID.');
    expect(iosYml.indexOf('Set :AppIdentifierPrefix')).toBeLessThan(iosYml.indexOf('adhoc --entitlements'));
    expect(iosYml).toContain('Print :AppIdentifierPrefix');
    expect(iosYml).toContain('[ "$prefix" = "$TEAM_ID." ]');
    expect(iosYml).toMatch(/for b in "\$APP" "\$NSE"; do[\s\S]*?Print :AppIdentifierPrefix[\s\S]*?done/);
    expect(iosYml.indexOf('Print :AppIdentifierPrefix')).toBeLessThan(iosYml.indexOf('-exportArchive'));
  });

  it('the AppDelegate forwards APNs registration to @capacitor/push-notifications', () => {
    expect(appDelegate).toMatch(/didRegisterForRemoteNotificationsWithDeviceToken[\s\S]*?\.capacitorDidRegisterForRemoteNotifications/);
    expect(appDelegate).toMatch(/didFailToRegisterForRemoteNotificationsWithError[\s\S]*?\.capacitorDidFailToRegisterForRemoteNotifications/);
    expect(read('mobile/ios/App/CapApp-SPM/Package.swift')).toContain('.product(name: "CapacitorPushNotifications"');
  });

  it('both targets hold the shared Keychain group; the app has push and AppIdentifierPrefix', () => {
    const appEnt = read('mobile/ios/App/App/App.entitlements');
    const nseEnt = read('mobile/ios/App/NotificationService/NotificationService.entitlements');
    expect(appEnt).toContain(shared);
    expect(nseEnt).toContain(shared);
    expect(appEnt).toMatch(/<key>aps-environment<\/key>\s*<string>development<\/string>/);
    // The app's private group comes first: it stays the default for items without an accessGroup.
    expect(appEnt.indexOf('$(AppIdentifierPrefix)com.project96.sai<')).toBeGreaterThan(0);
    expect(appEnt.indexOf('$(AppIdentifierPrefix)com.project96.sai<')).toBeLessThan(appEnt.indexOf(shared));
    for (const plist of ['mobile/ios/App/App/Info.plist', 'mobile/ios/App/NotificationService/Info.plist']) {
      expect(read(plist)).toMatch(/<key>AppIdentifierPrefix<\/key>\s*<string>\$\(AppIdentifierPrefix\)<\/string>/);
    }
    expect(read('mobile/ios/App/NotificationService/Info.plist')).toContain('com.apple.usernotifications.service');
  });

  it('the Xcode project builds and embeds the extension with matching versions', () => {
    expect(pbxproj).toContain('productType = "com.apple.product-type.app-extension"');
    expect(pbxproj).toContain('PRODUCT_BUNDLE_IDENTIFIER = com.project96.sai.NotificationService;');
    expect(pbxproj).toMatch(/name = "Embed Foundation Extensions"/);
    expect(pbxproj).toMatch(/dstSubfolderSpec = 13;/);
    expect(pbxproj).toContain('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;');
    expect(pbxproj).toContain('CODE_SIGN_ENTITLEMENTS = NotificationService/NotificationService.entitlements;');
    const values = (key: string) => new Set([...pbxproj.matchAll(new RegExp(`${key} = ([^;]+);`, 'g'))].map((m) => m[1]));
    expect(values('MARKETING_VERSION').size).toBe(1);
    expect(values('CURRENT_PROJECT_VERSION').size).toBe(1);
    expect(values('IPHONEOS_DEPLOYMENT_TARGET').size).toBe(1);
    expect(values('SWIFT_VERSION').size).toBe(1);
  });
});
