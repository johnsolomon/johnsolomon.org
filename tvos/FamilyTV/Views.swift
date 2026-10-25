import SwiftUI
import UIKit

// MARK: - Sidebar: Home, Search, the library folders, then genres and moods

struct MainView: View {
    @EnvironmentObject var store: Store
    @State private var tab = "home"

    var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house.fill", value: "home") {
                Stack { HomeView() }
            }
            Tab(value: "search", role: .search) {
                Stack { SearchView() }
            }
            TabSection("Library") {
                ForEach(store.lib.folderRows) { r in
                    Tab(r.name, systemImage: r.name == "Shows" ? "tv" : r.name == "Movies" ? "film" : "folder", value: "row:" + r.name) {
                        Stack { GridPage(title: r.name, items: r.items) }
                    }
                }
            }
            TabSection("Genres") {
                ForEach(store.genreList) { g in
                    Tab(g.name, systemImage: "tag", value: "genre:" + g.id) {
                        Stack { GridPage(title: g.name, items: store.genreItems(g.id)) }
                    }
                }
            }
            TabSection("Moods") {
                ForEach(store.moodList) { m in
                    Tab(m.name, systemImage: "sparkles", value: "mood:" + m.id) {
                        Stack { GridPage(title: m.name, items: store.moodItems(m.id)) }
                    }
                }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
    }
}

/// A page you can open a show from
struct Stack<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        NavigationStack {
            content.navigationDestination(for: Item.self) { DetailView(item: $0) }
        }
    }
}

// MARK: - Home

struct HomeView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        let cont = store.continueWatching
        let picks = store.forYou(skip: Set(cont.map { $0.item.key }))
        let hero = (store.progress.isEmpty ? nil : picks.first) ?? store.lib.newest
        if store.lib.all.isEmpty {
            Message(title: "Nothing here yet", text: "Drop videos into the Family TV Inbox on the Mac and they’ll show up here.")
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 50) {
                    if let hero { Hero(item: hero) }
                    if !cont.isEmpty {
                        Rail(title: "Continue Watching", entries: cont.map { RailEntry(item: $0.item, ep: $0.ep) })
                    }
                    if store.lib.all.count >= 4 {
                        Rail(title: store.evening ? "Tonight’s Picks" : "Picked for You", entries: picks.prefix(12).map { RailEntry(item: $0) })
                    }
                    ForEach(store.lib.rows) { r in
                        Rail(title: r.name, entries: r.items.map { RailEntry(item: $0) })
                    }
                }
                .padding(.bottom, 80)
            }
            .ignoresSafeArea(edges: .top)
        }
    }
}

struct Hero: View {
    @EnvironmentObject var store: Store
    let item: Item

    var body: some View {
        let m = store.metaOf(item)
        let kicker = [item.kind == .show ? "Series" : "Movie", m.year ?? item.year, m.genres.first].compactMap { $0 }.joined(separator: " · ")
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: store.bigArt[item.art] ?? store.art[item.art])
            LinearGradient(colors: [.black.opacity(0.85), .black.opacity(0.35), .clear], startPoint: .leading, endPoint: .trailing)
            LinearGradient(colors: [.clear, Color.bg], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 16) {
                Text(kicker.uppercased()).font(.system(size: 24, weight: .semibold)).kerning(2).foregroundStyle(Color.muted)
                Text(item.title).font(.system(size: 76, weight: .bold)).lineLimit(2)
                if let s = m.summary {
                    Text(s).font(.system(size: 29)).foregroundStyle(.white.opacity(0.8)).lineLimit(3).frame(maxWidth: 950, alignment: .leading)
                }
                HStack(spacing: 30) {
                    Button { store.play(item) } label: {
                        Label(store.started(item) ? "Resume" : "Play", systemImage: "play.fill")
                    }
                    if item.kind == .show {
                        NavigationLink(value: item) { Label("Episodes", systemImage: "list.bullet") }
                    }
                }
                .padding(.top, 14)
            }
            .padding(.horizontal, Size.edge)
            .padding(.bottom, 40)
        }
        .frame(height: 820)
        .clipped()
        .focusSection()
        .onAppear { store.loadBigArt(item.art) }
    }
}

