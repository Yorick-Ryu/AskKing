import SwiftUI
import UIKit

struct ConnectionView: View {
    @EnvironmentObject private var appState: AppState
    @State private var isConfirmingLogout = false

    var body: some View {
        Form {
            Section("电脑配置") {
                if let token = appState.codexClientToken, !token.isEmpty {
                    FieldRow("通知 Token", token)
                    Button {
                        UIPasteboard.general.string = appState.codexSetupPrompt
                        appState.notice = "已复制配置提示词。把它粘贴给电脑上的 Codex 即可。"
                    } label: {
                        Label("复制给 Codex 的配置提示词", systemImage: "doc.on.doc")
                    }
                    Button {
                        Task { await appState.refreshCodexClientToken() }
                    } label: {
                        Label("重新生成 Token", systemImage: "arrow.clockwise")
                    }
                } else {
                    Button {
                        Task { await appState.ensureDeviceRegistration() }
                    } label: {
                        Label("生成本机通知 Token", systemImage: "iphone.gen3")
                    }
                }
            }

            Section("连接") {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Relay 地址")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField(AppState.defaultRelayURLString, text: $appState.relayURLString)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .textSelection(.enabled)
                }
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("连接状态")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(appState.connectionStatus)
                    }
                    Spacer()
                    Button {
                        Task { await appState.testConnection() }
                    } label: {
                        HStack(spacing: 6) {
                            if appState.isTestingConnection {
                                ProgressView()
                                    .controlSize(.small)
                                    .frame(width: 16, height: 16)
                            } else {
                                Image(systemName: "dot.radiowaves.left.and.right")
                                    .font(.system(size: 15, weight: .semibold))
                                    .frame(width: 16, height: 16)
                            }
                            Text("测试")
                                .font(.system(size: 16, weight: .semibold))
                        }
                        .frame(height: 34)
                        .padding(.horizontal, 12)
                        .background(Color(.tertiarySystemFill), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.blue)
                    .disabled(appState.isTestingConnection)
                    .accessibilityLabel(appState.isTestingConnection ? "正在测试连接" : "测试连接")
                }
                .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }

                FieldRow("配对状态", appState.isPaired ? "已配对" : "未配对")

                if appState.isPaired {
                    Button(role: .destructive) {
                        isConfirmingLogout = true
                    } label: {
                        Label("退出配对", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } else {
                    Button { Task { await appState.ensureDeviceRegistration() } } label: {
                        Label("自动注册这台 iPhone", systemImage: "iphone.gen3")
                    }
                }
            }
        }
        .navigationTitle("连接")
        .alert("退出配对？", isPresented: $isConfirmingLogout) {
            Button("退出配对", role: .destructive) {
                Task { await appState.logout() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("这会注销当前设备，并停止接收 Codex Done 通知。")
        }
    }

}
