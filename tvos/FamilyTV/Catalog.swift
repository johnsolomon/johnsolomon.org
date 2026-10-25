import Foundation

// Turns the pCloud folder into shows and movies — the same rules as the website:
// episodes are recognized by S01E02 (or 1x02) in the file name, everything else is a movie,
// and top-level folders other than Movies/Shows get their own row.

struct Episode: Identifiable, Hashable {
    let id: String          // pCloud file id (also the key for watch progress)
    var season: Int
    var n: Int?
    var title: String
    var sortName: String
    var art: String
    var idx = 0
    var seasonLabel = ""
}

struct Item: Identifiable, Hashable {
    enum Kind: String { case show, movie }
    var kind: Kind
    var key: String
    var title: String
    var year: String?
    var episodes: [Episode]
    var art: String
    var added: Double
    var id: String { key }
}

struct Row: Identifiable, Hashable {
    var name: String
    var items: [Item]
    var virtual = false
    var id: String { name }
}

struct Catalog {
    var rows: [Row] = []
    var all: [Item] = []
    var newest: Item? { all.max { $0.added < $1.added } }
    var folderRows: [Row] { rows.filter { !$0.virtual } }
    func item(_ key: String) -> Item? { all.first { $0.key == key } }
}

// One file or folder from pCloud
struct Node {
    var name: String
    var isFolder: Bool
    var fileid: String?
    var created: Double
    var contents: [Node]

    init(_ j: [String: Any]) {
        name = j["name"] as? String ?? ""
        isFolder = j["isfolder"] as? Bool ?? false
        if let f = j["fileid"] as? NSNumber { fileid = f.stringValue } else { fileid = nil }
        created = Node.date(j["created"] as? String ?? j["modified"] as? String)
        contents = (j["contents"] as? [[String: Any]] ?? []).map(Node.init)
    }
    private static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        return f
    }()
    static func date(_ s: String?) -> Double { s.flatMap { fmt.date(from: $0)?.timeIntervalSince1970 } ?? 0 }
}

// MARK: - small text helpers

private func rx(_ p: String) -> NSRegularExpression { try! NSRegularExpression(pattern: p, options: [.caseInsensitive]) }
extension String {
    func test(_ r: NSRegularExpression) -> Bool { r.firstMatch(in: self, range: NSRange(startIndex..., in: self)) != nil }
    func groups(_ r: NSRegularExpression) -> [String?]? {
        guard let m = r.firstMatch(in: self, range: NSRange(startIndex..., in: self)) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: self).map { String(self[$0]) } }
    }
    func sub(_ r: NSRegularExpression, _ with: String) -> String {
        r.stringByReplacingMatches(in: self, range: NSRange(startIndex..., in: self), withTemplate: with)
    }
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
func natural(_ a: String, _ b: String) -> Bool { a.localizedStandardCompare(b) == .orderedAscending }