// MARK: - Rows and cards

struct RailEntry: Identifiable {
    var item: Item
    var ep: Episode?
    var id: String { item.key + "|" + (ep?.id ?? "") }
}

struct Rail: View {
    let title: String
    let entries: [RailEntry]
    var showEpisodes = false

    var body: some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                if !title.isEmpty {
                    Text(title).font(.system(size: 34, weight: .semibold)).padding(.horizontal, Size.edge)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: Size.gap) {
                        ForEach(entries) { e in Card(item: e.item, ep: e.ep, episodeStyle: showEpisodes) }
                    }
                    .padding(.horizontal, Size.edge)
                    .padding(.vertical, 36)        // room for the focused card to grow
                }
                .scrollClipDisabled()
            }
            .focusSection()
        }
    }
}

struct Card: View {
    @EnvironmentObject var store: Store
    let item: Item
    var ep: Episode? = nil
    var episodeStyle = false            // inside a show's page: the episode's own name first
    var width: CGFloat = Size.card

    var body: some View {
        Group {
            if item.kind == .show && ep == nil {
                NavigationLink(value: item) { face }
            } else {
                Button { store.play(item, ep?.idx) } label: { face }
            }
        }
        .buttonStyle(.card)
    }

    private var artId: String { item.kind == .show ? (ep?.art ?? item.art) : item.art }
    private var title: String { episodeStyle && ep != nil ? ep!.title : item.title }
    private var subtitle: String? {
        if let ep, item.kind == .show {
            let num = ep.n.map { "E\($0)" }
            if episodeStyle { return [ep.seasonLabel.isEmpty ? nil : ep.seasonLabel, num.map { "Episode \($0.dropFirst())" }].compactMap { $0 }.joined(separator: " · ") }
            return [num, ep.title].compactMap { $0 }.joined(separator: " · ")
        }
        if item.kind == .show { return "\(item.episodes.count) episode\(item.episodes.count == 1 ? "" : "s")" }
        return store.metaOf(item).genres.first
    }
    private var watched: Double {
        if let ep { return store.fraction(ep) }
        return item.kind == .movie ? store.fraction(item.episodes[0]) : 0
    }

    private var face: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: store.art[artId])
            LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 26, weight: .semibold)).lineLimit(1)
                if let s = subtitle, !s.isEmpty {
                    Text(s).font(.system(size: 21)).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, watched > 0 ? 24 : 16)
            if watched > 0 {
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.25))
                    Capsule().fill(Color.accentRed).frame(width: max(8, (width - 36) * watched))
                }
                .frame(width: width - 36, height: 6)
                .padding(.horizontal, 18)
                .padding(.bottom, 12)
            }
        }
        .frame(width: width, height: width * 9 / 16)
    }
}

/// A picture from pCloud, kept in memory so scrolling back doesn't reload it
struct RemoteImage: View {
    let url: URL?
    @State private var image: UIImage?
    private static let cache = NSCache<NSURL, UIImage>()

    var body: some View {
        Color.panel
            .overlay {
                if let image { Image(uiImage: image).resizable().scaledToFill() }
            }
            .clipped()
            .task(id: url) {
                guard let url else { image = nil; return }
                if let hit = Self.cache.object(forKey: url as NSURL) { image = hit; return }
                guard let got = try? await URLSession.shared.data(from: url), let img = UIImage(data: got.0) else { return }
                Self.cache.setObject(img, forKey: url as NSURL)
                withAnimation(.easeOut(duration: 0.2)) { image = img }
            }
    }
}

// MARK: - Grids and search

