import Foundation
import CryptoKit

enum SharedDocumentError: Error, LocalizedError {
    case invalid, changed, unresolved, missing, notCurrent
    var errorDescription: String? {
        switch self {
        case .invalid: return "Файл общего плана повреждён или имеет неподдерживаемый формат."
        case .changed: return "Файл изменился во время синхронизации. Повтори попытку."
        case .unresolved: return "iCloud обнаружил конфликт версий. Автоматическая запись остановлена."
        case .missing: return "Общий файл недоступен или удалён. Автоматическая запись остановлена."
        case .notCurrent: return "iCloud ещё загружает актуальную версию файла."
        }
    }
}

/// Format is the existing FinRoad state JSON, canonicalized for stable hashes.
struct SharedDocument {
    static func canonical(_ bytes: Data) throws -> Data {
        guard let obj = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              (obj["schema"] as? Int) == 1,
              obj["transactions"] is [Any], obj["debts"] is [Any],
              obj["incomeSources"] is [Any], obj["completed"] is [String: Any]
        else { throw SharedDocumentError.invalid }
        return try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys, .fragmentsAllowed])
    }
    static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format:"%02x", $0) }.joined() }
    static func hasConflicts(_ url: URL) -> Bool {
        !(NSFileVersion.unresolvedConflictVersionsOfItem(at: url) ?? []).isEmpty
    }
    static func read(_ url: URL) throws -> Data {
        var error: NSError?; var result: Result<Data, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &error) { coordinated in
            result = Result {
                guard !hasConflicts(coordinated) else { throw SharedDocumentError.unresolved }
                let values = try coordinated.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
                if values.isUbiquitousItem == true && values.ubiquitousItemDownloadingStatus != .current {
                    try? FileManager.default.startDownloadingUbiquitousItem(at: coordinated)
                    throw SharedDocumentError.notCurrent
                }
                return try canonical(Data(contentsOf: coordinated))
            }
        }
        if let error { throw error }; guard let result else { throw SharedDocumentError.missing }; return try result.get()
    }
    /// Only update a previously observed version; nil is allowed only for creation.
    static func write(_ bytes: Data, to url: URL, expected: String?) throws {
        let canonicalBytes = try canonical(bytes)
        var error: NSError?; var result: Result<Void, Error>?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forMerging, error: &error) { coordinated in
            result = Result {
                guard !hasConflicts(coordinated) else { throw SharedDocumentError.unresolved }
                let exists = FileManager.default.fileExists(atPath: coordinated.path)
                if exists {
                    let values = try coordinated.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
                    if values.isUbiquitousItem == true && values.ubiquitousItemDownloadingStatus != .current { throw SharedDocumentError.notCurrent }
                    guard let expected, hash(try canonical(Data(contentsOf: coordinated))) == expected else { throw SharedDocumentError.changed }
                } else if expected != nil { throw SharedDocumentError.missing }
                try canonicalBytes.write(to: coordinated, options: exists ? .atomic : .withoutOverwriting)
            }
        }
        if let error { throw error }; guard let result else { throw SharedDocumentError.missing }; try result.get()
    }
}
