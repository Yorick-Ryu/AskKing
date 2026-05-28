import SwiftUI

@main
struct AskKingApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .preferredColorScheme(appState.appearance.colorScheme)
        }
    }
}
