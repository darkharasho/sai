import Capacitor
import Security
import UIKit

/// The app's root view controller: Capacitor's bridge, with the app's own plugins registered.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(KeychainPlugin())
    }
}

/// Secrets for paired desktops (machine tokens), kept in the iOS Keychain.
/// Generic passwords under the service `com.project96.sai.machines`, readable after first unlock.
/// - `Keychain.get({ key })`: resolves `{ value }`, where `value` is the stored string or null.
/// - `Keychain.set({ key, value })`: stores (or replaces) the value.
/// - `Keychain.remove({ key })`: deletes the value; a missing key is not an error.
@objc(KeychainPlugin)
public class KeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeychainPlugin"
    public let jsName = "Keychain"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private static let service = "com.project96.sai.machines"

    private func baseQuery(_ key: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: KeychainPlugin.service,
            kSecAttrAccount as String: key
        ]
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("Missing key")
            return
        }
        var query = baseQuery(key)
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
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("Missing key")
            return
        }
        guard let value = call.getString("value") else {
            call.reject("Missing value")
            return
        }
        let data = Data(value.utf8)
        let query = baseQuery(key)
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
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("Missing key")
            return
        }
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("Keychain delete failed (\(status))")
            return
        }
        call.resolve()
    }
}
