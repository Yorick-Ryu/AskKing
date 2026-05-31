import SwiftUI

struct ConnectionView: View {
    @EnvironmentObject private var appState: AppState
    @State private var pairingCode = ""

    var body: some View {
        Form {
            Section("Relay") {
                TextField("中继地址", text: $appState.relayURLString)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                FieldRow("连接状态", appState.connectionStatus)
                FieldRow("部署模式", appState.relayURLString.hasPrefix("https://") ? "公网或 HTTPS 局域网" : "局域网开发")
                Button {
                    Task { await appState.testConnection() }
                } label: {
                    Label("测试连接", systemImage: "dot.radiowaves.left.and.right")
                }
                Button {
                    Task { await appState.discoverRelay() }
                } label: {
                    Label(appState.isDiscoveringRelay ? "正在自动发现" : "自动发现局域网 Relay", systemImage: "magnifyingglass")
                }
                .disabled(appState.isDiscoveringRelay)
            }

            Section("配对") {
                TextField("配对码", text: $pairingCode)
                    .textInputAutocapitalization(.characters)
                Button {
                    Task { await appState.pair(code: pairingCode) }
                } label: {
                    Label(appState.isPaired ? "重新配对" : "配对设备", systemImage: "link")
                }
                .disabled(pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if appState.isPaired {
                    Button(role: .destructive) {
                        appState.logout()
                    } label: {
                        Label("退出配对", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
        }
        .navigationTitle("连接")
    }
}
