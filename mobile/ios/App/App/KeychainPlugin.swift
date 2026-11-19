import Capacitor
import Security
import UIKit

/// The app's root view controller: Capacitor's bridge, with the app's own plugins registered.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(KeychainPlugin())
    }
}

/// Secrets for paired desktops (machine tokens) and push seal keys, kept in the iOS Keychain.
/// Generic passwords under the service `com.project96.sai.machines`, readable after first unlock
/// (so the Notification Service Extension can read seal keys while the phone is locked).
/// - `Keychain.get({ key, accessGroup? })`: resolves `{ value }`, the stored string or null.
/// - `Keychain.set({ key, value, accessGroup? })`: stores (or replaces) the value.
/// - `Keychain.remove({ key, accessGroup? })`: deletes the value; a missing key is not an error.
/// - `Keychain.buildEnv()`: resolves `{ env }`, the APNs environment this build was signed for.
/// - `Keychain.openSettings()`: opens this app's page in iOS Settings.
///
/// `accessGroup` is the group without the team prefix (`com.project96.sai.shared`); the prefix is
/// read at runtime from the `AppIdentifierPrefix` Info.plist key (`$(AppIdentifierPrefix)`). Seal
/// keys (`seal:<keyId>`) live in that shared group, which the extension also holds. Everything
/// else goes to the app's private group: it is first in App.entitlements' keychain-access-groups,
/// and the first entry is the default group for items added without an explicit group.
@objc(KeychainPlugin)
public class KeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeychainPlugin"
    public let jsName = "Keychain"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buildEnv", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private static let service = "com.project96.sai.machines"

    /// `TEAMID.` from Info.plist, or nil when the build had no team (unsigned simulator builds).
    static func appIdentifierPrefix() -> String? {
        guard let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String,
              !prefix.isEmpty, !prefix.contains("$(") else {
            return nil
        }
        return prefix.hasSuffix(".") ? prefix : prefix + "."
    }

    private enum GroupError: Error { case unavailable }

    /// The base query; adds `kSecAttrAccessGroup` when the call names an access group.
    private func baseQuery(_ key: String, _ call: CAPPluginCall) throws -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: KeychainPlugin.service,
            kSecAttrAccount as String: key
        ]
        if let group = call.getString("accessGroup"), !group.isEmpty {
            guard let prefix = KeychainPlugin.appIdentifierPrefix() else { throw GroupError.unavailable }
            query[kSecAttrAccessGroup as String] = prefix + group
        }
        return query
    }

    private func makeQuery(_ call: CAPPluginCall) -> [String: Any]? {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("Missing key")
            return nil
        }
        do {
            return try baseQuery(key, call)
        } catch {
            call.reject("Keychain access group unavailable (no AppIdentifierPrefix in this build)")
            return nil
        }
    }

    @objc func get(_ call: CAPPluginCall) {
        guard var query = makeQuery(call) else { return }
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("Keychain read failed (\(status))")
            return
        }
        call.resolve(["value": value])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let value = call.getString("value") else {
            call.reject("Missing value")
            return
        }
        guard let query = makeQuery(call) else { return }
        let data = Data(value.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else {
            call.reject("Keychain write failed (\(status))")
            return
        }
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let query = makeQuery(call) else { return }
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("Keychain delete failed (\(status))")
            return
        }
        call.resolve()
    }

    /// `aps-environment` from embedded.mobileprovision. Development and ad-hoc installs carry a
    /// profile; App Store and TestFlight installs don't, and always use production APNs. With no
    /// profile, the simulator resolves `development` and a device resolves `production`.
    @objc func buildEnv(_ call: CAPPluginCall) {
        if let env = KeychainPlugin.profileApsEnvironment() {
            call.resolve(["env": env])
            return
        }
        #if targetEnvironment(simulator)
        call.resolve(["env": "development"])
        #else
        call.resolve(["env": "production"])
        #endif
    }

    static func profileApsEnvironment() -> String? {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              // The profile is a CMS envelope around a plain XML plist.
              let text = String(data: data, encoding: .isoLatin1),
              let start = text.range(of: "<?xml"),
              let end = text.range(of: "</plist>", range: start.upperBound..<text.endIndex),
              let plistData = String(text[start.lowerBound..<end.upperBound]).data(using: .isoLatin1),
              let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any],
              let env = entitlements["aps-environment"] as? String,
              !env.isEmpty else {
            return nil
        }
        return env
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("No settings URL")
                return
            }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                } else {
                    call.reject("Could not open Settings")
                }
            }
        }
    }
}
