import Foundation
import SwiftUI

struct Prog: Codable, Equatable {
    var t: Double      // seconds watched
    var d: Double      // length in seconds
    var key: String    // which show or movie
    var ts: Double     // when, in ms since 1970 (same as the website)
    var fraction: Double { d > 0 ? min(1, t / d) : 0 }
}

// Genres, moods and similar titles worked out by the lock server's AI
struct Meta {
    var genres: [String] = []
    var summary: String?
    var year: String?
    var rating: String?
    var moods: [String: Double] = [:]
    var sim: [String: Double] = [:]
    init() {}
    init(_ j: JSON) {
        genres = j["genres"] as? [String] ?? []
        summary = j["summary"] as? String
        year = j["year"] as? String
        rating = j["rating"] as? String
        moods = (j["moods"] as? [String: NSNumber] ?? [:]).mapValues(\.doubleValue)
        for pair in j["sim"] as? [[Any]] ?? [] {
            if pair.count == 2, let k = pair[0] as? String, let v = pair[1] as? NSNumber { sim[k] = v.doubleValue }
        }
    }
}

struct Facet: Identifiable, Hashable { let id: String; let name: String; let count: Int }

let MOODS: [(key: String, name: String)] = [("calm", "Calm"), ("funny", "Funny"), ("exciting", "Exciting"),
                                            ("musical", "Musical"), ("heartwarming", "Heartwarming"), ("learning", "Learning")]

@MainActor
final class Store: ObservableObject {
    enum Phase: Equatable { case starting, locked, ready, failed(String) }
    enum Unlock { case ok, wrong(Int), locked(Date), offline }

    @Published var phase: Phase = .starting
    @Published var lib = Catalog()
    @Published var art: [String: URL] = [:]      // stills and posters for cards
    @Published var bigArt: [String: URL] = [:]   // sharper pictures for the big banners
    @Published var meta: [String: Meta] = [:]
    @Published var progress: [String: Prog] = [:]

    private(set) var cloud: PCloud?
    private var dirty: [String: Prog] = [:]
    private var syncTask: Task<Void, Never>?
    private var lastRefresh = Date.distantPast
    private var refreshing = false
    private let defaults = UserDefaults.standard

    private var token: String? {
        get { defaults.string(forKey: "ftv.token") }
        set { defaults.set(newValue, forKey: "ftv.token") }
    }

    init() {
        if let d = defaults.data(forKey: "ftv.progress"), let p = try? JSONDecoder().decode([String: Prog].self, from: d) { progress = p }
        if let m = Cache.read("meta") { meta = m.mapValues { Meta($0 as? JSON ?? [:]) } }
    }

    // MARK: starting up

    func start() async {
        guard let t = token else { phase = .locked; return }
        let cached = Cache.read("tree")
        do {
            let r = try await Gate.call(["token": t])
            if let link = r.json["link"] as? String {
                cloud = PCloud(link: link, pass: r.json["pass"] as? String)
            } else if r.status == 401 {
                token = nil; phase = .locked; return
            } else if cached == nil {
                phase = .failed("The lock server didn’t answer. Try again in a minute."); return
            }
        } catch {
            if cached == nil { phase = .failed("No internet connection."); return }
        }
        if let c = cached { lib = buildCatalog(Node(c)); phase = .ready }   // show the saved library right away
        await refresh()
    }

    func unlock(_ pin: String) async -> Unlock {
        guard let r = try? await Gate.call(["pin": pin]) else { return .offline }
        if let t = r.json["token"] as? String, let link = r.json["link"] as? String {
            token = t
            cloud = PCloud(link: link, pass: r.json["pass"] as? String)
            phase = .starting
            Task { await refresh() }
            return .ok
        }
        switch r.json["error"] as? String {
        case "locked":
            let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return .locked(f.date(from: r.json["retryAfter"] as? String ?? "") ?? Date().addingTimeInterval(900))
        case "wrong": return .wrong((r.json["left"] as? Int) ?? 0)
        default: return .offline
        }
    }

