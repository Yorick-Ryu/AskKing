import SwiftUI
import UIKit

struct ConnectionView: View {
    @EnvironmentObject private var appState: AppState
    @State private var pairingCode = ""
    @State private var isShowingScanner = false
    @State private var isShowingManualPairing = false
    @State private var isConfirmingLogout = false
    @State private var didCopyRelayCommand = false

    private let relayCommand = "npx askking@latest"

    private var isRelayUnavailable: Bool {
        ["离线", "异常", "未找到 Relay"].contains(appState.connectionStatus)
    }

    var body: some View {
        Form {
            Section("连接") {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Relay 地址")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("http://192.168.1.14:8787", text: $appState.relayURLString)
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

                if appState.isPaired && isRelayUnavailable {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("设备仍然已配对，但当前无法连接到 AskKing Relay。", systemImage: "wifi.slash")
                            .font(.footnote)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 12) {
                            Text(relayCommand)
                                .font(.system(.body, design: .monospaced).weight(.semibold))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)

                            Button {
                                copyRelayCommand()
                            } label: {
                                Image(systemName: didCopyRelayCommand ? "checkmark" : "doc.on.doc")
                                    .font(.system(size: 15, weight: .semibold))
                                    .frame(width: 32, height: 32)
                            }
                            .buttonStyle(.borderless)
                            .foregroundStyle(didCopyRelayCommand ? .green : .blue)
                            .accessibilityLabel(didCopyRelayCommand ? "已复制命令" : "复制命令")
                        }
                        .padding(.leading, 16)
                        .padding(.trailing, 8)
                        .padding(.vertical, 10)
                        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

                    Button {
                        Task { await appState.testConnection() }
                    } label: {
                        Label("重新连接", systemImage: "arrow.clockwise")
                    }
                } else if appState.isPaired {
                    Button(role: .destructive) {
                        isConfirmingLogout = true
                    } label: {
                        Label("退出配对", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } else {
                    Button {
                        isShowingScanner = true
                    } label: {
                        Label("扫描配对二维码", systemImage: "qrcode.viewfinder")
                    }

                    Button {
                        pairingCode = ""
                        isShowingManualPairing = true
                    } label: {
                        Label("输入配对码", systemImage: "keyboard")
                    }
                }
            }
        }
        .navigationTitle("连接")
        .sheet(isPresented: $isShowingScanner) {
            QRCodeScannerView { rawValue in
                if let payload = AskKingPairingPayload(rawValue: rawValue) {
                    pairingCode = payload.code
                }
                Task { await appState.pair(scannedValue: rawValue) }
            }
        }
        .alert("输入配对码", isPresented: $isShowingManualPairing) {
            TextField("配对码", text: $pairingCode)
                .textInputAutocapitalization(.characters)
            Button("取消", role: .cancel) {}
            Button("配对") {
                Task { await appState.pair(code: pairingCode) }
            }
            .disabled(pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: {
            Text("请输入终端二维码旁显示的配对码。")
        }
        .alert("退出配对？", isPresented: $isConfirmingLogout) {
            Button("退出配对", role: .destructive) {
                Task { await appState.logout() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("这会注销当前设备，并停止接收 AskKing 通知。")
        }
    }

    private func copyRelayCommand() {
        UIPasteboard.general.string = relayCommand
        didCopyRelayCommand = true

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.2))
            didCopyRelayCommand = false
        }
    }
}