struct GridPage: View {
    let title: String
    let items: [Item]
    private let columns = Array(repeating: GridItem(.fixed(380), spacing: 48), count: 4)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(title).font(.system(size: 57, weight: .bold))
                if items.isEmpty {
                    Text("Nothing here yet.").font(.system(size: 29)).foregroundStyle(Color.muted)
                }
                LazyVGrid(columns: columns, alignment: .leading, spacing: 56) {
                    ForEach(items) { Card(item: $0, width: 380) }
                }
                .padding(.vertical, 30)
            }
            .padding(.horizontal, Size.edge)
            .padding(.vertical, 40)
        }
    }
}

struct SearchView: View {
    @EnvironmentObject var store: Store
    @State private var query = ""
    private let columns = Array(repeating: GridItem(.fixed(380), spacing: 48), count: 4)

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 56) {
                ForEach(store.matches(query)) { Card(item: $0, width: 380) }
            }
            .padding(.horizontal, Size.edge)
            .padding(.vertical, 40)
        }
        .searchable(text: $query, prompt: "Shows, movies, episodes, genres")
    }
}

struct Message: View {
    let title: String
    let text: String
    var body: some View {
        VStack(spacing: 20) {
            Text(title).font(.system(size: 48, weight: .bold))
            Text(text).font(.system(size: 31)).foregroundStyle(Color.muted).multilineTextAlignment(.center).frame(maxWidth: 1100)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - A show (or movie) page

struct DetailView: View {
    @EnvironmentObject var store: Store
    let item: Item
    @State private var season = ""

    var body: some View {
        let m = store.metaOf(item)
        let seasons = item.episodes.reduce(into: [String]()) { if !$0.contains($1.seasonLabel) { $0.append($1.seasonLabel) } }
        let current = seasons.contains(season) ? season : (seasons.first ?? "")
        let eps = item.episodes.filter { $0.seasonLabel == current }
        let next = store.nextUnwatched(item)
        let kicker = [item.kind == .show ? "Series" : "Movie", m.year ?? item.year, m.rating].compactMap { $0 } + m.genres.prefix(3)
        ZStack(alignment: .topLeading) {
            RemoteImage(url: store.bigArt[item.art] ?? store.art[item.art])
                .ignoresSafeArea()
                .overlay(LinearGradient(colors: [.black.opacity(0.9), .black.opacity(0.5), .black.opacity(0.2)], startPoint: .leading, endPoint: .trailing).ignoresSafeArea())
                .overlay(LinearGradient(colors: [.clear, Color.bg], startPoint: .center, endPoint: .bottom).ignoresSafeArea())
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(kicker.joined(separator: " · ").uppercased()).font(.system(size: 24, weight: .semibold)).kerning(2).foregroundStyle(Color.muted)
                        Text(item.title).font(.system(size: 76, weight: .bold)).lineLimit(2)
                        if let s = m.summary {
                            Text(s).font(.system(size: 29)).foregroundStyle(.white.opacity(0.8)).lineLimit(4).frame(maxWidth: 1000, alignment: .leading)
                        }
                        HStack(spacing: 30) {
                            Button { store.play(item, next) } label: {
                                Label(playTitle(next), systemImage: "play.fill")
                            }
                            if item.kind == .show && item.episodes.count > 1 {
                                Button { store.play(item, Int.random(in: 0..<item.episodes.count)) } label: {
                                    Label("Random Episode", systemImage: "shuffle")
                                }
                            }
                        }
                        .padding(.top, 14)
                    }
                    .padding(.horizontal, Size.edge)
                    .padding(.top, 260)
                    .focusSection()

                    if item.kind == .show {
                        if seasons.count > 1 {
                            Picker("Season", selection: $season) {
                                ForEach(seasons, id: \.self) { Text($0).tag($0) }
                            }
                            .pickerStyle(.segmented)
                            .frame(maxWidth: 200 * CGFloat(seasons.count))
                            .padding(.horizontal, Size.edge)
                            .padding(.top, 50)
                        }
                        Rail(title: seasons.count > 1 ? "" : "Episodes", entries: eps.map { RailEntry(item: item, ep: $0) }, showEpisodes: true)
                            .padding(.top, 40)
                    }
                    Rail(title: "More Like This", entries: store.similar(to: item).map { RailEntry(item: $0) })
                        .padding(.top, 30)
                }
                .padding(.bottom, 80)
            }
        }
        .onAppear {
            store.loadBigArt(item.art)
            if season.isEmpty { season = item.episodes[store.nextUnwatched(item)].seasonLabel }
        }
    }
}

