import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        TabView {
            NavigationStack {
                MessagesView()
            }
            .tabItem { Label("消息", systemImage: "message.badge") }
            .badge(appState.events.filter { $0.kind == "approval" && $0.status == "pending" }.count)

            NavigationStack {
                ConnectionView()
            }
            .tabItem { Label("连接", systemImage: "network") }

            NavigationStack {
                SettingsView()
            }
            .tabItem { Label("设置", systemImage: "gearshape") }
        }
        .task {
            await appState.autoDiscoverRelayIfNeeded()
            await appState.refreshEvents()
            appState.startPolling()
        }
        .alert("AskKing", isPresented: Binding(get: { appState.notice != nil }, set: { if !$0 { appState.notice = nil } })) {
            Button("好", role: .cancel) { appState.notice = nil }
        } message: {
            Text(appState.notice ?? "")
        }
    }
}
