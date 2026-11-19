import CryptoKit
import Foundation
import Security
import UserNotifications

/// Opens SAI's sealed pushes on the phone.
///
/// The relay only ever sees ciphertext: the APNs payload carries a generic alert ("SAI" / "New
/// activity in a chat", the fallback), `mutable-content: 1`, the sealed blob in `s` and the kind
/// in `k`. The blob is base64(nonce[12] || ciphertext || tag[16]), AES-256-GCM with no AAD
/// (src/lib/push/seal.ts), sealed with one of the 32-byte keys the app keeps in the Keychain as
/// `seal:<keyId>` (service `com.project96.sai.machines`, the shared access group). The relay
/// doesn't know the keyId, so every seal key is tried until one authenticates.
///
/// On success the notification shows the real title and body, is threaded by chat, and its
/// userInfo gains `m` (keyId), `c` (chatId) and `p` (projectPath) for tap routing
/// (mobile/src/push). On any failure the fallback content is delivered unchanged.
class NotificationService: UNNotificationServiceExtension {
    private static let service = "com.project96.sai.machines"
    private static let sharedGroup = "com.project96.sai.shared"
    private static let sealAccountPrefix = "seal:"
    private static let kinds: Set<String> = ["done", "approval", "question", "error"]

    /// Guards the three fields below: serviceExtensionTimeWillExpire can run while didReceive
    /// is still working, and the handler must be called exactly once.
    private let lock = NSLock()
    private var contentHandler: ((UNNotificationContent) -> Void)?
    /// The original request content: what is delivered on any failure.
    private var fallbackContent: UNNotificationContent?
    /// The opened content, once decryption succeeded.
    private var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        lock.lock()
        self.contentHandler = contentHandler
        self.fallbackContent = request.content
        lock.unlock()

        if let opened = NotificationService.open(request.content.userInfo),
           let content = request.content.mutableCopy() as? UNMutableNotificationContent {
            if !opened.plain.title.isEmpty { content.title = opened.plain.title }
            if !opened.plain.body.isEmpty { content.body = opened.plain.body }
            content.threadIdentifier = opened.plain.chatId
            var info = content.userInfo
            info["m"] = opened.keyId
            info["c"] = opened.plain.chatId
            info["p"] = opened.plain.projectPath
            content.userInfo = info
            lock.lock()
            bestAttemptContent = content
            lock.unlock()
        }
        deliver()
    }

    override func serviceExtensionTimeWillExpire() {
        // Delivers the best attempt: the opened content if decryption finished, else the fallback.
        deliver()
    }

    private func deliver() {
        lock.lock()
        let handler = contentHandler
        contentHandler = nil
        let content: UNNotificationContent? = bestAttemptContent ?? fallbackContent
        lock.unlock()
        // Called outside the lock; whoever took the handler is the only caller.
        if let handler = handler, let content = content {
            handler(content)
        }
    }

    // MARK: - Opening

    struct PushPlain: Decodable {
        let v: Int
        let kind: String
        let chatId: String
        let projectPath: String
        let title: String
        let body: String
        let ts: Double
    }

    struct Opened {
        let keyId: String
        let plain: PushPlain
    }

    static func open(_ userInfo: [AnyHashable: Any]) -> Opened? {
        guard let sealed = userInfo["s"] as? String,
              let blob = Data(base64Encoded: sealed),
              blob.count >= 12 + 16,
              let box = try? AES.GCM.SealedBox(combined: blob) else {
            return nil
        }
        for (keyId, keyData) in sealKeys() {
            let key = SymmetricKey(data: keyData)
            // Only the right key authenticates; any other throws and the next is tried.
            guard let plaintext = try? AES.GCM.open(box, using: key) else { continue }
            guard let plain = try? JSONDecoder().decode(PushPlain.self, from: plaintext),
                  plain.v == 1, kinds.contains(plain.kind), plain.ts.isFinite else {
                return nil
            }
            return Opened(keyId: keyId, plain: plain)
        }
        return nil
    }

    /// Every `seal:<keyId>` item in the shared group: (keyId, 32 raw key bytes).
    static func sealKeys() -> [(String, Data)] {
        guard let prefix = AppIdentifierPrefix.resolve(service: service) else { return [] }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: prefix + sharedGroup,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
            kSecReturnData as String: true
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let items = result as? [[String: Any]] else {
            return []
        }
        var keys: [(String, Data)] = []
        for item in items {
            guard let account = item[kSecAttrAccount as String] as? String,
                  account.hasPrefix(sealAccountPrefix),
                  let stored = item[kSecValueData as String] as? Data,
                  // The app stores the key base64-encoded (the Keychain plugin stores strings).
                  let b64 = String(data: stored, encoding: .utf8),
                  let raw = Data(base64Encoded: b64),
                  raw.count == 32 else {
                continue
            }
            keys.append((String(account.dropFirst(sealAccountPrefix.count)), raw))
        }
        return keys
    }
}