extension DetailView {
    /// "Play", "Resume", or for a show "Resume E3" / "Play E4"
    func playTitle(_ next: Int) -> String {
        let ep = item.episodes[next]
        let word = store.progress[ep.id] != nil ? "Resume" : "Play"
        guard item.kind == .show, word == "Resume" || next > 0 else { return word }
        return "\(word) E\(ep.n ?? next + 1)"
    }
}

// MARK: - Passcode (once per Apple TV)

struct PasscodeView: View {
    @EnvironmentObject var store: Store
    @State private var pin = ""
    @State private var message = ""
    @State private var busy = false
    @State private var lockedUntil: Date?
    @State private var shakes = 0
    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"]

    var body: some View {
        VStack(spacing: 34) {
            Image(systemName: "play.tv.fill").font(.system(size: 80)).foregroundStyle(Color.accentRed)
            Text(lockedUntil == nil ? "Enter Passcode" : "Too many wrong tries").font(.system(size: 48, weight: .semibold))
            HStack(spacing: 30) {
                ForEach(0..<4, id: \.self) { i in
                    Circle().fill(i < pin.count ? Color.white : Color.clear)
                        .overlay(Circle().stroke(Color.white, lineWidth: 3))
                        .frame(width: 26, height: 26)
                }
            }
            .modifier(Shake(amount: CGFloat(shakes)))
            Text(message).font(.system(size: 26)).foregroundStyle(Color.muted).frame(height: 34)
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(130), spacing: 40), count: 3), spacing: 30) {
                ForEach(keys, id: \.self) { k in
                    if k.isEmpty {
                        Color.clear.frame(width: 120, height: 120)
                    } else {
                        Button { press(k) } label: {
                            if k == "del" { Image(systemName: "delete.left") } else { Text(k) }
                        }
                        .buttonStyle(KeyStyle())
                    }
                }
            }
            .disabled(busy || lockedUntil != nil)
        }
        .task(id: lockedUntil) {
            guard let until = lockedUntil else { return }
            let wait = until.timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }
            if !Task.isCancelled { lockedUntil = nil; message = "" }
        }
    }

    private func press(_ k: String) {
        if k == "del" { if !pin.isEmpty && !busy { pin.removeLast() }; return }
        guard pin.count < 4, !busy else { return }
        pin += k
        guard pin.count == 4 else { return }
        busy = true
        Task {
            switch await store.unlock(pin) {
            case .ok:
                return
            case .wrong(let left):
                message = left <= 3 ? "Wrong passcode · \(left) \(left == 1 ? "try" : "tries") left" : "Wrong passcode"
            case .locked(let until):
                lockedUntil = until
                message = "Try again \(until.formatted(.relative(presentation: .named)))"
            case .offline:
                message = "No connection — check the internet and try again"
            }
            withAnimation(.linear(duration: 0.4)) { shakes += 1 }
            try? await Task.sleep(nanoseconds: 500_000_000)
            pin = ""
            busy = false
        }
    }
}

struct KeyStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Key(configuration: configuration) }

    struct Key: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.isFocused) private var focused
        var body: some View {
            configuration.label
                .font(.system(size: 50, weight: .medium))
                .foregroundStyle(focused ? Color.black : Color.white)
                .frame(width: 120, height: 120)
                .background(Circle().fill(focused ? Color.white : Color.white.opacity(0.12)))
                .scaleEffect(configuration.isPressed ? 0.94 : focused ? 1.12 : 1)
                .animation(.easeOut(duration: 0.15), value: focused)
        }
    }
}

struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 16 * sin(amount * .pi * 4), y: 0))
    }
}
