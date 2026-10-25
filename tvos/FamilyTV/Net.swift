import Foundation

typealias JSON = [String: Any]

// The lock server (Supabase function "family-tv"): checks the passcode, remembers this Apple TV,
// hands out the library link, and keeps genres, moods and watch progress for every device.
enum Gate {
    static let url = URL(string: "https://noytzrdrvaztjeytdwma.supabase.co/functions/v1/family-tv")!

    static func call(_ body: JSON) async throws -> (status: Int, json: JSON) {
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25)
        r.httpMethod = "POST"
        r.setValue("https://johnsolomon.org", forHTTPHeaderField: "Origin")
        r.setValue("text/plain;charset=UTF-8", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: r)
        let j = (try? JSONSerialization.jsonObject(with: data)) as? JSON ?? [:]
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, j)
    }
}

struct PCloudError: Error { var result: Int }

/// pCloud sends ready-made paths; encode anything unusual just in case
func link(_ host: String, _ path: String) -> URL? {
    let s = "https://\(host)\(path)"
    return URL(string: s) ?? s.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed).flatMap(URL.init(string:))
}

// The shared pCloud folder. Download links pCloud hands out only work from the device that asked,
// so the Apple TV asks for its own.
final class PCloud {
    private let code: String
    private let pass: String
    private var api: String

    init(link: String, pass: String?) {
        self.pass = pass ?? ""
        api = link.range(of: #"//e[\w.-]*pcloud\.(link|com)"#, options: [.regularExpression, .caseInsensitive]) != nil
            ? "https://eapi.pcloud.com" : "https://api.pcloud.com"
        if let c = URLComponents(string: link)?.queryItems?.first(where: { $0.name == "code" })?.value { code = c }
        else { code = link.trimmed }
    }

    func call(_ method: String, _ params: [String: String] = [:]) async throws -> JSON {
        var c = URLComponents(string: "\(api)/\(method)")!
        var q = [URLQueryItem(name: "code", value: code)]
        if !pass.isEmpty { q.append(URLQueryItem(name: "linkpassword", value: pass)) }
        q += params.map { URLQueryItem(name: $0.key, value: $0.value) }
        c.queryItems = q
        let (data, _) = try await URLSession.shared.data(for: URLRequest(url: c.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
        return (try JSONSerialization.jsonObject(with: data)) as? JSON ?? [:]
    }

    /// The whole folder tree, as pCloud sends it
    func tree() async throws -> JSON {
        var j = try await call("showpublink")
        if (j["result"] as? Int) != 0 {          // the link may live in the other pCloud region
            api = api.contains("eapi") ? "https://api.pcloud.com" : "https://eapi.pcloud.com"
            let j2 = try await call("showpublink")
            if (j2["result"] as? Int) == 0 { j = j2 }
        }
        guard (j["result"] as? Int) == 0, let meta = j["metadata"] as? JSON else { throw PCloudError(result: j["result"] as? Int ?? -1) }
        return meta
    }

    /// Picture links for stills and posters
    func thumbs(_ ids: [String], size: String) async -> [String: URL] {
        var out: [String: URL] = [:]
        let unique = Array(Set(ids.filter { !$0.isEmpty }))
        for start in stride(from: 0, to: unique.count, by: 80) {
            let chunk = unique[start..<min(start + 80, unique.count)]
            guard let j = try? await call("getpubthumbslinks", ["fileids": chunk.joined(separator: ","), "size": size, "crop": "1"]) else { continue }
            for t in j["thumbs"] as? [JSON] ?? [] {
                guard (t["result"] as? Int) == 0, let id = (t["fileid"] as? NSNumber)?.stringValue,
                      let host = (t["hosts"] as? [String])?.first, let path = t["path"] as? String,
                      let u = link(host, path) else { continue }
                out[id] = u
            }
        }
        return out
    }

    /// A streaming link for one video
    func videoURL(_ fileid: String) async throws -> URL {
        let j = try await call("getpublinkdownload", ["fileid": fileid])
        guard (j["result"] as? Int) == 0, let host = (j["hosts"] as? [String])?.first, let path = j["path"] as? String,
              let u = link(host, path) else { throw PCloudError(result: j["result"] as? Int ?? -1) }
        return u
    }
}
