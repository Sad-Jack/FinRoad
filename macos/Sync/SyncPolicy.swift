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

/// Merge only a checkpoint advance whose previous value recreates the shared
/// base exactly. All other local edits, including settlement history, conflict.
func mergeCheckpointOnly(base: String?, checkpoint: Data, edited: Data) throws -> Data? {
    guard let base,
          var checkpointObject = try JSONSerialization.jsonObject(with: checkpoint) as? [String: Any],
          var editedObject = try JSONSerialization.jsonObject(with: edited) as? [String: Any],
          let checkpointDate = checkpointObject["autoFromDate"] as? String,
          let editedDate = editedObject["autoFromDate"] as? String,
          checkpointDate > editedDate else { return nil }
    checkpointObject["autoFromDate"] = editedDate
    let candidate = try SharedDocument.canonical(JSONSerialization.data(withJSONObject: checkpointObject))
    guard SharedDocument.hash(candidate) == base else { return nil }
    editedObject["autoFromDate"] = checkpointDate
    return try SharedDocument.canonical(JSONSerialization.data(withJSONObject: editedObject))
}
