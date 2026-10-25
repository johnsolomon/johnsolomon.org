import SwiftUI

extension Color {
    static let bg = Color(red: 10 / 255, green: 10 / 255, blue: 11 / 255)
    static let panel = Color(red: 20 / 255, green: 20 / 255, blue: 23 / 255)
    static let accentRed = Color(red: 229 / 255, green: 56 / 255, blue: 59 / 255)
    static let muted = Color(red: 154 / 255, green: 154 / 255, blue: 163 / 255)
}

// One set of sizes everywhere (Apple TV draws at 1920×1080 points)
enum Size {
    static let edge: CGFloat = 80           // left/right margin
    static let card: CGFloat = 400          // card width; cards are 16:9
    static let gap: CGFloat = 40
}

@main
struct FamilyTVApp: App {
    @StateObject private var store = Store()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .tint(.accentRed)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.refreshIfStale() }   // picks up newly added videos
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        ZStack {
            Color.bg.ignoresSafeArea()
            switch store.phase {
            case .starting:
                ProgressView()
            case .locked:
                PasscodeView()
            case .failed(let why):
                VStack(spacing: 30) {
                    Text("Can’t reach the video library").font(.system(size: 48, weight: .bold))
                    Text(why).font(.system(size: 31)).foregroundStyle(Color.muted)
                    Button("Try Again") { store.phase = .starting; Task { await store.start() } }.padding(.top, 30)
                }
            case .ready:
                MainView()
            }
        }
        .task { await store.start() }
    }
}
