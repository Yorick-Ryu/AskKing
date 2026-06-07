import SwiftUI

struct RootView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Group {
            if appState.isPaired {
                pairedTabs
            } else {
                NavigationStack {
                    OnboardingView()
                }
            }
        }
        .alert("AskKing", isPresented: Binding(get: { appState.notice != nil }, set: { if !$0 { appState.notice = nil } })) {
            Button("好", role: .cancel) { appState.notice = nil }
        } message: {
            Text(appState.notice ?? "")
        }
    }

    private var pairedTabs: some View {
        TabView(selection: $appState.selectedTab) {
            NavigationStack {
                MessagesView()
            }
            .tabItem { Label("消息", systemImage: "message.badge") }
            .tag(AppTab.messages)
            .badge(appState.events.filter { $0.kind == "approval" && $0.status == "pending" && !$0.isNotifyOnly }.count)

            NavigationStack {
                ConnectionView()
            }
            .tabItem { Label("连接", systemImage: "network") }
            .tag(AppTab.connection)

            NavigationStack {
                SettingsView()
            }
            .tabItem { Label("设置", systemImage: "gearshape") }
            .tag(AppTab.settings)
        }
        .task {
            await appState.refreshEvents()
            appState.startPolling()
        }
    }
}
