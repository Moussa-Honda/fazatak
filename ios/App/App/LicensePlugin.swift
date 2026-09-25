import Capacitor
import CryptoKit
import Foundation
import Security

@objc(LicensePlugin)
public class LicensePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LicensePlugin"
    public let jsName = "License"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activateLicense", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkLicense", returnType: CAPPluginReturnPromise)
    ]

    private let secretSalt = "NAYEF_FAZATK_2026_SECURITY_SALT"
    private let keychainService = "com.installment.app.license"

    private enum Account {
        static let accountNumber = "account_number"
        static let licenseCode = "license_code"
        static let expiry = "expiry"
        static let lastSeenTime = "last_seen_time"
        static let derivedKey = "derived_key"
    }

    @objc public func activateLicense(_ call: CAPPluginCall) {
        guard let rawCode = call.getString("code") else {
            call.reject("ERR_MISSING_CODE")
            return
        }
        let accountNumber = normalizedDigits(call.getString("accountNumber") ?? "")
        guard accountNumber.range(of: "^[0-9]{8}$", options: .regularExpression) != nil else {
            call.reject("ERR_ACCOUNT_NUMBER_REQUIRED")
            return
        }

        let code = normalizedDigits(rawCode.trimmingCharacters(in: .whitespacesAndNewlines))
        guard code.range(of: "^[0-9]{9}$", options: .regularExpression) != nil else {
            call.reject("ERR_INVALID_FORMAT")
            return
        }

        do {
            let typeDigit = String(code.prefix(1))
            let codeHash = String(code.dropFirst())
            let durations: [(days: Int64, type: String)] = [
                (30, "1"),
                (90, "3"),
                (180, "6"),
                (365, "9"),
                (9999, "0")
            ]

            guard let matchedDuration = durations.first(where: { duration in
                duration.type == typeDigit &&
                    numericHash(accountNumber + String(duration.days) + secretSalt) == codeHash
            }) else {
                call.reject("ERR_WRONG_CODE")
                return
            }

            let now = Int64(Date().timeIntervalSince1970)
            let currentExpiry = Int64(try readString(Account.expiry) ?? "0") ?? 0
            let expiry: Int64

            if matchedDuration.days == 9999 {
                expiry = 2_147_483_647
            } else if currentExpiry > 2_100_000_000 {
                expiry = currentExpiry
            } else {
                expiry = max(now, currentExpiry) + (matchedDuration.days * 24 * 60 * 60)
            }

            let derivedKey = numericHash(accountNumber + code + secretSalt)
            try writeString(accountNumber, account: Account.accountNumber)
            try writeString(code, account: Account.licenseCode)
            try writeString(String(expiry), account: Account.expiry)
            try writeString(String(now), account: Account.lastSeenTime)
            try writeString(derivedKey, account: Account.derivedKey)

            call.resolve([
                "success": true,
                "expiry": expiry,
                "key": derivedKey,
                "durationDays": matchedDuration.days,
                "accountNumber": accountNumber
            ])
        } catch {
            call.reject("ERR_ACTIVATION_FAILED")
        }
    }

    @objc public func checkLicense(_ call: CAPPluginCall) {
        do {
            let accountNumber = normalizedDigits(call.getString("accountNumber") ?? "")
            guard accountNumber.range(of: "^[0-9]{8}$", options: .regularExpression) != nil else {
                call.reject("ERR_ACCOUNT_NUMBER_REQUIRED")
                return
            }
            guard try readString(Account.licenseCode) != nil else {
                call.reject("ERR_NO_LICENSE")
                return
            }
            guard try readString(Account.accountNumber) == accountNumber else {
                call.reject("ERR_WRONG_ACCOUNT")
                return
            }

            let expiry = Int64(try readString(Account.expiry) ?? "0") ?? 0
            let lastSeen = Int64(try readString(Account.lastSeenTime) ?? "0") ?? 0
            let key = try readString(Account.derivedKey) ?? "DUMMY_KEY"
            let now = Int64(Date().timeIntervalSince1970)

            guard now >= lastSeen - 3_600 else {
                call.reject("ERR_TIME_TAMPERED")
                return
            }

            guard now <= expiry else {
                call.reject("ERR_EXPIRED")
                return
            }

            try writeString(String(now), account: Account.lastSeenTime)
            call.resolve([
                "isValid": true,
                "expiry": expiry,
                "key": key,
                "accountNumber": accountNumber
            ])
        } catch {
            call.reject("ERR_LICENSE_STORAGE")
        }
    }

    private func numericHash(_ input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        var numericCode: UInt64 = 0

        for byte in digest.prefix(8) {
            numericCode = ((numericCode * 256) + UInt64(byte)) % 100_000_000
        }

        return String(format: "%08llu", numericCode)
    }

    private func normalizedDigits(_ input: String) -> String {
        let replacements: [Character: Character] = [
            "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
            "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
            "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
            "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9"
        ]
        return String(input.map { replacements[$0] ?? $0 })
    }

    private func readString(_ account: String) throws -> String? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = result as? Data else {
            throw keychainError(status)
        }
        return String(data: data, encoding: .utf8)
    }

    private func writeString(_ value: String, account: String) throws {
        let data = Data(value.utf8)
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: account
        ]
        let attributes: [CFString: Any] = [kSecValueData: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw keychainError(updateStatus)
        }

        var insert = query
        insert[kSecValueData] = data
        insert[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(insert as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw keychainError(addStatus)
        }
    }

    private func keychainError(_ status: OSStatus) -> Error {
        NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
}
