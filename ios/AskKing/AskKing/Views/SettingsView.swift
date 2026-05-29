import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Form {
            Section("设备") {
                FieldRow("设备名", UIDevice.current.name)
                FieldRow("设备 ID", UserDefaults.standard.string(forKey: "deviceId") ?? "-")
                FieldRow("通知权限", appState.notificationStatus)
                Button {
                    Task { await appState.requestNotifications() }
                } label: {
                    Label("请求通知权限", systemImage: "bell.badge")
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

            Section("本地数据") {
                Button {
                    appState.events = []
                } label: {
                    Label("清理本地缓存", systemImage: "trash")
                }
                Button(role: .destructive) {
                    appState.logout()
                } label: {
                    Label("退出配对", systemImage: "xmark.circle")
                }
            }

            Section("关于") {
                FieldRow("产品", "AskKing")
                FieldRow("定位", "Agents ask. You decide.")
                FieldRow("版本", "0.1.0 MVP")
            }
        }
        .navigationTitle("设置")
        .task { await appState.updateNotificationStatus() }
    }
}
