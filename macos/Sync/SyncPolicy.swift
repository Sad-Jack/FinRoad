import Foundation

/// Sync decisions are based on the hash of the last version both copies shared.
/// A missing remote after pairing is never interpreted as a new empty document.
enum SyncDecision: Equatable {
    case unchanged
    case upload(expected: String?)
    case download
    case conflict
    case remoteMissing
}

func syncDecision(base: String?, local: String, remote: String?) -> SyncDecision {
    if local == remote { return .unchanged }
    guard let base = base else {
        return remote == nil ? .upload(expected: nil) : .conflict
    }
    guard let remote = remote else { return .remoteMissing }
    if local == base { return .download }
    if remote == base { return .upload(expected: base) }
    return .conflict
}
