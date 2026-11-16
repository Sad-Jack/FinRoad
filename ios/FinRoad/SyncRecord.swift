import Foundation

/// The payload and its shared ancestor are committed together in one atomic file.
struct SyncRecord: Codable {
    var state: Data
    var base: String?
    var bookmark: Data?
}

enum SyncRecordError: Error, LocalizedError {
    case localChanges, conflict, unavailable
    var errorDescription: String? {
        switch self {
        case .localChanges: return "Локальный план отличается. Сначала сохрани резервную копию."
        case .conflict: return "План изменился на обоих устройствах. Версии сохранены, синхронизация остановлена."
        case .unavailable: return "Общий файл недоступен. Локальные изменения сохранены."
        }
    }
}

final class SyncRecordStore {
    let url: URL
    init(url: URL) { self.url = url }
    func load() throws -> SyncRecord? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(SyncRecord.self, from: Data(contentsOf: url))
    }
    func save(_ record: SyncRecord) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(record).write(to: url, options: .atomic)
    }
}