    /// Re-reads the folder (new videos show up), pictures, progress and the AI's labels
    func refresh() async {
        if refreshing { return }
        refreshing = true; defer { refreshing = false }
        if cloud == nil, let t = token, let r = try? await Gate.call(["token": t]), let link = r.json["link"] as? String {
            cloud = PCloud(link: link, pass: r.json["pass"] as? String)
        }
        guard let cloud else { if lib.all.isEmpty { phase = .failed("No internet connection.") }; return }
        do {
            let tree = try await cloud.tree()
            Cache.write("tree", tree)
            lib = buildCatalog(Node(tree))
            phase = .ready
            lastRefresh = Date()
        } catch let e as PCloudError {
            let why = [7001: "The pCloud link isn’t valid.", 7002: "The pCloud link was deleted.", 7004: "The pCloud link has expired.",
                       7005: "pCloud’s monthly sharing limit for this link has been reached."][e.result]
            if lib.all.isEmpty { phase = .failed(why ?? "Can’t reach the video library.") }
            return
        } catch {
            if lib.all.isEmpty { phase = .failed("Can’t reach the video library. Check the internet connection.") }
            return
        }
        let ids = lib.all.map(\.art) + lib.all.filter { $0.kind == .show }.flatMap { $0.episodes.map(\.art) }
        let pics = await cloud.thumbs(ids, size: "800x452")
        art.merge(pics) { _, new in new }
        await syncProgress(all: !defaults.bool(forKey: "ftv.synced"))
        await loadMeta()
    }

    func refreshIfStale() {
        guard phase == .ready, Date().timeIntervalSince(lastRefresh) > 120 else { return }
        Task { await refresh() }
    }

    func loadBigArt(_ id: String) {
        guard bigArt[id] == nil, let cloud else { return }
        Task { let o = await cloud.thumbs([id], size: "1600x900"); bigArt.merge(o) { _, n in n } }
    }

    // MARK: genres and moods

    private func loadMeta() async {
        guard let t = token else { return }
        let items: [JSON] = lib.all.map { it in
            var o: JSON = ["key": it.key, "title": it.title, "kind": it.kind.rawValue]
            if let y = it.year { o["year"] = y }
            if it.kind == .show { o["eps"] = it.episodes.prefix(25).map(\.title) }
            return o
        }
        for _ in 0..<40 {                       // new titles are described one AI step per request
            guard let r = try? await Gate.call(["token": t, "meta": items]), let m = r.json["meta"] as? JSON else { break }
            meta = m.mapValues { Meta($0 as? JSON ?? [:]) }
            Cache.write("meta", m)
            if (r.json["pending"] as? Int ?? 0) == 0 { break }
        }
    }

    func metaOf(_ it: Item) -> Meta { meta[it.key.lowercased()] ?? Meta() }

    var genreList: [Facet] {
        var c: [String: Int] = [:]
        for it in lib.all { for g in metaOf(it).genres { c[g, default: 0] += 1 } }
        return c.map { Facet(id: $0.key, name: $0.key, count: $0.value) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : natural($0.name, $1.name) }
    }
    func genreItems(_ g: String) -> [Item] { lib.all.filter { metaOf($0).genres.contains(g) } }
    func moodItems(_ k: String) -> [Item] {
        lib.all.filter { (metaOf($0).moods[k] ?? 0) > 0.5 }.sorted { (metaOf($0).moods[k] ?? 0) > (metaOf($1).moods[k] ?? 0) }
    }
    var moodList: [Facet] {
        MOODS.map { Facet(id: $0.key, name: $0.name, count: moodItems($0.key).count) }.filter { $0.count > 0 }
    }
    func matches(_ q: String) -> [Item] {
        let q = q.trimmed.lowercased()
        guard !q.isEmpty else { return [] }
        return lib.all.filter { it in
            it.title.lowercased().contains(q) || metaOf(it).genres.contains { $0.lowercased().contains(q) }
                || it.episodes.contains { $0.title.lowercased().contains(q) }
        }
    }
    func similar(to it: Item) -> [Item] {
        metaOf(it).sim.sorted { $0.value > $1.value }.compactMap { k, _ in lib.all.first { $0.key.lowercased() == k } }.prefix(12).map { $0 }
    }

    // MARK: watch progress

    func fraction(_ ep: Episode) -> Double { progress[ep.id]?.fraction ?? 0 }
    func finished(_ it: Item) -> Bool { it.episodes.allSatisfy { fraction($0) >= 0.95 } }
    func started(_ it: Item) -> Bool { it.episodes.contains { progress[$0.id] != nil } }

    /// The episode to play: the last one in progress, else the first not yet watched
    func nextUnwatched(_ it: Item) -> Int {
        var best = -1, ts = 0.0
        for (i, e) in it.episodes.enumerated() {
            if let p = progress[e.id], p.ts > ts, p.fraction < 0.95 { ts = p.ts; best = i }
        }
        if best >= 0 { return best }
        return it.episodes.firstIndex { fraction($0) < 0.95 } ?? 0
    }

