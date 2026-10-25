import AVKit
import UIKit

/// Plays with Apple's own TV player: Siri Remote scrubbing with previews, ±10 s clicks,
/// subtitles and audio menus, and the TV switching to each video's frame rate and HDR.
/// Resumes where anyone in the family left off, rolls into the next episode by itself,
/// and shows a "Next Episode" button over the last moments.
@MainActor
final class Playback: NSObject, AVPlayerViewControllerDelegate {
    static let shared = Playback()

    private weak var store: Store?
    private var item: Item?
    private var index = 0
    private var controller: AVPlayerViewController?
    private let player = AVPlayer()
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var statusObserver: NSKeyValueObservation?
    private var ahead: (id: String, url: URL, at: Date)?
    private var loading = false
    private var retried = false

    func start(store: Store, item: Item, index: Int) {
        self.store = store
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        let vc = AVPlayerViewController()
        vc.player = player
        vc.delegate = self
        controller = vc
        if timeObserver == nil {
            timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 5, preferredTimescale: 1), queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.tick() }
            }
        }
        topController()?.present(vc, animated: true)
        load(item, index)
    }

    // MARK: loading a video

    private func load(_ it: Item, _ i: Int) {
        guard let store, let cloud = store.cloud, it.episodes.indices.contains(i) else { return }
        saveNow()
        item = it; index = i; retried = false
        let ep = it.episodes[i]
        controller?.contextualActions = []
        loading = true
        Task {
            do {
                let url: URL
                if let a = ahead, a.id == ep.id, Date().timeIntervalSince(a.at) < 300 { url = a.url } else { url = try await cloud.videoURL(ep.id) }
                ahead = nil
                let pi = AVPlayerItem(url: url)
                pi.externalMetadata = metadata(it, ep)
                watch(pi, resumeAt: resumePoint(ep))
                player.replaceCurrentItem(with: pi)
            } catch {
                loading = false
                let limit = (error as? PCloudError)?.result == 7005
                fail(limit ? "pCloud’s sharing limit for this month has been reached." : "Couldn’t reach pCloud. Check the internet connection.")
            }
        }
    }

    private func resumePoint(_ ep: Episode) -> Double {
        guard let p = store?.progress[ep.id], p.t > 10, p.t < p.d - 30 else { return 0 }
        return p.t
    }

    private func watch(_ pi: AVPlayerItem, resumeAt: Double) {
        statusObserver = pi.observe(\.status, options: [.new]) { [weak self] pi, _ in
            DispatchQueue.main.async { MainActor.assumeIsolated {
                guard let self else { return }
                switch pi.status {
                case .readyToPlay:
                    guard self.loading else { return }
                    self.loading = false
                    if resumeAt > 0 {
                        Task { @MainActor in
                            await self.player.seek(to: CMTime(seconds: resumeAt, preferredTimescale: 600))
                            self.player.play()
                        }
                    } else { self.player.play() }
                case .failed:
                    self.loading = false
                    if !self.retried, let it = self.item {        // links can go stale; ask pCloud for a fresh one once
                        let i = self.index
                        self.ahead = nil
                        self.load(it, i)
                        self.retried = true
                    } else {
                        self.fail("This video can’t be played. Drop it into the Family TV Inbox on the Mac to convert it.")
                    }
                default: break
                }
            } }
        }
        if let o = endObserver { NotificationCenter.default.removeObserver(o) }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: pi, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.ended() }
        }
    }

    private func metadata(_ it: Item, _ ep: Episode) -> [AVMetadataItem] {
        func meta(_ id: AVMetadataIdentifier, _ v: Any) -> AVMetadataItem {
            let m = AVMutableMetadataItem()
            m.identifier = id
            m.value = v as? NSCopying & NSObjectProtocol
            m.extendedLanguageTag = "und"
            return m.copy() as! AVMetadataItem
        }
        var out: [AVMetadataItem] = []
        if it.kind == .show {
            out.append(meta(.commonIdentifierTitle, ep.title as NSString))
            let sub = [ep.seasonLabel, ep.n.map { "Episode \($0)" } ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
            out.append(meta(.iTunesMetadataTrackSubTitle, (sub.isEmpty ? it.title : "\(it.title) · \(sub)") as NSString))
        } else {
            out.append(meta(.commonIdentifierTitle, it.title as NSString))
        }
        if let s = store?.metaOf(it).summary { out.append(meta(.commonIdentifierDescription, s as NSString)) }
        return out
    }

    // MARK: while playing

    private func tick() {
        saveNow()
        guard item != nil, let pi = player.currentItem else { return }
        let left = pi.duration.seconds - player.currentTime().seconds
        guard left.isFinite else { return }
        let next = upNext()
        if left < 45, let n = next {
            if controller?.contextualActions.isEmpty ?? false {
                controller?.contextualActions = [UIAction(title: n.label, image: UIImage(systemName: "forward.end.fill")) { [weak self] _ in
                    MainActor.assumeIsolated { self?.load(n.item, n.index) }
                }]
            }
            let nextEp = n.item.episodes[n.index]
            if ahead?.id != nextEp.id, let cloud = store?.cloud {           // fetch the next link early, so it starts instantly
                Task { if let u = try? await cloud.videoURL(nextEp.id) { self.ahead = (nextEp.id, u, Date()) } }
            }
        } else if left >= 45, !(controller?.contextualActions.isEmpty ?? true) {
            controller?.contextualActions = []
        }
    }

    private func saveNow() {
        guard let store, let it = item, let pi = player.currentItem, it.episodes.indices.contains(index) else { return }
        let d = pi.duration.seconds, t = player.currentTime().seconds
        if d.isFinite, d > 0, t.isFinite { store.save(it, it.episodes[index], t: t, d: d) }
    }

    /// The next episode, or at the end of a show or movie, the top AI pick not yet watched to the end
    private func upNext() -> (item: Item, index: Int, label: String)? {
        guard let store, let it = item else { return nil }
        if index + 1 < it.episodes.count { return (it, index + 1, "Next Episode") }
        guard let nx = store.forYou(skip: [it.key]).first(where: { !store.finished($0) }) else { return nil }
        return (nx, store.nextUnwatched(nx), "Watch \(nx.title)")
    }

    private func ended() {
        saveNow()
        if let n = upNext() { load(n.item, n.index) } else { controller?.dismiss(animated: true) }
    }

    private func fail(_ message: String) {
        let a = UIAlertController(title: "Can’t play", message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in self?.controller?.dismiss(animated: true) })
        controller?.present(a, animated: true)
    }

    // MARK: closing

    nonisolated func playerViewControllerWillBeginDismissalTransition(_ playerViewController: AVPlayerViewController) {
        MainActor.assumeIsolated { saveNow() }
    }

    nonisolated func playerViewControllerDidEndDismissalTransition(_ playerViewController: AVPlayerViewController) {
        MainActor.assumeIsolated { closed() }
    }

    private func closed() {
        saveNow()
        player.pause()
        player.replaceCurrentItem(with: nil)
        statusObserver = nil
        if let o = endObserver { NotificationCenter.default.removeObserver(o); endObserver = nil }
        item = nil; controller = nil; ahead = nil
        store?.flush()
    }

    private func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        var top = scenes.flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController
        while let p = top?.presentedViewController { top = p }
        return top
    }
}