private let VIDEO_EXT = rx(#"\.(mp4|m4v|mov)$"#)               // formats Apple TV plays
private let IMAGE_EXT = rx(#"\.(jpe?g|png|webp)$"#)
private let POSTER_NAME = rx(#"^(poster|cover|folder)\.(jpe?g|png|webp)$"#)
private let SHOW_DIR = rx(#"^(shows?|tv|tv shows|series)$"#)
private let MOVIE_DIR = rx(#"^(movies?|films?)$"#)
private let SEASON_DIR = rx(#"^(season|series|s)\s*\d+$"#)
private let JUNK = rx(#"\b(2160p|1080p|720p|480p|4k|uhd|hdr|x26[45]|h\.?26[45]|hevc|web[-. ]?(dl|rip)?|blu[-. ]?ray|brrip|bdrip|dvdrip|hdtv|aac|ac3|ddp?5\.1|5\.1|10bit|proper|repack|remux|yts|rarbg)\b.*$"#)
private let DOTS = rx(#"[._]+"#)
private let EMPTY_BRACKETS = rx(#"[\[(]\s*[\])]"#)
private let TRAIL_DASH = rx(#"\s+[-–]\s*$"#)
private let SPACES = rx(#"\s{2,}"#)
private let EPISODE = rx(#"^(.*?)\s*[-–]?\s*\b(?:s(\d{1,2})\s*e(\d{1,3})|(\d{1,2})x(\d{2,3}))\b\s*[-–:]?\s*(.*)$"#)
private let YEAR_END = rx(#"\s*\(?(19|20)\d{2}\)?$"#)
private let MOVIE_YEAR = rx(#"^(.*?)[\s(\[]*((?:19|20)\d{2})[\s)\]]*(.*)$"#)
private let EP_NUM = rx(#"^(?:episode|ep|e)\s*(\d+)"#)
private let DIGITS = rx(#"\d+"#)

private let EXTENSION = rx(#"\.[^.]+$"#)
private func base(_ n: String) -> String { n.sub(EXTENSION, "") }
private func tidy(_ s: String, _ scene: Bool) -> String {
    var t = s.sub(DOTS, " ")
    if scene { t = t.sub(JUNK, "") }
    return t.sub(EMPTY_BRACKETS, "").sub(TRAIL_DASH, "").sub(SPACES, " ").trimmed
}
private func isScene(_ name: String) -> Bool { base(name).contains(".") || base(name).contains("_") }
private func isVideo(_ f: Node) -> Bool { !f.isFolder && f.name.test(VIDEO_EXT) }
private func isImage(_ f: Node) -> Bool { !f.isFolder && f.name.test(IMAGE_EXT) }

private struct ParsedEpisode { var show: String; var season: Int; var ep: Int; var title: String }
private func parseEpisode(_ name: String) -> ParsedEpisode? {
    let sc = isScene(name), b = base(name).sub(DOTS, " ")
    guard let g = b.groups(EPISODE) else { return nil }
    let season = Int(g[2] ?? g[4] ?? "") ?? 1, ep = Int(g[3] ?? g[5] ?? "") ?? 0
    return ParsedEpisode(show: tidy(g[1] ?? "", sc).sub(YEAR_END, ""), season: season, ep: ep, title: tidy(g[6] ?? "", sc))
}
private func parseMovie(_ name: String) -> (title: String, year: String?) {
    let sc = isScene(name), b = base(name).sub(DOTS, " ")
    if let y = b.groups(MOVIE_YEAR), let t = y[1], !t.trimmed.isEmpty { return (tidy(t, sc), y[2]) }
    return (tidy(b, sc), nil)
}

private struct Found { var f: Node; var path: [Node]; var siblings: [Node] }
private func walk(_ folder: Node, _ path: [Node], _ out: inout [Found]) {
    for f in folder.contents {
        if f.isFolder { walk(f, path + [f], &out) } else if isVideo(f) { out.append(Found(f: f, path: path, siblings: folder.contents)) }
    }
}
private func posterIn(_ folder: Node?) -> String? {
    folder?.contents.first { isImage($0) && $0.name.test(POSTER_NAME) }?.fileid
}
// "Moana.jpg" next to "Moana.mp4", else poster.jpg in its folder
private func posterFor(_ f: Node, _ siblings: [Node], _ folder: Node?) -> String? {
    let b = base(f.name).lowercased()
    return siblings.first { isImage($0) && base($0.name).lowercased() == b }?.fileid ?? posterIn(folder)
}

func buildCatalog(_ root: Node) -> Catalog {
    var vids: [Found] = []
    walk(root, [], &vids)
    var shows: [String: Item] = [:]
    var showFolders: [String: Node] = [:]
    var movieRows: [String: [Item]] = [:]
    func rowFor(_ path: [Node]) -> String {
        guard let top = path.first else { return "Movies" }
        return top.name.test(MOVIE_DIR) || top.name.test(SHOW_DIR) ? "Movies" : top.name
    }
    for v in vids {
        guard let fid = v.f.fileid else { continue }
        let ep = parseEpisode(v.f.name)
        let parent = v.path.last
        let inShowDir = (v.path.first?.name.test(SHOW_DIR) ?? false) && v.path.count >= 2
        if ep != nil || inShowDir {
            let showFolder: Node? = inShowDir ? v.path[1]
                : (parent.map { $0.name.test(SEASON_DIR) } ?? false) && v.path.count >= 2 ? v.path[v.path.count - 2] : parent
            let epShow = ep?.show ?? ""
            let name = !epShow.isEmpty ? epShow : (showFolder?.name ?? "Videos")
            let key = "s:" + name.lowercased()
            if shows[key] == nil { shows[key] = Item(kind: .show, key: key, title: name, year: nil, episodes: [], art: "", added: 0) }
            if showFolders[key] == nil, let sf = showFolder { showFolders[key] = sf }
            var seasonFromDir: Int?
            if let p = parent, p.name.test(SEASON_DIR), let d = p.name.groups(DIGITS)?.first ?? nil { seasonFromDir = Int(d) }
            let b = base(v.f.name)
            let n = ep.map { $0.ep } ?? (b.groups(EP_NUM)?[1]).flatMap { Int($0 ?? "") }
            let title = ep.map { $0.title.isEmpty ? "Episode \($0.ep)" : $0.title } ?? tidy(b, isScene(v.f.name))
            shows[key]!.episodes.append(Episode(id: fid, season: ep?.season ?? seasonFromDir ?? 1, n: n, title: title,
                                                sortName: v.f.name, art: posterFor(v.f, v.siblings, nil) ?? fid))
            shows[key]!.added = max(shows[key]!.added, v.f.created)
            if shows[key]!.art.isEmpty, let a = posterIn(showFolder) { shows[key]!.art = a }
        } else {
            let row = rowFor(v.path)
            let m: (title: String, year: String?) = row == "Movies" ? parseMovie(v.f.name) : (title: tidy(base(v.f.name), false), year: nil)
            let own: Node? = (parent != nil && v.path.count >= 2 && !parent!.name.test(MOVIE_DIR)) ? parent : nil
            let title = own != nil && row == "Movies" ? tidy(own!.name, false) : m.title
            movieRows[row, default: []].append(Item(kind: .movie, key: "f" + fid, title: title, year: m.year,
                episodes: [Episode(id: fid, season: 1, n: nil, title: m.title, sortName: v.f.name, art: "")],
                art: posterFor(v.f, v.siblings, own) ?? fid, added: v.f.created))
        }
    }
    let showList: [Item] = shows.values.map { s0 in
        var s = s0
        s.episodes.sort { a, b in
            if a.season != b.season { return a.season < b.season }
            if (a.n ?? Int.max) != (b.n ?? Int.max) { return (a.n ?? Int.max) < (b.n ?? Int.max) }
            return natural(a.sortName, b.sortName)
        }
        let multi = Set(s.episodes.map(\.season)).count > 1
        for i in s.episodes.indices {
            s.episodes[i].idx = i
            s.episodes[i].seasonLabel = multi ? "Season \(s.episodes[i].season)" : ""
        }
        if s.art.isEmpty { s.art = s.episodes.first?.art ?? "" }
        return s
    }.sorted { natural($0.title, $1.title) }

    var rows: [Row] = []
    let all = showList + movieRows.keys.sorted(by: natural).flatMap { movieRows[$0]! }
    if all.count > 11 { rows.append(Row(name: "Recently Added", items: Array(all.sorted { $0.added > $1.added }.prefix(12)), virtual: true)) }
    if !showList.isEmpty { rows.append(Row(name: "Shows", items: showList)) }
    if let m = movieRows["Movies"] { rows.append(Row(name: "Movies", items: m.sorted { natural($0.title, $1.title) })) }
    for k in movieRows.keys.filter({ $0 != "Movies" }).sorted(by: natural) {
        rows.append(Row(name: k, items: movieRows[k]!.sorted { natural($0.title, $1.title) }))
    }
    return Catalog(rows: rows, all: all)
}