    var continueWatching: [(item: Item, ep: Episode)] {
        var seen = Set<String>(), out: [(item: Item, ep: Episode)] = []
        for (id, p) in progress.sorted(by: { $0.value.ts > $1.value.ts }) where p.d > 0 && p.fraction > 0.03 && p.fraction < 0.95 {
            guard !seen.contains(p.key), let it = lib.item(p.key), let ep = it.episodes.first(where: { $0.id == id }) else { continue }
            seen.insert(p.key); out.append((item: it, ep: ep))
            if out.count == 12 { break }
        }
        return out
    }

    var evening: Bool { let h = Calendar.current.component(.hour, from: Date()); return h >= 18 || h < 6 }

    /// Picked for you: most like what's been watched lately (the AI's similarity scores),
    /// calmer in the evening, upbeat in the day, a nudge for anything new.
    func forYou(skip: Set<String> = []) -> [Item] {
        let now = Date().timeIntervalSince1970 * 1000
        var recent: [String: Double] = [:]
        for p in progress.values { recent[p.key.lowercased()] = max(recent[p.key.lowercased()] ?? 0, p.ts) }
        let night = evening
        return lib.all.filter { !skip.contains($0.key) }.map { it -> (Item, Double) in
            let m = metaOf(it), me = it.key.lowercased()
            var s = 0.0
            for (k, ts) in recent where k != me { s += pow(0.5, (now - ts) / 6048e5) * ((m.sim[k] ?? 0.7) - 0.7) }
            s += night ? 0.02 * (m.moods["calm"] ?? 0) : 0.01 * ((m.moods["funny"] ?? 0) + (m.moods["exciting"] ?? 0))
            if now - it.added * 1000 < 6048e5 { s += 0.03 }
            if finished(it) { s -= 0.15 }
            return (it, s)
        }.sorted { $0.1 > $1.1 }.map { $0.0 }
    }

    func save(_ it: Item, _ ep: Episode, t: Double, d: Double) {
        guard d > 0, t.isFinite, d.isFinite else { return }
        let p = Prog(t: t, d: d, key: it.key, ts: (Date().timeIntervalSince1970 * 1000).rounded())
        progress[ep.id] = p
        dirty[ep.id] = p
        if let data = try? JSONEncoder().encode(progress) { defaults.set(data, forKey: "ftv.progress") }
        syncTask?.cancel()
        syncTask = Task { try? await Task.sleep(nanoseconds: 15_000_000_000); if !Task.isCancelled { await syncProgress(all: false) } }
    }

    func flush() { syncTask?.cancel(); Task { await syncProgress(all: false) } }

    /// Shares progress with the website and other devices, so playback resumes in the same spot everywhere
    private func syncProgress(all: Bool) async {
        guard let t = token else { return }
        let send = all ? progress : dirty
        dirty = [:]
        let body: JSON = send.mapValues { ["t": $0.t, "d": $0.d, "key": $0.key, "ts": $0.ts] as JSON }
        guard let r = try? await Gate.call(["token": t, "progress": body]), let got = r.json["progress"] as? [String: JSON] else {
            if !all { dirty.merge(send) { cur, _ in cur } }
            return
        }
        if all { defaults.set(true, forKey: "ftv.synced") }
        var changed = false
        for (id, j) in got {
            guard let pt = (j["t"] as? NSNumber)?.doubleValue, let pd = (j["d"] as? NSNumber)?.doubleValue,
                  let pk = j["key"] as? String, let pts = (j["ts"] as? NSNumber)?.doubleValue else { continue }
            if (progress[id]?.ts ?? -1) < pts { progress[id] = Prog(t: pt, d: pd, key: pk, ts: pts); changed = true }
        }
        if changed, let data = try? JSONEncoder().encode(progress) { defaults.set(data, forKey: "ftv.progress") }
    }

    // MARK: playing

    func play(_ it: Item, _ idx: Int? = nil) {
        Playback.shared.start(store: self, item: it, index: idx ?? nextUnwatched(it))
    }
}

/// The saved library and labels, so the app opens instantly (the system may clear these; they're re-fetched)
enum Cache {
    static func url(_ name: String) -> URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("ftv-\(name).json")
    }
    static func read(_ name: String) -> JSON? {
        guard let d = try? Data(contentsOf: url(name)) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? JSON
    }
    static func write(_ name: String, _ j: JSON) {
        if let d = try? JSONSerialization.data(withJSONObject: j) { try? d.write(to: url(name), options: .atomic) }
    }
}
