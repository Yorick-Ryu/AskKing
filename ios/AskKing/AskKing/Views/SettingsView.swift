import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Form {
            Section("设备") {
                FieldRow("设备 ID", AppState.deviceId ?? "-")
                FieldRow("通知权限", appState.notificationStatusText)
                if appState.canRequestNotificationPermission {
                    Button {
                        Task { await appState.requestNotifications() }
                    } label: {
                        Label("请求通知权限", systemImage: "bell.badge")
                    }
                }
            }

            Section("外观") {
                Picker("显示模式", selection: $appState.appearance) {
                    ForEach(AppearanceMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section("关于") {
                FieldRow("版本", appState.appVersionText)
            }
        }
        .navigationTitle("设置")
        .task { await appState.updateNotificationStatus() }
    }
}
