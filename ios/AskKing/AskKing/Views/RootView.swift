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
        .alert("Codex Done", isPresented: Binding(get: { appState.notice != nil }, set: { if !$0 { appState.notice = nil } })) {
            Button("好", role: .cancel) { appState.notice = nil }
        } message: {
            Text(appState.notice ?? "")
        }
    }

    private var pairedTabs: some View {
        TabView(selection: $appState.selectedTab) {
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
            await appState.ensureDeviceRegistration()
            await appState.updateNotificationStatus()
        }
    }
}
