import Foundation
import Security

/// The team's App ID prefix (`TEAMID.`), which keychain access groups are named under.
/// Compiled into both the app and the Notification Service Extension.
///
/// The Info.plist key `AppIdentifierPrefix` (`$(AppIdentifierPrefix)`) is the first source, but
/// Xcode only expands it in a signing build: the release archive is built unsigned, so there it
/// may be empty (CI then writes the team in, see ios.yml). As a fallback the prefix is read
/// from the Keychain itself: an item added without an access group lands in the target's default
/// group (its first `keychain-access-groups` entry, `TEAMID.<group>`), so a probe item's
/// `kSecAttrAccessGroup` carries the prefix. A resolved prefix is cached; a miss is retried
/// (before the first unlock the Keychain isn't readable).
enum AppIdentifierPrefix {
    private static let lock = NSLock()
    private static var cached: String?
    /// The probe's account, under the same service as the app's items. It holds no secret
    /// (empty data); it is created once and left in place.
    static let probeAccount = "__prefix_probe"

    static func resolve(service: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        if let cached = cached { return cached }
        guard let prefix = fromInfoPlist() ?? fromKeychain(service: service) else { return nil }
        cached = prefix
        return prefix
    }

    /// A team or seed ID: 10 upper-case letters or digits, then the dot.
    static func isValid(_ prefix: String) -> Bool {
        return prefix.range(of: "^[A-Z0-9]{10}\\.$", options: .regularExpression) != nil
    }

    static func fromInfoPlist() -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String,
              !value.contains("$("), value.hasSuffix("."), isValid(value) else {
            return nil
        }
        return value
    }

    static func fromKeychain(service: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: probeAccount,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        var status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            // No access group: the item goes to this target's default group.
            let add: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: probeAccount,
                kSecValueData as String: Data(),
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
                kSecReturnAttributes as String: true
            ]
            item = nil
            status = SecItemAdd(add as CFDictionary, &item)
            if status == errSecDuplicateItem {
                status = SecItemCopyMatching(query as CFDictionary, &item)
            }
        }
        guard status == errSecSuccess,
              let attributes = item as? [String: Any],
              let group = attributes[kSecAttrAccessGroup as String] as? String,
              let dot = group.firstIndex(of: ".") else {
            return nil
        }
        let prefix = String(group[...dot])
        return isValid(prefix) ? prefix : nil
    }
}
